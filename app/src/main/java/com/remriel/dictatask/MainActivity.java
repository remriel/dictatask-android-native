package com.remriel.dictatask;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceResponse;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.util.ArrayList;

/**
 * Hosts the locally bundled DictaTask application. All web assets are served by
 * WebViewAssetLoader from this APK; no remote URL is loaded at runtime.
 */
public final class MainActivity extends AppCompatActivity {
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String LOCAL_ENTRYPOINT =
            "https://" + ASSET_HOST + "/assets/index.html";
    private static final String NOTIFICATION_PROMPT_SHOWN = "notification_prompt_shown";

    private WebView webView;
    private SpeechRecognizer speechRecognizer;
    private ActivityResultLauncher<String> microphonePermissionLauncher;
    private boolean awaitingMicrophonePermission;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        configureMicrophonePermission();
        configureHourlyReminder();
        configureWebView();
    }

    private void configureHourlyReminder() {
        ReminderScheduler.ensureNotificationChannel(this);
        ReminderScheduler.schedule(this);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
                && !getPreferences(MODE_PRIVATE).getBoolean(NOTIFICATION_PROMPT_SHOWN, false)) {
            getPreferences(MODE_PRIVATE)
                    .edit()
                    .putBoolean(NOTIFICATION_PROMPT_SHOWN, true)
                    .apply();
            requestPermissions(
                    new String[]{Manifest.permission.POST_NOTIFICATIONS},
                    9101
            );
        }
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
        });
        webView.loadUrl(LOCAL_ENTRYPOINT);
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
                    emitSpeechError(mapSpeechError(error));
                    emitSpeechEnd();
                }

                @Override
                public void onResults(Bundle results) {
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
            speechRecognizer.startListening(recognizerIntent);
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
        evaluateJavascript(
                "window.__dictaSpeechResult && window.__dictaSpeechResult("
                        + JSONObject.quote(transcript)
                        + ", "
                        + isFinal
                        + ");"
        );
    }

    private void emitSpeechError(String error) {
        evaluateJavascript(
                "window.__dictaSpeechError && window.__dictaSpeechError("
                        + JSONObject.quote(error)
                        + ");"
        );
    }

    private void emitSpeechEnd() {
        evaluateJavascript("window.__dictaSpeechEnd && window.__dictaSpeechEnd();");
    }

    private void evaluateJavascript(String script) {
        if (webView == null) {
            return;
        }
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    @Override
    protected void onDestroy() {
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
    }
}
