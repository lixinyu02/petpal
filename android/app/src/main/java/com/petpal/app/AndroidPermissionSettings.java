package com.petpal.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;

/** All routes are fixed, scoped to this application, and checked again at launch time. */
final class AndroidPermissionSettings {
    private AndroidPermissionSettings() { }
    private static String vendor() { return BackgroundSettingsPolicy.vendor(Build.MANUFACTURER, Build.BRAND); }
    private static Intent resolve(Context context, String kind, BackgroundSettingsPolicy.Route route) {
        Intent intent = BackgroundSettings.resolve(context, route);
        if (intent != null && "android-notification-channel".equals(route.id)) {
            intent.putExtra(Settings.EXTRA_CHANNEL_ID, AndroidPermissionPolicy.channel(kind));
        }
        return intent;
    }
    static JSObject routes(Context context) {
        JSObject result = new JSObject();
        for (String kind : AndroidPermissionPolicy.KINDS) {
            boolean available = false;
            for (BackgroundSettingsPolicy.Route route : AndroidPermissionPolicy.routes(kind, vendor(), Build.VERSION.SDK_INT)) {
                if (resolve(context, kind, route) != null) { available = true; break; }
            }
            result.put(kind, new JSObject().put("available", available));
        }
        return result;
    }
    static JSObject open(Activity activity, String request) {
        String kind = AndroidPermissionPolicy.kind(request);
        for (BackgroundSettingsPolicy.Route route : AndroidPermissionPolicy.routes(kind, vendor(), Build.VERSION.SDK_INT)) {
            Intent intent = resolve(activity, kind, route);
            if (intent == null) continue;
            try {
                activity.startActivity(intent);
                return new JSObject().put("opened", true).put("kind", kind).put("route", route.id).put("fallback", route.fallback);
            } catch (RuntimeException unavailable) {
                // OEM and managed-profile restrictions can change between resolve and launch.
            }
        }
        return new JSObject().put("opened", false).put("kind", kind).put("route", "unavailable").put("fallback", false);
    }
}
