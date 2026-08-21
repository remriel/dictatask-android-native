package com.remriel.dictatask;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Hosts the locally bundled DictaTask application. All web assets are served by
 * WebViewAssetLoader from this APK; no remote URL is loaded at runtime.
 */
public final class MainActivity extends ComponentActivity {
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String LOCAL_ENTRYPOINT =
            "https://" + ASSET_HOST + "/assets/index.html";
    private static final String STATE_PREFERENCES = "dictatask_state";
    private static final String RETIRED_REMINDER_PREFERENCES = "dictatask_reminders";
    private static final String RETIRED_REMINDER_CHANNEL = "dictatask_focus_v2";
    private static final String RETIRED_LEGACY_CHANNEL = "dictatask_hourly_reminders";
    private static final int RETIRED_REMINDER_NOTIFICATION_ID = 7042;
    private static final int RETIRED_LEGACY_NOTIFICATION_ID = 7041;
    private static final long PARTIAL_RESULT_COALESCE_MILLIS = 75L;

    private WebView webView;
    private SpeechRecognizer speechRecognizer;
    private SharedPreferences statePreferences;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService exportExecutor = Executors.newSingleThreadExecutor();
    private ActivityResultLauncher<String> microphonePermissionLauncher;
    private ActivityResultLauncher<Intent> exportFileLauncher;
    private String pendingExportContents;
    private boolean awaitingMicrophonePermission;
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
                STATE_PREFERENCES,
                MODE_PRIVATE
        );
        retireFocusSignals();
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        configureMicrophonePermission();
        configureExportFilePicker();
        configureWebView();
    }

    /** Removes the retired custom reminder surface from upgraded installs. */
    private void retireFocusSignals() {
        getSharedPreferences(RETIRED_REMINDER_PREFERENCES, MODE_PRIVATE)
                .edit()
                .clear()
                .apply();

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        manager.cancel(RETIRED_REMINDER_NOTIFICATION_ID);
        manager.cancel(RETIRED_LEGACY_NOTIFICATION_ID);
        manager.deleteNotificationChannel(RETIRED_REMINDER_CHANNEL);
        manager.deleteNotificationChannel(RETIRED_LEGACY_CHANNEL);
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
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
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
        public void setColorScheme(String scheme) {
            MainActivity.this.setColorSchemeFromUi(scheme);
        }

        @JavascriptInterface
        public void exportTaskHistory(String contents) {
            runOnUiThread(() -> launchTaskHistoryExport(contents == null ? "" : contents));
        }
    }
}
