package com.petpal.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class TaskNotificationIntentPolicyTest {
    private static final String EPOCH = "12345678-1234-4321-8765-123456789abc";
    @Test public void acceptsOnlyCanonicalNativeAgentAndCompanionNotificationUris() {
        for (String tag : new String[] {TaskNotificationPolicy.tag("server1", "user1", "event1"), CompanionNotificationPolicy.tag("server1", "user1", "event1")}) {
            assertTrue(TaskNotificationIntentPolicy.matches(TaskNotificationIntentPolicy.OPEN, "petpal-internal://notification/" + tag, tag, EPOCH));
        }
    }
    @Test public void externalOauthAndAlteredUriCannotBypassTheOfficialIntentSanitizer() {
        String tag = CompanionNotificationPolicy.tag("server1", "user1", "event1"), uri = "petpal-internal://notification/" + tag;
        for (String value : new String[] {null, uri + "?code=private", uri + "#x", uri + "/", "petpal-internal://other/" + tag,
            "petpal-internal://user@notification/" + tag, "https://localhost/" + tag, "petpal://official-account/return?ticket=x", uri.replace("event1", "event2")}) {
            assertFalse(String.valueOf(value), TaskNotificationIntentPolicy.matches(TaskNotificationIntentPolicy.OPEN, value, tag, EPOCH));
        }
        for (String action : new String[] {null, "android.intent.action.VIEW", "android.intent.action.MAIN", "com.petpal.app.OPEN_CHAT"}) assertFalse(TaskNotificationIntentPolicy.matches(action, uri, tag, EPOCH));
    }
    @Test public void missingOrMaliciousTagAndEpochNeverProduceAnInternalRoute() {
        String tag = TaskNotificationPolicy.tag("server1", "user1", "event1"), uri = "petpal-internal://notification/" + tag;
        for (String epoch : new String[] {null, "", "old-user", EPOCH + "\n"}) assertFalse(TaskNotificationIntentPolicy.matches(TaskNotificationIntentPolicy.OPEN, uri, tag, epoch));
        for (String bad : new String[] {null, "", "event1", "petpal-agent-" + "a".repeat(64) + "-../other", "petpal-agent-" + "a".repeat(64) + "-event1?x"}) {
            assertFalse(TaskNotificationIntentPolicy.matches(TaskNotificationIntentPolicy.OPEN, "petpal-internal://notification/" + bad, bad, EPOCH));
        }
    }
}
