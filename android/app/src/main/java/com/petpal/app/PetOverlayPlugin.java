package com.petpal.app;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
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
    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("permission", Settings.canDrawOverlays(getContext()));
        result.put("running", PetOverlayService.running);
        result.put("companionKind", PetOverlayService.companionKind);
        call.resolve(result);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        boolean allowed = Settings.canDrawOverlays(getContext());
        if (!allowed) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
        }
        JSObject result = new JSObject();
        result.put("permission", allowed);
        call.resolve(result);
    }

    @PluginMethod
    public void showPet(PluginCall call) {
        start(call);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!Settings.canDrawOverlays(getContext())) {
            call.reject("请先允许小伴显示在其他应用上层，然后返回应用开启桌宠。");
            return;
        }
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationsResult");
            return;
        }
        startOverlay(call);
    }

    @PermissionCallback
    private void notificationsResult(PluginCall call) {
        if (getPermissionState("notifications") != PermissionState.GRANTED) {
            call.reject("需要通知权限，以便随时从常驻通知停止桌宠。");
            return;
        }
        startOverlay(call);
    }

    private void startOverlay(PluginCall call) {
        try {
            String kind = OverlayAssetPolicy.normalizeCompanionKind(call.getString("companionKind"));
            Intent intent = new Intent(getContext(), PetOverlayService.class).putExtra(PetOverlayService.COMPANION_KIND, kind);
            ContextCompat.startForegroundService(getContext(), intent);
            JSObject result = new JSObject();
            result.put("running", true);
            result.put("companionKind", kind);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法开启桌宠：" + error.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), PetOverlayService.class));
        JSObject result = new JSObject();
        result.put("running", false);
        call.resolve(result);
    }
}
