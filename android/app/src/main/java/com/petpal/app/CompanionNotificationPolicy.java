package com.petpal.app;

/** Independent companion feed; never broadens the v1 Agent event schema. */
public final class CompanionNotificationPolicy {
    public static final int MAX_EVENTS = 20, MAX_TITLE = 80, MAX_BODY = 240;
    public static final long MAX_TTL_MS = 24 * 60 * 60 * 1000L, FUTURE_SKEW_MS = 5 * 60 * 1000L;
    private CompanionNotificationPolicy() { }
    public static String title(String value) { return text(value, MAX_TITLE, false, false); }
    public static String body(String value) { return text(value, MAX_BODY, true, true); }
    private static String text(String value, int limit, boolean multiline, boolean empty) {
        if (value == null || value.length() > limit || !empty && value.trim().isEmpty()) throw new IllegalArgumentException("每日问候通知文字无效。");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if ((c < 32 || c == 127) && !(multiline && c == '\n')) throw new IllegalArgumentException("每日问候通知文字无效。");
        }
        return value;
    }
    public static boolean eligible(String createdAt, String validUntil, long now) {
        long created = TaskNotificationPolicy.expires(createdAt), until = TaskNotificationPolicy.expires(validUntil);
        if (until <= created || until - created > MAX_TTL_MS || created > now + FUTURE_SKEW_MS) throw new IllegalArgumentException("每日问候通知有效期无效。");
        return until > now;
    }
    public static String tag(String instance, String user, String event) {
        return TaskNotificationPolicy.tag(instance, user, event).replaceFirst("^petpal-agent-", "petpal-companion-");
    }
}
