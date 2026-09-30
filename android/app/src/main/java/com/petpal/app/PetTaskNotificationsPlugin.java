package com.petpal.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

@CapacitorPlugin(name = "PetTaskNotifications", permissions = {
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class PetTaskNotificationsPlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private boolean destroyed, starting;
    private long permissionGeneration;
    private JSONObject permissionInput;
    private PluginCall resumeCall;
    private final TaskNotificationState.Listener listener = event -> {
        if (destroyed) return;
        try { notifyListeners(event, "navigation".equals(event) ? new JSObject().put("pending", true) : new JSObject(TaskNotificationState.status(getContext()).toString())); }
        catch (Exception ignored) { }
    };
    @Override public void load() { TaskNotificationState.init(getContext()); TaskNotificationState.listen(listener); }
    private boolean trusted() { return trusted(true); }
    private boolean trusted(boolean requireForeground) {
        return !destroyed && getActivity() instanceof MainActivity && !getActivity().isFinishing() && !getActivity().isDestroyed()
            && TaskNotificationPolicy.trustedBridge(((MainActivity) getActivity()).hasSecureUpdaterBridge(),
                UpdaterPolicy.trustedPage(getBridge().getLocalUrl(), getBridge().getWebView().getUrl()),
                ((MainActivity) getActivity()).isUpdaterForeground() && getBridge().getWebView().isShown(), requireForeground);
    }
    private interface Action { void run() throws Exception; }
    private void fromMain(PluginCall call, Action action) {
        fromMain(call, true, action);
    }
    private void fromMain(PluginCall call, boolean requireForeground, Action action) {
        if (getActivity() == null) { call.reject("任务提醒只允许由小伴主页面调用。"); return; }
        getActivity().runOnUiThread(() -> {
            if (!trusted(requireForeground)) { call.reject("任务提醒只允许由安全的本地主页面调用。"); return; }
            try { action.run(); } catch (Exception failure) { reject(call, failure); }
        });
    }
    private void reject(PluginCall call, Exception failure) {
        String detail = failure instanceof IllegalArgumentException || failure instanceof IllegalStateException ? failure.getMessage() : null;
        if (detail == null || !(detail.startsWith("任务") || detail.startsWith("通知") || detail.startsWith("后台") || detail.startsWith("登录") || detail.startsWith("无法"))) detail = "无法配置任务提醒，请返回应用重新开启。";
        call.reject(detail);
    }
    @PluginMethod public void installation(PluginCall call) { fromMain(call, () -> call.resolve(new JSObject().put("deviceId", TaskNotificationState.installation(getContext())))); }
    @PluginMethod public void status(PluginCall call) { fromMain(call, () -> call.resolve(new JSObject(TaskNotificationState.status(getContext()).toString()))); }
    @PluginMethod public void start(PluginCall call) {
        fromMain(call, () -> {
            if (starting) { call.reject("通知权限或提醒启动正在处理中。"); return; }
            long cursor = TaskNotificationPolicy.parseCursor(call.getData().opt("cursor"));
            JSONObject input = new JSONObject().put("url", TaskNotificationPolicy.baseUrl(call.getString("url")))
                .put("token", TaskNotificationPolicy.token(call.getString("token"))).put("deviceId", TaskNotificationPolicy.deviceId(call.getString("deviceId")))
                .put("instanceId", TaskNotificationPolicy.id(call.getString("instanceId"))).put("userId", TaskNotificationPolicy.id(call.getString("userId")))
                .put("cursor", TaskNotificationPolicy.cursor(cursor)).put("expiresAt", call.getString("expiresAt"));
            TaskNotificationPolicy.expires(input.getString("expiresAt")); starting = true;
            permissionGeneration = TaskNotificationState.generation(getContext()); permissionInput = input;
            if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) { TaskNotificationState.permissionAsked(getContext()); requestPermissionForAlias("notifications", call, "notificationsResult"); }
            else begin(call, input, permissionGeneration);
        });
    }
    @PermissionCallback private void notificationsResult(PluginCall call) {
        long expected = permissionGeneration;
        if (destroyed || TaskNotificationState.generation(getContext()) != expected) { permissionInput = null; starting = false; call.reject("登录已变化，请重新开启提醒。"); return; }
        if (getPermissionState("notifications") != PermissionState.GRANTED) { permissionInput = null; starting = false; call.reject("请允许系统通知后再开启后台任务提醒。"); return; }
        resumeCall = call;
        if (getActivity() != null) getActivity().getWindow().getDecorView().post(this::resumePermissionStart);
    }
    private void resumePermissionStart() {
        if (resumeCall == null || !trusted()) return;
        PluginCall call = resumeCall; resumeCall = null; begin(call, permissionInput, permissionGeneration);
    }
    @Override protected void handleOnResume() {
        super.handleOnResume(); if (getActivity() != null) getActivity().getWindow().getDecorView().post(this::resumePermissionStart);
    }
    private void begin(PluginCall call, JSONObject input, long expected) {
        permissionInput = null;
        if (!trusted() || input == null || TaskNotificationState.generation(getContext()) != expected || !TaskNotificationState.permission(getContext())) {
            starting = false; call.reject("任务提醒启动已取消，或系统通知未允许，请重新开启。"); return;
        }
        android.app.Activity activity = getActivity(); android.content.Context application = getContext().getApplicationContext();
        io.execute(() -> {
            try {
                TaskNotificationState.Snapshot config = TaskNotificationState.activate(application, input, expected);
                activity.runOnUiThread(() -> {
                    starting = false;
                    if (!trusted() || !TaskNotificationState.matches(config.epoch)) { TaskNotificationState.clearIf(config.epoch, "disabled", ""); PetTaskNotificationService.revoke(config); call.reject("登录已变化，任务提醒未启动。"); return; }
                    try { ContextCompat.startForegroundService(getContext(), new Intent(getContext(), PetTaskNotificationService.class)); call.resolve(new JSObject(TaskNotificationState.status(getContext()).toString())); }
                    catch (Exception failure) { TaskNotificationState.clearIf(config.epoch, "error", "无法开启后台任务提醒。"); PetTaskNotificationService.revoke(config); reject(call, failure); }
                });
            } catch (Exception failure) {
                activity.runOnUiThread(() -> { starting = false; reject(call, failure); });
            }
        });
    }
    private void clear(PluginCall call) {
        fromMain(call, false, () -> {
            TaskNotificationState.Snapshot previous = TaskNotificationState.snapshot(getContext());
            TaskNotificationState.clear("disabled", ""); getContext().stopService(new Intent(getContext(), PetTaskNotificationService.class)); PetTaskNotificationService.revoke(previous);
            permissionInput = null;
            if (resumeCall != null) { resumeCall.reject("登录已变化，任务提醒启动已取消。"); resumeCall = null; permissionInput = null; starting = false; }
            call.resolve(new JSObject(TaskNotificationState.status(getContext()).toString()));
        });
    }
    @PluginMethod public void stop(PluginCall call) { clear(call); }
    @PluginMethod public void clearScope(PluginCall call) { clear(call); }
    @PluginMethod public void consumeNavigation(PluginCall call) {
        fromMain(call, () -> call.resolve(new JSObject(TaskNotificationState.consume(getContext(), TaskNotificationPolicy.id(call.getString("instanceId")), TaskNotificationPolicy.id(call.getString("userId"))).toString())));
    }
    @PluginMethod public void openSystemSettings(PluginCall call) {
        fromMain(call, () -> {
            getActivity().startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                android.net.Uri.fromParts("package", getContext().getPackageName(), null)));
            call.resolve(new JSObject().put("opened", true));
        });
    }
    @Override protected void handleOnDestroy() { destroyed = true; permissionInput = null; resumeCall = null; TaskNotificationState.listen(null); io.shutdownNow(); super.handleOnDestroy(); }
}
