package com.petpal.app;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/** Pure permission interpretation and fixed settings routes; never accepts an arbitrary intent. */
public final class AndroidPermissionPolicy {
    private AndroidPermissionPolicy() { }
    public static final List<String> KINDS = Collections.unmodifiableList(Arrays.asList(
        "app", "microphone", "camera", "notifications", "task", "companion", "watch", "overlay", "install", "battery", "autostart"));
    public static String kind(String value) {
        for (String allowed : KINDS) if (allowed.equals(value)) return value;
        throw new IllegalArgumentException("权限设置类型无效。");
    }
    public static String mediaState(boolean supported, boolean granted, boolean asked, boolean rationale, boolean lastResultDenied) {
        if (!supported) return "unsupported";
        if (granted) return "granted";
        if (rationale) return "denied";
        // A prompt that has not completed, or a previously granted one-time permission,
        // must remain retryable. asked alone is not evidence of a permanent denial.
        return asked && lastResultDenied ? "settings" : "prompt";
    }
    public static String channel(String kind) {
        switch (kind(kind)) {
            case "task": return "petpal_agent_results";
            case "companion": return "petpal_companion_routines";
            case "watch": return "petpal_agent_listener";
            default: return null;
        }
    }
    public static List<BackgroundSettingsPolicy.Route> routes(String request, String vendor, int apiLevel) {
        String kind = kind(request);
        if ("battery".equals(kind) || "autostart".equals(kind) || "app".equals(kind) || "notifications".equals(kind)) {
            return BackgroundSettingsPolicy.routes(kind, vendor, apiLevel);
        }
        List<BackgroundSettingsPolicy.Route> routes = new ArrayList<>();
        if (channel(kind) != null && apiLevel >= 26) {
            routes.add(BackgroundSettingsPolicy.system("android-notification-channel", "android.settings.CHANNEL_NOTIFICATION_SETTINGS", true, false, true, false));
            routes.add(BackgroundSettingsPolicy.system("android-notifications", "android.settings.APP_NOTIFICATION_SETTINGS", false, true, true, false));
        } else if ("overlay".equals(kind) && apiLevel >= 23) {
            routes.add(BackgroundSettingsPolicy.system("android-overlay", "android.settings.action.MANAGE_OVERLAY_PERMISSION", true, false, false, true));
        } else if ("install".equals(kind)) {
            if (apiLevel >= 26) routes.add(BackgroundSettingsPolicy.system("android-install-sources", "android.settings.MANAGE_UNKNOWN_APP_SOURCES", true, false, false, true));
            else routes.add(BackgroundSettingsPolicy.system("android-security", "android.settings.SECURITY_SETTINGS", true, false, false, false));
        }
        boolean media = "microphone".equals(kind) || "camera".equals(kind);
        routes.add(BackgroundSettingsPolicy.system("android-app-details", "android.settings.APPLICATION_DETAILS_SETTINGS", media, !media, false, true));
        routes.add(BackgroundSettingsPolicy.system("android-settings", "android.settings.SETTINGS", false, true, false, false));
        return Collections.unmodifiableList(routes);
    }
}
