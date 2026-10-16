package com.petpal.app;

import java.net.URI;

/** Navigation only. OAuth credentials are never accepted by this route. */
final class OfficialReturnPolicy {
    private OfficialReturnPolicy() { }
    static String ticket(String value) {
        if (value == null || !value.matches("[A-Za-z0-9_-]{43}")) throw new IllegalArgumentException("授权返程已失效。");
        return value;
    }
    static String uri(String value) { return "petpal://official-account/return?ticket=" + ticket(value); }
    static String parse(String value) {
        try {
            if (value == null || value.length() > 256) throw new IllegalArgumentException();
            URI uri = new URI(value);
            if (!"petpal".equals(uri.getScheme()) || !"official-account".equals(uri.getRawAuthority()) || !"/return".equals(uri.getRawPath()) || uri.getRawFragment() != null) throw new IllegalArgumentException();
            String query = uri.getRawQuery();
            if (query == null || !query.startsWith("ticket=")) throw new IllegalArgumentException();
            return ticket(query.substring(7));
        } catch (Exception error) { throw new IllegalArgumentException("授权返程已失效。"); }
    }
    static String intent(String value) { return "intent://official-account/return?ticket=" + ticket(value) + "#Intent;scheme=petpal;package=com.petpal.app;end"; }
    static boolean live(long now, long expiresAt) { return now >= 0 && now < expiresAt; }
    static String csp(String nonce) {
        ticket(nonce);
        return "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'nonce-" + nonce + "'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
    }
    static String html(String value, String nonce) {
        ticket(nonce); String intent = intent(value), uri = uri(value);
        return "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"referrer\" content=\"no-referrer\"><title>返回小伴</title>"
            + "<style nonce=\"" + nonce + "\">body{margin:0;background:#fafbf8;color:#244b3c;font:16px system-ui,sans-serif;display:grid;min-height:100dvh;place-items:center}main{max-width:28rem;padding:32px;text-align:center}h1{font-size:24px}p{line-height:1.8;color:#626d65}a{display:block;margin:24px auto 0;padding:14px 24px;background:#285e4b;color:white;border-radius:14px;text-decoration:none;font-weight:600}.alternate{background:transparent;color:#285e4b;font-size:14px}small{display:block;color:#626d65;line-height:1.7}</style></head>"
            + "<body><main><h1>已收到授权结果</h1><p>小伴正在验证官方账号。请返回应用查看连接结果。</p><a id=\"return\" href=\"" + intent + "\">返回小伴</a><a class=\"alternate\" href=\"" + uri + "\">其他浏览器返回</a><small>没有自动打开时，请点击上方按钮。<br>是否连接成功，以小伴中的账号状态为准。</small></main>"
            + "<script nonce=\"" + nonce + "\">try{window.location.replace('" + intent + "')}catch(e){}</script></body></html>";
    }
}
