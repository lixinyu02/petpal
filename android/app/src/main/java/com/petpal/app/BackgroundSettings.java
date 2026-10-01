package com.petpal.app;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.json.JSONObject;

/** Resolves fixed routes to explicit, exported and enabled preinstalled system activities. */
final class BackgroundSettings {
    private BackgroundSettings() { }
    static JSObject status(Context context) throws Exception {
        JSObject routes = new JSObject();
        String vendor = BackgroundSettingsPolicy.vendor(Build.MANUFACTURER, Build.BRAND);
        for (String kind : BackgroundSettingsPolicy.KINDS) {
            BackgroundSettingsPolicy.Route selected = BackgroundSettingsPolicy.select(
                BackgroundSettingsPolicy.routes(kind, vendor, Build.VERSION.SDK_INT), route -> resolve(context, route) != null);
            routes.put(kind, new JSObject().put("available", selected != null).put("direct", selected != null && selected.direct)
                .put("route", selected == null ? "unavailable" : selected.id).put("fallback", selected != null && selected.fallback));
        }
        Object batteryExempt = JSONObject.NULL;
        if (Build.VERSION.SDK_INT >= 23) {
            try {
                PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
                if (power != null) batteryExempt = power.isIgnoringBatteryOptimizations(context.getPackageName());
            } catch (RuntimeException ignored) { }
        }
        return new JSObject().put("manufacturer", Build.MANUFACTURER).put("brand", Build.BRAND).put("vendor", vendor)
            .put("apiLevel", Build.VERSION.SDK_INT).put("batteryExempt", batteryExempt).put("routes", routes);
    }

    static JSObject open(Activity activity, String request) {
        String kind = BackgroundSettingsPolicy.kind(request);
        String vendor = BackgroundSettingsPolicy.vendor(Build.MANUFACTURER, Build.BRAND);
        for (BackgroundSettingsPolicy.Route route : BackgroundSettingsPolicy.routes(kind, vendor, Build.VERSION.SDK_INT)) {
            Intent intent = resolve(activity, route);
            if (intent == null) continue;
            try {
                activity.startActivity(intent);
                return new JSObject().put("opened", true).put("kind", kind).put("route", route.id).put("fallback", route.fallback);
            } catch (RuntimeException unavailable) {
                // ActivityNotFoundException, SecurityException and vendor launch failures all try the next fixed route.
            }
        }
        return new JSObject().put("opened", false).put("kind", kind).put("route", "unavailable").put("fallback", false);
    }

    private static Intent intent(Context context, BackgroundSettingsPolicy.Route route) {
        Intent value = new Intent();
        if (route.packageName != null) value.setComponent(new ComponentName(route.packageName, route.activityName));
        else value.setAction(route.action);
        if (route.packageUri) value.setData(Uri.fromParts("package", context.getPackageName(), null));
        if (route.appPackageExtra) value.putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
        return value;
    }

    private static boolean enabled(PackageManager manager, ActivityInfo info, String callerPackage) {
        int app = manager.getApplicationEnabledSetting(info.packageName);
        int activity = manager.getComponentEnabledSetting(new ComponentName(info.packageName, info.name));
        boolean appEnabled = app == PackageManager.COMPONENT_ENABLED_STATE_ENABLED || app == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && info.applicationInfo.enabled;
        boolean activityEnabled = activity == PackageManager.COMPONENT_ENABLED_STATE_ENABLED || activity == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && info.enabled;
        boolean permissionGranted = info.permission == null || info.permission.isEmpty() || manager.checkPermission(info.permission, callerPackage) == PackageManager.PERMISSION_GRANTED;
        return BackgroundSettingsPolicy.trustedHandler((info.applicationInfo.flags & ApplicationInfo.FLAG_SYSTEM) != 0,
            (info.applicationInfo.flags & ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0, info.exported, appEnabled, activityEnabled, permissionGranted);
    }

    private static Intent resolve(Context context, BackgroundSettingsPolicy.Route route) {
        PackageManager manager = context.getPackageManager();
        Intent request = intent(context, route);
        try {
            if (route.packageName != null) {
                ActivityInfo info = manager.getActivityInfo(request.getComponent(), 0);
                return info.applicationInfo != null && enabled(manager, info, context.getPackageName()) ? request : null;
            }
            // Query handlers for this one fixed Settings action, not an installed-app inventory.
            List<ResolveInfo> matches = new ArrayList<>(manager.queryIntentActivities(request, PackageManager.MATCH_DEFAULT_ONLY));
            Collections.sort(matches, (first, second) -> handlerKey(first).compareTo(handlerKey(second)));
            for (ResolveInfo match : matches) {
                ActivityInfo info = match.activityInfo;
                if (info != null && info.applicationInfo != null && enabled(manager, info, context.getPackageName())) return new Intent(request).setComponent(new ComponentName(info.packageName, info.name));
            }
        } catch (PackageManager.NameNotFoundException | RuntimeException unavailable) { }
        return null;
    }
    private static String handlerKey(ResolveInfo info) {
        if (info.activityInfo == null) return "2";
        return ("com.android.settings".equals(info.activityInfo.packageName) ? "0" : "1") + info.activityInfo.packageName + "/" + info.activityInfo.name;
    }
}
