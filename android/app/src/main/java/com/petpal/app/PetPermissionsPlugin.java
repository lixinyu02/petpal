package com.petpal.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PetPermissions")
public final class PetPermissionsPlugin extends Plugin {
    private boolean destroyed;
    private boolean trusted() {
        return !destroyed && getActivity() instanceof MainActivity && !getActivity().isFinishing() && !getActivity().isDestroyed()
            && getBridge() != null && getBridge().getWebView() != null
            && TaskNotificationPolicy.trustedBridge(((MainActivity) getActivity()).hasSecureUpdaterBridge(),
                UpdaterPolicy.trustedPage(getBridge().getLocalUrl(), getBridge().getWebView().getUrl()),
                ((MainActivity) getActivity()).isUpdaterForeground() && getBridge().getWebView().isShown(), true);
    }
    private interface Action { void run(); }
    private void fromMain(PluginCall call, Action action) {
        if (getActivity() == null) { call.reject("权限设置只允许由小伴主页面调用。"); return; }
        getActivity().runOnUiThread(() -> {
            if (!trusted()) { call.reject("权限设置只允许由安全的本地主页面调用。"); return; }
            try { action.run(); }
            catch (IllegalArgumentException invalid) { call.reject("权限设置类型无效。"); }
            catch (RuntimeException unavailable) { call.reject("无法读取或打开系统权限设置，请返回应用重试。"); }
        });
    }
    @PluginMethod public void status(PluginCall call) { fromMain(call, () -> call.resolve(AndroidPermissionState.status(getActivity()))); }
    @PluginMethod public void openSettings(PluginCall call) { fromMain(call, () -> call.resolve(AndroidPermissionSettings.open(getActivity(), call.getString("kind")))); }
    @Override protected void handleOnDestroy() { destroyed = true; super.handleOnDestroy(); }
}
