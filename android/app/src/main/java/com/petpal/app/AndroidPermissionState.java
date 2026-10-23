package com.petpal.app;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationChannelGroup;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import org.json.JSONObject;

/** Snapshot only: never requests permission, opens a sensor, creates a channel or changes settings. */
final class AndroidPermissionState {
    private static final String PREFS = "petpal_permission_history_v1";
    private AndroidPermissionState() { }
    private static boolean mediaPermission(String permission) {
        return Manifest.permission.RECORD_AUDIO.equals(permission) || Manifest.permission.CAMERA.equals(permission);
    }
    private static SharedPreferences prefs(Context context) { return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    static void markRequested(Context context, String permission) {
        if (!mediaPermission(permission)) return;
        prefs(context).edit().putBoolean(permission + ".asked", true).putString(permission + ".result", "pending").apply();
    }
    static void recordResult(Activity activity, String permission) {
        if (!mediaPermission(permission)) return;
        boolean granted = ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED;
        prefs(activity).edit().putString(permission + ".result", granted ? "granted" : "denied").apply();
    }
    private static JSObject media(Activity activity, String permission, String feature) {
        boolean supported = activity.getPackageManager().hasSystemFeature(feature);
        boolean granted = ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED;
        SharedPreferences history = prefs(activity);
        String state = AndroidPermissionPolicy.mediaState(supported, granted, history.getBoolean(permission + ".asked", false),
            ActivityCompat.shouldShowRequestPermissionRationale(activity, permission), "denied".equals(history.getString(permission + ".result", "")));
        // Android's public SDK exposes sensor-toggle capability but not the current
        // privacy-toggle value to ordinary apps. Avoid hidden APIs and false diagnoses.
        return new JSObject().put("state", state).put("supported", supported).put("blocked", JSONObject.NULL);
    }
    private static JSObject channel(Context context, String id) {
        if (Build.VERSION.SDK_INT < 26) return new JSObject().put("created", false).put("enabled", true);
        try {
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager == null) return new JSObject().put("created", false).put("enabled", false);
            NotificationChannel channel = manager.getNotificationChannel(id);
            if (channel == null) return new JSObject().put("created", false).put("enabled", true);
            boolean enabled = channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
            if (Build.VERSION.SDK_INT >= 28 && channel.getGroup() != null) {
                NotificationChannelGroup group = manager.getNotificationChannelGroup(channel.getGroup());
                if (group != null && group.isBlocked()) enabled = false;
            }
            return new JSObject().put("created", true).put("enabled", enabled);
        } catch (RuntimeException unavailable) {
            return new JSObject().put("created", false).put("enabled", false);
        }
    }
    static JSObject status(Activity activity) {
        String vendor = BackgroundSettingsPolicy.vendor(Build.MANUFACTURER, Build.BRAND);
        JSObject device = new JSObject().put("manufacturer", Build.MANUFACTURER).put("brand", Build.BRAND).put("model", Build.MODEL)
            .put("apiLevel", Build.VERSION.SDK_INT).put("androidRelease", Build.VERSION.RELEASE).put("vendor", vendor);
        boolean runtimeGranted = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        boolean notificationsEnabled;
        try { notificationsEnabled = NotificationManagerCompat.from(activity).areNotificationsEnabled(); }
        catch (RuntimeException unavailable) { notificationsEnabled = false; }
        JSObject channels = new JSObject().put("task", channel(activity, PetTaskNotificationService.RESULT_CHANNEL))
            .put("companion", channel(activity, PetTaskNotificationService.COMPANION_CHANNEL)).put("watch", channel(activity, PetTaskNotificationService.WATCH_CHANNEL))
            .put("overlay", channel(activity, "petpal_companion"));
        boolean overlayGranted = false, overlaySupported = Build.VERSION.SDK_INT >= 23;
        try { overlayGranted = Settings.canDrawOverlays(activity); } catch (RuntimeException unavailable) { overlaySupported = false; }
        boolean installGranted = false;
        try {
            installGranted = Build.VERSION.SDK_INT >= 26 ? activity.getPackageManager().canRequestPackageInstalls()
                : Settings.Secure.getInt(activity.getContentResolver(), Settings.Secure.INSTALL_NON_MARKET_APPS, 0) == 1;
        } catch (RuntimeException unavailable) { }
        Object batteryExempt = JSONObject.NULL;
        try {
            PowerManager manager = (PowerManager) activity.getSystemService(Context.POWER_SERVICE);
            if (manager != null) batteryExempt = manager.isIgnoringBatteryOptimizations(activity.getPackageName());
        } catch (RuntimeException unavailable) { }
        return new JSObject().put("device", device)
            .put("microphone", media(activity, Manifest.permission.RECORD_AUDIO, PackageManager.FEATURE_MICROPHONE))
            .put("camera", media(activity, Manifest.permission.CAMERA, PackageManager.FEATURE_CAMERA_ANY))
            .put("notifications", new JSObject().put("runtimeGranted", runtimeGranted).put("enabled", notificationsEnabled).put("channels", channels))
            .put("overlay", new JSObject().put("granted", overlayGranted).put("supported", overlaySupported))
            .put("install", new JSObject().put("granted", installGranted).put("supported", true))
            .put("battery", new JSObject().put("exempt", batteryExempt)).put("routes", AndroidPermissionSettings.routes(activity));
    }
}
