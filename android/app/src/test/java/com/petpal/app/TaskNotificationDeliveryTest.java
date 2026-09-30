package com.petpal.app;

import java.util.HashMap;
import java.util.Map;
import org.junit.Test;
import static org.junit.Assert.*;

public class TaskNotificationDeliveryTest {
    @Test public void postFailureLeavesCursorAndPreparedRouteRecoverable() throws Exception {
        long[] cursor = { 0 }; boolean[] prepared = { false }; int[] attempts = { 0 };
        assertThrows(Exception.class, () -> TaskNotificationDelivery.deliver(cursor[0], 7, () -> prepared[0] = true,
            () -> { ++attempts[0]; throw new Exception("notification permission changed"); }, () -> cursor[0] = 7));
        assertTrue(prepared[0]); assertEquals(0L, cursor[0]);
        TaskNotificationDelivery.deliver(cursor[0], 7, () -> prepared[0] = true, () -> ++attempts[0], () -> cursor[0] = 7);
        assertEquals(2, attempts[0]); assertEquals(7L, cursor[0]);
    }
    @Test public void crashAfterPrepareDoesNotTreatRouteAsAlreadyDisplayed() throws Exception {
        long[] cursor = { 0 }; boolean[] prepared = { true }; int[] shown = { 0 };
        // Recreated process sees the prepared persisted route, but no committed cursor.
        TaskNotificationDelivery.deliver(cursor[0], 8, () -> { assertTrue(prepared[0]); }, () -> ++shown[0], () -> cursor[0] = 8);
        assertEquals(1, shown[0]); assertEquals(8L, cursor[0]);
    }
    @Test public void crashAfterPostReplacesTheSameTagBeforeCommittingCursor() throws Exception {
        long[] cursor = { 0 }; Map<String, String> notifications = new HashMap<>();
        String tag = TaskNotificationPolicy.tag("server", "user", "event");
        assertThrows(Exception.class, () -> TaskNotificationDelivery.deliver(cursor[0], 9, () -> { }, () -> notifications.put(tag, "result"), () -> { throw new Exception("process died before cursor commit"); }));
        assertEquals(0L, cursor[0]); assertEquals(1, notifications.size());
        TaskNotificationDelivery.deliver(cursor[0], 9, () -> { }, () -> notifications.put(tag, "result"), () -> cursor[0] = 9);
        assertEquals(1, notifications.size()); assertEquals(9L, cursor[0]);
    }
    @Test public void committedRedeliveryNeverPreparesPostsOrCommitsAgain() throws Exception {
        assertFalse(TaskNotificationDelivery.deliver(9, 9, () -> fail("prepare"), () -> fail("post"), () -> fail("commit")));
        assertFalse(TaskNotificationDelivery.deliver(9, 8, () -> fail("prepare"), () -> fail("post"), () -> fail("commit")));
    }
}
