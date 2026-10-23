package com.petpal.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Looper;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

@CapacitorPlugin(name = "PetAppProxy")
public final class PetAppProxyPlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private PetAppProxyState manager;
    private volatile boolean destroyed;
    private long fileGeneration;
    private String fileScope;
    @Override public void load() { manager = new PetAppProxyState(getContext()); }
    private boolean trusted(boolean foreground) {
        // Capacitor invokes plugin methods on CapacitorPlugins. WebView origin
        // and visibility must only be inspected on the owning main thread.
        return Looper.myLooper() == Looper.getMainLooper() && !destroyed && getActivity() instanceof MainActivity
            && !getActivity().isFinishing() && !getActivity().isDestroyed() && getBridge() != null && getBridge().getWebView() != null
            && TaskNotificationPolicy.trustedBridge(((MainActivity) getActivity()).hasSecureUpdaterBridge(),
                UpdaterPolicy.trustedPage(getBridge().getLocalUrl(), getBridge().getWebView().getUrl()),
                ((MainActivity) getActivity()).isUpdaterForeground() && getBridge().getWebView().isShown(), foreground);
    }
    private interface Work { JSONObject run() throws Exception; }
    private interface Prepared { void run(Activity activity); }
    private void onUi(PluginCall call, boolean foreground, Prepared prepared) {
        final Activity activity = getActivity();
        if (activity == null) { call.reject("应用代理仅允许小伴主页面调用。"); return; }
        activity.runOnUiThread(() -> {
            if (!trusted(foreground)) { call.reject("应用代理仅允许安全的本地主页面调用。"); return; }
            try { prepared.run(activity); }
            catch (RuntimeException failure) { call.reject("应用代理页面已关闭或操作无法启动，请重新打开设置。"); }
        });
    }
    private void enqueue(PluginCall call, Activity activity, Work work) {
            io.execute(() -> {
                try {
                    JSONObject result = work.run();
                    JSObject response = JSObject.fromJSONObject(result);
                    activity.runOnUiThread(() -> { if (trusted(false)) call.resolve(response); else call.reject("应用页面已变化，代理操作已结束。"); });
                } catch (Exception failure) {
                    // Native, subscription and YAML errors are untrusted: never echo their details.
                    activity.runOnUiThread(() -> call.reject(!manager.restartRequired().isEmpty() ? manager.restartRequired() : failure instanceof InterruptedException ? "登录已变化，代理操作已取消。" : "应用代理操作未完成，请检查配置、系统版本和网络。"));
                }
            });
    }
    private void action(PluginCall call, boolean foreground, Work work) { onUi(call, foreground, activity -> enqueue(call, activity, work)); }
    @PluginMethod public void bindScope(PluginCall call) {
        onUi(call, false, activity -> {
            manager.invalidate(); final long generation = manager.generation(); final JSONObject input = call.getData();
            enqueue(call, activity, () -> manager.bind(input, generation));
        });
    }
    @PluginMethod public void clearScope(PluginCall call) {
        onUi(call, false, activity -> { manager.invalidate(); enqueue(call, activity, () -> manager.clear()); });
    }
    @PluginMethod public void status(PluginCall call) { final long generation = manager.generation(); action(call, false, () -> manager.refreshStatus(generation)); }
    @PluginMethod public void start(PluginCall call) {
        final long generation = manager.generation(); final String scope = call.getString("scope"); action(call, true, () -> manager.start(scope, generation));
    }
    @PluginMethod public void stop(PluginCall call) { action(call, false, () -> { if (!manager.current(call.getString("scope"))) throw new IllegalStateException(); return manager.stop(); }); }
    @PluginMethod public void importText(PluginCall call) {
        final long generation = manager.generation(); final String scope = call.getString("scope"), yaml = call.getString("yaml"); action(call, true, () -> manager.importText(scope, yaml, "", generation));
    }
    @PluginMethod public void importUrl(PluginCall call) {
        final long generation = manager.generation(); final String scope = call.getString("scope"), url = call.getString("url"); action(call, true, () -> manager.importUrl(scope, url, false, generation));
    }
    @PluginMethod public void updateRemote(PluginCall call) {
        final long generation = manager.generation(); final String scope = call.getString("scope"); action(call, true, () -> manager.importUrl(scope, "", true, generation));
    }
    @PluginMethod public void importServer(PluginCall call) {
        final long generation = manager.generation(); final String scope = call.getString("scope"), profile = call.getString("profileId"); final boolean reset = Boolean.TRUE.equals(call.getBoolean("resetPolicy", false));
        action(call, true, () -> manager.importServer(scope, profile, reset, generation));
    }
    @PluginMethod public void updateServer(PluginCall call) {
        final long generation = manager.generation(); final String scope = call.getString("scope"); final boolean reset = Boolean.TRUE.equals(call.getBoolean("resetPolicy", false));
        action(call, true, () -> manager.updateServer(scope, reset, generation));
    }
    @PluginMethod public void checkServer(PluginCall call) {
        final long generation = manager.generation(); final String scope = call.getString("scope"); action(call, false, () -> manager.checkServer(scope, generation));
    }
    @PluginMethod public void mode(PluginCall call) {
        final long generation = manager.generation(); final String scope = call.getString("scope"), mode = call.getString("mode"); action(call, true, () -> manager.mode(scope, mode, generation));
    }
    @PluginMethod public void preferences(PluginCall call) {
        final long generation = manager.generation(); final String scope = call.getString("scope"); final Boolean autoStart = call.getBoolean("autoStart");
        action(call, true, () -> { if (autoStart == null) throw new IllegalArgumentException(); return manager.preferences(scope, autoStart, generation); });
    }
    @PluginMethod public void select(PluginCall call) {
        final long generation = manager.generation(); final String scope = call.getString("scope"), group = call.getString("group"), name = call.getString("name"); action(call, true, () -> manager.select(scope, group, name, generation));
    }
    @PluginMethod public void importFile(PluginCall call) {
        onUi(call, true, activity -> {
            if (!manager.current(call.getString("scope"))) { call.reject("请先登录并打开应用代理设置。"); return; }
            fileGeneration = manager.generation(); fileScope = call.getString("scope");
            Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/yaml", "text/yaml", "text/plain", "application/octet-stream"});
            startActivityForResult(call, pick, "fileResult");
        });
    }
    @ActivityCallback private void fileResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) { action(call, false, () -> manager.status()); return; }
        final Uri uri = result.getData().getData(); final String scope = fileScope; final long expected = fileGeneration;
        action(call, false, () -> {
            if (expected != manager.generation() || !manager.current(scope) || !"content".equals(uri.getScheme())) throw new IllegalStateException();
            String text = PetAppProxyState.utf8(PetAppProxyState.read(getContext().getContentResolver().openInputStream(uri), PetAppProxyPolicy.MAX_BYTES));
            return manager.importText(scope, text, "", expected);
        });
    }
    @Override protected void handleOnDestroy() {
        destroyed = true; manager.invalidate();
        io.execute(() -> { try { manager.clear(); } catch (Exception ignored) { } }); io.shutdown(); super.handleOnDestroy();
    }
}
