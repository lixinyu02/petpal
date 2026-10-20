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
    private boolean officialSettingsRequested;
    private final BackNavigationPolicy backNavigation = new BackNavigationPolicy();
    private OnBackPressedCallback nativeBack;
    private ScreenInsetsController screenInsets;
    private final WebViewListener backPageListener = new WebViewListener() {
        @Override public void onPageStarted(WebView view) { backNavigation.cancel(); }
        @Override public void onPageLoaded(WebView view) { openOfficialSettings(); }
    };
    public boolean hasSecureUpdaterBridge() { return secureUpdaterBridge; }
    public boolean isUpdaterForeground() { return updaterForeground; }
    @Override public void onResume() { super.onResume(); updaterForeground = true; openOfficialSettings(); }
    @Override public void onPause() { updaterForeground = false; backNavigation.cancel(); super.onPause(); }
    @Override public void onDestroy() {
        backNavigation.cancel();
        if (screenInsets != null) screenInsets.close();
        if (getBridge() != null) getBridge().removeWebViewListener(backPageListener);
        super.onDestroy();
    }
    @Override
    public void onCreate(Bundle savedInstanceState) {
        sanitizeOfficialIntent(getIntent());
        registerPlugin(PetOverlayPlugin.class);
        registerPlugin(PetUpdaterPlugin.class);
        registerPlugin(PetTaskNotificationsPlugin.class);
        registerPlugin(PetAppProxyPlugin.class);
        registerPlugin(PetOfficialAccountPlugin.class);
        registerPlugin(PetLoginSessionPlugin.class);
        registerPlugin(PetScreenPlugin.class);
        super.onCreate(savedInstanceState);
        // Capacitor already presents its no-WebView fallback if bridge creation could not run.
        // Preserve that page instead of crashing while installing local-only features.
        if (getBridge() == null || getBridge().getWebView() == null) return;
        screenInsets = new ScreenInsetsController(this, getBridge().getWebView());
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
        openOfficialSettings();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        // Strip external data before Capacitor can publish an appUrlOpen event.
        sanitizeOfficialIntent(intent);
        super.onNewIntent(intent);
        backNavigation.cancel();
        setIntent(intent);
        captureTaskNavigation(intent);
        openRequestedChat(intent);
        openOfficialSettings();
    }

    private void sanitizeOfficialIntent(Intent intent) {
        if (intent == null) return;
        if (PetOfficialAccountService.OPEN_SETTINGS.equals(intent.getAction())) {
            // Opening this fixed settings page has no authentication side effects.
            officialSettingsRequested = true;
        } else if (Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() != null) {
            PetOfficialAccountHost host = PetOfficialAccountHost.existing();
            String value = Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null ? intent.getData().toString() : null;
            boolean accepted = host != null && host.runtime().consumeReturn(value);
            if (accepted) officialSettingsRequested = true;
        } else return;
        intent.setData(null); intent.setClipData(null); intent.replaceExtras((Bundle) null); intent.setSelector(null); intent.setAction(Intent.ACTION_MAIN);
        intent.setFlags(intent.getFlags() & ~(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION));
    }

    private void openOfficialSettings() {
        if (!officialSettingsRequested || !updaterForeground || getBridge() == null || getBridge().getWebView() == null) return;
        WebView view = getBridge().getWebView();
        if (!UpdaterPolicy.trustedPage(getBridge().getLocalUrl(), view.getUrl())) return;
        officialSettingsRequested = false;
        // The event has no payload. Existing workspaces retain their WebView/session.
        view.evaluateJavascript("(function(){try{return !window.dispatchEvent(new CustomEvent('petpal:official-return',{cancelable:true}));}catch(e){return false;}})()", handled -> {
            if ("true".equals(handled) || isFinishing() || isDestroyed() || getBridge() == null || getBridge().getWebView() != view || !UpdaterPolicy.trustedPage(getBridge().getLocalUrl(), view.getUrl())) return;
            android.net.Uri current = android.net.Uri.parse(view.getUrl());
            if ("1".equals(current.getQueryParameter("chat")) && "1".equals(current.getQueryParameter("settings"))) return;
            view.loadUrl(getBridge().getLocalUrl().replaceAll("/$", "") + "/?chat=1&settings=1");
        });
    }

    private boolean activeLocalPage(WebView view) {
        return secureUpdaterBridge && updaterForeground && !isFinishing() && !isDestroyed()
            && getBridge() != null && getBridge().getWebView() == view && view.isShown()
            && BackNavigationPolicy.trustedPage(getBridge().getLocalUrl(), view.getUrl());
    }

    private void requestPageBack() {
        // Some OEM back dispatchers reach the Activity before the IME handles back.
        // Dismissing the keyboard must not also close a menu or leave the workspace.
        if (screenInsets != null && screenInsets.hideImeIfVisible()) return;
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

    public void setScreenAppearance(String theme) {
        if (screenInsets != null) screenInsets.setAppearance(theme);
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
