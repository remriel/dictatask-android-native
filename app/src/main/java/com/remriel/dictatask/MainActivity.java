package com.remriel.dictatask;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceResponse;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.view.ViewGroup;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.activity.ComponentActivity;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.BufferedOutputStream;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Hosts the locally bundled DictaTask application. All web assets are served by
 * WebViewAssetLoader from this APK; no remote URL is loaded at runtime.
 */
public final class MainActivity extends ComponentActivity {
    static final String ACTION_OPEN_TASK = "com.remriel.dictatask.action.OPEN_TASK";
    static final String EXTRA_TASK_ID = "task_id";

    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String LOCAL_ENTRYPOINT =
            "https://" + ASSET_HOST + "/assets/index.html";
    private static final long PARTIAL_RESULT_COALESCE_MILLIS = 75L;
    private static volatile WeakReference<MainActivity> activeActivity =
            new WeakReference<>(null);

    private WebView webView;
    private SpeechRecognizer speechRecognizer;
    private SharedPreferences statePreferences;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService exportExecutor = Executors.newSingleThreadExecutor();
    private ActivityResultLauncher<String> microphonePermissionLauncher;
    private ActivityResultLauncher<String> notificationPermissionLauncher;
    private ActivityResultLauncher<Intent> exportFileLauncher;
    private String pendingExportContents;
    private String pendingTaskId;
    private boolean awaitingMicrophonePermission;
    private boolean webContentReady;
    private boolean pendingNativeStateChanged;
    private boolean pendingReminderSettingsChanged;
    private boolean recognitionActive;
    private boolean partialResultScheduled;
    private String pendingPartialTranscript;
    private final Runnable partialResultDispatcher = () -> {
        partialResultScheduled = false;
        String transcript = pendingPartialTranscript;
        pendingPartialTranscript = null;
        if (transcript != null && !transcript.isEmpty()) {
            emitSpeechResultNow(transcript, false);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        statePreferences = getSharedPreferences(
                TaskSnapshotRepository.PREFERENCES_NAME,
                MODE_PRIVATE
        );
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        configureMicrophonePermission();
        configureNotificationPermission();
        configureExportFilePicker();
        handleNotificationIntent(getIntent());
        configureWebView();
    }

    private void configureExportFilePicker() {
        exportFileLauncher = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(),
                result -> {
                    String contents = pendingExportContents;
                    pendingExportContents = null;
                    if (result.getResultCode() != RESULT_OK || result.getData() == null || contents == null) {
                        return;
                    }

                    Uri destination = result.getData().getData();
                    if (destination == null) {
                        return;
                    }

                    writeTaskHistoryExport(destination, contents);
                }
        );
    }

    private void writeTaskHistoryExport(Uri destination, String contents) {
        exportExecutor.execute(() -> {
            boolean exported = false;
            try (OutputStream rawOutput = getContentResolver().openOutputStream(destination)) {
                if (rawOutput == null) {
                    throw new IllegalStateException("The selected location could not be opened.");
                }
                try (BufferedOutputStream output = new BufferedOutputStream(rawOutput)) {
                    output.write(contents.getBytes(StandardCharsets.UTF_8));
                }
                exported = true;
            } catch (Exception ignored) {
                // The user-facing result is posted below on the main thread.
            }
            boolean exportSucceeded = exported;
            runOnUiThread(() -> Toast.makeText(
                    this,
                    exportSucceeded
                            ? "Task history exported."
                            : "Could not export task history.",
                    exportSucceeded ? Toast.LENGTH_SHORT : Toast.LENGTH_LONG
            ).show());
        });
    }

    private void launchTaskHistoryExport(String contents) {
        if (exportFileLauncher == null) {
            return;
        }
        pendingExportContents = contents;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("text/plain");
        intent.putExtra(Intent.EXTRA_TITLE, "dictatask-task-history.txt");
        exportFileLauncher.launch(intent);
    }

    private void configureNotificationPermission() {
        notificationPermissionLauncher = registerForActivityResult(
                new ActivityResultContracts.RequestPermission(),
                granted -> {
                    ReminderPreferences preferences = new ReminderPreferences(this);
                    if (!granted) {
                        preferences.setEnabled(false);
                    }
                    ReminderScheduler.reconcile(this);
                    dispatchReminderSettingsChanged();
                }
        );
    }

