package com.petpal.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class TaskNotificationPolicyTest {
    @Test public void allowsHttpsHostsPortsAndReverseProxyPrefixesWithoutCredentials() {
        assertEquals("https://magicdatou.top:4318/petpal", TaskNotificationPolicy.baseUrl("https://magicdatou.top:4318/petpal/"));
        assertEquals("https://localhost", TaskNotificationPolicy.baseUrl("https://localhost/"));
        assertEquals("https://[::1]:443", TaskNotificationPolicy.baseUrl("https://[::1]:443"));
    }
    @Test public void rejectsCleartextCredentialsFragmentsAndPathTraversal() {
        for (String url : new String[] { null, "http://192.168.60.1", "https://user:token@a.test", "https://a.test?q=token", "https://a.test#x", "https://a.test:0", "https://a.test:65536", "https://a.test/../secret", "https://a.test/%2e%2e", "https://a.test/\\secret", "https://a.test\n", "file:///private", "javascript:alert(1)" }) {
            assertThrows(String.valueOf(url), IllegalArgumentException.class, () -> TaskNotificationPolicy.baseUrl(url));
        }
    }
    @Test public void acceptsDeviceTokensButRejectsHeaderAndNavigationInjection() {
        assertEquals("c".repeat(64), TaskNotificationPolicy.token("c".repeat(64)));
        for (String token : new String[] { "", "test", "a".repeat(129), "a".repeat(50) + "\r\nOther: secret" }) assertThrows(IllegalArgumentException.class, () -> TaskNotificationPolicy.token(token));
        for (String id : new String[] { "../path", "https://host", "<script>", "abc\n", "a".repeat(129) }) assertThrows(IllegalArgumentException.class, () -> TaskNotificationPolicy.id(id));
        assertEquals("01aa-bb_12", TaskNotificationPolicy.id("01aa-bb_12"));
    }
    @Test public void validatesIsoExpiryWithoutLenientDateRollover() {
        assertEquals(0L, TaskNotificationPolicy.expires("1970-01-01T00:00:00.000Z"));
        for (String value : new String[] { "2026-02-30T12:00:00.000Z", "2026-10-01", "2026-10-01T00:00:00.000+08:00", "not-a-date" }) assertThrows(IllegalArgumentException.class, () -> TaskNotificationPolicy.expires(value));
    }
    @Test public void onlyCompletedAndErrorProduceResultNotifications() {
        assertEquals("completed", TaskNotificationPolicy.outcome("completed")); assertEquals("error", TaskNotificationPolicy.outcome("error"));
        for (String status : new String[] { "cancelled", "unknown", "running", "queued", "failed" }) assertThrows(IllegalArgumentException.class, () -> TaskNotificationPolicy.outcome(status));
        assertEquals("chat-agent", TaskNotificationPolicy.source("chat-agent")); assertEquals("agent", TaskNotificationPolicy.source("agent"));
        assertThrows(IllegalArgumentException.class, () -> TaskNotificationPolicy.source("chat"));
    }
    @Test public void rejectsStaleCrossAccountAndCrossServerNavigationScopes() {
        assertTrue(TaskNotificationPolicy.scopeMatches("epoch1", "epoch1", "instance1", "instance1", "user1", "user1"));
        assertFalse(TaskNotificationPolicy.scopeMatches("epoch1", "epoch2", "instance1", "instance1", "user1", "user1"));
        assertFalse(TaskNotificationPolicy.scopeMatches("epoch1", "epoch1", "instance1", "instance2", "user1", "user1"));
        assertFalse(TaskNotificationPolicy.scopeMatches("epoch1", "epoch1", "instance1", "instance1", "user1", "user2"));
        assertFalse(TaskNotificationPolicy.generationMatches(3, 2)); assertTrue(TaskNotificationPolicy.generationMatches(3, 3));
    }
    @Test public void foregroundIsRequiredForGrantButNotTrustedBackgroundRevocation() {
        assertTrue(TaskNotificationPolicy.trustedBridge(true, true, true, true));
        assertFalse(TaskNotificationPolicy.trustedBridge(true, true, false, true));
        assertTrue(TaskNotificationPolicy.trustedBridge(true, true, false, false));
        assertFalse(TaskNotificationPolicy.trustedBridge(false, true, true, false));
        assertFalse(TaskNotificationPolicy.trustedBridge(true, false, true, false));
    }
    @Test public void boundsCursorsAndRejectsOutOfOrderMissingOrUnannouncedHistory() {
        TaskNotificationPolicy.feedRange(10, 12, 15, 0, false); TaskNotificationPolicy.eventSequence(10, 12, 12); TaskNotificationPolicy.feedEnd(12, 12);
        TaskNotificationPolicy.feedRange(10, 30, 30, 20, true);
        assertThrows(IllegalArgumentException.class, () -> TaskNotificationPolicy.feedRange(10, 30, 30, 20, false));
        assertThrows(IllegalArgumentException.class, () -> TaskNotificationPolicy.feedRange(40, 40, 30, 20, false));
        assertThrows(IllegalArgumentException.class, () -> TaskNotificationPolicy.eventSequence(12, 12, 13));
        assertThrows(IllegalArgumentException.class, () -> TaskNotificationPolicy.eventSequence(12, 14, 13));
        assertThrows(IllegalArgumentException.class, () -> TaskNotificationPolicy.feedEnd(12, 20));
        assertThrows(IllegalArgumentException.class, () -> TaskNotificationPolicy.cursor(TaskNotificationPolicy.MAX_CURSOR + 1));
    }
    @Test public void parsesCapacitorJsonIntegerLongAndExactDoubleCursors() {
        assertEquals(0L, TaskNotificationPolicy.parseCursor(Integer.valueOf(0)));
        assertEquals(12L, TaskNotificationPolicy.parseCursor(Integer.valueOf(12)));
        assertEquals(2147483648L, TaskNotificationPolicy.parseCursor(Long.valueOf(2147483648L)));
        assertEquals(TaskNotificationPolicy.MAX_CURSOR, TaskNotificationPolicy.parseCursor(Long.valueOf(TaskNotificationPolicy.MAX_CURSOR)));
        assertEquals(0L, TaskNotificationPolicy.parseCursor(Double.valueOf(0.0)));
        assertEquals(12L, TaskNotificationPolicy.parseCursor(Double.valueOf(12.0)));
        assertEquals(TaskNotificationPolicy.MAX_CURSOR, TaskNotificationPolicy.parseCursor(Double.valueOf(TaskNotificationPolicy.MAX_CURSOR)));
    }
    @Test public void rejectsNonNumericFractionalNonFiniteAndUnsafeCursors() {
        for (Object value : new Object[] { null, "0", "12", Boolean.TRUE, Double.valueOf(0.5), Double.valueOf(-0.5), Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY,
            Integer.valueOf(-1), Long.valueOf(-1), Long.valueOf(TaskNotificationPolicy.MAX_CURSOR + 1), Double.valueOf(TaskNotificationPolicy.MAX_CURSOR + 1), Long.MAX_VALUE }) {
            assertThrows(String.valueOf(value), IllegalArgumentException.class, () -> TaskNotificationPolicy.parseCursor(value));
        }
    }
    @Test public void stableTagsAreIsolatedAcrossUsersAndInstances() {
        assertEquals(TaskNotificationPolicy.tag("server1", "user1", "event1"), TaskNotificationPolicy.tag("server1", "user1", "event1"));
        assertNotEquals(TaskNotificationPolicy.tag("server1", "user1", "event1"), TaskNotificationPolicy.tag("server1", "user2", "event1"));
        assertNotEquals(TaskNotificationPolicy.tag("server1", "user1", "event1"), TaskNotificationPolicy.tag("server2", "user1", "event1"));
    }
}
