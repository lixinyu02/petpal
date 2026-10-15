package com.petpal.app;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;

@CapacitorPlugin(name = "PetOfficialAccount")
public final class PetOfficialAccountPlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private PetOfficialAccountRuntime runtime;
    private volatile boolean destroyed;
    @Override public void load() {
        runtime = new PetOfficialAccountRuntime(getContext(), this::openBrowser, () -> {
            if (destroyed || getActivity() == null) return;
            getActivity().runOnUiThread(() -> { if (trusted(false)) notifyListeners("status", new JSObject().put("changed", true)); });
        });
    }
    private boolean trusted(boolean foreground) {
        return !destroyed && getActivity() instanceof MainActivity && !getActivity().isFinishing() && !getActivity().isDestroyed()
            && ((MainActivity) getActivity()).hasSecureUpdaterBridge() && getBridge() != null && getBridge().getWebView() != null
            && UpdaterPolicy.trustedPage(getBridge().getLocalUrl(), getBridge().getWebView().getUrl())
            && (!foreground || ((MainActivity) getActivity()).isUpdaterForeground() && getBridge().getWebView().isShown());
    }
    private void openBrowser(String url) throws Exception {
        if (getActivity() == null) throw new IllegalStateException(); CountDownLatch ready = new CountDownLatch(1); AtomicReference<Exception> failure = new AtomicReference<>();
        getActivity().runOnUiThread(() -> {
            try { if (!trusted(true) || !url.startsWith("https://auth.openai.com/api/accounts/authorize?")) throw new IllegalStateException(); getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)); }
            catch (Exception error) { failure.set(error); }
            finally { ready.countDown(); }
        });
        if (!ready.await(10, TimeUnit.SECONDS) || failure.get() != null) throw new IllegalStateException("无法打开官方登录浏览器。");
    }
    private interface Action { JSONObject run(String scopeId) throws Exception; }
    private void action(PluginCall call, boolean binding, boolean foreground, Action work) {
        if (getActivity() == null) { call.reject("官方账号只允许由小伴主页面管理。"); return; }
        getActivity().runOnUiThread(() -> {
            if (!trusted(foreground)) { call.reject("官方账号只允许由安全的小伴主页面管理。"); return; }
            final String id;
            try { id = binding ? null : PetOfficialAccountPolicy.uuid(call.getString("scopeId")); if (!binding) runtime.checkScope(id); }
            catch (Exception failure) { call.reject("小伴登录已变化，请重新打开官方账号设置。"); return; }
            io.execute(() -> {
                try {
                    if (!binding) runtime.checkScope(id); JSONObject result = work.run(id); if (!binding) runtime.checkScope(id);
                    JSObject output = new JSObject(result.toString()); String expected = binding ? result.getString("scopeId") : id;
                    getActivity().runOnUiThread(() -> {
                        try { if (!trusted(false)) throw new IllegalStateException(); runtime.checkScope(expected); call.resolve(output); }
                        catch (Exception failure) { call.reject("官方账号页面或登录已变化，请重新打开设置。"); }
                    });
                } catch (Exception failure) { call.reject("官方账号操作未完成，请检查网络、登录状态后重试。"); }
            });
        });
    }
    @PluginMethod public void bind(PluginCall call) { action(call, true, true, ignored -> runtime.bind(call.getData())); }
    @PluginMethod public void status(PluginCall call) { action(call, false, false, runtime::scopedStatus); }
    @PluginMethod public void start(PluginCall call) { action(call, false, true, ignored -> runtime.start(call.getString("profileId"))); }
    @PluginMethod public void cancel(PluginCall call) {
        if (getActivity() == null) { call.reject("官方账号页面不可用。"); return; }
        getActivity().runOnUiThread(() -> {
            if (!trusted(false)) { call.reject("官方账号只允许由安全的小伴主页面管理。"); return; }
            try { call.resolve(new JSObject(runtime.cancelLocal(PetOfficialAccountPolicy.uuid(call.getString("scopeId"))).toString())); }
            catch (Exception failure) { call.reject("小伴登录已变化，请重新打开官方账号设置。"); }
        });
    }
    @PluginMethod public void select(PluginCall call) { action(call, false, true, ignored -> runtime.select(call.getString("profileId"))); }
    @PluginMethod public void logout(PluginCall call) { action(call, false, true, ignored -> runtime.logout()); }
    @PluginMethod public void refresh(PluginCall call) { action(call, false, true, ignored -> runtime.refresh()); }
    @PluginMethod public void resumeUsage(PluginCall call) { action(call, false, true, ignored -> runtime.resumeUsage()); }
    @PluginMethod public void clearScope(PluginCall call) {
        if (getActivity() == null) { call.reject("官方账号页面不可用。"); return; }
        getActivity().runOnUiThread(() -> { if (!trusted(false)) { call.reject("官方账号只允许由安全的小伴主页面管理。"); return; } runtime.clearScope(); call.resolve(); });
    }
    @Override protected void handleOnDestroy() { destroyed = true; if (runtime != null) runtime.close(); io.shutdownNow(); super.handleOnDestroy(); }
}
