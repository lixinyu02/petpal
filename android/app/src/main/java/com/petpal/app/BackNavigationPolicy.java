package com.petpal.app;

import java.net.URI;
import java.util.Objects;

/** Main-frame back handoff only; no JavaScript-callable navigation bridge. */
final class BackNavigationPolicy {
    enum Result { IGNORED, CONSUMED, FALLBACK }

    static final class Request {
        final String pageUrl;
        private Request(String pageUrl) { this.pageUrl = pageUrl; }
    }

    private Request pending;

    static boolean trustedPage(String localUrl, String pageUrl) {
        try {
            URI local = new URI(localUrl), page = new URI(pageUrl);
            if (!localOrigin(local) || !localOrigin(page)) return false;
            String query = page.getQuery();
            if (query != null) for (String pair : query.split("&")) {
                String key = pair.split("=", 2)[0];
                if ("overlay".equals(key) || "pet".equals(key)) return false;
            }
            return true;
        } catch (Exception ignored) { return false; }
    }

    private static boolean localOrigin(URI uri) {
        return "https".equals(uri.getScheme()) && "localhost".equals(uri.getHost())
            && uri.getPort() == -1 && uri.getRawUserInfo() == null;
    }

    boolean isPending() { return pending != null; }

    Request begin(String localUrl, String pageUrl) {
        if (pending != null || !trustedPage(localUrl, pageUrl)) return null;
        pending = new Request(pageUrl);
        return pending;
    }

    Result complete(Request request, String localUrl, String pageUrl, boolean activeMainFrame, String value) {
        if (request == null || request != pending) return Result.IGNORED;
        // Consume identity before any fallback so late or repeated callbacks cannot exit twice.
        pending = null;
        if (!activeMainFrame || !Objects.equals(request.pageUrl, pageUrl) || !trustedPage(localUrl, pageUrl)) return Result.IGNORED;
        if ("true".equals(value)) return Result.CONSUMED;
        return "false".equals(value) ? Result.FALLBACK : Result.IGNORED;
    }

    void cancel() { pending = null; }
}
