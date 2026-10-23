package com.petpal.app;

import android.os.Bundle;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
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
    private boolean rendererUnavailable;
    private static final RendererRecoveryPolicy RENDERER_RECOVERY = new RendererRecoveryPolicy();
    private final BackNavigationPolicy backNavigation = new BackNavigationPolicy();
    private OnBackPressedCallback nativeBack;
    private ScreenInsetsController screenInsets;
    private final WebViewListener backPageListener = new WebViewListener() {
        @Override public void onPageStarted(WebView view) { backNavigation.cancel(); }
        @Override public void onPageLoaded(WebView view) { if (!rendererUnavailable) openOfficialSettings(); }
        @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) { return recoverRenderer(view); }
    };
    public boolean hasSecureUpdaterBridge() { return secureUpdaterBridge; }
    public boolean isUpdaterForeground() { return updaterForeground; }
    static void retryRendererByUser() { RENDERER_RECOVERY.retryByUser(); }
    private boolean recoverRenderer(WebView view) {
        if (getBridge() == null || getBridge().getWebView() != view) return false;
        if (rendererUnavailable) return true;
        rendererUnavailable = true; secureUpdaterBridge = false; updaterForeground = false; officialSettingsRequested = false; backNavigation.cancel();
        if (screenInsets != null) { screenInsets.close(); screenInsets = null; }
        if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
        view.destroy();
        boolean automatic = RENDERER_RECOVERY.automatic(SystemClock.elapsedRealtime());
        // Post outside the provider callback. Normal Activity destruction closes
        // plugins once; their owner fences protect any successor's native state.
        new Handler(Looper.getMainLooper()).post(() -> {
            if (isFinishing() || isDestroyed()) return;
            if (automatic) recreate();
            else { startActivity(new Intent(this, RendererRecoveryActivity.class)); finish(); }
        });
        return true;
    }
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
        ScreenInsetsController.prepareAppearance(this);
        registerPlugin(PetOverlayPlugin.class);
        registerPlugin(PetUpdaterPlugin.class);
        registerPlugin(PetTaskNotificationsPlugin.class);
        registerPlugin(PetAppProxyPlugin.class);
        registerPlugin(PetOfficialAccountPlugin.class);
        registerPlugin(PetLoginSessionPlugin.class);
        registerPlugin(PetScreenPlugin.class);
        registerPlugin(PetPermissionsPlugin.class);
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
        openRequestedChat(intent);
        openOfficialSettings();
    }

    private void sanitizeOfficialIntent(Intent intent) {
        if (intent == null) return;
        if (PetTaskNotificationService.OPEN.equals(intent.getAction())) {
            boolean accepted = false;
            try {
                android.content.ComponentName component = intent.getComponent();
                Bundle extras = intent.getExtras();
                boolean knownExtras = extras != null;
                if (extras != null) for (String key : extras.keySet()) if (!PetTaskNotificationService.TAG_EXTRA.equals(key)
                    && !PetTaskNotificationService.EPOCH_EXTRA.equals(key) && !OPEN_CHAT.equals(key)) { knownExtras = false; break; }
                boolean canonical = component != null && getPackageName().equals(component.getPackageName()) && MainActivity.class.getName().equals(component.getClassName())
                    && intent.getClipData() == null && intent.getSelector() == null && knownExtras
                    && (intent.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)) == 0
                    && TaskNotificationIntentPolicy.matches(intent.getAction(), intent.getDataString(), intent.getStringExtra(PetTaskNotificationService.TAG_EXTRA), intent.getStringExtra(PetTaskNotificationService.EPOCH_EXTRA));
                if (canonical) accepted = TaskNotificationState.capture(this, intent.getStringExtra(PetTaskNotificationService.TAG_EXTRA), intent.getStringExtra(PetTaskNotificationService.EPOCH_EXTRA));
            } catch (Exception ignored) { }
            // Capture only an existing encrypted current-account route. Never
            // publish its URI to Capacitor or let external OAuth links use it.
            clearExternalIntent(intent);
            if (accepted) intent.putExtra(OPEN_CHAT, true);
            return;
        }
        if (PetOfficialAccountService.OPEN_SETTINGS.equals(intent.getAction())) {
            // Opening this fixed settings page has no authentication side effects.
            officialSettingsRequested = true;
        } else if (Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() != null) {
            PetOfficialAccountHost host = PetOfficialAccountHost.existing();
            String value = Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null ? intent.getData().toString() : null;
            boolean accepted = host != null && host.runtime().consumeReturn(value);
            if (accepted) officialSettingsRequested = true;
        } else return;
        clearExternalIntent(intent);
    }

    private void clearExternalIntent(Intent intent) {
        intent.setData(null); intent.setClipData(null); intent.replaceExtras((Bundle) null); intent.setSelector(null); intent.setAction(Intent.ACTION_MAIN);
        intent.setFlags(intent.getFlags() & ~(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION));
    }

    private void openOfficialSettings() {
        if (rendererUnavailable || !officialSettingsRequested || !updaterForeground || getBridge() == null || getBridge().getWebView() == null) return;
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
                if (rendererUnavailable) return;
                String local = getBridge() == null ? null : getBridge().getLocalUrl();
                BackNavigationPolicy.Result result = backNavigation.complete(request, local, view.getUrl(), activeLocalPage(view), value);
                if (result == BackNavigationPolicy.Result.FALLBACK) defaultBack();
            });
        } catch (RuntimeException ignored) { backNavigation.cancel(); }
    }

    public void setScreenAppearance(String theme) {
        if (screenInsets != null) screenInsets.setAppearance(theme);
    }

    public void setScreenAppearance(String theme, String preference) {
        if (screenInsets != null) screenInsets.setAppearance(theme, preference);
    }

    private void defaultBack() {
        if (nativeBack == null || isFinishing() || isDestroyed()) return;
        nativeBack.setEnabled(false);
        try { getOnBackPressedDispatcher().onBackPressed(); }
        finally { if (!isDestroyed()) nativeBack.setEnabled(true); }
    }

    private void openRequestedChat(Intent intent) {
        if (!rendererUnavailable && intent != null && intent.getBooleanExtra(OPEN_CHAT, false) && getBridge() != null && getBridge().getWebView() != null) {
            intent.removeExtra(OPEN_CHAT);
            var webView = getBridge().getWebView();
            webView.post(() -> {
                if (rendererUnavailable || isDestroyed() || isFinishing() || getBridge() == null || getBridge().getWebView() != webView) return;
                android.net.Uri current = android.net.Uri.parse(webView.getUrl() == null ? "about:blank" : webView.getUrl());
                if (!current.isHierarchical() || !"1".equals(current.getQueryParameter("chat"))) {
                    String local = getBridge().getLocalUrl();
                    if (local != null) webView.loadUrl(local.replaceAll("/$", "") + "/?chat=1");
                }
            });
        }
    }
}