    private void configureMicrophonePermission() {
        microphonePermissionLauncher = registerForActivityResult(
                new ActivityResultContracts.RequestPermission(),
                granted -> {
                    if (granted && awaitingMicrophonePermission) {
                        startNativeRecognition();
                    } else if (!granted) {
                        emitSpeechError("not-allowed");
                        emitSpeechEnd();
                    }
                }
        );
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(21, 18, 28));
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, windowInsets) -> {
            Insets systemBars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(
                    systemBars.left,
                    systemBars.top,
                    systemBars.right,
                    systemBars.bottom
            );
            return windowInsets;
        });
        setContentView(webView);
        ViewCompat.requestApplyInsets(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.addJavascriptInterface(new NativeSpeechBridge(), "DictaTaskAndroid");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(
                    WebView view,
                    WebResourceRequest request
            ) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String host = request.getUrl().getHost();
                return host == null || !ASSET_HOST.equals(host);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // React explicitly acknowledges when its native-event listeners are attached.
            }

            @Override
            public boolean onRenderProcessGone(
                    WebView view,
                    RenderProcessGoneDetail detail
            ) {
                if (view != webView) {
                    return false;
                }
                webContentReady = false;
                view.removeJavascriptInterface("DictaTaskAndroid");
                if (view.getParent() instanceof ViewGroup) {
                    ((ViewGroup) view.getParent()).removeView(view);
                }
                view.destroy();
                webView = null;
                getWindow().getDecorView().post(() -> {
                    if (!isFinishing() && !isDestroyed()) {
                        configureWebView();
                    }
                });
                return true;
            }
        });
        webView.loadUrl(LOCAL_ENTRYPOINT);
    }

    private void handleNotificationIntent(Intent intent) {
        if (intent == null || !ACTION_OPEN_TASK.equals(intent.getAction())) {
            return;
        }
        String taskId = intent.getStringExtra(EXTRA_TASK_ID);
        if (taskId != null && !taskId.isBlank()) {
            pendingTaskId = taskId;
            if (webContentReady) {
                dispatchPendingTaskNavigation();
            }
        }
    }

    private void requestNotificationPermissionFromUi() {
        runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                    || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED) {
                ReminderScheduler.reconcile(this);
                dispatchReminderSettingsChanged();
                return;
            }
            if (notificationPermissionLauncher != null) {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS);
            }
        });
    }

    private void setRemindersEnabledFromUi(boolean enabled) {
        new ReminderPreferences(this).setEnabled(enabled);
        if (enabled) {
            ReminderScheduler.reconcile(this);
        } else {
            ReminderScheduler.cancel(this);
        }
        runOnUiThread(this::dispatchReminderSettingsChanged);
    }

    private String getReminderSettingsJson() {
        ReminderScheduler.ensureNotificationChannel(this);
        ReminderPreferences preferences = new ReminderPreferences(this);
        JSONObject settings = new JSONObject();
        try {
            settings.put("enabled", preferences.isEnabled());
            settings.put("permissionGranted", ReminderNotification.hasRuntimePermission(this));
            settings.put(
                    "notificationsEnabled",
                    ReminderNotification.areNotificationsUsable(this)
            );
            settings.put("quietStartHour", preferences.getQuietStartHour());
            settings.put("quietEndHour", preferences.getQuietEndHour());
        } catch (Exception ignored) {
            // These primitive values are always JSON-safe.
        }
        return settings.toString();
    }

    private void openNotificationSettingsFromUi() {
        runOnUiThread(() -> {
            ReminderScheduler.ensureNotificationChannel(this);
            Intent channelSettings = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())
                    .putExtra(Settings.EXTRA_CHANNEL_ID, ReminderNotification.CHANNEL_ID);
            try {
                startActivity(channelSettings);
            } catch (RuntimeException exception) {
                Intent appSettings = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                startActivity(appSettings);
            }
        });
    }

    private void setColorSchemeFromUi(String scheme) {
        if (!"light".equals(scheme) && !"dark".equals(scheme)) {
            return;
        }
        runOnUiThread(() -> {
            boolean light = "light".equals(scheme);
            int systemColor = ContextCompat.getColor(
                    this,
                    light ? R.color.dt_paper : R.color.dt_charcoal
            );
            if (webView != null) {
                webView.setBackgroundColor(systemColor);
            }
            getWindow().getDecorView().setBackgroundColor(systemColor);
            getWindow().setStatusBarColor(systemColor);
            getWindow().setNavigationBarColor(systemColor);
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
                    getWindow(),
                    getWindow().getDecorView()
            );
            controller.setAppearanceLightStatusBars(light);
            controller.setAppearanceLightNavigationBars(light);
        });
    }

    private void dispatchReminderSettingsChanged() {
        if (!webContentReady) {
            pendingReminderSettingsChanged = true;
            return;
        }
        pendingReminderSettingsChanged = false;
        dispatchWebEvent(
                "dictatask:reminder-settings-changed",
                getReminderSettingsJson()
        );
    }

    private void dispatchNativeStateChanged() {
        if (!webContentReady) {
            pendingNativeStateChanged = true;
            return;
        }
        pendingNativeStateChanged = false;
        JSONObject detail = new JSONObject();
        try {
            detail.put("key", TaskSnapshotRepository.TASKS_KEY);
        } catch (Exception ignored) {
            // The constant key is always JSON-safe.
        }
        dispatchWebEvent("dictatask:native-state-changed", detail.toString());
    }

    private void dispatchPendingTaskNavigation() {
        String taskId = pendingTaskId;
        if (!webContentReady || taskId == null) {
            return;
        }
        pendingTaskId = null;
        JSONObject detail = new JSONObject();
        try {
            detail.put("destination", "task");
            detail.put("taskId", taskId);
        } catch (Exception ignored) {
            return;
        }
        dispatchWebEvent("dictatask:navigate", detail.toString());
    }

    private void dispatchWebEvent(String eventName, String detailJson) {
        evaluateJavascript(
                "window.dispatchEvent(new CustomEvent("
                        + JSONObject.quote(eventName)
                        + ", { detail: "
                        + detailJson
                        + " }));"
        );
    }

    private void flushPendingWebEvents() {
        dispatchPendingTaskNavigation();
        if (pendingNativeStateChanged) {
            dispatchNativeStateChanged();
        }
        if (pendingReminderSettingsChanged) {
            dispatchReminderSettingsChanged();
        }
    }

    static void dispatchNativeStateChangedIfActive() {
        MainActivity activity = activeActivity.get();
        if (activity != null) {
            activity.runOnUiThread(activity::dispatchNativeStateChanged);
        }
    }

    static boolean isAppInForeground() {
        return activeActivity.get() != null;
    }

    private void startNativeRecognition() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            awaitingMicrophonePermission = true;
            microphonePermissionLauncher.launch(Manifest.permission.RECORD_AUDIO);
            return;
        }

        awaitingMicrophonePermission = false;
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            emitSpeechError("audio-capture");
            emitSpeechEnd();
            return;
        }

        if (speechRecognizer == null) {
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
            speechRecognizer.setRecognitionListener(new RecognitionListener() {
                @Override
                public void onReadyForSpeech(Bundle params) {
                    // The bundled app already changes its visible recording state.
                }

                @Override
                public void onBeginningOfSpeech() {
                    // Transcription feedback is delivered through partial results.
                }

                @Override
                public void onRmsChanged(float rmsdB) {
                    // The site’s animated voice wave remains the visual feedback.
                }

                @Override
                public void onBufferReceived(byte[] buffer) {
                    // Raw microphone samples are never retained.
                }

                @Override
                public void onEndOfSpeech() {
                    // Wait for final results before ending this recognition segment.
                }

                @Override
                public void onError(int error) {
                    clearPendingPartialResult();
                    emitSpeechError(mapSpeechError(error));
                    emitSpeechEnd();
                }

                @Override
                public void onResults(Bundle results) {
                    clearPendingPartialResult();
                    emitSpeechResult(firstRecognitionResult(results), true);
                    emitSpeechEnd();
                }

                @Override
                public void onPartialResults(Bundle partialResults) {
                    emitSpeechResult(firstRecognitionResult(partialResults), false);
                }

                @Override
                public void onEvent(int eventType, Bundle params) {
                    // No additional events are required by DictaTask’s recognition bridge.
                }
            });
        }

        try {
            android.content.Intent recognizerIntent =
                    new android.content.Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            recognizerIntent.putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
            );
            recognizerIntent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            recognizerIntent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            recognizerIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US");
            recognizerIntent.putExtra(
                    RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS,
                    30_000L
            );
            recognizerIntent.putExtra(
                    RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS,
                    30_000L
            );
            recognizerIntent.putExtra(
                    RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS,
                    30_000L
            );
            speechRecognizer.startListening(recognizerIntent);
            recognitionActive = true;
        } catch (SecurityException exception) {
            emitSpeechError("not-allowed");
            emitSpeechEnd();
        } catch (RuntimeException exception) {
            emitSpeechError("audio-capture");
            emitSpeechEnd();
        }
    }

    private void stopNativeRecognition() {
        if (speechRecognizer != null) {
            try {
                speechRecognizer.stopListening();
            } catch (RuntimeException exception) {
                emitSpeechEnd();
            }
        }
    }

    private void abortNativeRecognition() {
        clearPendingPartialResult();
        if (speechRecognizer != null) {
            try {
                speechRecognizer.cancel();
            } catch (RuntimeException ignored) {
                // The web side is explicitly closed below either way.
            }
        }
        emitSpeechEnd();
    }

    private String firstRecognitionResult(Bundle results) {
        if (results == null) {
            return "";
        }

        ArrayList<String> candidates = results.getStringArrayList(
                SpeechRecognizer.RESULTS_RECOGNITION
        );
        if (candidates == null || candidates.isEmpty()) {
            return "";
        }
        return candidates.get(0).trim();
    }

    @NonNull
    private String mapSpeechError(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "not-allowed";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "network";
            case SpeechRecognizer.ERROR_AUDIO:
                return "audio-capture";
            case SpeechRecognizer.ERROR_CLIENT:
                return "aborted";
            default:
                return "no-speech";
        }
    }

    private void emitSpeechResult(String transcript, boolean isFinal) {
        if (transcript.isEmpty()) {
            return;
        }
        if (!isFinal) {
            pendingPartialTranscript = transcript;
            if (!partialResultScheduled) {
                partialResultScheduled = true;
                mainHandler.postDelayed(
                        partialResultDispatcher,
                        PARTIAL_RESULT_COALESCE_MILLIS
                );
            }
            return;
        }
        emitSpeechResultNow(transcript, true);
    }

    private void emitSpeechResultNow(String transcript, boolean isFinal) {
        evaluateJavascript(
                "window.__dictaSpeechResult && window.__dictaSpeechResult("
                        + JSONObject.quote(transcript)
                        + ", "
                        + isFinal
                        + ");"
        );
    }

    private void clearPendingPartialResult() {
        pendingPartialTranscript = null;
        if (partialResultScheduled) {
            mainHandler.removeCallbacks(partialResultDispatcher);
            partialResultScheduled = false;
        }
    }

    private void emitSpeechError(String error) {
        evaluateJavascript(
                "window.__dictaSpeechError && window.__dictaSpeechError("
                        + JSONObject.quote(error)
                        + ");"
        );
    }

    private void emitSpeechEnd() {
        recognitionActive = false;
        clearPendingPartialResult();
        evaluateJavascript("window.__dictaSpeechEnd && window.__dictaSpeechEnd();");
    }

    private void evaluateJavascript(String script) {
        WebView target = webView;
        if (target == null) {
            return;
        }
        target.post(() -> {
            if (target == webView) {
                target.evaluateJavascript(script, null);
            }
        });
    }

    private String getStoredState(String key) {
        if (key == null || key.isEmpty()) {
            return "";
        }
        return statePreferences == null ? "" : statePreferences.getString(key, "");
    }

    private void setStoredState(String key, String raw) {
        if (key == null || key.isEmpty() || raw == null) {
            return;
        }
        if (statePreferences != null) {
            statePreferences.edit().putString(key, raw).apply();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleNotificationIntent(intent);
    }

    @Override
    protected void onStart() {
        super.onStart();
        activeActivity = new WeakReference<>(this);
        new ReminderPreferences(this).markForeground();
        ReminderNotification.cancel(this);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            webView.post(() -> ReminderScheduler.reconcile(getApplicationContext()));
        }
        dispatchReminderSettingsChanged();
        dispatchNativeStateChanged();
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onStop() {
        if (recognitionActive) {
            abortNativeRecognition();
        }
        MainActivity active = activeActivity.get();
        if (active == this) {
            activeActivity = new WeakReference<>(null);
        }
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        clearPendingPartialResult();
        exportExecutor.shutdownNow();
        if (speechRecognizer != null) {
            speechRecognizer.destroy();
            speechRecognizer = null;
        }
        if (webView != null) {
            webView.removeJavascriptInterface("DictaTaskAndroid");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private final class NativeSpeechBridge {
        @JavascriptInterface
        public void startRecognition() {
            runOnUiThread(MainActivity.this::startNativeRecognition);
        }

        @JavascriptInterface
        public void stopRecognition() {
            runOnUiThread(MainActivity.this::stopNativeRecognition);
        }

        @JavascriptInterface
        public void abortRecognition() {
            runOnUiThread(MainActivity.this::abortNativeRecognition);
        }

        @JavascriptInterface
        public String getStoredState(String key) {
            return MainActivity.this.getStoredState(key);
        }

        @JavascriptInterface
        public void setStoredState(String key, String raw) {
            MainActivity.this.setStoredState(key, raw);
        }

        @JavascriptInterface
        public String getReminderSettings() {
            return MainActivity.this.getReminderSettingsJson();
        }

        @JavascriptInterface
        public void setRemindersEnabled(boolean enabled) {
            MainActivity.this.setRemindersEnabledFromUi(enabled);
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            MainActivity.this.requestNotificationPermissionFromUi();
        }

        @JavascriptInterface
        public void openNotificationSettings() {
            MainActivity.this.openNotificationSettingsFromUi();
        }

        @JavascriptInterface
        public void setColorScheme(String scheme) {
            MainActivity.this.setColorSchemeFromUi(scheme);
        }

        @JavascriptInterface
        public void notifyWebReady() {
            runOnUiThread(() -> {
                webContentReady = true;
                flushPendingWebEvents();
            });
        }

        @JavascriptInterface
        public void exportTaskHistory(String contents) {
            runOnUiThread(() -> launchTaskHistoryExport(contents == null ? "" : contents));
        }
    }
}
