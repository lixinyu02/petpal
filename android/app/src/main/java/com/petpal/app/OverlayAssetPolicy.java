package com.petpal.app;

import java.net.URI;

/** Restricts the independent overlay to read-only files shipped in assets/public. */
public final class OverlayAssetPolicy {
    public static final String HOST = "appassets.androidplatform.net";
    public static final String ENTRY_URL = "https://" + HOST + "/assets/public/index.html?overlay=1&avatar=anime";

    private OverlayAssetPolicy() { }

    public static String normalizeCompanionKind(String kind) {
        return "cat".equals(kind) ? "cat" : "anime";
    }

    public static String entryUrl(String kind) {
        return "https://" + HOST + "/assets/public/index.html?overlay=1&avatar=" + normalizeCompanionKind(kind);
    }

    public static boolean canNavigate(String url) {
        return entryUrl("anime").equals(url) || entryUrl("cat").equals(url);
    }

    public static String assetPath(String url, String method) {
        if (url == null || !"GET".equals(method)) return null;
        try {
            URI uri = URI.create(url);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || !HOST.equalsIgnoreCase(uri.getHost())
                || uri.getUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443)) return null;
            return resourcePath(uri.getPath());
        } catch (IllegalArgumentException ignored) { return null; }
    }

    public static String resourcePath(String requestPath) {
        if (requestPath == null || requestPath.length() > 2048 || requestPath.indexOf('\\') >= 0) return null;
        for (int i = 0; i < requestPath.length(); i++) if (requestPath.charAt(i) < 32) return null;
        String path = requestPath.startsWith("/") ? requestPath.substring(1) : requestPath;
        // HTML uses this explicit bootstrap path; Vite's absolute /assets and /pets paths use the root mapping.
        if (path.startsWith("assets/public/")) path = path.substring("assets/public/".length());
        if (path.isEmpty()) path = "index.html";
        for (String part : path.split("/", -1)) {
            if (part.isEmpty() || part.equals(".") || part.equals("..")) return null;
        }
        return "public/" + path;
    }
}
