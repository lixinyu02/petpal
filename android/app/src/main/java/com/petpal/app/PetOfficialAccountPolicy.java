package com.petpal.app;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;

/** Android-free checks for the native official-account trust boundary. */
public final class PetOfficialAccountPolicy {
    private PetOfficialAccountPolicy() { }
    public static String text(String value, int limit, boolean spaces) {
        if (value == null || value.isEmpty() || value.length() > limit) throw new IllegalArgumentException("官方账号参数无效。");
        for (int i = 0; i < value.length(); i++) if (value.charAt(i) < (spaces ? 32 : 33) || value.charAt(i) == 127) throw new IllegalArgumentException("官方账号参数无效。");
        return value;
    }
    public static String id(String value) { return text(value, 160, false); }
    public static String uuid(String value) {
        if (value == null || !value.matches("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")) throw new IllegalArgumentException("官方账号标识无效。");
        return value;
    }
    public static URI backend(String value) {
        try {
            text(value, 2048, false); URI uri = new URI(value);
            boolean local = "http".equals(uri.getScheme()) && ("127.0.0.1".equals(uri.getHost()) || "localhost".equals(uri.getHost()) || "[::1]".equals(uri.getHost()));
            if ((!"https".equals(uri.getScheme()) && !local) || uri.getHost() == null || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null || uri.getPort() == 0 || uri.getPort() > 65535 || !(uri.getRawPath().isEmpty() || "/".equals(uri.getRawPath())) || value.indexOf('\\') >= 0) throw new IllegalArgumentException();
            String scheme = uri.getScheme().toLowerCase(java.util.Locale.ROOT), host = uri.getHost().toLowerCase(java.util.Locale.ROOT); int port = uri.getPort();
            if ("https".equals(scheme) && port == 443 || "http".equals(scheme) && port == 80) port = -1;
            return new URI(scheme, null, host, port, "", null, null);
        } catch (Exception failure) { throw new IllegalArgumentException("官方账号需要安全的小伴 HTTPS 服务地址。"); }
    }
    public static Map<String, String> callback(String target, String expectedState) {
        try {
            if (target == null || target.length() > 16384 || !target.startsWith("/auth/callback?")) throw new IllegalArgumentException();
            URI uri = new URI(target); if (uri.isAbsolute() || uri.getRawAuthority() != null || uri.getRawFragment() != null || !"/auth/callback".equals(uri.getRawPath())) throw new IllegalArgumentException();
            Map<String, String> parameters = new HashMap<>();
            for (String part : uri.getRawQuery().split("&", -1)) {
                String[] pair = part.split("=", 2); String name = URLDecoder.decode(pair[0], "UTF-8"), value = pair.length == 2 ? URLDecoder.decode(pair[1], "UTF-8") : "";
                if (parameters.put(name, value) != null) throw new IllegalArgumentException();
            }
            if (!equal(parameters.get("state"), expectedState)) throw new IllegalArgumentException();
            return parameters;
        } catch (Exception failure) { throw new IllegalArgumentException("官方登录回调无效，请继续原来的登录。"); }
    }
    public static boolean equal(String first, String second) {
        return first != null && second != null && MessageDigest.isEqual(first.getBytes(StandardCharsets.UTF_8), second.getBytes(StandardCharsets.UTF_8));
    }
    public static int utf8Boundary(String value, int maximumBytes) {
        int count = 0, end = 0;
        while (end < value.length()) {
            int code = value.codePointAt(end), size = code <= 127 ? 1 : code <= 2047 ? 2 : code <= 65535 ? 3 : 4;
            if (count + size > maximumBytes) break;
            count += size; end += Character.charCount(code);
        }
        return end;
    }
    public static long count(Object raw) {
        if (!(raw instanceof Number)) return 0;
        double value = ((Number) raw).doubleValue();
        return finite(value) && value >= 0 && value <= 9007199254740991L && value == Math.floor(value) ? (long) value : 0;
    }
    public static boolean finite(double value) { return !Double.isNaN(value) && !Double.isInfinite(value); }
    public static long add(long left, long right) { return Math.min(9007199254740991L, left + right); }
}
