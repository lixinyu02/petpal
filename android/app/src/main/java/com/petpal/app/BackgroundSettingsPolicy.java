package com.petpal.app;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/** Fixed settings routes only. No caller-controlled action, component, package or URL. */
public final class BackgroundSettingsPolicy {
    private BackgroundSettingsPolicy() { }
    public static final List<String> KINDS = Collections.unmodifiableList(Arrays.asList("battery", "autostart", "notifications", "app"));

    public static String kind(String value) {
        for (String allowed : KINDS) if (allowed.equals(value)) return allowed;
        throw new IllegalArgumentException("后台设置类型无效。");
    }

    private static String normalized(String value) { return value == null ? "" : value.trim().toLowerCase(Locale.ROOT); }
    private static String vendorName(String value) {
        switch (normalized(value)) {
            case "xiaomi": case "redmi": case "poco": return "xiaomi";
            case "huawei": return "huawei";
            case "honor": return "honor";
            case "oppo": case "oplus": case "realme": case "oneplus": return "oppo";
            case "vivo": case "iqoo": return "vivo";
            case "samsung": return "samsung";
            case "meizu": return "meizu";
            case "asus": return "asus";
            default: return "generic";
        }
    }

    public static String vendor(String manufacturer, String brand) {
        String branded = vendorName(brand);
        return "generic".equals(branded) ? vendorName(manufacturer) : branded;
    }

    public static final class Route {
        public final String id, action, packageName, activityName;
        public final boolean direct, fallback, appPackageExtra, packageUri;
        private Route(String id, String action, String packageName, String activityName, boolean direct, boolean fallback, boolean appPackageExtra, boolean packageUri) {
            this.id = id; this.action = action; this.packageName = packageName; this.activityName = activityName;
            this.direct = direct; this.fallback = fallback; this.appPackageExtra = appPackageExtra; this.packageUri = packageUri;
        }
    }
    private static Route system(String id, String action, boolean direct, boolean fallback, boolean appPackageExtra, boolean packageUri) {
        return new Route(id, action, null, null, direct, fallback, appPackageExtra, packageUri);
    }
    private static Route oem(String id, String pkg, String activity) { return new Route(id, null, pkg, activity, true, false, false, false); }

    public static List<Route> routes(String request, String vendor, int apiLevel) {
        String target = kind(request);
        List<Route> routes = new ArrayList<>();
        if ("battery".equals(target)) {
            // AOSP has this non-public per-app action. Never assume support; resolve it before using it.
            routes.add(system("android-app-battery", "android.settings.VIEW_ADVANCED_POWER_USAGE_DETAIL", true, false, false, true));
            switch (vendor == null ? "generic" : vendor) {
                case "xiaomi":
                    routes.add(oem("xiaomi-battery", "com.miui.powerkeeper", "com.miui.powerkeeper.ui.HiddenAppsContainerManagementActivity"));
                    break;
                case "samsung":
                    routes.add(oem("samsung-battery", "com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity"));
                    routes.add(oem("samsung-battery", "com.samsung.android.lool", "com.samsung.android.sm.battery.ui.BatteryActivity"));
                    break;
                case "meizu":
                    routes.add(oem("meizu-battery", "com.meizu.safe", "com.meizu.safe.powerui.PowerAppPermissionActivity"));
                    break;
                case "asus":
                    routes.add(oem("asus-battery", "com.asus.mobilemanager", "com.asus.mobilemanager.powersaver.PowerSaverSettings"));
                    break;
                default: break;
            }
            if (apiLevel >= 23) routes.add(system("android-battery-list", "android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS", true, false, false, false));
        } else if ("autostart".equals(target)) {
            // Historical OEM routes are best effort; availability is resolved again immediately before launch.
            switch (vendor == null ? "generic" : vendor) {
                case "xiaomi":
                    routes.add(oem("xiaomi-autostart", "com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"));
                    break;
                case "huawei":
                    routes.add(oem("huawei-autostart", "com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"));
                    routes.add(oem("huawei-autostart", "com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"));
                    break;
                case "oppo":
                    routes.add(oem("oppo-autostart", "com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"));
                    routes.add(oem("oppo-autostart", "com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"));
                    routes.add(oem("oppo-autostart", "com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"));
                    break;
                case "vivo":
                    routes.add(oem("vivo-autostart", "com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"));
                    routes.add(oem("vivo-autostart", "com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"));
                    routes.add(oem("vivo-autostart", "com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"));
                    break;
                case "meizu":
                    routes.add(oem("meizu-autostart", "com.meizu.safe", "com.meizu.safe.permission.SmartBGActivity"));
                    break;
                case "asus":
                    routes.add(oem("asus-autostart", "com.asus.mobilemanager", "com.asus.mobilemanager.autostart.AutoStartActivity"));
                    break;
                // Modern Honor and Samsung have no verified direct autostart component here.
                default: break;
            }
        } else if ("notifications".equals(target) && apiLevel >= 26) {
            routes.add(system("android-notifications", "android.settings.APP_NOTIFICATION_SETTINGS", true, false, true, false));
        }
        boolean app = "app".equals(target);
        routes.add(system("android-app-details", "android.settings.APPLICATION_DETAILS_SETTINGS", app, !app, false, true));
        routes.add(system("android-settings", "android.settings.SETTINGS", false, true, false, false));
        return Collections.unmodifiableList(routes);
    }

    public interface Availability { boolean available(Route route); }
    public static Route select(List<Route> routes, Availability availability) {
        for (Route route : routes) if (availability.available(route)) return route;
        return null;
    }

    public static boolean trustedHandler(boolean system, boolean updatedSystem, boolean exported, boolean appEnabled, boolean activityEnabled, boolean permissionGranted) {
        return (system || updatedSystem) && exported && appEnabled && activityEnabled && permissionGranted;
    }
}
