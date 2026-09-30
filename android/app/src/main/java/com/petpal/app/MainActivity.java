package com.petpal.app;

import android.os.Bundle;
import android.content.Intent;
import com.getcapacitor.BridgeActivity;
import androidx.webkit.WebViewFeature;

public class MainActivity extends BridgeActivity {
    public static final String OPEN_CHAT = "com.petpal.app.OPEN_CHAT";
    private boolean secureUpdaterBridge;
    private boolean updaterForeground;
    public boolean hasSecureUpdaterBridge() { return secureUpdaterBridge; }
    public boolean isUpdaterForeground() { return updaterForeground; }
    @Override public void onResume() { super.onResume(); updaterForeground = true; }
    @Override public void onPause() { updaterForeground = false; super.onPause(); }
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PetOverlayPlugin.class);
        registerPlugin(PetUpdaterPlugin.class);
        registerPlugin(PetTaskNotificationsPlugin.class);
        super.onCreate(savedInstanceState);
        // Capacitor normally uses an origin-scoped, main-frame WebMessageListener.
        // Remove its possible legacy JS-interface fallback, which has no frame origin.
        // Existing modern media/overlay bridges keep using the safe listener.
        getBridge().getWebView().removeJavascriptInterface("androidBridge");
        secureUpdaterBridge = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
            && !getBridge().getConfig().isUsingLegacyBridge() && getBridge().getConfig().getServerUrl() == null;
        getBridge().getWebView().setWebChromeClient(new LocalMediaChromeClient(getBridge()));
        captureTaskNavigation(getIntent());
        openRequestedChat(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureTaskNavigation(intent);
        openRequestedChat(intent);
    }

    private void captureTaskNavigation(Intent intent) {
        if (intent == null || !PetTaskNotificationService.OPEN.equals(intent.getAction())) return;
        String tag = intent.getStringExtra(PetTaskNotificationService.TAG_EXTRA), epoch = intent.getStringExtra(PetTaskNotificationService.EPOCH_EXTRA);
        intent.removeExtra(PetTaskNotificationService.TAG_EXTRA); intent.removeExtra(PetTaskNotificationService.EPOCH_EXTRA); intent.setAction(null);
        try { TaskNotificationState.capture(this, tag, epoch); } catch (Exception ignored) { }
    }

    private void openRequestedChat(Intent intent) {
        if (intent != null && intent.getBooleanExtra(OPEN_CHAT, false) && getBridge() != null) {
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
