package com.remriel.dictatask;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.MediaRecorder;
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
import android.util.Base64;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

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
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

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
    private static final String GROQ_KEY_PREFERENCE = "groq_api_key_v1";
    private static final String GROQ_KEYSTORE = "AndroidKeyStore";
    private static final String GROQ_KEY_ALIAS = "dictatask_groq_key";
    private static final String GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
    private static final int GROQ_CONNECT_TIMEOUT_MILLIS = 20_000;
    private static final int GROQ_READ_TIMEOUT_MILLIS = 60_000;

    private WebView webView;
    private SpeechRecognizer speechRecognizer;
    private MediaRecorder groqRecorder;
    private File groqAudioFile;
    private SharedPreferences statePreferences;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService exportExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService groqExecutor = Executors.newSingleThreadExecutor();
    private ActivityResultLauncher<String> microphonePermissionLauncher;
    private ActivityResultLauncher<Intent> exportFileLauncher;
    private String pendingExportContents;
    private boolean awaitingMicrophonePermission;
    private boolean recognitionActive;
    private boolean groqRecordingActive;
    private CaptureMode pendingCaptureMode = CaptureMode.NONE;
    private String pendingGroqModel = "whisper-large-v3-turbo";
    private String pendingGroqLanguage = "";
    private int pendingGroqDurationSeconds = 30;
    private final Runnable groqAutoStopper = this::stopGroqRecordingInternal;
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

    private enum CaptureMode { NONE, PLATFORM, GROQ }

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
                    CaptureMode requested = pendingCaptureMode;
                    pendingCaptureMode = CaptureMode.NONE;
                    awaitingMicrophonePermission = false;
                    if (granted && requested == CaptureMode.PLATFORM) startNativeRecognition();
                    else if (granted && requested == CaptureMode.GROQ) startGroqRecordingInternal();
                    else if (!granted && requested == CaptureMode.GROQ) {
                        emitGroqError("not-allowed");
                        emitGroqEnd();
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
            pendingCaptureMode = CaptureMode.PLATFORM;
            microphonePermissionLauncher.launch(Manifest.permission.RECORD_AUDIO);
            return;
        }

        awaitingMicrophonePermission = false;
        pendingCaptureMode = CaptureMode.NONE;
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

    private void startGroqRecording(String model, String language, int durationSeconds) {
        pendingGroqModel = "whisper-large-v3".equals(model) ? "whisper-large-v3" : "whisper-large-v3-turbo";
        pendingGroqLanguage = language == null ? "" : language.trim().toLowerCase(Locale.ROOT);
        pendingGroqDurationSeconds = Math.max(15, Math.min(60, durationSeconds));
        if (!hasGroqApiKey()) {
            emitGroqError("api-key");
            emitGroqEnd();
            return;
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            awaitingMicrophonePermission = true;
            pendingCaptureMode = CaptureMode.GROQ;
            microphonePermissionLauncher.launch(Manifest.permission.RECORD_AUDIO);
            return;
        }
        startGroqRecordingInternal();
    }

    private void startGroqRecordingInternal() {
        if (groqRecordingActive) return;
        try {
            File cacheDirectory = getCacheDir();
            groqAudioFile = File.createTempFile("dictatask-groq-", ".m4a", cacheDirectory);
            MediaRecorder recorder = new MediaRecorder();
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioEncodingBitRate(64_000);
            recorder.setAudioSamplingRate(16_000);
            recorder.setOutputFile(groqAudioFile.getAbsolutePath());
            recorder.prepare();
            recorder.start();
            groqRecorder = recorder;
            groqRecordingActive = true;
            mainHandler.removeCallbacks(groqAutoStopper);
            mainHandler.postDelayed(groqAutoStopper, pendingGroqDurationSeconds * 1_000L);
        } catch (Exception exception) {
            releaseGroqRecorder();
            deleteGroqAudioFile();
            emitGroqError("audio-capture");
            emitGroqEnd();
        }
    }

    private void stopGroqRecording() {
        runOnUiThread(this::stopGroqRecordingInternal);
    }

    private void stopGroqRecordingInternal() {
        mainHandler.removeCallbacks(groqAutoStopper);
        if (!groqRecordingActive) return;
        groqRecordingActive = false;
        File audioFile = groqAudioFile;
        groqAudioFile = null;
        try {
            if (groqRecorder != null) groqRecorder.stop();
        } catch (RuntimeException exception) {
            releaseGroqRecorder();
            if (audioFile != null) audioFile.delete();
            emitGroqError("no-speech");
            emitGroqEnd();
            return;
        }
        releaseGroqRecorder();
        if (audioFile == null || !audioFile.isFile() || audioFile.length() < 256) {
            if (audioFile != null) audioFile.delete();
            emitGroqError("no-speech");
            emitGroqEnd();
            return;
        }
        String apiKey = getGroqApiKey();
        if (apiKey.isEmpty()) {
            audioFile.delete();
            emitGroqError("api-key");
            emitGroqEnd();
            return;
        }
        final String model = pendingGroqModel;
        final String language = pendingGroqLanguage;
        groqExecutor.execute(() -> transcribeWithGroq(audioFile, apiKey, model, language));
    }

    private void transcribeWithGroq(File audioFile, String apiKey, String model, String language) {
        HttpURLConnection connection = null;
        try {
            String boundary = "DictaTask" + System.currentTimeMillis();
            connection = (HttpURLConnection) new URL(GROQ_TRANSCRIPTION_URL).openConnection();
            connection.setConnectTimeout(GROQ_CONNECT_TIMEOUT_MILLIS);
            connection.setReadTimeout(GROQ_READ_TIMEOUT_MILLIS);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Authorization", "Bearer " + apiKey);
            connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
            try (OutputStream output = new BufferedOutputStream(connection.getOutputStream())) {
                writeMultipartField(output, boundary, "model", model);
                if (!language.isEmpty()) writeMultipartField(output, boundary, "language", language);
                writeMultipartField(output, boundary, "response_format", "json");
                writeMultipartFile(output, boundary, audioFile);
                output.write(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
            }
            int responseCode = connection.getResponseCode();
            if (responseCode < 200 || responseCode >= 300) {
                emitGroqError(responseCode == 401 || responseCode == 403 ? "api-key" : "network");
                return;
            }
            String body = readResponse(connection);
            String transcript = new JSONObject(body).optString("text", "").trim();
            if (transcript.isEmpty()) emitGroqError("no-speech");
            else emitGroqResult(transcript);
        } catch (Exception exception) {
            emitGroqError("network");
        } finally {
            if (connection != null) connection.disconnect();
            audioFile.delete();
            emitGroqEnd();
        }
    }

    private void writeMultipartField(OutputStream output, String boundary, String name, String value) throws Exception {
        output.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + name + "\"\r\n\r\n" + value + "\r\n").getBytes(StandardCharsets.UTF_8));
    }

    private void writeMultipartFile(OutputStream output, String boundary, File file) throws Exception {
        output.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"dictatask-recording.m4a\"\r\nContent-Type: audio/mp4\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        try (BufferedInputStream input = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
        }
        output.write("\r\n".getBytes(StandardCharsets.UTF_8));
    }

    private String readResponse(HttpURLConnection connection) throws Exception {
        try (BufferedInputStream input = new BufferedInputStream(connection.getInputStream()); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private void releaseGroqRecorder() {
        if (groqRecorder == null) return;
        try { groqRecorder.reset(); } catch (RuntimeException ignored) { }
        try { groqRecorder.release(); } catch (RuntimeException ignored) { }
        groqRecorder = null;
    }

    private void deleteGroqAudioFile() {
        if (groqAudioFile != null) groqAudioFile.delete();
        groqAudioFile = null;
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

    private void emitGroqResult(String transcript) {
        evaluateJavascript("window.__dictaGroqResult && window.__dictaGroqResult(" + JSONObject.quote(transcript) + ");");
    }

    private void emitGroqError(String error) {
        evaluateJavascript("window.__dictaGroqError && window.__dictaGroqError(" + JSONObject.quote(error) + ");");
    }

    private void emitGroqEnd() {
        evaluateJavascript("window.__dictaGroqEnd && window.__dictaGroqEnd();");
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

    private boolean hasGroqApiKey() {
        return statePreferences != null && !statePreferences.getString(GROQ_KEY_PREFERENCE, "").isEmpty();
    }

    private void setGroqApiKey(String rawKey) {
        String key = rawKey == null ? "" : rawKey.trim();
        if (key.isEmpty()) {
            clearGroqApiKey();
            return;
        }
        try {
            SecretKey secretKey = getOrCreateGroqSecretKey();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, secretKey);
            String payload = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + "." + Base64.encodeToString(cipher.doFinal(key.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            statePreferences.edit().putString(GROQ_KEY_PREFERENCE, payload).apply();
        } catch (Exception ignored) {
            // Keep the key out of plaintext storage if secure storage is unavailable.
            Toast.makeText(this, "Could not save the Groq key securely.", Toast.LENGTH_LONG).show();
        }
    }

    private void clearGroqApiKey() {
        if (statePreferences != null) statePreferences.edit().remove(GROQ_KEY_PREFERENCE).apply();
    }

    private String getGroqApiKey() {
        if (statePreferences == null) return "";
        String payload = statePreferences.getString(GROQ_KEY_PREFERENCE, "");
        String[] parts = payload.split("\\.", 2);
        if (parts.length != 2) return "";
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateGroqSecretKey(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8).trim();
        } catch (Exception ignored) {
            clearGroqApiKey();
            return "";
        }
    }

    private SecretKey getOrCreateGroqSecretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(GROQ_KEYSTORE);
        keyStore.load(null);
        KeyStore.Entry entry = keyStore.getEntry(GROQ_KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, GROQ_KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(GROQ_KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
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
        if (groqRecordingActive) stopGroqRecordingInternal();
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        clearPendingPartialResult();
        exportExecutor.shutdownNow();
        mainHandler.removeCallbacks(groqAutoStopper);
        releaseGroqRecorder();
        deleteGroqAudioFile();
        groqExecutor.shutdownNow();
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
        public void startGroqRecording(String model, String language, int durationSeconds) {
            runOnUiThread(() -> MainActivity.this.startGroqRecording(model, language, durationSeconds));
        }

        @JavascriptInterface
        public void stopGroqRecording() {
            MainActivity.this.stopGroqRecording();
        }

        @JavascriptInterface
        public void setGroqApiKey(String apiKey) {
            runOnUiThread(() -> MainActivity.this.setGroqApiKey(apiKey));
        }

        @JavascriptInterface
        public void clearGroqApiKey() {
            runOnUiThread(MainActivity.this::clearGroqApiKey);
        }

        @JavascriptInterface
        public boolean hasGroqApiKey() {
            return MainActivity.this.hasGroqApiKey();
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
