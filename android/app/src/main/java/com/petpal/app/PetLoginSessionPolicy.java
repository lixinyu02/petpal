package com.petpal.app;

import java.net.URI;

/** Independent of Android so malformed vault input can be checked on every build. */
final class PetLoginSessionPolicy {
    private static boolean unsafe(String value) { for (int index = 0; index < value.length(); index++) { char character = value.charAt(index); if (character <= 0x20 || character == 0x7f) return true; } return false; }
    static String url(String input) {
        try {
            if (input == null || input.length() > 2048 || unsafe(input) || input.indexOf('\\') >= 0) throw new IllegalArgumentException();
            URI value = new URI(input);
            if (!("https".equalsIgnoreCase(value.getScheme()) || "http".equalsIgnoreCase(value.getScheme())) || value.getHost() == null
                || value.getRawUserInfo() != null || value.getRawQuery() != null || value.getRawFragment() != null
                || value.getPort() == 0 || value.getPort() > 65535) throw new IllegalArgumentException();
            return input.replaceAll("/+$", "");
        } catch (Exception failure) { throw new IllegalArgumentException("保存的服务地址无效，请重新登录。"); }
    }
    static String token(String value) {
        if (value == null || value.isEmpty() || value.length() > 4096 || unsafe(value)) throw new IllegalArgumentException("登录凭据无效。");
        return value;
    }
    static String kind(String value) {
        if (!"session".equals(value) && !"pairing".equals(value)) throw new IllegalArgumentException("登录凭据类型无效。");
        return value;
    }
    static String target(String value) {
        if (!"remote".equals(value)) throw new IllegalArgumentException("安卓只能保存远程服务登录。");
        return value;
    }
}
