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
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.Locale;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.TimeZone;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/** Serialized by the plugin's IO worker; generation invalidation is immediate. */
final class PetAppProxyState {
    interface ConnectionFactory { HttpURLConnection open(URL url) throws Exception; }
    private static final int SETTINGS_BYTES = PetAppProxyPolicy.MAX_BYTES * 6 + 2 * 1024 * 1024;
    private final Context context;
    private final ConnectionFactory network;
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final PetAppProxyRouting routing = new PetAppProxyRouting(PetNetwork::proxy, task -> { if (!main.post(task)) throw new IllegalStateException(); }, (port, completed) -> {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
            if (port > 0) throw new IllegalStateException("Android System WebView 不支持应用代理。");
            completed.complete(null); return;
        }
        if (port == 0) ProxyController.getInstance().clearProxyOverride(Runnable::run, () -> completed.complete(null));
        else {
            ProxyConfig.Builder config = new ProxyConfig.Builder().addProxyRule("http://127.0.0.1:" + port);
            for (String rule : Arrays.asList("localhost", "*.localhost", "*.local", "127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "[::1]", "fc00::/7", "fe80::/10")) config.addBypassRule(rule);
            ProxyController.getInstance().setProxyOverride(config.build(), Runnable::run, () -> completed.complete(null));
        }
    });
    private volatile PetAppProxyRouting.Lease proxyLease;
    private volatile long generation;
    private volatile String scope = "";
    private volatile Process process;
    private volatile String state = "stopped", error = "";
    private String owner = "", yaml = "", remote = "", updatedAt = "", secret = "", abi = "";
    // Authentication is bound to the verified server and is never written to settings.
    private volatile String serverBase = "", serverToken = "";
    private String source = "manual", mode = "rule", serverProfileId = "", serverProfileName = "", serverProfileRevision = "", serverProfileUpdatedAt = "", serverProfileHash = "", serverStatus = "none";
    private boolean serverUpdateAvailable, serverRevoked, modeOverride;
    private JSONObject selections = new JSONObject(), localSelections = new JSONObject(), defaultSelections = new JSONObject(), policies = new JSONObject();
    private int port, controllerPort;
    private boolean autoStart;
    private File directory;
    private JSONArray groups = new JSONArray();
    private Set<String> loadedProxyNames = new LinkedHashSet<>();
    private JSONObject manifest;
    PetAppProxyState(Context context) { this(context, PetNetwork::open); }
    PetAppProxyState(Context context, ConnectionFactory network) { this.context = context.getApplicationContext(); this.network = network; }
    long generation() { return generation; }
    String restartRequired() { return routing.failureMessage(); }
    synchronized void invalidate() {
        generation++; scope = ""; serverToken = ""; serverBase = ""; routing.release(proxyLease); state = "stopping";
        // Revocation must not wait behind a slow subscription or /auth/me read.
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
        if (!routing.failureMessage().isEmpty()) return routing.failureMessage();
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
            .put("remoteConfigured", !remote.isEmpty()).put("remoteUpdatedAt", updatedAt).put("groups", groups).put("error", routing.failureMessage().isEmpty() ? error : routing.failureMessage())
            .put("source", source).put("mode", mode).put("serverProfileId", serverProfileId).put("serverProfileName", serverProfileName)
            .put("serverProfileRevision", serverProfileRevision).put("serverProfileUpdatedAt", serverProfileUpdatedAt)
            .put("serverUpdateAvailable", serverUpdateAvailable).put("serverStatus", serverStatus);
    }
    /** No account token is persisted. A new binding always stops the previous core. */
    JSONObject bind(JSONObject input, long expected) throws Exception {
        stop(); check(expected);
        String url = input.getString("url"), token = input.getString("token"), instance = input.getString("instanceId"), user = input.getString("userId");
        // Keep public TLS validation, with the app's same-device loopback exception.
        url = PetAppProxyPolicy.backendUrl(url); TaskNotificationPolicy.id(instance); TaskNotificationPolicy.id(user);
        if (token.length() < 16 || token.length() > 4096 || token.matches(".*[\\x00-\\x20\\x7f].*")) throw new IllegalArgumentException("登录凭据无效。");
        HttpURLConnection connection = network.open(new URL(url + "/api/auth/me"));
        try {
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(10000); connection.setReadTimeout(10000); connection.setRequestProperty("Authorization", "Bearer " + token);
            if (connection.getResponseCode() != 200) throw new IllegalArgumentException("请先登录小伴，再设置应用代理。");
            JSONObject identity = new JSONObject(utf8(boundedRead(connection.getInputStream(), 256 * 1024, expected, System.nanoTime() + TimeUnit.SECONDS.toNanos(20))));
            if (!instance.equals(identity.optString("instanceId")) || !user.equals(identity.optJSONObject("user") == null ? "" : identity.getJSONObject("user").optString("id"))) throw new IllegalArgumentException("登录账号已变化，请重新设置应用代理。");
        } finally { connection.disconnect(); }
        synchronized (this) { check(expected); serverBase = url; serverToken = token; }
        owner = sha((url + "\n" + instance + "\n" + user).getBytes(StandardCharsets.UTF_8));
        // Android may expose filesDir through /data/user/0 -> /data/data.
        // Resolve that OS-owned root first, then reject links below our boundary.
        directory = new File(context.getFilesDir().getCanonicalFile(), "app-proxy/" + owner); if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("代理私有目录不可用。");
        if (!directory.getCanonicalPath().equals(directory.getAbsolutePath())) throw new IllegalStateException("代理目录无效。");
        resetConfiguration(); groups = new JSONArray(); error = "";
        AtomicFile saved = new AtomicFile(new File(directory, "settings.json"));
        if (saved.getBaseFile().isFile()) {
            try {
                JSONObject settings = new JSONObject(utf8(read(saved.openRead(), SETTINGS_BYTES)));
                applySettings(settings);
            } catch (Exception failure) { synchronized (this) { check(expected); state = "error"; error = "已保存的代理配置需要检查，原文件已保留。"; scope = UUID.randomUUID().toString(); } return status(); }
        }
        synchronized (this) { check(expected); scope = UUID.randomUUID().toString(); state = "stopped"; }
        if ("server".equals(source)) checkServer(scope, expected);
        if (autoStart && !yaml.isEmpty() && !serverRevoked && unavailable().isEmpty()) {
            try { start(scope, expected); }
            catch (InterruptedException cancelled) { throw cancelled; }
            catch (Exception failure) { check(expected); state = "error"; error = "代理自动启动未完成，已保留配置；可关闭自动启用或更换配置。"; }
        }
        return status();
    }
    private static JSONObject copy(JSONObject value) throws Exception { return new JSONObject(value.toString()); }
    private static JSONObject selected(JSONObject value) throws Exception {
        Map<String, Object> input = new LinkedHashMap<>();
        if (value != null) for (java.util.Iterator<String> keys = value.keys(); keys.hasNext();) { String key = keys.next(); input.put(key, value.get(key)); }
        return new JSONObject(PetAppProxyPolicy.selections(input));
    }
    private static String time(String value) { if (!value.isEmpty()) TaskNotificationPolicy.expires(value); return value; }
    private void resetConfiguration() {
        yaml = ""; remote = ""; updatedAt = ""; autoStart = false; source = "manual"; mode = "rule"; modeOverride = false;
        serverProfileId = ""; serverProfileName = ""; serverProfileRevision = ""; serverProfileUpdatedAt = ""; serverProfileHash = ""; serverStatus = "none"; serverUpdateAvailable = false; serverRevoked = false;
        selections = new JSONObject(); localSelections = new JSONObject(); defaultSelections = new JSONObject(); policies = new JSONObject();
    }
    private void applySettings(JSONObject settings) throws Exception {
        String value = settings.optString("yaml"); String nextYaml = value.isEmpty() ? "" : PetAppProxyPolicy.normalize(value);
        String nextRemote = settings.optString("remote"); if (!nextRemote.isEmpty()) nextRemote = PetAppProxyPolicy.remoteUrl(nextRemote);
        String nextSource = settings.optString("source", nextRemote.isEmpty() ? "manual" : "url");
        if (!Arrays.asList("manual", "url", "server").contains(nextSource)) throw new IllegalArgumentException();
        String parsedMode = nextYaml.isEmpty() ? "rule" : String.valueOf(PetAppProxyPolicy.parse(nextYaml).getOrDefault("mode", "rule")).toLowerCase(Locale.ROOT);
        String nextMode = PetAppProxyPolicy.mode(settings.optString("mode", parsedMode));
        JSONObject nextSelections = selected(settings.optJSONObject("selections")), nextLocals = selected(settings.optJSONObject("localSelections")), nextDefaults = selected(settings.optJSONObject("defaultSelections"));
        JSONObject nextPolicies = new JSONObject(), rawPolicies = settings.optJSONObject("policies");
        if (rawPolicies != null) {
            if (rawPolicies.length() > 16) throw new IllegalArgumentException();
            for (java.util.Iterator<String> keys = rawPolicies.keys(); keys.hasNext();) {
                String key = keys.next(); PetAppProxyPolicy.contentHash(key); JSONObject policy = rawPolicies.getJSONObject(key);
                nextPolicies.put(key, new JSONObject().put("mode", PetAppProxyPolicy.mode(policy.getString("mode"))).put("modeOverride", policy.optBoolean("modeOverride", false)).put("localSelections", selected(policy.optJSONObject("localSelections"))));
            }
        }
        String nextId = "", nextName = "", nextRevision = "", nextHash = "", nextUpdated = "";
        if ("server".equals(nextSource)) {
            nextId = PetAppProxyPolicy.profileId(settings.getString("serverProfileId")); nextName = PetAppProxyPolicy.label(settings.getString("serverProfileName"));
            nextRevision = PetAppProxyPolicy.revision(settings.getString("serverProfileRevision")); nextHash = PetAppProxyPolicy.contentHash(settings.getString("serverProfileHash")); nextUpdated = time(settings.getString("serverProfileUpdatedAt"));
            if (!nextRemote.isEmpty() || nextUpdated.isEmpty()) throw new IllegalArgumentException();
        }
        String nextRemoteUpdated = time(settings.optString("updatedAt"));
        yaml = nextYaml; remote = nextRemote; updatedAt = nextRemoteUpdated; source = nextSource; mode = nextMode; autoStart = settings.optBoolean("autoStart", false); modeOverride = settings.optBoolean("modeOverride", false);
        selections = nextSelections; localSelections = nextLocals; defaultSelections = nextDefaults; policies = nextPolicies; serverProfileId = nextId; serverProfileName = nextName; serverProfileRevision = nextRevision; serverProfileHash = nextHash; serverProfileUpdatedAt = nextUpdated;
        serverRevoked = "server".equals(source) && settings.optBoolean("serverRevoked", false);
        serverStatus = "server".equals(source) ? serverRevoked ? "revoked" : "unavailable" : "none"; serverUpdateAvailable = false;
    }
    private String policyKey(String kind, String id) throws Exception { return sha((kind + "\n" + id).getBytes(StandardCharsets.UTF_8)); }
    private JSONObject snapshot() throws Exception {
        JSONObject value = new JSONObject().put("version", 2).put("yaml", yaml).put("remote", remote).put("updatedAt", updatedAt).put("autoStart", autoStart).put("source", source).put("mode", mode).put("modeOverride", modeOverride)
            .put("selections", copy(selections)).put("localSelections", copy(localSelections)).put("defaultSelections", copy(defaultSelections)).put("policies", copy(policies)).put("serverProfileId", serverProfileId).put("serverProfileName", serverProfileName).put("serverProfileRevision", serverProfileRevision)
            .put("serverProfileUpdatedAt", serverProfileUpdatedAt).put("serverProfileHash", serverProfileHash).put("serverRevoked", serverRevoked);
        if ("server".equals(source)) {
            JSONObject cache = value.getJSONObject("policies"); String key = policyKey(source, serverProfileId);
            if (!cache.has(key) && cache.length() >= 16) cache.remove(cache.keys().next());
            cache.put(key, new JSONObject().put("mode", mode).put("modeOverride", modeOverride).put("localSelections", copy(localSelections)));
        }
        return value;
    }
    private void saveSettings(JSONObject value, long expected) throws Exception {
        check(expected); if (directory == null || scope.isEmpty()) throw new IllegalStateException("请先登录小伴。");
        if ("server".equals(value.optString("source"))) {
            JSONObject cache = value.getJSONObject("policies"); String key = policyKey("server", value.getString("serverProfileId"));
            if (!cache.has(key) && cache.length() >= 16) cache.remove(cache.keys().next());
            cache.put(key, new JSONObject().put("mode", value.getString("mode")).put("modeOverride", value.optBoolean("modeOverride", false)).put("localSelections", copy(value.getJSONObject("localSelections"))));
        }
        byte[] bytes = value.toString().getBytes(StandardCharsets.UTF_8); if (bytes.length > SETTINGS_BYTES) throw new IllegalArgumentException();
        AtomicFile saved = new AtomicFile(new File(directory, "settings.json")); FileOutputStream output = null;
        String oldStatus = serverStatus; boolean oldUpdate = serverUpdateAvailable;
        try {
            output = saved.startWrite(); output.write(bytes); output.flush();
            synchronized (this) { check(expected); saved.finishWrite(output); output = null; applySettings(value); }
            if ("server".equals(source) && !serverRevoked) { serverStatus = oldStatus; serverUpdateAvailable = oldUpdate; }
        } catch (Exception failure) { if (output != null) saved.failWrite(output); throw failure; }
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
    private void refreshGroups() throws Exception {
        JSONObject all = controller("/proxies", "GET", null).optJSONObject("proxies"); JSONArray next = new JSONArray(); Set<String> loaded = new LinkedHashSet<>();
        if (all != null) for (java.util.Iterator<String> names = all.keys(); names.hasNext();) {
            String name = names.next(); loaded.add(name); JSONObject item = all.optJSONObject(name); if (name.isEmpty() || name.length() > 256 || name.matches(".*[\\x00-\\x1f\\x7f].*") || item == null) continue;
            JSONArray choices = item.optJSONArray("all"); if (choices == null || choices.length() > 2048) continue;
            JSONArray safe = new JSONArray(); for (int i = 0; i < choices.length(); i++) { String choice = choices.optString(i, ""); if (!choice.isEmpty() && choice.length() <= 256 && !choice.matches(".*[\\x00-\\x1f\\x7f].*")) safe.put(choice); }
            for (int i = 0; i < safe.length(); i++) loaded.add(safe.getString(i));
            if (!"Selector".equals(item.optString("type")) || next.length() >= 128) continue;
            next.put(new JSONObject().put("name", name).put("selected", item.optString("now", "")).put("choices", safe));
        }
        groups = next; loadedProxyNames = loaded;
    }
    private boolean hasChoice(String group, String name) throws Exception {
        for (int i = 0; i < groups.length(); i++) {
            JSONObject item = groups.getJSONObject(i); if (!item.getString("name").equals(group)) continue;
            JSONArray choices = item.getJSONArray("choices"); for (int j = 0; j < choices.length(); j++) if (name.equals(choices.getString(j))) return true;
        }
        return false;
    }
    private void choose(String group, String name) throws Exception {
        for (int i = 0; i < groups.length(); i++) { JSONObject item = groups.getJSONObject(i); if (group.equals(item.getString("name")) && name.equals(item.optString("selected"))) return; }
        controller("/proxies/" + java.net.URLEncoder.encode(group, "UTF-8").replace("+", "%20"), "PUT", new JSONObject().put("name", name));
    }
    private boolean providersReady(List<String> names) {
        try {
            JSONObject providers = controller("/providers/proxies", "GET", null).getJSONObject("providers");
            for (String name : names) {
                JSONObject provider = providers.optJSONObject(name); if (provider == null || provider.optJSONArray("proxies") == null) return false;
                String updated = provider.optString("updatedAt");
                if (provider.getJSONArray("proxies").length() == 0 && !"Inline".equalsIgnoreCase(provider.optString("vehicleType")) && (updated.isEmpty() || updated.startsWith("0001-"))) return false;
            }
            return true;
        } catch (Exception unavailable) { return false; }
    }
    /** A saved choice is applied only after the actual core confirms membership. */
    private void restorePolicy(long expected) throws Exception {
        JSONObject valid = new JSONObject(), validLocal = new JSONObject(), candidates = copy(defaultSelections); Map<String, List<String>> dynamic = PetAppProxyPolicy.dynamicGroups(yaml);
        for (java.util.Iterator<String> keys = selections.keys(); keys.hasNext();) { String key = keys.next(); candidates.put(key, selections.getString(key)); }
        for (java.util.Iterator<String> keys = candidates.keys(); keys.hasNext();) {
            String group = keys.next(), name = candidates.getString(group); check(expected);
            if (!hasChoice(group, name)) {
                if (dynamic.containsKey(group) && !providersReady(dynamic.get(group))) {
                    // An unloaded HTTP provider is not evidence that the saved
                    // node was removed. Keep the desired choice for a refresh.
                    valid.put(group, name); if (name.equals(localSelections.optString(group))) validLocal.put(group, name);
                    String fallback = defaultSelections.optString(group); if (!fallback.isEmpty() && hasChoice(group, fallback)) choose(group, fallback);
                    continue;
                }
                name = defaultSelections.optString(group);
            }
            if (name.isEmpty() || !hasChoice(group, name)) continue; choose(group, name); valid.put(group, name);
            if (name.equals(localSelections.optString(group))) validLocal.put(group, name);
        }
        if (!valid.toString().equals(selections.toString()) || !validLocal.toString().equals(localSelections.toString())) { JSONObject next = snapshot().put("selections", valid).put("localSelections", validLocal); saveSettings(next, expected); }
        refreshGroups();
    }
    JSONObject refreshStatus(long expected) throws Exception { check(expected); if ("running".equals(state)) { refreshGroups(); restorePolicy(expected); } return status(); }
    JSONObject start(String expectedScope, long expected) throws Exception {
        require(expectedScope); check(expected); String reason = unavailable(); if (!reason.isEmpty()) throw new IllegalStateException(reason);
        if (serverRevoked) throw new IllegalStateException("服务器已撤销此代理配置，请选择其他配置。");
        if ("running".equals(state)) return status(); if (process != null) throw new IllegalStateException("请先关闭上一次代理。");
        if (yaml.isEmpty()) throw new IllegalStateException("请先导入 Clash YAML 配置。");
        state = "starting"; error = "";
        try {
            File executable = executable(); check(expected); port = freePort(); do { controllerPort = freePort(); } while (controllerPort == port);
            secret = UUID.randomUUID().toString() + UUID.randomUUID();
            File runtime = new File(directory, "runtime.yaml");
            byte[] runtimeBytes = PetAppProxyPolicy.runtime(PetAppProxyPolicy.withMode(yaml, mode), port, controllerPort, secret).getBytes(StandardCharsets.UTF_8);
            synchronized (this) { check(expected); try (FileOutputStream output = new FileOutputStream(runtime, false)) { output.write(runtimeBytes); } check(expected); process = coreProcess(executable.getAbsolutePath(), "-d", directory.getAbsolutePath(), "-f", runtime.getAbsolutePath()).start(); }
            boolean ready = false; long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
            while (System.nanoTime() < deadline) { check(expected); if (!process.isAlive()) break; try { controller("/version", "GET", null); ready = true; break; } catch (Exception waiting) { Thread.sleep(160); } }
            if (!ready) throw new IllegalStateException("代理启动失败，请检查配置和节点资源。");
            Set<String> requiredNames = PetAppProxyPolicy.requiredProxyNames(yaml); long configDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
            do { check(expected); refreshGroups(); if (loadedProxyNames.containsAll(requiredNames)) break; if (!process.isAlive()) throw new IllegalStateException("代理配置尚未就绪。"); Thread.sleep(80); } while (System.nanoTime() < configDeadline);
            if (!loadedProxyNames.containsAll(requiredNames)) throw new IllegalStateException("代理节点配置未及时就绪，已保留配置。");
            restorePolicy(expected); check(expected);
            final PetAppProxyRouting.Lease lease;
            synchronized (this) { check(expected); proxyLease = lease = routing.acquire(); }
            routing.enable(lease, port).await();
            synchronized (this) { check(expected); if (!routing.owns(lease)) throw new InterruptedException(); state = "running"; }
            Process running = process; Thread watcher = new Thread(() -> {
                try { running.waitFor(); } catch (InterruptedException interrupted) { return; }
                synchronized (PetAppProxyState.this) {
                    if (process != running || !"running".equals(state)) return;
                    routing.release(lease); state = "error"; error = "代理内核已退出，请关闭后重新启用；任务不会自动重发。";
                }
            }, "PetPal-proxy-exit"); watcher.setDaemon(true); watcher.start();
            return status();
        } catch (Exception failure) {
            try { stop(); } catch (Exception cleanup) { }
            if (generation == expected) { state = "error"; error = routing.failureMessage().isEmpty() ? "代理未能启用，请检查配置、系统版本和 WebView。" : routing.failureMessage(); }
            throw failure;
        }
    }
    JSONObject stop() throws Exception {
        state = "stopping"; Exception failure = null;
        PetAppProxyRouting.Request released;
        synchronized (this) { released = routing.release(proxyLease); proxyLease = null; }
        try { if (released != null) released.await(); } catch (Exception problem) { failure = problem; }
        Process previous = process;
        if (previous != null) { previous.destroy(); if (!previous.waitFor(3, TimeUnit.SECONDS)) { previous.destroyForcibly(); if (!previous.waitFor(3, TimeUnit.SECONDS)) throw new IllegalStateException("代理内核退出尚未确认，请退出小伴后重试。"); } process = null; }
        if (directory != null) { File runtime = new File(directory, "runtime.yaml"); if (runtime.exists() && !runtime.delete()) failure = new IllegalStateException("临时代理配置清理失败，请退出小伴后检查。"); }
        secret = ""; port = 0; controllerPort = 0; groups = new JSONArray(); loadedProxyNames = new LinkedHashSet<>(); state = failure == null ? "stopped" : "error"; error = failure == null ? "" : "代理关闭未完成，请退出小伴后重试。";
        if (failure != null) throw failure; return status();
    }
    JSONObject clear() throws Exception { stop(); resetConfiguration(); owner = ""; directory = null; serverToken = ""; serverBase = ""; scope = ""; return status(); }
    private void validate(String normalized, String selectedMode, long expected) throws Exception {
        check(expected);
        String reason = unavailable(); if (!reason.isEmpty()) throw new IllegalStateException(reason);
        File candidate = new File(directory, "validate-" + UUID.randomUUID() + ".yaml");
        try {
            int first = freePort(), second; do { second = freePort(); } while (first == second);
            byte[] candidateBytes = PetAppProxyPolicy.runtime(PetAppProxyPolicy.withMode(normalized, selectedMode), first, second, "validation-only").getBytes(StandardCharsets.UTF_8);
            Process test; String executable = executable().getAbsolutePath();
            synchronized (this) { check(expected); try (FileOutputStream output = new FileOutputStream(candidate)) { output.write(candidateBytes); } check(expected); test = coreProcess(executable, "-t", "-d", directory.getAbsolutePath(), "-f", candidate.getAbsolutePath()).start(); }
            boolean finished = false;
            try { long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(25); while (System.nanoTime() < deadline) { check(expected); if (test.waitFor(150, TimeUnit.MILLISECONDS)) { finished = true; break; } } if (!finished || test.exitValue() != 0) throw new IllegalArgumentException("代理配置校验未通过，原配置已保留。"); }
            finally { if (!finished) { test.destroyForcibly(); test.waitFor(3, TimeUnit.SECONDS); } }
        } finally { if (candidate.exists()) candidate.delete(); }
    }
    private JSONObject replace(JSONObject next, long expected) throws Exception {
        validate(next.getString("yaml"), next.getString("mode"), expected);
        JSONObject previous = snapshot(); boolean running = "running".equals(state); String previousStatus = serverStatus; boolean previousUpdate = serverUpdateAvailable;
        try {
            if (process != null) stop(); check(expected); saveSettings(next, expected);
            serverStatus = "server".equals(source) ? "ready" : "none"; serverUpdateAvailable = false; state = "stopped"; error = "";
            if (running) start(scope, expected); return status();
        } catch (Exception failure) {
            if (expected == generation) {
                try { if (process != null) stop(); saveSettings(previous, expected); serverStatus = previousStatus; serverUpdateAvailable = previousUpdate; if (running && !serverRevoked) start(scope, expected); }
                catch (Exception rollback) { state = "error"; error = "旧代理配置已保留，但恢复运行未完成，请重新启用。"; }
            }
            throw failure;
        }
    }
    JSONObject importText(String expectedScope, String source, String remoteUrl, long expected) throws Exception {
        require(expectedScope); check(expected); if (process != null) throw new IllegalStateException("请先关闭代理，再更换配置。");
        String normalized = PetAppProxyPolicy.normalize(source); String date = "";
        if (!remoteUrl.isEmpty()) { SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT); format.setTimeZone(TimeZone.getTimeZone("UTC")); date = format.format(new Date()); }
        String selectedMode = PetAppProxyPolicy.mode(String.valueOf(PetAppProxyPolicy.parse(normalized).getOrDefault("mode", "rule")).toLowerCase(Locale.ROOT));
        JSONObject next = snapshot().put("yaml", normalized).put("remote", remoteUrl).put("updatedAt", date).put("source", remoteUrl.isEmpty() ? "manual" : "url").put("mode", selectedMode).put("modeOverride", false)
            .put("selections", new JSONObject()).put("localSelections", new JSONObject()).put("defaultSelections", new JSONObject()).put("serverProfileId", "").put("serverProfileName", "").put("serverProfileRevision", "").put("serverProfileHash", "").put("serverProfileUpdatedAt", "").put("serverRevoked", false);
        return replace(next, expected);
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
    JSONObject preferences(String expectedScope, boolean enabled, long expected) throws Exception { require(expectedScope); saveSettings(snapshot().put("autoStart", enabled), expected); return status(); }
    JSONObject select(String expectedScope, String group, String name, long expected) throws Exception {
        require(expectedScope); check(expected); if (!"running".equals(state)) throw new IllegalStateException("请先启用代理。");
        PetAppProxyPolicy.label(group); PetAppProxyPolicy.label(name); refreshGroups();
        if (!hasChoice(group, name)) throw new IllegalArgumentException("节点列表已变化，请刷新后重试。");
        String previous = ""; for (int i = 0; i < groups.length(); i++) if (group.equals(groups.getJSONObject(i).getString("name"))) previous = groups.getJSONObject(i).getString("selected");
        choose(group, name); check(expected);
        try { JSONObject next = snapshot(); next.getJSONObject("selections").put(group, name); next.getJSONObject("localSelections").put(group, name); saveSettings(next, expected); }
        catch (Exception failure) { if (expected == generation && !previous.isEmpty()) try { choose(group, previous); } catch (Exception ignored) { } throw failure; }
        refreshGroups(); return status();
    }
    JSONObject mode(String expectedScope, String selectedMode, long expected) throws Exception {
        require(expectedScope); check(expected); PetAppProxyPolicy.mode(selectedMode);
        if (yaml.isEmpty()) throw new IllegalStateException("请先导入代理配置。");
        String previous = mode; boolean running = "running".equals(state);
        if (running) controller("/configs", "PATCH", new JSONObject().put("mode", selectedMode));
        try { saveSettings(snapshot().put("mode", selectedMode).put("modeOverride", true), expected); }
        catch (Exception failure) { if (running && expected == generation) try { controller("/configs", "PATCH", new JSONObject().put("mode", previous)); } catch (Exception ignored) { } throw failure; }
        return status();
    }
    private static final class ServerFailure extends java.io.IOException {
        final int status;
        ServerFailure(int status) { super("服务器代理请求未完成。"); this.status = status; }
    }
    private static final class ServerReply {
        final byte[] bytes; final String etag, hash, contentType;
        ServerReply(byte[] bytes, String etag, String hash, String contentType) { this.bytes = bytes; this.etag = etag; this.hash = hash; this.contentType = contentType; }
    }
    /** The caller controls only an opaque profile ID, never a URL or a header. */
    private ServerReply serverRequest(String id, boolean configuration, String revision, long expected) throws Exception {
        check(expected); PetAppProxyPolicy.profileId(id);
        final String base = serverBase, token = serverToken;
        if (base.isEmpty() || token.isEmpty()) throw new IllegalStateException("请重新登录小伴后同步代理。");
        URL url = new URL(base + "/api/app-proxy/profiles/" + id + (configuration ? "/config" : ""));
        HttpURLConnection connection = network.open(url);
        try {
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(6000); connection.setReadTimeout(6000);
            connection.setRequestProperty("Authorization", "Bearer " + token); connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("Accept", configuration ? "application/yaml" : "application/json");
            if (configuration) connection.setRequestProperty("If-Match", "\"" + PetAppProxyPolicy.revision(revision) + "\"");
            int code = connection.getResponseCode(); check(expected);
            if (code != 200) throw new ServerFailure(code);
            int maximum = configuration ? PetAppProxyPolicy.MAX_BYTES : PetAppProxyPolicy.MAX_BYTES + 512 * 1024;
            if (connection.getContentLengthLong() > maximum) throw new IllegalArgumentException("服务器代理响应超过大小限制。");
            byte[] bytes = boundedRead(connection.getInputStream(), maximum, expected, System.nanoTime() + TimeUnit.SECONDS.toNanos(20)); check(expected);
            return new ServerReply(bytes, connection.getHeaderField("ETag"), connection.getHeaderField("X-Content-SHA256"), connection.getContentType());
        } finally { connection.disconnect(); }
    }
    private JSONObject serverProfile(String id, long expected) throws Exception {
        JSONObject profile = new JSONObject(utf8(serverRequest(id, false, "", expected).bytes)).getJSONObject("profile");
        if (!id.equals(PetAppProxyPolicy.profileId(profile.getString("id")))) throw new IllegalArgumentException();
        PetAppProxyPolicy.label(profile.getString("name")); PetAppProxyPolicy.revision(profile.getString("revision")); PetAppProxyPolicy.contentHash(profile.getString("sha256"));
        if (time(profile.getString("updatedAt")).isEmpty()) throw new IllegalArgumentException();
        PetAppProxyPolicy.mode(profile.getString("mode")); selected(profile.getJSONObject("selections"));
        return profile;
    }
    private void revoke(String id, long expected) throws Exception {
        check(expected); if (!"server".equals(source) || !id.equals(serverProfileId)) return;
        if (process != null) stop(); check(expected);
        saveSettings(snapshot().put("serverRevoked", true), expected); serverStatus = "revoked"; serverUpdateAvailable = false;
        error = "服务器已撤销此代理配置，请选择其他配置。";
    }
    JSONObject checkServer(String expectedScope, long expected) throws Exception {
        require(expectedScope); check(expected); if (!"server".equals(source)) return refreshStatus(expected);
        String id = serverProfileId;
        try {
            JSONObject profile = serverProfile(id, expected); check(expected);
            if (serverRevoked) saveSettings(snapshot().put("serverRevoked", false), expected);
            serverUpdateAvailable = !serverProfileRevision.equals(profile.getString("revision")) || !serverProfileHash.equals(profile.getString("sha256"));
            serverStatus = serverUpdateAvailable ? "update-available" : "ready"; error = "";
        } catch (InterruptedException cancelled) { throw cancelled; }
        catch (Exception failure) {
            check(expected);
            if (failure instanceof ServerFailure && Arrays.asList(401, 403, 404).contains(((ServerFailure) failure).status)) revoke(id, expected);
            else serverStatus = serverRevoked ? "revoked" : "unavailable";
        }
        return refreshStatus(expected);
    }
    JSONObject updateServer(String expectedScope, boolean resetPolicy, long expected) throws Exception {
        require(expectedScope); if (!"server".equals(source) || serverProfileId.isEmpty()) throw new IllegalStateException("尚未选择服务器代理配置。");
        return importServer(expectedScope, serverProfileId, resetPolicy, expected);
    }
    JSONObject importServer(String expectedScope, String id, boolean resetPolicy, long expected) throws Exception {
        require(expectedScope); check(expected); PetAppProxyPolicy.profileId(id);
        try {
            JSONObject profile = serverProfile(id, expected);
            String revision = profile.getString("revision"), hash = profile.getString("sha256");
            ServerReply config = serverRequest(id, true, revision, expected);
            if (!("\"" + revision + "\"").equals(config.etag) || !hash.equals(config.hash) || !hash.equals(sha(config.bytes)) || config.contentType == null || !config.contentType.toLowerCase(Locale.ROOT).matches("application/yaml(?:\\s*;.*)?")) throw new IllegalArgumentException("服务器代理配置校验未通过，原配置已保留。");
            String normalized = PetAppProxyPolicy.normalize(utf8(config.bytes));
            JSONObject previous = snapshot(), cache = previous.getJSONObject("policies").optJSONObject(policyKey("server", id));
            String nextMode = profile.getString("mode"); boolean overridden = !resetPolicy && cache != null && cache.optBoolean("modeOverride", false);
            JSONObject locals = !resetPolicy && cache != null ? selected(cache.optJSONObject("localSelections")) : new JSONObject();
            if (overridden) nextMode = PetAppProxyPolicy.mode(cache.getString("mode"));
            JSONObject defaults = selected(profile.getJSONObject("selections")), effective = copy(defaults);
            for (java.util.Iterator<String> keys = locals.keys(); keys.hasNext();) { String group = keys.next(); effective.put(group, locals.getString(group)); }
            JSONObject next = previous.put("yaml", normalized).put("source", "server").put("remote", "").put("updatedAt", "").put("mode", nextMode).put("modeOverride", overridden).put("selections", effective).put("localSelections", locals).put("defaultSelections", defaults)
                .put("serverProfileId", id).put("serverProfileName", profile.getString("name")).put("serverProfileRevision", revision).put("serverProfileHash", hash).put("serverProfileUpdatedAt", profile.getString("updatedAt")).put("serverRevoked", false);
            return replace(next, expected);
        } catch (Exception failure) {
            check(expected);
            if (failure instanceof ServerFailure && Arrays.asList(401, 403, 404).contains(((ServerFailure) failure).status)) revoke(id, expected);
            throw failure;
        }
    }
}
