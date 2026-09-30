package com.petpal.app;

import java.net.URI;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** Android-free policy: metadata is untrusted until the downloaded APK is verified. */
public final class UpdaterPolicy {
    public static final long MAX_BYTES = 2L * 1024 * 1024 * 1024;
    public static final int MAX_REDIRECTS = 3;
    private UpdaterPolicy() { }
    private static boolean controls(String value, boolean space) { for (int i = 0; i < value.length(); i++) if (value.charAt(i) < (space ? 33 : 32) || value.charAt(i) == 127) return true; return false; }

    private static URI https(String value, int limit) { return https(value, limit, false); }
    private static URI https(String value, int limit, boolean allowPort) {
        if (value == null || value.length() > limit || controls(value, true)) throw new IllegalArgumentException("更新地址无效。");
        try {
            URI uri = new URI(value);
            if (!(allowPort ? "https".equalsIgnoreCase(uri.getScheme()) : "https".equals(uri.getScheme())) || uri.getHost() == null || uri.getRawUserInfo() != null
                || (!allowPort && uri.getPort() != -1) || uri.getPort() == 0 || uri.getPort() > 65535
                || uri.getRawFragment() != null || value.indexOf('\\') >= 0) throw new IllegalArgumentException();
            return uri;
        } catch (Exception error) { throw new IllegalArgumentException("更新地址必须为受支持的 HTTPS 地址。"); }
    }

    private static String source(String value) {
        if (value == null || "github".equals(value)) return "github";
        if ("server".equals(value)) return value;
        throw new IllegalArgumentException("更新发布源无效。");
    }

    private static boolean safePath(String path, boolean absolute) {
        if (path == null || path.isEmpty() || (absolute && !path.startsWith("/"))) return false;
        String[] segments = path.split("/", -1);
        for (int i = path.startsWith("/") ? 1 : 0; i < segments.length; i++) {
            if (!segments[i].matches("[A-Za-z0-9][A-Za-z0-9._+-]*")) return false;
        }
        return true;
    }

    private static URI serverManifest(String value) {
        URI uri = https(value, 8192, true);
        if (uri.getRawQuery() != null || !safePath(uri.getRawPath(), true) || !uri.getRawPath().endsWith("/petpal-update.json")) {
            throw new IllegalArgumentException("更新服务器清单地址无效。");
        }
        return uri;
    }

    private static int originPort(URI uri) { return uri.getPort() == -1 ? 443 : uri.getPort(); }
    private static boolean sameOrigin(URI first, URI second) {
        return first.getScheme().equalsIgnoreCase(second.getScheme()) && first.getHost().equalsIgnoreCase(second.getHost()) && originPort(first) == originPort(second);
    }

    public static URI initialUrl(String value, String source, String manifestUrl) {
        if ("github".equals(source(source))) {
            if (manifestUrl != null && !manifestUrl.isEmpty()) throw new IllegalArgumentException("更新发布源与清单不匹配。");
            return initialUrl(value);
        }
        URI manifest = serverManifest(manifestUrl), asset = https(value, 8192, true);
        String directory = manifest.getRawPath().substring(0, manifest.getRawPath().lastIndexOf('/') + 1);
        if (asset.getRawQuery() != null || !sameOrigin(manifest, asset) || !safePath(asset.getRawPath(), true)
            || !asset.getRawPath().startsWith(directory)) {
            throw new IllegalArgumentException("更新 APK 必须位于清单所在的 HTTPS 服务器目录中。");
        }
        return asset;
    }

    public static URI initialUrl(String value) {
        URI uri = https(value, 2048);
        if (!"github.com".equals(uri.getHost()) || uri.getRawQuery() != null) throw new IllegalArgumentException("仅支持 GitHub Releases APK。");
        String[] segments = uri.getRawPath().split("/", -1);
        if (segments.length != 7 || !segments[0].isEmpty() || !segments[1].matches("[A-Za-z0-9][A-Za-z0-9-]{0,38}")
            || !segments[2].matches("[A-Za-z0-9][A-Za-z0-9_.-]{0,99}") || !"releases".equals(segments[3]) || !"download".equals(segments[4])
            || !segments[5].matches("[A-Za-z0-9][A-Za-z0-9._~@+-]{0,199}") || !segments[6].matches("[A-Za-z0-9][A-Za-z0-9._+-]{0,179}\\.apk")) {
            throw new IllegalArgumentException("更新地址不是有效的 GitHub Releases APK 资产。");
        }
        return uri;
    }

    public static URI redirect(URI initial, URI previous, String location, int count) {
        if (count > MAX_REDIRECTS || location == null || location.length() > 8192) throw new IllegalArgumentException("更新下载重定向次数或地址无效。");
        URI next;
        try { next = https(previous.resolve(location).toString(), 8192); }
        catch (Exception error) { throw new IllegalArgumentException("更新下载重定向地址无效。"); }
        if ("release-assets.githubusercontent.com".equals(next.getHost()) && next.getRawPath().startsWith("/") && next.getRawPath().length() > 1) return next;
        // The original GitHub asset may normalize its tag, but cannot change repository.
        URI github = initialUrl(next.toString());
        String[] before = initial.getRawPath().split("/"), after = github.getRawPath().split("/");
        if (!before[1].equals(after[1]) || !before[2].equals(after[2])) throw new IllegalArgumentException("更新下载不能跳转到其他仓库。");
        return github;
    }

