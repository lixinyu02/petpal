package com.petpal.app;

import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Appearance-only bridge; accepts no URLs, scripts, window flags or settings. */
@CapacitorPlugin(name = "PetScreen")
public final class PetScreenPlugin extends Plugin {
    private boolean trusted() {
        return getActivity() instanceof MainActivity
            && ((MainActivity) getActivity()).hasSecureUpdaterBridge()
            && ((MainActivity) getActivity()).isUpdaterForeground()
            && !getActivity().isFinishing() && !getActivity().isDestroyed()
            && getBridge().getWebView().isShown()
            && BackNavigationPolicy.trustedPage(getBridge().getLocalUrl(), getBridge().getWebView().getUrl());
    }

    @PluginMethod public void setAppearance(PluginCall call) {
        String theme = call.getString("theme");
        if (call.getData().length() != 1 || !ScreenInsetsPolicy.validTheme(theme)) {
            call.reject("界面主题必须为 day 或 night。"); return;
        }
        getActivity().runOnUiThread(() -> {
            if (!trusted()) { call.reject("系统栏外观仅限安全的小伴主页面设置。"); return; }
            ((MainActivity) getActivity()).setScreenAppearance(theme);
            JSObject result = new JSObject();
            result.put("nativeInsets", ScreenInsetsPolicy.nativeInsets(Build.VERSION.SDK_INT));
            call.resolve(result);
        });
    }
}
