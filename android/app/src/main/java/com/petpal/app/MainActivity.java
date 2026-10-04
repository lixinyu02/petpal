package com.petpal.app;

import android.os.Bundle;
import android.content.Intent;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import androidx.webkit.WebViewFeature;

public class MainActivity extends BridgeActivity {
    public static final String OPEN_CHAT = "com.petpal.app.OPEN_CHAT";
    private boolean secureUpdaterBridge;
    private boolean updaterForeground;
    private final BackNavigationPolicy backNavigation = new BackNavigationPolicy();
    private OnBackPressedCallback nativeBack;
    private final WebViewListener backPageListener = new WebViewListener() {
        @Override public void onPageStarted(WebView view) { backNavigation.cancel(); }
    };
    public boolean hasSecureUpdaterBridge() { return secureUpdaterBridge; }
    public boolean isUpdaterForeground() { return updaterForeground; }
    @Override public void onResume() { super.onResume(); updaterForeground = true; }
    @Override public void onPause() { updaterForeground = false; backNavigation.cancel(); super.onPause(); }
    @Override public void onDestroy() {
        backNavigation.cancel();
        if (getBridge() != null) getBridge().removeWebViewListener(backPageListener);
        super.onDestroy();
    }
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PetOverlayPlugin.class);
        registerPlugin(PetUpdaterPlugin.class);
        registerPlugin(PetTaskNotificationsPlugin.class);
        super.onCreate(savedInstanceState);
        // Capacitor already presents its no-WebView fallback if bridge creation could not run.
        // Preserve that page instead of crashing while installing local-only features.
        if (getBridge() == null || getBridge().getWebView() == null) return;
        // Capacitor normally uses an origin-scoped, main-frame WebMessageListener.
        // Remove its possible legacy JS-interface fallback, which has no frame origin.
        // Existing modern media/overlay bridges keep using the safe listener.
        getBridge().getWebView().removeJavascriptInterface("androidBridge");
        secureUpdaterBridge = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
            && !getBridge().getConfig().isUsingLegacyBridge() && getBridge().getConfig().getServerUrl() == null;
        getBridge().getWebView().setWebChromeClient(new LocalMediaChromeClient(getBridge()));
        getBridge().addWebViewListener(backPageListener);
        nativeBack = new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { requestPageBack(); }
        };
        getOnBackPressedDispatcher().addCallback(this, nativeBack);
        captureTaskNavigation(getIntent());
        openRequestedChat(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        backNavigation.cancel();
        setIntent(intent);
        captureTaskNavigation(intent);
        openRequestedChat(intent);
    }

    private boolean activeLocalPage(WebView view) {
        return secureUpdaterBridge && updaterForeground && !isFinishing() && !isDestroyed()
            && getBridge() != null && getBridge().getWebView() == view && view.isShown()
            && BackNavigationPolicy.trustedPage(getBridge().getLocalUrl(), view.getUrl());
    }

    private void requestPageBack() {
        if (backNavigation.isPending()) return;
        WebView view = getBridge() == null ? null : getBridge().getWebView();
        if (view == null || !activeLocalPage(view)) { defaultBack(); return; }
        BackNavigationPolicy.Request request = backNavigation.begin(getBridge().getLocalUrl(), view.getUrl());
        if (request == null) return;
        try {
            // evaluateJavascript always targets the main frame. No function is exposed to frames.
            view.evaluateJavascript("(function(){try {if(window!==window.top)return true;return !window.dispatchEvent(new CustomEvent('petpal:native-back',{cancelable:true}));}catch(error){return true;}})()", value -> {
                String local = getBridge() == null ? null : getBridge().getLocalUrl();
                BackNavigationPolicy.Result result = backNavigation.complete(request, local, view.getUrl(), activeLocalPage(view), value);
                if (result == BackNavigationPolicy.Result.FALLBACK) defaultBack();
            });
        } catch (RuntimeException ignored) { backNavigation.cancel(); }
    }

    private void defaultBack() {
        if (nativeBack == null || isFinishing() || isDestroyed()) return;
        nativeBack.setEnabled(false);
        try { getOnBackPressedDispatcher().onBackPressed(); }
        finally { if (!isDestroyed()) nativeBack.setEnabled(true); }
    }

    private void captureTaskNavigation(Intent intent) {
        if (intent == null || !PetTaskNotificationService.OPEN.equals(intent.getAction())) return;
        String tag = intent.getStringExtra(PetTaskNotificationService.TAG_EXTRA), epoch = intent.getStringExtra(PetTaskNotificationService.EPOCH_EXTRA);
        intent.removeExtra(PetTaskNotificationService.TAG_EXTRA); intent.removeExtra(PetTaskNotificationService.EPOCH_EXTRA); intent.setAction(null);
        try { TaskNotificationState.capture(this, tag, epoch); } catch (Exception ignored) { }
    }

    private void openRequestedChat(Intent intent) {
        if (intent != null && intent.getBooleanExtra(OPEN_CHAT, false) && getBridge() != null && getBridge().getWebView() != null) {
            intent.removeExtra(OPEN_CHAT);
            var webView = getBridge().getWebView();
            webView.post(() -> {
                android.net.Uri current = android.net.Uri.parse(webView.getUrl() == null ? "about:blank" : webView.getUrl());
                if (!current.isHierarchical() || !"1".equals(current.getQueryParameter("chat"))) {
                    String local = getBridge().getLocalUrl();
                    if (local != null) webView.loadUrl(local.replaceAll("/$", "") + "/?chat=1");
                }
            });
        }
    }
}
