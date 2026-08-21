package com.remriel.dictatask;

import android.annotation.SuppressLint;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.ComponentActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;

/**
 * A dedicated Android destination for the all-time Hatch Vault. It loads a
 * separate local entry document and shares the task collection through the
 * same small native state bridge as the task workspace.
 */
public final class VaultActivity extends ComponentActivity {
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String LOCAL_ENTRYPOINT =
            "https://" + ASSET_HOST + "/assets/vault.html";
    private static final String STATE_PREFERENCES = "dictatask_state";
    private static final int VAULT_BACKGROUND = Color.rgb(13, 13, 18);

    private WebView webView;
    private SharedPreferences statePreferences;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        statePreferences = getSharedPreferences(STATE_PREFERENCES, MODE_PRIVATE);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        configureSystemBars();
        configureWebView();
    }

    private void configureSystemBars() {
        getWindow().getDecorView().setBackgroundColor(VAULT_BACKGROUND);
        getWindow().setStatusBarColor(VAULT_BACKGROUND);
        getWindow().setNavigationBarColor(VAULT_BACKGROUND);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
                getWindow(),
                getWindow().getDecorView()
        );
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(VAULT_BACKGROUND);
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

        webView.addJavascriptInterface(new VaultBridge(), "DictaTaskAndroid");
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

    private String getStoredState(String key) {
        if (key == null || key.isEmpty() || statePreferences == null) {
            return "";
        }
        return statePreferences.getString(key, "");
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
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("DictaTaskAndroid");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private final class VaultBridge {
        @JavascriptInterface
        public String getStoredState(String key) {
            return VaultActivity.this.getStoredState(key);
        }

        @JavascriptInterface
        public void closeHatchVault() {
            runOnUiThread(VaultActivity.this::finish);
        }
    }
}
