package com.petpal.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class CompanionNotificationPolicyTest {
    private static final String CREATED = "2026-10-20T00:00:00.000Z", UNTIL = "2026-10-20T06:00:00.000Z";
    private static final long NOW = TaskNotificationPolicy.expires("2026-10-20T01:00:00.000Z");
    @Test public void currentGreetingIsEligibleAndOfflineExpiredGreetingIsNot() {
        assertTrue(CompanionNotificationPolicy.eligible(CREATED, UNTIL, NOW));
        assertFalse(CompanionNotificationPolicy.eligible(CREATED, UNTIL, TaskNotificationPolicy.expires(UNTIL)));
        assertFalse(CompanionNotificationPolicy.eligible(CREATED, UNTIL, NOW + 7 * 86400000L));
    }
    @Test public void invalidDatesFutureClaimsAndOverlongLifetimeCannotCreateStickyAlerts() {
        assertThrows(IllegalArgumentException.class, () -> CompanionNotificationPolicy.eligible(CREATED, CREATED, NOW));
        assertThrows(IllegalArgumentException.class, () -> CompanionNotificationPolicy.eligible(CREATED, "2026-10-22T00:00:00.000Z", NOW));
        assertThrows(IllegalArgumentException.class, () -> CompanionNotificationPolicy.eligible(CREATED, UNTIL, TaskNotificationPolicy.expires(CREATED) - 300001));
        assertThrows(IllegalArgumentException.class, () -> CompanionNotificationPolicy.eligible("2026-02-30T00:00:00.000Z", UNTIL, NOW));
        assertThrows(IllegalArgumentException.class, () -> CompanionNotificationPolicy.eligible(CREATED, "2026-10-20T06:00:00+00:00", NOW));
    }
    @Test public void notificationTextIsBoundedPlainTextAndBodyMayContainLineBreaks() {
        assertEquals("早上好", CompanionNotificationPolicy.title("早上好"));
        assertEquals("天气已更新\n点击查看", CompanionNotificationPolicy.body("天气已更新\n点击查看"));
        assertEquals("", CompanionNotificationPolicy.body(""));
        assertEquals(80, CompanionNotificationPolicy.title("好".repeat(80)).length());
        assertEquals(240, CompanionNotificationPolicy.body("晴".repeat(240)).length());
        for (String value : new String[] {null, "", " ", "好".repeat(81), "问候\n标题", "\u0000", "hello\u007f"}) assertThrows(IllegalArgumentException.class, () -> CompanionNotificationPolicy.title(value));
        for (String value : new String[] {null, "晴".repeat(241), "\u0000", "hello\tprivate", "hello\rprivate"}) assertThrows(IllegalArgumentException.class, () -> CompanionNotificationPolicy.body(value));
    }
    @Test public void companionTagsAreIndependentFromAgentAndFromOtherUsersOrServers() {
        String value = CompanionNotificationPolicy.tag("server1", "user1", "event1");
        assertTrue(value.startsWith("petpal-companion-"));
        assertNotEquals(TaskNotificationPolicy.tag("server1", "user1", "event1"), value);
        assertNotEquals(CompanionNotificationPolicy.tag("server1", "user2", "event1"), value);
        assertNotEquals(CompanionNotificationPolicy.tag("server2", "user1", "event1"), value);
        // A v1 batch receiving a companion source must still be rejected.
        assertThrows(IllegalArgumentException.class, () -> TaskNotificationPolicy.source("companion"));
    }
    @Test public void initialAndResetBaselinesRequireHighWaterAndCannotReplayHistory() {
        TaskNotificationPolicy.feedRange(30, 30, 30, 10, true);
        TaskNotificationPolicy.feedRange(3, 30, 30, 10, true);
        assertThrows(IllegalArgumentException.class, () -> TaskNotificationPolicy.feedRange(3, 29, 30, 10, true));
        assertThrows(IllegalArgumentException.class, () -> TaskNotificationPolicy.feedRange(3, 30, 30, 10, false));
        TaskNotificationPolicy.eventSequence(30, 31, 32); TaskNotificationPolicy.eventSequence(31, 32, 32); TaskNotificationPolicy.feedEnd(32, 32);
    }
}
