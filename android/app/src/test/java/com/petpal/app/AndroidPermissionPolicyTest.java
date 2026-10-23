package com.petpal.app;

import java.util.List;
import org.junit.Test;
import static org.junit.Assert.*;

public class AndroidPermissionPolicyTest {
    @Test public void settingsKindsAreExactAndImmutable() {
        for (String kind : AndroidPermissionPolicy.KINDS) assertEquals(kind, AndroidPermissionPolicy.kind(kind));
        for (String value : new String[] { null, "", " app", "app ", "Microphone", "overlay\n", "intent://settings", "package:com.other.app", "android.settings.SETTINGS" }) {
            assertThrows(String.valueOf(value), IllegalArgumentException.class, () -> AndroidPermissionPolicy.kind(value));
        }
        assertThrows(UnsupportedOperationException.class, () -> AndroidPermissionPolicy.KINDS.clear());
    }
    @Test public void firstRequestNeverBecomesPermanentDenialFromRationaleAlone() {
        assertEquals("prompt", AndroidPermissionPolicy.mediaState(true, false, false, false, false));
        assertEquals("prompt", AndroidPermissionPolicy.mediaState(true, false, true, false, false));
        assertEquals("denied", AndroidPermissionPolicy.mediaState(true, false, true, true, true));
        assertEquals("settings", AndroidPermissionPolicy.mediaState(true, false, true, false, true));
        assertEquals("prompt", AndroidPermissionPolicy.mediaState(true, false, false, false, true));
    }
    @Test public void revokedOneTimeOrPreviouslyGrantedPermissionsCanPromptAgain() {
        assertEquals("granted", AndroidPermissionPolicy.mediaState(true, true, true, false, false));
        assertEquals("prompt", AndroidPermissionPolicy.mediaState(true, false, true, false, false));
        assertEquals("denied", AndroidPermissionPolicy.mediaState(true, false, false, true, false));
    }
    @Test public void grantWinsOverHistoryAndUnsupportedHardwareWinsOverGrant() {
        for (int mask = 0; mask < 8; mask++) {
            assertEquals("granted", AndroidPermissionPolicy.mediaState(true, true, (mask & 1) != 0, (mask & 2) != 0, (mask & 4) != 0));
            assertEquals("unsupported", AndroidPermissionPolicy.mediaState(false, (mask & 1) != 0, true, (mask & 2) != 0, (mask & 4) != 0));
        }
    }
    @Test public void channelNamesMapOnlyToTheActualFeatureChannels() {
        assertEquals("petpal_agent_results", AndroidPermissionPolicy.channel("task"));
        assertEquals("petpal_companion_routines", AndroidPermissionPolicy.channel("companion"));
        assertEquals("petpal_agent_listener", AndroidPermissionPolicy.channel("watch"));
        assertNull(AndroidPermissionPolicy.channel("notifications"));
        assertThrows(IllegalArgumentException.class, () -> AndroidPermissionPolicy.channel("arbitrary-channel"));
    }
    @Test public void notificationChannelsPreferTheExactChannelThenTheAppPage() {
        for (String kind : new String[] { "task", "companion", "watch" }) {
            List<BackgroundSettingsPolicy.Route> routes = AndroidPermissionPolicy.routes(kind, "generic", 26);
            assertEquals("android-notification-channel", routes.get(0).id);
            assertTrue(routes.get(0).appPackageExtra); assertTrue(routes.get(0).direct); assertFalse(routes.get(0).fallback);
            assertEquals("android-notifications", routes.get(1).id); assertTrue(routes.get(1).fallback);
            assertEquals("android-app-details", routes.get(2).id);
            assertEquals("android-app-details", AndroidPermissionPolicy.routes(kind, "generic", 23).get(0).id);
        }
    }
    @Test public void specialAccessHasVersionAppropriateRoutesWithoutRequestingAccess() {
        BackgroundSettingsPolicy.Route overlay = AndroidPermissionPolicy.routes("overlay", "generic", 23).get(0);
        assertEquals("android.settings.action.MANAGE_OVERLAY_PERMISSION", overlay.action); assertTrue(overlay.packageUri);
        BackgroundSettingsPolicy.Route install = AndroidPermissionPolicy.routes("install", "generic", 26).get(0);
        assertEquals("android.settings.MANAGE_UNKNOWN_APP_SOURCES", install.action); assertTrue(install.packageUri);
        assertEquals("android.settings.SECURITY_SETTINGS", AndroidPermissionPolicy.routes("install", "generic", 23).get(0).action);
        for (String kind : new String[] { "microphone", "camera" }) {
            BackgroundSettingsPolicy.Route route = AndroidPermissionPolicy.routes(kind, "generic", 35).get(0);
            assertEquals("android-app-details", route.id); assertTrue(route.packageUri); assertTrue(route.direct);
        }
    }
    @Test public void existingOemBatteryAndAutostartPoliciesArePreserved() {
        for (String vendor : new String[] { "xiaomi", "honor", "huawei", "oppo", "vivo", "samsung", "generic" }) {
            for (String kind : new String[] { "battery", "autostart", "notifications", "app" }) {
                List<BackgroundSettingsPolicy.Route> expected = BackgroundSettingsPolicy.routes(kind, vendor, 35);
                List<BackgroundSettingsPolicy.Route> actual = AndroidPermissionPolicy.routes(kind, vendor, 35);
                assertEquals(expected.size(), actual.size());
                for (int index = 0; index < expected.size(); index++) assertEquals(expected.get(index).id, actual.get(index).id);
            }
        }
    }
    @Test public void everyRouteSetIsImmutableAndHasSafeFallbackAcrossSdkVersions() {
        for (int sdk : new int[] { 23, 25, 26, 28, 33, 35, 36 }) for (String kind : AndroidPermissionPolicy.KINDS) {
            List<BackgroundSettingsPolicy.Route> routes = AndroidPermissionPolicy.routes(kind, "generic", sdk);
            assertThrows(UnsupportedOperationException.class, () -> routes.clear());
            assertEquals("android-settings", routes.get(routes.size() - 1).id);
            BackgroundSettingsPolicy.Route fallback = BackgroundSettingsPolicy.select(routes, route -> "android-app-details".equals(route.id));
            assertNotNull(fallback); assertTrue(fallback.packageUri);
            for (BackgroundSettingsPolicy.Route route : routes) assertNotEquals("android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS", route.action);
        }
    }
}
