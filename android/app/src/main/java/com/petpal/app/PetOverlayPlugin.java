package com.petpal.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationChannelGroup;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name = "PetOverlay", permissions = {
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class PetOverlayPlugin extends Plugin {
    private static final String CHANNEL = "petpal_companion";
    private boolean destroyed, readyToStart;
    private PluginCall pendingStart;
    private String pendingKind;

    private boolean trusted(boolean foreground) {
        return !destroyed && getActivity() instanceof MainActivity && !getActivity().isFinishing() && !getActivity().isDestroyed()
            && getBridge() != null && getBridge().getWebView() != null && ((MainActivity) getActivity()).hasSecureUpdaterBridge()
            && UpdaterPolicy.trustedPage(getBridge().getLocalUrl(), getBridge().getWebView().getUrl())
            && (!foreground || ((MainActivity) getActivity()).isUpdaterForeground() && getBridge().getWebView().isShown());
    }

    private void fromMain(PluginCall call, boolean foreground, Runnable action) {
        if (getActivity() == null) { call.reject("请返回小伴主页面管理悬浮伙伴。"); return; }
        getActivity().runOnUiThread(() -> {
            if (!trusted(foreground)) { call.reject("悬浮伙伴只允许由安全的小伴主页面管理。"); return; }
            try { action.run(); } catch (RuntimeException failure) { call.reject("悬浮伙伴设置未完成，请返回应用后重试。"); }
        });
    }

    private boolean channelAllowed() {
        if (Build.VERSION.SDK_INT < 26) return true;
        try {
            NotificationManager manager = getContext().getSystemService(NotificationManager.class);
            if (manager == null) return false;
            NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
            if (channel == null) return true;
            if (channel.getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
            if (Build.VERSION.SDK_INT >= 28 && channel.getGroup() != null) {
                NotificationChannelGroup group = manager.getNotificationChannelGroup(channel.getGroup());
                if (group != null && group.isBlocked()) return false;
            }
            return true;
        } catch (RuntimeException unavailable) { return false; }
    }

    private boolean notificationsAllowed() {
        try {
            return (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
                && NotificationManagerCompat.from(getContext()).areNotificationsEnabled() && channelAllowed();
        } catch (RuntimeException unavailable) { return false; }
    }

    @PluginMethod
    public void status(PluginCall call) {
        fromMain(call, true, () -> {
            JSObject result = new JSObject();
            result.put("permission", Settings.canDrawOverlays(getContext()));
            result.put("running", PetOverlayService.running);
            result.put("companionKind", PetOverlayService.companionKind);
            result.put("notifications", notificationsAllowed());
            result.put("notificationChannel", channelAllowed());
            result.put("starting", pendingStart != null);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        fromMain(call, true, () -> {
            boolean allowed = Settings.canDrawOverlays(getContext());
            JSObject result = allowed ? new JSObject() : AndroidPermissionSettings.open(getActivity(), "overlay");
            result.put("permission", allowed);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void showPet(PluginCall call) {
        start(call);
    }

    @PluginMethod
    public void start(PluginCall call) {
        fromMain(call, true, () -> {
            if (pendingStart != null) { call.reject("悬浮伙伴权限或启动正在处理中。"); return; }
            if (!Settings.canDrawOverlays(getContext())) { call.reject("请先允许小伴显示在其他应用上层，然后返回应用开启桌宠。"); return; }
            pendingStart = call; pendingKind = OverlayAssetPolicy.normalizeCompanionKind(call.getString("companionKind"));
            if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
                try {
                    requestPermissionForAlias("notifications", call, "notificationsResult");
                } catch (RuntimeException failure) { finishStart("无法打开系统通知授权，请到应用通知设置检查后重试。"); }
                return;
            }
            readyToStart = true; resumeStart();
        });
    }

    @PermissionCallback
    private void notificationsResult(PluginCall call) {
        if (destroyed || pendingStart != call) return;
        if (getPermissionState("notifications") != PermissionState.GRANTED) {
            finishStart("请允许系统通知，以便随时从常驻通知停止悬浮伙伴。"); return;
        }
        readyToStart = true;
        if (getActivity() != null) getActivity().getWindow().getDecorView().post(this::resumeStart);
    }

    @Override protected void handleOnResume() {
        super.handleOnResume();
        if (getActivity() != null) getActivity().getWindow().getDecorView().post(this::resumeStart);
    }

    private void finishStart(String message) {
        PluginCall call = pendingStart; pendingStart = null; pendingKind = null; readyToStart = false;
        if (call != null) call.reject(message);
    }

    private void resumeStart() {
        if (pendingStart == null || !readyToStart || !trusted(true)) return;
        try {
            if (!Settings.canDrawOverlays(getContext())) { finishStart("悬浮窗权限已关闭，请重新允许后再开启伙伴。"); return; }
            if (!notificationsAllowed()) { finishStart("请在系统通知设置中允许小伴通知及悬浮伙伴通知频道，再重新开启。"); return; }
            PluginCall call = pendingStart;
            String kind = pendingKind;
            Intent intent = new Intent(getContext(), PetOverlayService.class).putExtra(PetOverlayService.COMPANION_KIND, kind);
            ContextCompat.startForegroundService(getContext(), intent);
            pendingStart = null; pendingKind = null; readyToStart = false;
            JSObject result = new JSObject();
            result.put("running", true);
            result.put("companionKind", kind);
            call.resolve(result);
        } catch (Exception error) {
            finishStart("无法开启悬浮伙伴，请返回应用前台并检查系统权限后重试。");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        fromMain(call, false, () -> {
            finishStart("悬浮伙伴启动已取消。");
            getContext().stopService(new Intent(getContext(), PetOverlayService.class));
            JSObject result = new JSObject(); result.put("running", false); call.resolve(result);
        });
    }

    @Override protected void handleOnDestroy() { destroyed = true; finishStart("页面已关闭，悬浮伙伴启动已取消。"); super.handleOnDestroy(); }
}
