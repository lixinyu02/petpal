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

    private static URI https(String value, int limit) {
        if (value == null || value.length() > limit || controls(value, true)) throw new IllegalArgumentException("更新地址无效。");
        try {
            URI uri = new URI(value);
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null
                || uri.getPort() != -1 || uri.getRawFragment() != null || value.indexOf('\\') >= 0) throw new IllegalArgumentException();
            return uri;
        } catch (Exception error) { throw new IllegalArgumentException("更新地址必须为受支持的 HTTPS 地址。"); }
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

    public static void metadata(String id, String target, String format, String version, long versionCode, String url, String hash, long bytes, long installedCode) {
        if (id == null || id.isEmpty() || id.length() > 160 || controls(id, false) || !"android".equals(target) || !"apk".equals(format)
            || version == null || !version.matches("(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)")
            || version.length() > 60 || versionCode <= installedCode || versionCode > Integer.MAX_VALUE || bytes < 1 || bytes > MAX_BYTES
            || hash == null || !hash.matches("[0-9a-fA-F]{64}")) throw new IllegalArgumentException("更新版本、大小或校验信息无效；仅可安装更高版本。");
        initialUrl(url);
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
        if (revision == null || !revision.matches("[A-Za-z0-9._:-]{1,160}") || manifestHash == null || !manifestHash.matches("[a-f0-9]{64}")
            || sequence < 1 || sequence > 9007199254740991L || repository == null || repository.length() > 201) throw new IllegalArgumentException("更新清单绑定信息无效，请重新检查更新。");
        String[] path = initialUrl(url).getRawPath().split("/");
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
