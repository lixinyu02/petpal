package com.petpal.app;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/** Android-free validation for credentials, ordered feeds and internal navigation. */
public final class TaskNotificationPolicy {
    public static final long MAX_CURSOR = 9007199254740991L;
    public static final int MAX_RESPONSE_BYTES = 256 * 1024;
    private TaskNotificationPolicy() { }
    public static String id(String value) {
        if (value == null || !value.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,127}")) throw new IllegalArgumentException("任务通知标识无效。");
        return value;
    }
    public static String deviceId(String value) {
        if (value == null || !value.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")) throw new IllegalArgumentException("通知设备标识无效。");
        return value;
    }
    public static String token(String value) {
        if (value == null || !value.matches("[A-Za-z0-9_-]{40,128}")) throw new IllegalArgumentException("通知凭据无效。");
        return value;
    }
    public static String baseUrl(String value) {
        try {
            if (value == null || value.length() > 2048 || value.matches(".*[\\x00-\\x20\\x7f\\\\].*")) throw new Exception();
            URI uri = new URI(value);
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null || uri.getPort() == 0 || uri.getPort() < -1 || uri.getPort() > 65535) throw new Exception();
            String path = uri.getRawPath();
            if (path != null && !path.isEmpty() && !path.matches("(?:/[A-Za-z0-9_-]+)*/?")) throw new Exception();
            return value.replaceAll("/+$", "");
        } catch (Exception failure) { throw new IllegalArgumentException("后台任务提醒只支持无凭据的可信 HTTPS 服务地址。"); }
    }
    public static long cursor(long value) {
        if (value < 0 || value > MAX_CURSOR) throw new IllegalArgumentException("通知游标无效。");
        return value;
    }
    public static long parseCursor(Object value) {
        if (value instanceof Integer || value instanceof Long) return cursor(((Number) value).longValue());
        if (value instanceof Double) {
            double number = ((Double) value).doubleValue();
            if (!Double.isNaN(number) && !Double.isInfinite(number) && number >= 0 && number <= MAX_CURSOR && number == Math.rint(number)) return cursor((long) number);
        }
        throw new IllegalArgumentException("通知游标无效。");
    }
    public static long expires(String value) {
        try {
            if (value == null || !value.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z")) throw new Exception();
            SimpleDateFormat parser = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
            parser.setLenient(false); parser.setTimeZone(TimeZone.getTimeZone("UTC"));
            Date result = parser.parse(value); if (result == null) throw new Exception(); return result.getTime();
        } catch (Exception failure) { throw new IllegalArgumentException("通知凭据到期时间无效。"); }
    }
    public static String source(String value) {
        if (!"agent".equals(value) && !"chat-agent".equals(value)) throw new IllegalArgumentException("通知任务来源无效。");
        return value;
    }
    public static String outcome(String value) {
        if (!"completed".equals(value) && !"error".equals(value)) throw new IllegalArgumentException("通知任务状态无效。");
        return value;
    }
    public static boolean scopeMatches(String epoch, String expectedEpoch, String instance, String expectedInstance, String user, String expectedUser) {
        return epoch != null && epoch.equals(expectedEpoch) && instance != null && instance.equals(expectedInstance) && user != null && user.equals(expectedUser);
    }
    public static void feedRange(long after, long next, long high, long minimum, boolean reset) {
        cursor(after); cursor(next); cursor(high); cursor(minimum);
        if (minimum > high || next > high || !reset && (after < minimum || after > high || next < after) || reset && next != high) throw new IllegalArgumentException("通知序列不一致。");
    }
    public static void eventSequence(long previous, long sequence, long next) {
        cursor(previous); cursor(next); cursor(sequence); if (sequence <= previous || sequence > next) throw new IllegalArgumentException("通知事件顺序无效。");
    }
    public static void feedEnd(long last, long next) { if (last != next) throw new IllegalArgumentException("通知批次游标无效。"); }
    public static boolean trustedBridge(boolean modernMainFrameBridge, boolean trustedLocalPage, boolean foreground, boolean requireForeground) {
        return modernMainFrameBridge && trustedLocalPage && (!requireForeground || foreground);
    }
    public static boolean generationMatches(long current, long captured) { return current == captured; }
    public static String tag(String instance, String user, String event) {
        id(instance); id(user); id(event);
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest((instance + "\n" + user).getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder("petpal-agent-"); for (byte value : bytes) out.append(String.format(Locale.ROOT, "%02x", value & 255));
            return out + "-" + event;
        } catch (Exception failure) { throw new IllegalStateException("无法创建通知标识。"); }
    }
}
