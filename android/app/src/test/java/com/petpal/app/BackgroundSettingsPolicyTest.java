package com.petpal.app;

import java.util.List;
import org.junit.Test;
import static org.junit.Assert.*;

public class BackgroundSettingsPolicyTest {
    @Test public void onlyFixedKindsAreAcceptedWithoutCoercion() {
        for (String kind : new String[] { "battery", "autostart", "notifications", "app" }) assertEquals(kind, BackgroundSettingsPolicy.kind(kind));
        for (String kind : new String[] { null, "", "Battery", " battery", "app ", "android.settings.SETTINGS", "package:com.other.app", "intent://settings", "com.miui.securitycenter", "battery\n" }) {
            assertThrows(String.valueOf(kind), IllegalArgumentException.class, () -> BackgroundSettingsPolicy.kind(kind));
        }
        assertThrows(UnsupportedOperationException.class, () -> BackgroundSettingsPolicy.KINDS.add("arbitrary"));
    }
    @Test public void recognizesManufacturerAndBrandedVariantsCaseInsensitively() {
        String[][] inputs = {
            { "Xiaomi", "", "xiaomi" }, { "Xiaomi", "REDMI", "xiaomi" }, { "", "Poco", "xiaomi" },
            { " HUAWEI ", "huawei", "huawei" }, { "HUAWEI", "HONOR", "honor" }, { "HONOR", "", "honor" },
            { "OPPO", "realme", "oppo" }, { "OPLUS", "ONEPLUS", "oppo" }, { "vivo", "iQOO", "vivo" },
            { "SAMSUNG", "samsung", "samsung" }, { "Meizu", "", "meizu" }, { "ASUS", "asus", "asus" }
        };
        for (String[] input : inputs) assertEquals(input[0] + "/" + input[1], input[2], BackgroundSettingsPolicy.vendor(input[0], input[1]));
    }
    @Test public void unknownAndPartialVendorStringsRemainGeneric() {
        assertEquals("generic", BackgroundSettingsPolicy.vendor(null, null));
        for (String unknown : new String[] { "Google", "motorola", "nokia", "some xiaomi compatible", "huawei-malicious", "com.miui.securitycenter", "Samsung\nother", "" }) {
            assertEquals(unknown, "generic", BackgroundSettingsPolicy.vendor(unknown, unknown));
        }
        assertEquals("samsung", BackgroundSettingsPolicy.vendor("Samsung", "unrecognized"));
    }
    @Test public void batteryPrefersPerAppThenVerifiedOemThenStandardList() {
        List<BackgroundSettingsPolicy.Route> routes = BackgroundSettingsPolicy.routes("battery", "xiaomi", 35);
        assertEquals("android-app-battery", routes.get(0).id);
        assertEquals("android.settings.VIEW_ADVANCED_POWER_USAGE_DETAIL", routes.get(0).action);
        assertTrue(routes.get(0).packageUri);
        assertEquals("xiaomi-battery", routes.get(1).id);
        assertEquals("com.miui.powerkeeper", routes.get(1).packageName);
        assertEquals("android-battery-list", routes.get(2).id);
        assertEquals("android-app-details", routes.get(3).id);
        assertEquals("android-settings", routes.get(4).id);
        assertTrue(routes.get(2).direct); assertFalse(routes.get(2).fallback);
    }
    @Test public void unavailableOemFallsBackToSystemBatteryListAndOwnDetails() {
        List<BackgroundSettingsPolicy.Route> routes = BackgroundSettingsPolicy.routes("battery", "xiaomi", 35);
        BackgroundSettingsPolicy.Route selected = BackgroundSettingsPolicy.select(routes, route -> "android-battery-list".equals(route.id));
        assertEquals("android-battery-list", selected.id); assertTrue(selected.direct); assertFalse(selected.fallback);
        selected = BackgroundSettingsPolicy.select(routes, route -> "android-app-details".equals(route.id));
        assertEquals("android-app-details", selected.id); assertFalse(selected.direct); assertTrue(selected.fallback); assertTrue(selected.packageUri);
        assertNull(BackgroundSettingsPolicy.select(routes, route -> false));
    }
    @Test public void notificationsArePerAppFromApi26AndSafelyFallBackOnOlderBuilds() {
        BackgroundSettingsPolicy.Route current = BackgroundSettingsPolicy.routes("notifications", "generic", 26).get(0);
        assertEquals("android-notifications", current.id); assertTrue(current.appPackageExtra); assertFalse(current.packageUri);
        assertTrue(current.direct); assertFalse(current.fallback);
        BackgroundSettingsPolicy.Route older = BackgroundSettingsPolicy.routes("notifications", "generic", 23).get(0);
        assertEquals("android-app-details", older.id); assertFalse(older.direct); assertTrue(older.fallback);
    }
    @Test public void appDetailsAreDirectOnlyWhenAppWasRequested() {
        BackgroundSettingsPolicy.Route route = BackgroundSettingsPolicy.routes("app", "generic", 35).get(0);
        assertEquals("android-app-details", route.id); assertTrue(route.direct); assertFalse(route.fallback);
        route = BackgroundSettingsPolicy.routes("autostart", "generic", 35).get(0);
        assertEquals("android-app-details", route.id); assertFalse(route.direct); assertTrue(route.fallback);
    }
    @Test public void modernHonorAndUnknownVendorsDoNotBorrowUnverifiedHuaweiRoutes() {
        for (String vendor : new String[] { "honor", "generic", null, "evil", "com.hihonor.systemmanager" }) {
            List<BackgroundSettingsPolicy.Route> routes = BackgroundSettingsPolicy.routes("autostart", vendor, 35);
            assertEquals(2, routes.size()); assertEquals("android-app-details", routes.get(0).id);
            assertNull(routes.get(0).packageName); assertTrue(routes.get(0).fallback);
        }
    }
    @Test public void verifiedOemAutostartEntriesStayInTheirOwnVendorAndHaveFallback() {
        for (String vendor : new String[] { "xiaomi", "huawei", "oppo", "vivo", "meizu", "asus" }) {
            List<BackgroundSettingsPolicy.Route> routes = BackgroundSettingsPolicy.routes("autostart", vendor, 35);
            BackgroundSettingsPolicy.Route first = routes.get(0);
            assertEquals(vendor + "-autostart", first.id); assertNotNull(first.packageName); assertNotNull(first.activityName);
            assertTrue(first.packageName.matches("[a-zA-Z0-9_]+(?:\\.[a-zA-Z0-9_]+)+"));
            assertTrue(first.activityName.matches("[a-zA-Z0-9_]+(?:\\.[a-zA-Z0-9_]+)+"));
            assertNull(first.action);
            assertTrue(first.direct); assertFalse(first.fallback);
            BackgroundSettingsPolicy.Route selected = BackgroundSettingsPolicy.select(routes, route -> "android-app-details".equals(route.id));
            assertTrue(selected.fallback); assertFalse(selected.direct);
        }
    }
    @Test public void routesCannotBeMutatedAndDoNotContainPermissionRequestActions() {
        for (String kind : BackgroundSettingsPolicy.KINDS) for (String vendor : new String[] { "xiaomi", "huawei", "honor", "oppo", "vivo", "samsung", "meizu", "asus", "generic" }) {
            List<BackgroundSettingsPolicy.Route> routes = BackgroundSettingsPolicy.routes(kind, vendor, 35);
            assertThrows(UnsupportedOperationException.class, () -> routes.clear());
            for (BackgroundSettingsPolicy.Route route : routes) {
                assertNotEquals("android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS", route.action);
                assertTrue(route.packageName != null || route.action.startsWith("android.settings."));
                assertFalse(route.appPackageExtra && route.packageUri);
            }
        }
    }
    @Test public void onlyExportedEnabledAccessibleSystemOrUpdatedSystemHandlersAreTrusted() {
        for (int mask = 0; mask < 64; mask++) {
            boolean system = (mask & 1) != 0, updated = (mask & 2) != 0, exported = (mask & 4) != 0,
                appEnabled = (mask & 8) != 0, activityEnabled = (mask & 16) != 0, permission = (mask & 32) != 0;
            assertEquals("handler flags " + mask, (system || updated) && exported && appEnabled && activityEnabled && permission,
                BackgroundSettingsPolicy.trustedHandler(system, updated, exported, appEnabled, activityEnabled, permission));
        }
    }
}