    public static URI redirect(URI initial, URI previous, String location, int count, String source, String manifestUrl) {
        if ("github".equals(source(source))) {
            initialUrl(initial.toString(), source, manifestUrl);
            return redirect(initial, previous, location, count);
        }
        if (count < 1 || count > MAX_REDIRECTS || location == null || location.isEmpty() || location.length() > 8192
            || controls(location, true) || location.indexOf('\\') >= 0) throw new IllegalArgumentException("更新下载重定向次数或地址无效。");
        initialUrl(initial.toString(), source, manifestUrl);
        initialUrl(previous.toString(), source, manifestUrl);
        try {
            // Inspect before resolve: URI.resolve would erase ../ segments and hide an unsafe redirect.
            URI relative = new URI(location);
            if (relative.getRawQuery() != null || relative.getRawFragment() != null || relative.getRawUserInfo() != null
                || (!relative.isAbsolute() && relative.getRawAuthority() != null)
                || !safePath(relative.getRawPath(), relative.isAbsolute())) throw new IllegalArgumentException();
            return initialUrl(previous.resolve(relative).toString(), source, manifestUrl);
        } catch (Exception error) { throw new IllegalArgumentException("更新下载重定向地址无效。"); }
    }

    public static void metadata(String id, String target, String format, String version, long versionCode, String url, String hash, long bytes, long installedCode) {
        metadata(id, target, format, version, versionCode, url, hash, bytes, installedCode, "github", null);
    }

    public static void metadata(String id, String target, String format, String version, long versionCode, String url, String hash, long bytes, long installedCode, String source, String manifestUrl) {
        if (id == null || id.isEmpty() || id.length() > 160 || controls(id, false) || !"android".equals(target) || !"apk".equals(format)
            || version == null || !version.matches("(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)")
            || version.length() > 60 || versionCode <= installedCode || versionCode > Integer.MAX_VALUE || bytes < 1 || bytes > MAX_BYTES
            || hash == null || !hash.matches("[0-9a-fA-F]{64}")) throw new IllegalArgumentException("更新版本、大小或校验信息无效；仅可安装更高版本。");
        initialUrl(url, source, manifestUrl);
    }

    public static void apkIdentity(String applicationId, long code, String version, String[] installedSigners, String[] candidateSigners, long installedCode, long expectedCode, String expectedVersion) {
        if (!"com.petpal.app".equals(applicationId)) throw new IllegalArgumentException("下载文件的应用包名不匹配。");
        if (code <= installedCode || code != expectedCode || !expectedVersion.equals(version)) throw new IllegalArgumentException("下载 APK 的版本不匹配或不是更新版本。");
        if (installedSigners == null || candidateSigners == null || installedSigners.length == 0 || candidateSigners.length == 0) throw new IllegalArgumentException("无法验证 APK 安装签名。");
        Set<String> installed = new HashSet<>(Arrays.asList(installedSigners)), candidate = new HashSet<>(Arrays.asList(candidateSigners));
        if (installed.contains(null) || installed.contains("") || candidate.contains(null) || candidate.contains("")
            || installed.size() != installedSigners.length || candidate.size() != candidateSigners.length || !installed.equals(candidate)) throw new IllegalArgumentException("下载 APK 与当前应用的签名不一致。");
    }

    public static void binding(String revision, String manifestHash, long sequence, String repository, String url) {
        binding(revision, manifestHash, sequence, repository, url, "github", null);
    }

    public static void binding(String revision, String manifestHash, long sequence, String repository, String url, String source, String manifestUrl) {
        if (revision == null || !revision.matches("[A-Za-z0-9._:-]{1,160}") || manifestHash == null || !manifestHash.matches("[a-f0-9]{64}")
            || sequence < 1 || sequence > 9007199254740991L) throw new IllegalArgumentException("更新清单绑定信息无效，请重新检查更新。");
        URI asset = initialUrl(url, source, manifestUrl);
        if ("server".equals(source(source))) return;
        if (repository == null || repository.length() > 201) throw new IllegalArgumentException("更新清单绑定信息无效，请重新检查更新。");
        String[] path = asset.getRawPath().split("/");
        if (!(path[1] + "/" + path[2]).toLowerCase(java.util.Locale.ROOT).equals(repository)) throw new IllegalArgumentException("更新仓库与发布文件不匹配。");
    }

    public static boolean trustedPage(String localUrl, String pageUrl) {
        try {
            URI local = new URI(localUrl), current = new URI(pageUrl);
            if (!"https".equals(local.getScheme()) || !"localhost".equals(local.getHost()) || local.getPort() != -1 || local.getUserInfo() != null
                || !"https".equals(current.getScheme()) || !"localhost".equals(current.getHost()) || current.getPort() != -1 || current.getUserInfo() != null) return false;
            String query = current.getQuery();
            if (query != null) for (String pair : query.split("&")) { String key = pair.split("=", 2)[0]; if ("overlay".equals(key) || "pet".equals(key)) return false; }
            return true;
        } catch (Exception error) { return false; }
    }
}
