package com.petpal.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "PetLoginSession")
public final class PetLoginSessionPlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private PetLoginSessionState state;
    private volatile boolean destroyed;
    @Override public void load() { state = new PetLoginSessionState(getContext()); }
    private boolean trusted() {
        return !destroyed && getActivity() instanceof MainActivity && !getActivity().isFinishing() && !getActivity().isDestroyed()
            && ((MainActivity) getActivity()).hasSecureUpdaterBridge() && getBridge() != null && getBridge().getWebView() != null
            && UpdaterPolicy.trustedPage(getBridge().getLocalUrl(), getBridge().getWebView().getUrl());
    }
    private void action(PluginCall call, String kind) {
        if (getActivity() == null) { call.reject("设备登录只能由小伴主页面管理。"); return; }
        getActivity().runOnUiThread(() -> {
            if (!trusted()) { call.reject("设备登录只能由安全的小伴主页面管理。"); return; }
            long revision = "read".equals(kind) ? 0 : state.reserve();
            // A logout must not sit behind a queued read or be cancelled when
            // the activity closes. This is a bounded local unlink, without IO
            // to the network or keystore.
            if ("clear".equals(kind)) {
                try { state.clear(revision); call.resolve(); }
                catch (Exception failure) { call.reject("无法清除设备登录，请重试。"); }
                return;
            }
            io.execute(() -> {
                try {
                    if (destroyed) throw new IllegalStateException();
                    JSObject result;
                    if ("read".equals(kind)) result = new JSObject(state.read().toString());
                    else { if ("write".equals(kind)) state.write(call.getData(), revision); else state.clear(revision); result = new JSObject(); }
                    getActivity().runOnUiThread(() -> { if (trusted()) call.resolve(result); else call.reject("登录页面已变化，请重试。"); });
                } catch (Exception failure) { call.reject("设备登录操作未完成，请重新登录或重试。"); }
            });
        });
    }
    @PluginMethod public void read(PluginCall call) { action(call, "read"); }
    @PluginMethod public void write(PluginCall call) { action(call, "write"); }
    @PluginMethod public void clear(PluginCall call) { action(call, "clear"); }
    @Override protected void handleOnDestroy() { destroyed = true; io.shutdownNow(); super.handleOnDestroy(); }
}
