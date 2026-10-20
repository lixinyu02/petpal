package com.petpal.app;

/** Only canonical native notification identities may enter the saved-route gate. */
public final class TaskNotificationIntentPolicy {
    public static final String OPEN = "com.petpal.app.OPEN_AGENT_NOTIFICATION";
    private TaskNotificationIntentPolicy() { }
    public static boolean matches(String action, String data, String tag, String epoch) {
        if (!OPEN.equals(action) || tag == null || !tag.matches("petpal-(?:agent|companion)-[a-f0-9]{64}-[A-Za-z0-9][A-Za-z0-9_-]{0,127}")) return false;
        try { TaskNotificationPolicy.deviceId(epoch); }
        catch (IllegalArgumentException invalid) { return false; }
        return ("petpal-internal://notification/" + tag).equals(data);
    }
}
