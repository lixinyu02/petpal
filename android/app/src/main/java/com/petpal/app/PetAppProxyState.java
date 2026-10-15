package com.petpal.app;

import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.AtomicFile;
import androidx.webkit.ProxyConfig;
import androidx.webkit.ProxyController;
import androidx.webkit.WebViewFeature;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.Proxy;
import java.net.ServerSocket;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/** Serialized by the plugin's IO worker; generation invalidation is immediate. */
final class PetAppProxyState {
    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile long generation;
    private volatile String scope = "";
    private volatile Process process;
    private volatile String state = "stopped", error = "";
    private String owner = "", yaml = "", remote = "", updatedAt = "", secret = "", abi = "";
    private int port, controllerPort;
    private boolean autoStart;
    private File directory;
    private JSONArray groups = new JSONArray();
    private JSONObject manifest;
    PetAppProxyState(Context context) { this.context = context.getApplicationContext(); }
    long generation() { return generation; }
    synchronized void invalidate() {
        generation++; scope = ""; PetNetwork.proxy(0); state = "stopping";
        // Revocation must not wait behind a slow subscription or /auth/me read.
        main.post(() -> { if (WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) ProxyController.getInstance().clearProxyOverride(Runnable::run, () -> { }); });
    }
    private void check(long expected) throws InterruptedException { if (expected != generation || Thread.currentThread().isInterrupted()) throw new InterruptedException(); }
    boolean current(String expected) { return expected != null && !scope.isEmpty() && scope.equals(expected); }
    private void require(String expected) { if (!current(expected)) throw new IllegalStateException("登录已变化，请重新打开应用代理。"); }
    static byte[] read(InputStream stream, int maximum) throws Exception {
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) != -1) { if (output.size() + count > maximum) throw new IllegalArgumentException("代理配置或响应超过大小限制。"); output.write(buffer, 0, count); }
            return output.toByteArray();
        }
    }
    static String utf8(byte[] value) throws CharacterCodingException { return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(value)).toString(); }
    private byte[] boundedRead(InputStream stream, int maximum, long expected, long deadline) throws Exception {
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) != -1) { check(expected); if (System.nanoTime() > deadline) throw new IllegalStateException("代理网络请求超时。"); if (output.size() + count > maximum) throw new IllegalArgumentException("代理响应超过大小限制。"); output.write(buffer, 0, count); }
            return output.toByteArray();
        }
    }
    private static String sha(byte[] bytes) throws Exception { StringBuilder value = new StringBuilder(); for (byte b : MessageDigest.getInstance("SHA-256").digest(bytes)) value.append(String.format(Locale.ROOT, "%02x", b & 255)); return value.toString(); }
    private void metadata() throws Exception {
        if (manifest != null) return;
        manifest = new JSONObject(utf8(read(context.getAssets().open("mihomo/manifest.json"), 65536)));
        JSONObject targets = manifest.getJSONObject("targets");
        for (String candidate : Build.SUPPORTED_ABIS) if (targets.has(candidate)) { abi = candidate; break; }
    }
    private String unavailable() {
        try { metadata(); } catch (Exception missing) { return "此安装包未包含已校验的 Android 代理内核，请安装完整新版客户端。"; }
        if (Build.VERSION.SDK_INT < manifest.optInt("minimumApi", 34)) return "内置代理暂支持 Android 14 及以上；其他功能可继续使用。";
        if (abi.isEmpty()) return "此设备架构暂未提供内置代理内核。";
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) return "请更新 Android System WebView 后再启用应用代理。";
        return "";
    }
    synchronized JSONObject status() throws Exception {
        String reason = unavailable();
        return new JSONObject().put("supported", reason.isEmpty()).put("unavailableReason", reason).put("scope", scope)
            .put("platform", "android").put("abi", abi).put("version", manifest == null ? "1.19.32" : manifest.optString("version", "1.19.32"))
            .put("state", state).put("running", "running".equals(state)).put("configured", !yaml.isEmpty()).put("autoStart", autoStart)
            .put("remoteConfigured", !remote.isEmpty()).put("remoteUpdatedAt", updatedAt).put("groups", groups).put("error", error);
    }
    /** No account token is persisted. A new binding always stops the previous core. */
    JSONObject bind(JSONObject input, long expected) throws Exception {
        stop(); check(expected);
        String url = input.getString("url"), token = input.getString("token"), instance = input.getString("instanceId"), user = input.getString("userId");
        // This policy is shared with the existing HTTPS Android task listener.
        url = TaskNotificationPolicy.baseUrl(url); TaskNotificationPolicy.id(instance); TaskNotificationPolicy.id(user);
        if (token.length() < 16 || token.length() > 4096 || token.matches(".*[\\x00-\\x20\\x7f].*")) throw new IllegalArgumentException("登录凭据无效。");
        HttpURLConnection connection = PetNetwork.open(new URL(url + "/api/auth/me"));
        try {
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(10000); connection.setReadTimeout(10000); connection.setRequestProperty("Authorization", "Bearer " + token);
            if (connection.getResponseCode() != 200) throw new IllegalArgumentException("请先登录小伴，再设置应用代理。");
            JSONObject identity = new JSONObject(utf8(boundedRead(connection.getInputStream(), 256 * 1024, expected, System.nanoTime() + TimeUnit.SECONDS.toNanos(20))));
            if (!instance.equals(identity.optString("instanceId")) || !user.equals(identity.optJSONObject("user") == null ? "" : identity.getJSONObject("user").optString("id"))) throw new IllegalArgumentException("登录账号已变化，请重新设置应用代理。");
        } finally { connection.disconnect(); }
        check(expected);
        owner = sha((url + "\n" + instance + "\n" + user).getBytes(StandardCharsets.UTF_8));
        directory = new File(context.getFilesDir(), "app-proxy/" + owner); if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("代理私有目录不可用。");
        if (!directory.getCanonicalPath().equals(new File(context.getFilesDir(), "app-proxy/" + owner).getAbsolutePath())) throw new IllegalStateException("代理目录无效。");
        yaml = ""; remote = ""; updatedAt = ""; autoStart = false; groups = new JSONArray(); error = "";
        AtomicFile saved = new AtomicFile(new File(directory, "settings.json"));
        if (saved.getBaseFile().isFile()) {
            try {
                JSONObject settings = new JSONObject(utf8(read(saved.openRead(), PetAppProxyPolicy.MAX_BYTES + 65536)));
                String value = settings.optString("yaml"); yaml = value.isEmpty() ? "" : PetAppProxyPolicy.normalize(value);
                remote = settings.optString("remote"); if (!remote.isEmpty()) remote = PetAppProxyPolicy.remoteUrl(remote);
                updatedAt = settings.optString("updatedAt"); autoStart = settings.optBoolean("autoStart", false);
            } catch (Exception failure) { state = "error"; error = "已保存的代理配置需要检查，原文件已保留。"; scope = UUID.randomUUID().toString(); return status(); }
        }
        check(expected); scope = UUID.randomUUID().toString(); state = "stopped";
        if (autoStart && !yaml.isEmpty() && unavailable().isEmpty()) start(scope, expected);
        return status();
    }
    private void save(String nextYaml, String nextRemote, String nextUpdated, boolean nextAuto, long expected) throws Exception {
        check(expected); if (directory == null || scope.isEmpty()) throw new IllegalStateException("请先登录小伴。");
        JSONObject value = new JSONObject().put("version", 1).put("yaml", nextYaml).put("remote", nextRemote).put("updatedAt", nextUpdated).put("autoStart", nextAuto);
        AtomicFile saved = new AtomicFile(new File(directory, "settings.json")); FileOutputStream output = null;
        try { output = saved.startWrite(); output.write(value.toString().getBytes(StandardCharsets.UTF_8)); output.flush(); check(expected); saved.finishWrite(output); }
        catch (Exception failure) { if (output != null) saved.failWrite(output); throw failure; }
        yaml = nextYaml; remote = nextRemote; updatedAt = nextUpdated; autoStart = nextAuto;
    }
    private File executable() throws Exception {
        metadata(); JSONObject expected = manifest.getJSONObject("targets").getJSONObject(abi).getJSONObject("executable");
        File file = new File(context.getApplicationInfo().nativeLibraryDir, "libpetpal_mihomo.so");
        if (!file.isFile() || file.length() != expected.getLong("bytes") || !file.canExecute() || !file.getCanonicalPath().equals(file.getAbsolutePath())) throw new IllegalStateException("安装包内的代理内核不完整，请重新安装。");
        MessageDigest hash = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) { byte[] buffer = new byte[65536]; int count; while ((count = input.read(buffer)) != -1) hash.update(buffer, 0, count); }
        StringBuilder actual = new StringBuilder(); for (byte value : hash.digest()) actual.append(String.format(Locale.ROOT, "%02x", value & 255));
        if (!actual.toString().equals(expected.getString("sha256"))) throw new IllegalStateException("代理内核校验失败，请重新安装完整客户端。");
        return file;
    }
    private static int freePort() throws Exception { try (ServerSocket socket = new ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))) { return socket.getLocalPort(); } }
    private ProcessBuilder coreProcess(String... command) {
        ProcessBuilder builder = new ProcessBuilder(command); builder.directory(directory);
        // Preserve Android's runtime environment, but never inherit a host
        // proxy or an opt-out from Mihomo's application-private file boundary.
        for (String name : Arrays.asList("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy", "SKIP_SAFE_PATH_CHECK", "SAFE_PATHS", "CLASH_HOME", "CLASH_CONFIG_PATH", "LD_PRELOAD")) builder.environment().remove(name);
        builder.environment().put("HOME", directory.getAbsolutePath());
        builder.environment().put("XDG_CONFIG_HOME", new File(directory, "xdg").getAbsolutePath());
        builder.environment().put("SKIP_SAFE_PATH_CHECK", "false");
        builder.redirectError(new File("/dev/null")); builder.redirectOutput(new File("/dev/null")); return builder;
    }
    private JSONObject controller(String route, String method, JSONObject body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL("http://127.0.0.1:" + controllerPort + route).openConnection(Proxy.NO_PROXY);
        try {
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(1000); connection.setReadTimeout(2000); connection.setRequestMethod(method); connection.setRequestProperty("Authorization", "Bearer " + secret);
            if (body != null) { connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json"); byte[] data = body.toString().getBytes(StandardCharsets.UTF_8); connection.setFixedLengthStreamingMode(data.length); try (java.io.OutputStream output = connection.getOutputStream()) { output.write(data); } }
            int code = connection.getResponseCode(); if (code < 200 || code >= 300) throw new java.io.IOException();
            if (code == 204) return new JSONObject();
            return new JSONObject(utf8(read(connection.getInputStream(), 1024 * 1024)));
        } finally { connection.disconnect(); }
    }
    private void webProxy(boolean enable, long expected) throws Exception {
        CountDownLatch done = new CountDownLatch(1); final Exception[] failure = new Exception[1];
        main.post(() -> {
            try {
                if (enable && generation != expected) { failure[0] = new InterruptedException(); done.countDown(); return; }
                if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) { if (enable) throw new IllegalStateException("Android System WebView 不支持应用代理。"); done.countDown(); return; }
                if (!enable) ProxyController.getInstance().clearProxyOverride(Runnable::run, done::countDown);
                else {
                    ProxyConfig.Builder config = new ProxyConfig.Builder().addProxyRule("http://127.0.0.1:" + port);
                    for (String rule : Arrays.asList("localhost", "*.localhost", "*.local", "127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "[::1]", "fc00::/7", "fe80::/10")) config.addBypassRule(rule);
                    ProxyController.getInstance().setProxyOverride(config.build(), Runnable::run, done::countDown);
                }
            } catch (Exception problem) { failure[0] = problem; done.countDown(); }
        });
        if (!done.await(8, TimeUnit.SECONDS)) throw new IllegalStateException("应用代理设置未及时生效，请关闭后重试。");
        if (failure[0] != null) throw failure[0];
    }
    private void refreshGroups() throws Exception {
        JSONObject all = controller("/proxies", "GET", null).optJSONObject("proxies"); JSONArray next = new JSONArray();
        if (all != null) for (java.util.Iterator<String> names = all.keys(); names.hasNext() && next.length() < 128;) {
            String name = names.next(); JSONObject item = all.optJSONObject(name); if (name.length() > 256 || item == null || !"Selector".equals(item.optString("type"))) continue;
            JSONArray choices = item.optJSONArray("all"); if (choices == null || choices.length() > 2048) continue;
            JSONArray safe = new JSONArray(); for (int i = 0; i < choices.length(); i++) { String choice = choices.optString(i, ""); if (!choice.isEmpty() && choice.length() <= 256 && !choice.matches(".*[\\x00-\\x1f\\x7f].*")) safe.put(choice); }
            next.put(new JSONObject().put("name", name).put("selected", item.optString("now", "")).put("choices", safe));
        }
        groups = next;
    }
    JSONObject start(String expectedScope, long expected) throws Exception {
        require(expectedScope); check(expected); String reason = unavailable(); if (!reason.isEmpty()) throw new IllegalStateException(reason);
        if ("running".equals(state)) return status(); if (process != null) throw new IllegalStateException("请先关闭上一次代理。");
        if (yaml.isEmpty()) throw new IllegalStateException("请先导入 Clash YAML 配置。");
        state = "starting"; error = "";
        try {
            File executable = executable(); check(expected); port = freePort(); do { controllerPort = freePort(); } while (controllerPort == port);
            secret = UUID.randomUUID().toString() + UUID.randomUUID();
            File runtime = new File(directory, "runtime.yaml");
            try (FileOutputStream output = new FileOutputStream(runtime, false)) { output.write(PetAppProxyPolicy.runtime(yaml, port, controllerPort, secret).getBytes(StandardCharsets.UTF_8)); }
            process = coreProcess(executable.getAbsolutePath(), "-d", directory.getAbsolutePath(), "-f", runtime.getAbsolutePath()).start();
            boolean ready = false; long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
            while (System.nanoTime() < deadline) { check(expected); if (!process.isAlive()) break; try { controller("/version", "GET", null); ready = true; break; } catch (Exception waiting) { Thread.sleep(160); } }
            if (!ready) throw new IllegalStateException("代理启动失败，请检查配置和节点资源。");
            check(expected); refreshGroups(); webProxy(true, expected); check(expected); PetNetwork.proxy(port); state = "running";
            Process running = process; Thread watcher = new Thread(() -> {
                try { running.waitFor(); } catch (InterruptedException interrupted) { return; }
                synchronized (PetAppProxyState.this) {
                    if (process != running || !"running".equals(state)) return;
                    PetNetwork.proxy(0); state = "error"; error = "代理内核已退出，请关闭后重新启用；任务不会自动重发。";
                }
                main.post(() -> { if (WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) ProxyController.getInstance().clearProxyOverride(Runnable::run, () -> { }); });
            }, "PetPal-proxy-exit"); watcher.setDaemon(true); watcher.start();
            return status();
        } catch (Exception failure) {
            try { stop(); } catch (Exception cleanup) { }
            if (generation == expected) { state = "error"; error = "代理未能启用，请检查配置、系统版本和 WebView。"; }
            throw failure;
        }
    }
    JSONObject stop() throws Exception {
        PetNetwork.proxy(0); state = "stopping"; Exception failure = null;
        try { webProxy(false, generation); } catch (Exception problem) { failure = problem; }
        Process previous = process;
        if (previous != null) { previous.destroy(); if (!previous.waitFor(3, TimeUnit.SECONDS)) { previous.destroyForcibly(); if (!previous.waitFor(3, TimeUnit.SECONDS)) throw new IllegalStateException("代理内核退出尚未确认，请退出小伴后重试。"); } process = null; }
        if (directory != null) { File runtime = new File(directory, "runtime.yaml"); if (runtime.exists() && !runtime.delete()) failure = new IllegalStateException("临时代理配置清理失败，请退出小伴后检查。"); }
        secret = ""; port = 0; controllerPort = 0; groups = new JSONArray(); state = failure == null ? "stopped" : "error"; error = failure == null ? "" : "代理关闭未完成，请退出小伴后重试。";
        if (failure != null) throw failure; return status();
    }
    JSONObject clear() throws Exception { stop(); yaml = ""; remote = ""; updatedAt = ""; owner = ""; directory = null; autoStart = false; return status(); }
    JSONObject importText(String expectedScope, String source, String remoteUrl, long expected) throws Exception {
        require(expectedScope); check(expected); if (process != null) throw new IllegalStateException("请先关闭代理，再更换配置。");
        String normalized = PetAppProxyPolicy.normalize(source); String date = "";
        if (!remoteUrl.isEmpty()) { SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT); format.setTimeZone(TimeZone.getTimeZone("UTC")); date = format.format(new Date()); }
        // Ask the exact bundled core to validate before replacing saved config.
        String reason = unavailable(); if (!reason.isEmpty()) throw new IllegalStateException(reason);
        File candidate = new File(directory, "validate-" + UUID.randomUUID() + ".yaml");
        try {
            try (FileOutputStream output = new FileOutputStream(candidate)) { output.write(PetAppProxyPolicy.runtime(normalized, freePort(), freePort(), "validation-only").getBytes(StandardCharsets.UTF_8)); }
            Process test = coreProcess(executable().getAbsolutePath(), "-t", "-d", directory.getAbsolutePath(), "-f", candidate.getAbsolutePath()).start(); boolean finished = false;
            try { long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(25); while (System.nanoTime() < deadline) { check(expected); if (test.waitFor(150, TimeUnit.MILLISECONDS)) { finished = true; break; } } if (!finished || test.exitValue() != 0) throw new IllegalArgumentException("代理配置校验未通过，原配置已保留。"); }
            finally { if (!finished) { test.destroyForcibly(); test.waitFor(3, TimeUnit.SECONDS); } }
            save(normalized, remoteUrl, date, autoStart, expected); state = "stopped"; error = ""; return status();
        } finally { if (candidate.exists()) candidate.delete(); }
    }
    JSONObject importUrl(String expectedScope, String requested, boolean refresh, long expected) throws Exception {
        require(expectedScope); if (process != null) throw new IllegalStateException("请先关闭代理，再更新配置。");
        String source = refresh ? remote : requested; if (source.isEmpty()) throw new IllegalStateException("尚未保存远程配置来源。");
        source = PetAppProxyPolicy.remoteUrl(source); URL next = new URL(source); long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
        for (int redirect = 0; redirect <= 3; redirect++) {
            check(expected); if (System.nanoTime() > deadline) throw new IllegalStateException("远程配置下载超时。");
            // Download without saved proxy or app login credentials. Never recurse through a core being configured.
            HttpURLConnection connection = (HttpURLConnection) next.openConnection(Proxy.NO_PROXY);
            try {
                connection.setConnectTimeout(6000); connection.setReadTimeout(6000); connection.setInstanceFollowRedirects(false); connection.setRequestProperty("Accept", "application/yaml,text/yaml,text/plain"); connection.setRequestProperty("Accept-Encoding", "identity");
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) { String location = connection.getHeaderField("Location"); if (redirect == 3 || location == null) throw new IllegalArgumentException("远程配置重定向无效。"); next = new URL(PetAppProxyPolicy.remoteUrl(new URL(next, location).toString())); continue; }
                if (status != 200 || connection.getContentLengthLong() > PetAppProxyPolicy.MAX_BYTES) throw new IllegalArgumentException("远程服务器未返回可用的 YAML 配置。");
                byte[] bytes = boundedRead(connection.getInputStream(), PetAppProxyPolicy.MAX_BYTES, expected, deadline); check(expected); if (System.nanoTime() > deadline) throw new IllegalStateException("远程配置下载超时。");
                return importText(expectedScope, utf8(bytes), source, expected);
            } finally { connection.disconnect(); }
        }
        throw new IllegalArgumentException("远程配置重定向无效。");
    }
    JSONObject preferences(String expectedScope, boolean enabled, long expected) throws Exception { require(expectedScope); save(yaml, remote, updatedAt, enabled, expected); return status(); }
    JSONObject select(String expectedScope, String group, String name, long expected) throws Exception {
        require(expectedScope); check(expected); if (!"running".equals(state)) throw new IllegalStateException("请先启用代理。");
        refreshGroups(); boolean allowed = false;
        for (int i = 0; i < groups.length(); i++) { JSONObject item = groups.getJSONObject(i); if (!item.getString("name").equals(group)) continue; JSONArray choices = item.getJSONArray("choices"); for (int j = 0; j < choices.length(); j++) if (name.equals(choices.getString(j))) allowed = true; }
        if (!allowed) throw new IllegalArgumentException("节点列表已变化，请刷新后重试。");
        controller("/proxies/" + java.net.URLEncoder.encode(group, "UTF-8").replace("+", "%20"), "PUT", new JSONObject().put("name", name)); check(expected); refreshGroups(); return status();
    }
}
