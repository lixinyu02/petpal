package com.petpal.app;

import android.content.Context;
import android.os.SystemClock;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.math.BigInteger;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.spec.RSAPublicKeySpec;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;
import org.json.JSONObject;

/** Credentials and every official HTTP request stay in native memory/storage. */
class PetOfficialAccountRuntime implements AutoCloseable {
    interface Browser { void open(String url) throws Exception; }
    interface Listener { void changed(); }
    private static final String ISSUER = "https://auth.openai.com", AUTHORIZE = ISSUER + "/api/accounts/authorize", TOKEN = ISSUER + "/api/accounts/oauth/token", REVOKE = ISSUER + "/api/accounts/oauth/revoke", JWKS = ISSUER + "/.well-known/jwks.json";
    private static final String RESOURCE = "https://api.openai.com/v1", MODELS = RESOURCE + "/models", RESPONSES = RESOURCE + "/responses", PLAN = "chatgpt.tokens.use.direct", KEY = "PetPal.OfficialAccount.v1";
    private static final byte[] AAD = "com.petpal.app/official-account/v1".getBytes(StandardCharsets.UTF_8);
    private static final int MAX_VAULT = 4 * 1024 * 1024, MAX_JSON = 2 * 1024 * 1024, MAX_REQUEST = 16 * 1024 * 1024, MAX_CHUNK = 48 * 1024;
    private final Context context;
    private final Browser browser;
    private final Listener listener;
    private final AtomicFile storage;
    private final ExecutorService callbacks = Executors.newSingleThreadExecutor(), requests = Executors.newFixedThreadPool(4);
    private final ScheduledExecutorService clock = Executors.newSingleThreadScheduledExecutor();
    private final Object gate = new Object(), accessGate = new Object(), registrationGate = new Object();
    private JSONObject vault;
    private Scope scope;
    private long generation;
    private long bindingGeneration, refreshGeneration;
    private boolean closed;
    private Attempt attempt;
    private ReturnNavigation returnNavigation;
    private CallbackReceipt callbackReceipt;
    private String error = "", modelsError = "";
    private JSONArray models = new JSONArray();
    private Relay relay;
    private static final class SupersededRefresh extends IOException { }
    private final Map<String, String> retryClients = new HashMap<>();
    private final Map<String, Running> running = new ConcurrentHashMap<>();
    private final Map<HttpURLConnection, Scope> connections = new ConcurrentHashMap<>();

    private static final class Scope {
        final URI url; final String token, instanceId, userId, key, id = UUID.randomUUID().toString(); final long generation;
        Scope(URI url, String token, String instance, String user, long generation) throws Exception {
            this.url = url; this.token = token; this.instanceId = instance; this.userId = user; this.generation = generation;
            this.key = hex(MessageDigest.getInstance("SHA-256").digest((url.toString() + "\n" + instance + "\n" + user).getBytes(StandardCharsets.UTF_8)));
        }
    }
    private static final class Attempt {
        final Scope scope; final ServerSocket server; final String state = random(32), nonce = random(32), verifier = random(48), redirect, selectedId, clientId;
        final String id = random(24);
        final long deadline = SystemClock.elapsedRealtime() + 600000; volatile boolean used; volatile Socket inbound;
        Attempt(Scope scope, ServerSocket server, String selectedId, String clientId) { this.scope = scope; this.server = server; this.selectedId = selectedId; this.clientId = clientId; redirect = "http://127.0.0.1:" + server.getLocalPort() + "/auth/callback"; }
        void closeListener() { try { server.close(); } catch (Exception ignored) { } }
        void close() { closeListener(); Socket value = inbound; if (value != null) try { value.close(); } catch (Exception ignored) { } }
    }
    private static final class ReturnNavigation {
        final Scope scope; final String attemptId, ticket = random(32); long expiresAt;
        ReturnNavigation(Attempt attempt) { scope = attempt.scope; attemptId = attempt.id; expiresAt = attempt.deadline; }
    }
    /** Only an exact URL digest survives consumption; authorization codes never do. */
    private static final class CallbackReceipt {
        final Scope scope; final String attemptId, redirect, digest; long expiresAt;
        CallbackReceipt(Attempt value, String digest) { scope = value.scope; attemptId = value.id; redirect = value.redirect; this.digest = digest; expiresAt = value.deadline; }
    }
    private static final class CallbackInput {
        final boolean denied; final String code, clientId;
        CallbackInput(boolean denied, String code, String clientId) { this.denied = denied; this.code = code; this.clientId = clientId; }
    }
    private static final class Relay {
        final Scope scope; final String id, revision; volatile boolean stopped; volatile HttpURLConnection poll;
        Relay(Scope scope, String id, String revision) { this.scope = scope; this.id = id; this.revision = revision; }
    }
    private static final class Running {
        final Relay relay; final String id; volatile boolean cancelled, timedOut; volatile HttpURLConnection connection; int sequence;
        final long deadline = System.nanoTime() + TimeUnit.MINUTES.toNanos(10);
        Running(Relay relay, String id) { this.relay = relay; this.id = id; }
        void cancel() { cancelled = true; HttpURLConnection value = connection; if (value != null) value.disconnect(); }
    }
    PetOfficialAccountRuntime(Context context, Browser browser, Listener listener) {
        this.context = context.getApplicationContext(); this.browser = browser; this.listener = listener;
        storage = new AtomicFile(new File(this.context.getNoBackupFilesDir(), "official-account-v1.enc"));
    }
    private static String hex(byte[] value) { StringBuilder out = new StringBuilder(); for (byte item : value) out.append(String.format(java.util.Locale.ROOT, "%02x", item & 255)); return out.toString(); }
    private static String random(int bytes) { byte[] value = new byte[bytes]; new SecureRandom().nextBytes(value); return b64(value); }
    private static String b64(byte[] value) { return Base64.encodeToString(value, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING); }
    private static byte[] decode(String value) { if (value == null || !value.matches("[A-Za-z0-9_-]+")) throw new IllegalArgumentException("官方账号身份验证失败。"); return Base64.decode(value, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING); }
    private static String stamp() { return new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.ROOT) {{ setTimeZone(java.util.TimeZone.getTimeZone("UTC")); }}.format(new java.util.Date()); }
    private static IOException failure() { return new IOException("官方账号连接未完成，请检查网络或重新登录。"); }
    private void emit() { try { listener.changed(); } catch (Exception ignored) { } }
    private void assertCurrent(Scope value) throws IOException { synchronized (gate) { if (closed || scope != value || value.generation != generation) throw failure(); } }
    private void assertRelay(Relay value) throws IOException { assertCurrent(value.scope); synchronized (gate) { if (relay != value || value.stopped) throw failure(); } }
    private SecretKey key(boolean create) throws Exception {
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore"); keys.load(null);
        if (keys.containsAlias(KEY)) return (SecretKey) keys.getKey(KEY, null);
        if (!create) throw new IOException("官方账号存储密钥不可用，请保留文件并检查系统。");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
    private void init() throws Exception {
        synchronized (gate) {
            if (vault != null) return;
            if (!storage.getBaseFile().exists() && !new File(storage.getBaseFile().getPath() + ".bak").exists()) { JSONObject next = new JSONObject().put("version", 1).put("hostId", "urn:uuid:" + UUID.randomUUID()).put("deviceId", UUID.randomUUID().toString()).put("users", new JSONObject()); save(next); return; }
            try (InputStream input = storage.openRead()) {
                JSONObject envelope = new JSONObject(new String(bytes(input, MAX_VAULT), StandardCharsets.UTF_8));
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, Base64.decode(envelope.getString("iv"), Base64.NO_WRAP))); cipher.updateAAD(AAD);
                JSONObject saved = new JSONObject(new String(cipher.doFinal(Base64.decode(envelope.getString("data"), Base64.NO_WRAP)), StandardCharsets.UTF_8));
                if (saved.getInt("version") != 1 || !saved.getString("hostId").matches("urn:uuid:[0-9a-f-]{36}") || !(saved.opt("users") instanceof JSONObject)) throw failure();
                PetOfficialAccountPolicy.uuid(saved.getString("deviceId")); vault = saved;
            } catch (Exception failure) { throw new IOException("无法读取官方账号私有配置，原文件已保留，请检查系统密钥。"); }
        }
    }
    private void save(JSONObject next) throws Exception {
        byte[] plain = next.toString().getBytes(StandardCharsets.UTF_8); if (plain.length > MAX_VAULT) throw new IOException("官方账号配置已达上限。");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key(true)); cipher.updateAAD(AAD);
        JSONObject envelope = new JSONObject().put("version", 1).put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).put("data", Base64.encodeToString(cipher.doFinal(plain), Base64.NO_WRAP));
        byte[] encrypted = envelope.toString().getBytes(StandardCharsets.UTF_8); if (encrypted.length > MAX_VAULT) throw new IOException("官方账号配置已达上限。"); FileOutputStream stream = null;
        try { stream = storage.startWrite(); stream.write(encrypted); storage.finishWrite(stream); vault = next; }
        catch (Exception failure) { if (stream != null) storage.failWrite(stream); throw new IOException("无法保存官方账号私有配置。"); }
    }
    private JSONObject user(Scope value, JSONObject data) throws Exception {
        JSONObject users = data.getJSONObject("users"), result = users.optJSONObject(value.key);
        if (result == null) { if (users.length() >= 256) throw new IOException("官方账号已达保存上限。"); result = new JSONObject().put("profiles", new JSONArray()).put("activeProfileId", JSONObject.NULL).put("usage", emptyUsage()); users.put(value.key, result); }
        return result;
    }
    private JSONObject profile(Scope value, JSONObject data) throws Exception {
        JSONObject user = user(value, data); JSONArray profiles = user.getJSONArray("profiles"); String selected = user.optString("activeProfileId", "");
        for (int i = 0; i < profiles.length(); i++) if (selected.equals(profiles.getJSONObject(i).optString("id"))) return profiles.getJSONObject(i);
        return null;
    }
    private static JSONObject emptyUsage() throws Exception { return new JSONObject().put("state", "unverified").put("checkedAt", JSONObject.NULL).put("lastModel", JSONObject.NULL).put("completedRequests", 0).put("inputTokens", 0).put("outputTokens", 0).put("totalTokens", 0); }
    private static boolean signedIn(JSONObject profile) { return profile != null && (!profile.optString("refreshToken").isEmpty() || !profile.optString("accessToken").isEmpty() && profile.optLong("expiresAt") > System.currentTimeMillis()); }
    private static boolean plan(JSONObject profile) { JSONArray scopes = profile == null ? null : profile.optJSONArray("scopes"); if (scopes != null) for (int i = 0; i < scopes.length(); i++) if (PLAN.equals(scopes.optString(i))) return true; return false; }
    JSONObject status() throws Exception {
        init(); synchronized (gate) {
            Scope value = scope; JSONObject user = value == null ? new JSONObject().put("profiles", new JSONArray()) : user(value, vault), profile = value == null ? null : profile(value, vault);
            JSONArray profiles = new JSONArray(), saved = user.getJSONArray("profiles");
            for (int i = 0; i < saved.length(); i++) { JSONObject entry = saved.getJSONObject(i); profiles.put(new JSONObject().put("id", entry.getString("id")).put("email", entry.optString("email")).put("label", entry.optString("label")).put("signedIn", signedIn(entry)).put("planUsageEnabled", signedIn(entry) && plan(entry))); }
            JSONObject out = new JSONObject().put("supported", true).put("manualCallbackSupported", true).put("state", attempt != null && value == attempt.scope ? "signing-in" : signedIn(profile) ? "signed-in" : "signed-out").put("activeProfileId", profile == null ? JSONObject.NULL : profile.getString("id")).put("planUsageEnabled", signedIn(profile) && plan(profile)).put("profiles", profiles).put("models", new JSONArray(models.toString())).put("usage", user.optJSONObject("usage") == null ? emptyUsage() : new JSONObject(user.getJSONObject("usage").toString()));
            if (attempt != null && value == attempt.scope) out.put("signInStage", attempt.used ? "verifying" : "browser");
            if (!error.isEmpty()) out.put("error", error); if (!modelsError.isEmpty()) out.put("modelsError", modelsError);
            out.put("relayConnected", relay != null && !relay.stopped); return out;
        }
    }
    JSONObject bind(JSONObject input) throws Exception {
        URI url = PetOfficialAccountPolicy.backend(input.getString("url")); String token = PetOfficialAccountPolicy.text(input.getString("token"), 4096, false), instance = PetOfficialAccountPolicy.id(input.getString("instanceId")), user = PetOfficialAccountPolicy.id(input.getString("userId"));
        init(); final Scope selected; final long binding; Relay previous = null;
        synchronized (gate) {
            if (closed) throw failure(); binding = ++bindingGeneration;
            Scope existing = scope;
            if (existing != null && (!existing.url.equals(url) || !PetOfficialAccountPolicy.equal(existing.token, token) || !existing.instanceId.equals(instance) || !existing.userId.equals(user))) previous = clearScopeLocked();
            selected = scope == null ? new Scope(url, token, instance, user, generation) : scope;
        }
        disconnectRelay(previous);
        verify(selected);
        synchronized (gate) { if (closed || binding != bindingGeneration || selected.generation != generation) throw failure(); scope = selected; error = ""; }
        if (signedIn(active(selected)) && plan(active(selected))) { try { refreshModels(selected); } catch (Exception failure) { modelsFailed(selected, failure); } }
        assertCurrent(selected); return new JSONObject().put("scopeId", selected.id).put("status", status());
    }
    void checkScope(String id) throws Exception { synchronized (gate) { if (scope == null || !scope.id.equals(id)) throw new IOException("小伴登录已变化，请重新打开官方账号设置。"); assertCurrent(scope); } }
    JSONObject scopedStatus(String id) throws Exception { checkScope(id); required(); checkScope(id); return status(); }
    private void verify(Scope value) throws Exception {
        JSONObject response = backend(value, "/api/auth/me", null, 15000, false);
        if (!value.instanceId.equals(response.optString("instanceId")) || response.optJSONObject("user") == null || !value.userId.equals(response.getJSONObject("user").optString("id"))) throw new IOException("小伴登录身份已变化，请重新登录。");
    }
    private Scope required() throws Exception { init(); Scope value; synchronized (gate) { value = scope; } if (value == null) throw new IOException("请先登录小伴账号。"); assertCurrent(value); try { verify(value); } catch (AuthFailure failure) { clearScope(value); throw failure; } assertCurrent(value); return value; }
    private JSONObject active(Scope value) throws Exception { synchronized (gate) { assertCurrent(value); JSONObject entry = profile(value, vault); return entry == null ? null : new JSONObject(entry.toString()); } }
    /** This is the only connection creation point; no cookies or browser headers. */
    protected HttpURLConnection open(URI uri, boolean official) throws Exception {
        if (official && !java.util.Arrays.asList(AUTHORIZE, TOKEN, REVOKE, JWKS, MODELS, RESPONSES).contains(uri.toString())) throw failure();
        HttpURLConnection connection = PetNetwork.open(uri.toURL()); connection.setInstanceFollowRedirects(false); connection.setUseCaches(false); connection.setConnectTimeout(15000); connection.setReadTimeout(15000); connection.setRequestProperty("Cookie", ""); connection.setRequestProperty("Accept-Encoding", "identity"); connection.setRequestProperty("User-Agent", "PetPal-Android/0.9.13"); return connection;
    }
    private static byte[] bytes(InputStream input, int maximum) throws Exception { if (input == null) return new byte[0]; ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; for (int count; (count = input.read(buffer)) != -1;) { if (out.size() + count > maximum) throw failure(); out.write(buffer, 0, count); } return out.toByteArray(); }
    private JSONObject json(URI uri, String bearer, byte[] body, String contentType, int timeout, boolean official, Scope value, boolean requireCurrent) throws Exception {
        if (requireCurrent) assertCurrent(value); HttpURLConnection connection = open(uri, official); connections.put(connection, value);
        Relay polling = null; synchronized (gate) { if (!official && uri.getPath().endsWith("/poll") && relay != null && relay.scope == value) { polling = relay; polling.poll = connection; } }
        try {
            connection.setReadTimeout(timeout); connection.setRequestProperty("Accept", "application/json"); if (bearer != null) connection.setRequestProperty("Authorization", "Bearer " + bearer);
            if (body != null) { connection.setRequestMethod("POST"); connection.setRequestProperty("Content-Type", contentType); connection.setDoOutput(true); connection.setFixedLengthStreamingMode(body.length); try (OutputStream output = connection.getOutputStream()) { output.write(body); } }
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                boolean invalidGrant = false;
                if (official && TOKEN.equals(uri.toString()) && (status == 400 || status == 401)) try (InputStream input = connection.getErrorStream()) { if (input != null) invalidGrant = "invalid_grant".equals(new JSONObject(new String(bytes(input, 65536), StandardCharsets.UTF_8)).optString("error")); } catch (Exception ignored) { }
                if (status == 401 || status == 403 || official && TOKEN.equals(uri.toString()) && status == 400) throw new AuthFailure(invalidGrant); throw failure();
            }
            int maximum = !official && uri.getPath().endsWith("/poll") ? MAX_REQUEST + 65536 : MAX_JSON;
            String declared = connection.getHeaderField("Content-Length"); if (declared != null && Long.parseLong(declared) > maximum) throw failure();
            byte[] result; try (InputStream stream = connection.getInputStream()) { result = bytes(stream, maximum); }
            if (requireCurrent) assertCurrent(value); return result.length == 0 ? new JSONObject() : new JSONObject(new String(result, StandardCharsets.UTF_8));
        } finally { if (polling != null && polling.poll == connection) polling.poll = null; connections.remove(connection); connection.disconnect(); }
    }
    private static final class AuthFailure extends IOException { final boolean invalidGrant; AuthFailure() { this(false); } AuthFailure(boolean invalidGrant) { super("官方登录或小伴会话已失效，请重新登录。"); this.invalidGrant = invalidGrant; } }
    private JSONObject backend(Scope value, String route, JSONObject body, int timeout, boolean current) throws Exception { return json(URI.create(value.url + route), value.token, body == null ? null : body.toString().getBytes(StandardCharsets.UTF_8), "application/json", timeout, false, value, current); }
    private JSONObject form(String url, Map<String, String> fields, Scope value) throws Exception {
        StringBuilder body = new StringBuilder(); for (Map.Entry<String, String> entry : fields.entrySet()) { if (body.length() != 0) body.append('&'); body.append(URLEncoder.encode(entry.getKey(), "UTF-8")).append('=').append(URLEncoder.encode(entry.getValue(), "UTF-8")); }
        return json(URI.create(url), null, body.toString().getBytes(StandardCharsets.UTF_8), "application/x-www-form-urlencoded", 15000, true, value, true);
    }
    JSONObject start(String profileId) throws Exception {
        Scope value = required(); JSONObject selected = null;
        synchronized (gate) {
            if (profileId != null) { PetOfficialAccountPolicy.uuid(profileId); JSONArray saved = user(value, vault).getJSONArray("profiles"); for (int i = 0; i < saved.length(); i++) if (profileId.equals(saved.getJSONObject(i).optString("id"))) selected = new JSONObject(saved.getJSONObject(i).toString()); if (selected == null) throw new IOException("保存的官方账号不存在。"); }
            if (attempt != null) attempt.close(); attempt = null; returnNavigation = null; callbackReceipt = null; error = "";
        }
        ServerSocket server = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1")); server.setSoTimeout(1000); String clientId; synchronized (gate) { clientId = selected == null ? retryClients.get(value.key) : selected.getString("clientId"); } Attempt next = new Attempt(value, server, profileId, clientId);
        synchronized (gate) { assertCurrent(value); attempt = next; returnNavigation = new ReturnNavigation(next); }
        Map<String, String> parameters = new HashMap<>(); parameters.put("client_id", next.clientId == null ? "dynamic_agent_client" : next.clientId); parameters.put("ext_agent_host_id", vault.getString("hostId")); parameters.put("response_type", "code"); parameters.put("redirect_uri", next.redirect); parameters.put("scope", "openid profile email offline_access resource.invoke " + PLAN); parameters.put("resource", RESOURCE); parameters.put("state", next.state); parameters.put("nonce", next.nonce); parameters.put("code_challenge_method", "S256"); parameters.put("code_challenge", b64(MessageDigest.getInstance("SHA-256").digest(next.verifier.getBytes(StandardCharsets.US_ASCII))));
        if (next.clientId == null) parameters.put("agent_name_hint", "小伴 PetPal Android"); if (selected != null) { if (!selected.optString("idToken").isEmpty()) parameters.put("id_token_hint", selected.getString("idToken")); if (!selected.optString("email").isEmpty()) parameters.put("login_hint", selected.getString("email")); }
        StringBuilder url = new StringBuilder(AUTHORIZE).append('?'); for (Map.Entry<String, String> field : parameters.entrySet()) url.append(URLEncoder.encode(field.getKey(), "UTF-8")).append('=').append(URLEncoder.encode(field.getValue(), "UTF-8")).append('&');
        callbacks.execute(() -> accept(next)); clock.schedule(() -> finish(next, "官方登录已超时，请重新登录。"), 10, TimeUnit.MINUTES);
        try { browser.open(url.toString()); } catch (Exception failure) { finish(next, "无法打开系统浏览器，请重试。"); throw failure(); }
        emit(); return status();
    }
    private void accept(Attempt next) {
        try {
            while (SystemClock.elapsedRealtime() < next.deadline) {
                synchronized (gate) { if (attempt != next || scope != next.scope || closed) return; }
                try (Socket socket = next.server.accept()) {
                    synchronized (gate) { if (attempt != next || next.used || scope != next.scope || closed) return; next.inbound = socket; }
                    socket.setSoTimeout(5000); BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
                    String first = line(reader, 16384); Map<String, String> headers = new HashMap<>(); int size = first.length();
                    for (int i = 0; i < 32; i++) { String field = line(reader, 8192); size += field.length(); if (size > 32768) throw failure(); if (field.isEmpty()) break; int colon = field.indexOf(':'); if (colon <= 0) throw failure(); String name = field.substring(0, colon).toLowerCase(java.util.Locale.ROOT); if (headers.put(name, field.substring(colon + 1).trim()) != null) throw failure(); }
                    String[] request = first.split(" ", -1); CallbackInput input; String digest;
                    try {
                        if (request.length != 3 || !"GET".equals(request[0]) || !"HTTP/1.1".equals(request[2]) || !("127.0.0.1:" + next.server.getLocalPort()).equals(headers.get("host"))) throw failure();
                        input = callbackInput(next, PetOfficialAccountPolicy.callback(request[1], next.state));
                        digest = callbackDigest(next.redirect + request[1].substring("/auth/callback".length()));
                    }
                    catch (Exception invalid) { respond(socket, 400, "登录回调无效，请继续原来的登录。"); continue; }
                    if (!claimCallback(next, digest)) { respond(socket, 410, "此登录已经结束，请回到小伴。"); return; } emit();
                    // Browser delivery must not cancel an otherwise valid authorization code.
                    try { respondReturn(socket, next); } catch (Exception ignored) { }
                    exchangeCallback(next, input); return;
                } catch (SocketTimeoutException ignored) { }
                finally { next.inbound = null; }
            }
            finish(next, "官方登录已超时，请重新登录。");
        } catch (Exception failure) { synchronized (gate) { if (next.used) return; } finish(next, "官方账号验证未完成，请重新登录。"); }
    }
    private static String callbackDigest(String value) throws Exception { return hex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
    private static CallbackInput callbackInput(Attempt next, Map<String, String> parameters) throws Exception {
        if (parameters.containsKey("error")) {
            PetOfficialAccountPolicy.text(parameters.get("error"), 512, false); if (parameters.containsKey("code")) throw failure();
            return new CallbackInput(true, null, null);
        }
        String code = PetOfficialAccountPolicy.text(parameters.get("code"), 8192, false), returned = parameters.get("client_id"), clientId = next.clientId == null ? returned : next.clientId;
        PetOfficialAccountPolicy.text(clientId, 512, false); if ("dynamic_agent_client".equals(clientId) || returned != null && !returned.equals(clientId)) throw failure();
        return new CallbackInput(false, code, clientId);
    }
    private boolean claimCallback(Attempt next, String digest) throws Exception {
        synchronized (gate) {
            assertAttempt(next); if (next.used) return false;
            next.used = true; callbackReceipt = new CallbackReceipt(next, digest); next.closeListener(); return true;
        }
    }
    private void exchangeCallback(Attempt next, CallbackInput input) {
        try { if (input.denied) finish(next, "官方授权未完成，请重新登录。"); else complete(next, input.code, input.clientId); }
        catch (Exception invalid) { finish(next, "官方账号验证未完成，请重新登录。"); }
    }
    /** Called only from the trusted native dialog; the URL never crosses the JS bridge. */
    JSONObject completeCallback(String scopeId, String callbackUrl) throws Exception {
        checkScope(scopeId); final Scope owner; final Attempt next; final String redirect;
        synchronized (gate) {
            owner = scope; next = attempt;
            if (next == null && (callbackReceipt == null || callbackReceipt.scope != owner || !OfficialReturnPolicy.live(SystemClock.elapsedRealtime(), callbackReceipt.expiresAt))) throw failure();
            redirect = next == null ? callbackReceipt.redirect : next.redirect;
        }
        String target = PetOfficialAccountPolicy.callbackTarget(callbackUrl, redirect), digest = callbackDigest(callbackUrl);
        CallbackInput input = next == null ? null : callbackInput(next, PetOfficialAccountPolicy.callback(target, next.state));
        synchronized (gate) {
            checkScope(scopeId); assertCurrent(owner);
            CallbackReceipt receipt = callbackReceipt;
            if (receipt != null && receipt.scope == owner && (next == null || next.id.equals(receipt.attemptId)) && OfficialReturnPolicy.live(SystemClock.elapsedRealtime(), receipt.expiresAt) && PetOfficialAccountPolicy.equal(digest, receipt.digest)) return status();
            if (next == null || attempt != next || !claimCallback(next, digest)) throw failure();
            next.close();
        }
        emit(); callbacks.execute(() -> exchangeCallback(next, input)); checkScope(scopeId); return status();
    }
    private static String line(BufferedReader reader, int maximum) throws Exception { StringBuilder value = new StringBuilder(); for (int next; (next = reader.read()) != -1;) { if (next == '\n') return value.toString().replaceAll("\r$", ""); if (value.length() >= maximum) throw failure(); value.append((char) next); } throw failure(); }
    private static void respond(Socket socket, int status, String text) throws Exception { byte[] bytes = text.getBytes(StandardCharsets.UTF_8); OutputStream out = socket.getOutputStream(); out.write(("HTTP/1.1 " + status + " Response\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; frame-ancestors 'none'\r\nConnection: close\r\nContent-Length: " + bytes.length + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII)); out.write(bytes); out.flush(); }
    private void respondReturn(Socket socket, Attempt next) throws Exception {
        final String ticket; synchronized (gate) { assertAttempt(next); if (returnNavigation == null || !next.id.equals(returnNavigation.attemptId)) throw failure(); ticket = returnNavigation.ticket; }
        String nonce = random(32); byte[] bytes = OfficialReturnPolicy.html(ticket, nonce).getBytes(StandardCharsets.UTF_8);
        OutputStream out = socket.getOutputStream(); out.write(("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: " + OfficialReturnPolicy.csp(nonce) + "\r\nConnection: close\r\nContent-Length: " + bytes.length + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII)); out.write(bytes); out.flush();
    }
    private void finish(Attempt next, String message) {
        next.close(); synchronized (gate) {
            if (attempt != next) return; attempt = null; error = message;
            if (returnNavigation != null && next.id.equals(returnNavigation.attemptId)) returnNavigation.expiresAt = Math.min(returnNavigation.expiresAt, SystemClock.elapsedRealtime() + 120000);
            if (callbackReceipt != null && next.id.equals(callbackReceipt.attemptId)) callbackReceipt.expiresAt = Math.min(callbackReceipt.expiresAt, SystemClock.elapsedRealtime() + 120000);
        } emit();
    }
    String pendingAttemptId() { synchronized (gate) { return !closed && attempt != null && OfficialReturnPolicy.live(SystemClock.elapsedRealtime(), attempt.deadline) ? attempt.id : null; } }
    void cancelAttempt(String id, String message) {
        synchronized (gate) { if (attempt == null || !PetOfficialAccountPolicy.equal(id, attempt.id)) return; attempt.close(); attempt = null; returnNavigation = null; callbackReceipt = null; error = message; } emit();
    }
    boolean consumeReturn(String uri) {
        final String ticket; try { ticket = OfficialReturnPolicy.parse(uri); } catch (Exception invalid) { return false; }
        synchronized (gate) {
            ReturnNavigation navigation = returnNavigation;
            if (closed || navigation == null || scope == null || navigation.scope != scope || scope.generation != generation || !OfficialReturnPolicy.live(SystemClock.elapsedRealtime(), navigation.expiresAt) || !PetOfficialAccountPolicy.equal(ticket, navigation.ticket)) return false;
            returnNavigation = null; return true;
        }
    }
    private void assertAttempt(Attempt next) throws IOException { assertCurrent(next.scope); synchronized (gate) { if (attempt != next || SystemClock.elapsedRealtime() >= next.deadline) throw failure(); } }
    private JSONObject verifyId(String token, String clientId, String nonce, String subject, Scope value) throws Exception {
        PetOfficialAccountPolicy.text(token, 65536, false); String[] parts = token.split("\\.", -1); if (parts.length != 3) throw failure(); JSONObject header = new JSONObject(new String(decode(parts[0]), StandardCharsets.UTF_8)), claims = new JSONObject(new String(decode(parts[1]), StandardCharsets.UTF_8));
        if (!"RS256".equals(header.optString("alg")) || header.has("crit")) throw failure(); String kid = PetOfficialAccountPolicy.text(header.getString("kid"), 200, false);
        JSONArray keys = json(URI.create(JWKS), null, null, null, 15000, true, value, true).getJSONArray("keys"); if (keys.length() > 64) throw failure(); JSONObject key = null;
        for (int i = 0; i < keys.length(); i++) { JSONObject candidate = keys.optJSONObject(i); if (candidate != null && kid.equals(candidate.optString("kid")) && "RSA".equals(candidate.optString("kty")) && (!candidate.has("alg") || "RS256".equals(candidate.optString("alg"))) && (!candidate.has("use") || "sig".equals(candidate.optString("use")))) { if (key != null) throw failure(); key = candidate; } }
        if (key == null) throw failure(); BigInteger modulus = new BigInteger(1, decode(PetOfficialAccountPolicy.text(key.getString("n"), 1400, false))), exponent = new BigInteger(1, decode(PetOfficialAccountPolicy.text(key.getString("e"), 16, false))); if (modulus.bitLength() < 2048 || modulus.bitLength() > 8192 || exponent.bitLength() > 32 || exponent.compareTo(BigInteger.valueOf(3)) < 0) throw failure(); Signature verifier = Signature.getInstance("SHA256withRSA"); verifier.initVerify(KeyFactory.getInstance("RSA").generatePublic(new RSAPublicKeySpec(modulus, exponent))); verifier.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII)); if (!verifier.verify(decode(parts[2]))) throw failure();
        List<String> audiences = new ArrayList<>(); Object aud = claims.opt("aud"); if (aud instanceof String) audiences.add((String) aud); else if (aud instanceof JSONArray) { JSONArray array = (JSONArray) aud; if (array.length() > 16) throw failure(); for (int i = 0; i < array.length(); i++) audiences.add(PetOfficialAccountPolicy.text(array.getString(i), 512, false)); }
        long now = System.currentTimeMillis() / 1000; PetOfficialAccountPolicy.text(claims.getString("sub"), 512, false);
        double exp = claims.optDouble("exp", Double.NaN), nbf = claims.optDouble("nbf", Double.NaN);
        if (!ISSUER.equals(claims.optString("iss")) || !audiences.contains(clientId) || audiences.size() > 1 && !clientId.equals(claims.optString("azp")) || !(claims.opt("exp") instanceof Number) || !PetOfficialAccountPolicy.finite(exp) || exp <= now || claims.has("nbf") && (!(claims.opt("nbf") instanceof Number) || !PetOfficialAccountPolicy.finite(nbf) || nbf > now + 60) || nonce != null && !PetOfficialAccountPolicy.equal(nonce, claims.optString("nonce")) || subject != null && !subject.equals(claims.getString("sub"))) throw failure(); return claims;
    }
    private JSONObject credentials(JSONObject response, JSONObject previous) throws Exception {
        String access = PetOfficialAccountPolicy.text(response.getString("access_token"), 32768, false); double expires = response.getDouble("expires_in");
        if (!"bearer".equalsIgnoreCase(response.optString("token_type")) || !(response.opt("expires_in") instanceof Number) || !PetOfficialAccountPolicy.finite(expires) || expires <= 0 || expires > 31 * 86400) throw failure();
        String refresh = response.has("refresh_token") ? PetOfficialAccountPolicy.text(response.getString("refresh_token"), 32768, false) : previous == null ? "" : previous.optString("refreshToken"), id = response.has("id_token") ? PetOfficialAccountPolicy.text(response.getString("id_token"), 65536, false) : previous == null ? "" : previous.optString("idToken");
        JSONArray scopes = new JSONArray(); if (response.has("scope")) { String raw = response.getString("scope"); if (raw.length() > 8192 || raw.matches("(?s).*[\\x00-\\x1f\\x7f].*")) throw failure(); Set<String> seen = new HashSet<>(); for (String item : raw.split(" ")) if (!item.isEmpty() && seen.add(PetOfficialAccountPolicy.text(item, 128, false))) { if (scopes.length() >= 64) throw failure(); scopes.put(item); } } else if (previous != null) scopes = previous.getJSONArray("scopes");
        return new JSONObject().put("accessToken", access).put("refreshToken", refresh).put("idToken", id).put("expiresAt", System.currentTimeMillis() + (long) (expires * 1000)).put("scopes", scopes);
    }
    private void complete(Attempt next, String code, String clientId) throws Exception {
        assertAttempt(next); verify(next.scope); JSONObject response;
        try { response = form(TOKEN, map("grant_type", "authorization_code", "client_id", clientId, "code", code, "code_verifier", next.verifier, "redirect_uri", next.redirect, "resource", RESOURCE), next.scope); }
        catch (AuthFailure failure) { if (next.selectedId == null && failure.invalidGrant) synchronized (gate) { assertAttempt(next); retryClients.put(next.scope.key, clientId); } throw failure; }
        JSONObject tokens = credentials(response, null), selected = null;
        synchronized (gate) { JSONArray saved = user(next.scope, vault).getJSONArray("profiles"); for (int i = 0; i < saved.length(); i++) if (next.selectedId != null && next.selectedId.equals(saved.getJSONObject(i).optString("id"))) selected = saved.getJSONObject(i); }
        JSONObject claims = verifyId(response.getString("id_token"), clientId, next.nonce, selected == null ? null : selected.getString("subject"), next.scope); assertAttempt(next); verify(next.scope); assertAttempt(next); revokeRelay();
        synchronized (gate) {
            assertAttempt(next); JSONObject draft = new JSONObject(vault.toString()), user = user(next.scope, draft); JSONArray profiles = user.getJSONArray("profiles"); JSONObject profile = null;
            for (int i = 0; i < profiles.length(); i++) { JSONObject entry = profiles.getJSONObject(i); if (clientId.equals(entry.optString("clientId"))) { if (!claims.getString("sub").equals(entry.optString("subject"))) throw failure(); profile = entry; } }
            if (next.selectedId != null && (profile == null || !next.selectedId.equals(profile.optString("id")))) throw failure();
            String email = claims.optString("email", ""); if (email.length() > 254 || email.matches("(?s).*[\\x00-\\x1f\\x7f].*")) email = "";
            if (profile == null) { if (profiles.length() >= 64) throw failure(); String id = UUID.randomUUID().toString(); profile = new JSONObject().put("id", id).put("clientId", clientId).put("subject", claims.getString("sub")).put("label", (email.isEmpty() ? "ChatGPT 账号" : email) + " · " + id.substring(0, 6)); profiles.put(profile); }
            copy(tokens, profile); profile.put("email", email).put("revision", UUID.randomUUID().toString()); user.put("activeProfileId", profile.getString("id")).put("usage", emptyUsage()); save(draft); retryClients.remove(next.scope.key);
        }
        finish(next, plan(tokens) ? "" : "已登录，但尚未允许使用 ChatGPT 套餐，请重新授权。"); if (plan(tokens)) try { refreshModels(next.scope); } catch (Exception failure) { modelsFailed(next.scope, failure); }
    }
    private static Map<String, String> map(String... pairs) { Map<String, String> out = new HashMap<>(); for (int i = 0; i < pairs.length; i += 2) out.put(pairs[i], pairs[i + 1]); return out; }
    private static void copy(JSONObject from, JSONObject to) throws Exception { for (Iterator<String> keys = from.keys(); keys.hasNext();) { String name = keys.next(); to.put(name, from.get(name)); } }
    private JSONObject access(Scope value, boolean force) throws Exception {
        synchronized (accessGate) {
            JSONObject current = active(value); if (!signedIn(current) || !plan(current)) throw new AuthFailure();
            if (!force && !current.optString("accessToken").isEmpty() && current.optLong("expiresAt") > System.currentTimeMillis() + 30000) return current;
            try {
                if (current.optString("refreshToken").isEmpty()) throw new AuthFailure();
                JSONObject response = form(TOKEN, map("grant_type", "refresh_token", "client_id", current.getString("clientId"), "refresh_token", current.getString("refreshToken"), "resource", RESOURCE), value), tokens = credentials(response, current);
                if (response.has("id_token")) verifyId(response.getString("id_token"), current.getString("clientId"), null, current.getString("subject"), value);
                synchronized (gate) { assertCurrent(value); JSONObject draft = new JSONObject(vault.toString()), selected = profile(value, draft); if (selected == null || !selected.getString("id").equals(current.getString("id")) || !selected.getString("revision").equals(current.getString("revision"))) throw failure(); copy(tokens, selected); save(draft); }
                JSONObject refreshed = active(value); if (!plan(refreshed)) throw new AuthFailure(); return refreshed;
            } catch (AuthFailure failure) {
                Relay previous = null;
                try {
                    synchronized (gate) {
                        assertCurrent(value); JSONObject draft = new JSONObject(vault.toString()), selected = profile(value, draft);
                        if (selected != null && selected.getString("id").equals(current.getString("id")) && selected.getString("revision").equals(current.getString("revision"))) {
                            refreshGeneration++; previous = detachRelayLocked(); clearTokens(selected); save(draft); error = "官方登录已失效，请重新登录。";
                        }
                    }
                } finally { disconnectRelay(previous); }
                emit(); throw failure;
            }
        }
    }
    private static void clearTokens(JSONObject profile) throws Exception { profile.put("accessToken", "").put("refreshToken", "").put("idToken", "").put("expiresAt", 0).put("scopes", new JSONArray()).put("revision", UUID.randomUUID().toString()); }
    JSONObject cancelLocal(String scopeId) throws Exception { checkScope(scopeId); synchronized (gate) { checkScope(scopeId); if (attempt != null) attempt.close(); attempt = null; returnNavigation = null; callbackReceipt = null; error = ""; } emit(); return status(); }
    JSONObject select(String id) throws Exception {
        Scope value = required(); PetOfficialAccountPolicy.uuid(id); Relay previous = null;
        try {
            synchronized (gate) {
                assertCurrent(value); JSONObject draft = new JSONObject(vault.toString()), user = user(value, draft); boolean found = false; JSONArray profiles = user.getJSONArray("profiles");
                for (int i = 0; i < profiles.length(); i++) if (id.equals(profiles.getJSONObject(i).optString("id"))) { profiles.getJSONObject(i).put("revision", UUID.randomUUID().toString()); found = true; }
                if (!found) throw failure();
                refreshGeneration++; previous = detachRelayLocked(); if (attempt != null) attempt.close(); attempt = null; returnNavigation = null; callbackReceipt = null;
                user.put("activeProfileId", id).put("usage", emptyUsage()); save(draft); error = "";
            }
        } finally { disconnectRelay(previous); }
        try { refreshModels(value); } catch (Exception failure) { modelsFailed(value, failure); } emit(); return status();
    }
    JSONObject logout() throws Exception {
        Scope value = required(); JSONObject previous; Relay oldRelay = null;
        try {
            synchronized (gate) {
                assertCurrent(value); previous = active(value); refreshGeneration++; oldRelay = detachRelayLocked(); if (attempt != null) attempt.close(); attempt = null; returnNavigation = null; callbackReceipt = null;
                JSONObject draft = new JSONObject(vault.toString()), profile = profile(value, draft); if (profile != null) clearTokens(profile); user(value, draft).put("usage", emptyUsage()); save(draft); error = "";
            }
        } finally { disconnectRelay(oldRelay); }
        if (previous != null && !previous.optString("refreshToken").isEmpty()) try { form(REVOKE, map("token", previous.getString("refreshToken"), "token_type_hint", "refresh_token", "client_id", previous.getString("clientId")), value); } catch (Exception failure) { synchronized (gate) { if (scope == value) error = "已退出手机账号，官方会话撤销未确认，可在 ChatGPT 设置断开此应用。"; } }
        emit(); return status();
    }
    JSONObject refresh() throws Exception { Scope value = required(); try { refreshModels(value); } catch (Exception failure) { modelsFailed(value, failure); } return status(); }
    JSONObject resumeUsage() throws Exception { Scope value = required(); synchronized (gate) { JSONObject draft = new JSONObject(vault.toString()), usage = user(value, draft).optJSONObject("usage"); if (usage == null) usage = emptyUsage(); usage.put("state", "unverified"); user(value, draft).put("usage", usage); save(draft); } try { refreshModels(value); } catch (Exception failure) { modelsFailed(value, failure); } return status(); }
    private void modelsFailed(Scope value, Exception failure) { synchronized (gate) { if (scope != value || failure instanceof SupersededRefresh) return; modelsError = "暂时无法读取官方模型或登记手机连接；请更新小伴服务并检查网络。"; } emit(); }
    private JSONArray directory(JSONObject data) throws Exception {
        JSONArray source = data.getJSONArray("models"), out = new JSONArray(); if (source.length() > 4096) throw failure(); Set<String> slugs = new HashSet<>();
        for (int i = 0; i < source.length() && out.length() < 256; i++) { JSONObject item = source.optJSONObject(i); if (item == null) continue; String slug = item.optString("slug"); if (!"list".equals(item.optString("visibility")) || item.optBoolean("hidden") || !slug.matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,159}") || !slugs.add(slug)) continue; String display = item.optString("display_name", slug); try { PetOfficialAccountPolicy.text(display, 160, true); } catch (Exception ignored) { display = slug; } JSONArray modalities = item.optJSONArray("input_modalities"); if (modalities == null) modalities = item.optJSONArray("inputModalities"); boolean images = false; if (modalities != null) for (int j = 0; j < modalities.length(); j++) if ("image".equals(modalities.optString(j))) images = true; out.put(new JSONObject().put("model", slug).put("displayName", display).put("supportsImages", images)); }
        return out;
    }
    private void refreshModels(Scope value) throws Exception {
        final long refresh;
        synchronized (gate) { assertCurrent(value); refresh = ++refreshGeneration; }
        JSONObject credentials = null; String candidate = null;
        try {
            credentials = access(value, false); assertRefresh(value, refresh, credentials); JSONObject response;
            try { response = json(URI.create(MODELS), credentials.getString("accessToken"), null, null, 15000, true, value, true); }
            catch (AuthFailure expired) { assertRefresh(value, refresh, credentials); credentials = access(value, true); assertRefresh(value, refresh, credentials); response = json(URI.create(MODELS), credentials.getString("accessToken"), null, null, 15000, true, value, true); }
            assertRefresh(value, refresh, credentials); JSONArray available = directory(response); String revision = credentials.getString("revision");
            // Serialize registrations: an older server request must finish before
            // its successor can register and replace this device's relay.
            synchronized (registrationGate) {
                synchronized (gate) { assertRefresh(value, refresh, credentials); if (relay != null && !relay.stopped && relay.revision.equals(revision) && sameDirectory(models, available)) { modelsError = ""; return; } }
                revokeRelay(); verify(value); assertRefresh(value, refresh, credentials);
                JSONObject registered = backend(value, "/api/mobile-official/connect", new JSONObject().put("deviceId", vault.getString("deviceId")).put("revision", revision).put("models", available), 15000, false);
                candidate = PetOfficialAccountPolicy.text(registered.getString("relayId"), 160, false); if (!candidate.matches("[A-Za-z0-9_-]+")) { candidate = null; throw failure(); }
                assertRefresh(value, refresh, credentials);
                JSONArray ids = registered.getJSONArray("models"); if (ids.length() != available.length()) throw failure();
                Set<String> received = new HashSet<>(); for (int i = 0; i < ids.length(); i++) { JSONObject item = ids.getJSONObject(i); PetOfficialAccountPolicy.id(item.getString("id")); boolean known = false; for (int j = 0; j < available.length(); j++) if (available.getJSONObject(j).getString("model").equals(item.getString("model"))) known = true; if (!known || !received.add(item.getString("model"))) throw failure(); PetOfficialAccountPolicy.text(item.getString("displayName"), 320, true); if (!(item.get("supportsImages") instanceof Boolean)) throw failure(); }
                Relay next = new Relay(value, candidate, revision);
                synchronized (gate) { assertRefresh(value, refresh, credentials); models = new JSONArray(ids.toString()); modelsError = ""; relay = next; candidate = null; }
                new Thread(() -> poll(next), "petpal-official-relay").start(); emit();
            }
        } catch (Exception failure) {
            assertRefresh(value, refresh, credentials); throw failure;
        } finally { if (candidate != null) disconnectRelay(new Relay(value, candidate, "")); }
    }
    private void assertRefresh(Scope value, long refresh, JSONObject credentials) throws Exception {
        synchronized (gate) {
            assertCurrent(value); if (refreshGeneration != refresh) throw new SupersededRefresh();
            if (credentials != null) {
                JSONObject selected = profile(value, vault);
                if (!signedIn(selected) || !plan(selected) || !selected.getString("id").equals(credentials.getString("id")) || !selected.getString("revision").equals(credentials.getString("revision"))) throw new SupersededRefresh();
            }
        }
    }
    private static boolean sameDirectory(JSONArray registered, JSONArray available) throws Exception { if (registered.length() != available.length()) return false; for (int i = 0; i < available.length(); i++) { JSONObject a = available.getJSONObject(i), b = registered.getJSONObject(i); if (!a.getString("model").equals(b.getString("model")) || !a.getString("displayName").equals(b.getString("displayName")) || a.getBoolean("supportsImages") != b.getBoolean("supportsImages")) return false; } return true; }
    private void poll(Relay value) {
        try {
            while (true) {
                assertRelay(value); JSONObject response = backend(value.scope, "/api/mobile-official/" + value.id + "/poll", null, 35000, true); assertRelay(value); JSONArray commands = response.getJSONArray("commands"); if (commands.length() > 32) throw failure();
                for (int i = 0; i < commands.length(); i++) { JSONObject command = commands.getJSONObject(i); String id = PetOfficialAccountPolicy.id(command.getString("id")); if ("cancel".equals(command.optString("type"))) { Running found = running.get(id); if (found != null && found.relay == value) found.cancel(); continue; } if (!"request".equals(command.optString("type")) || running.size() >= 4 || running.containsKey(id)) throw failure(); JSONObject body = command.getJSONObject("body"); if (body.toString().getBytes(StandardCharsets.UTF_8).length > MAX_REQUEST) throw failure(); Running request = new Running(value, id); running.put(id, request); requests.execute(() -> infer(request, body)); }
            }
        } catch (Exception failure) { synchronized (gate) { if (relay == value) { modelsError = "手机官方模型已离线，请刷新官方账号重新连接。"; models = new JSONArray(); relay = null; } } stopRelay(value); emit(); }
    }
    private void check(Running request) throws Exception { assertRelay(request.relay); if (request.cancelled) throw failure(); }
    private void reply(Running request, JSONObject data) throws Exception { check(request); data.put("id", request.id).put("sequence", request.sequence); backend(request.relay.scope, "/api/mobile-official/" + request.relay.id + "/reply", data, 15000, true); check(request); request.sequence++; }
    private void send(Running request, String text) throws Exception { while (!text.isEmpty()) { if (request.timedOut || System.nanoTime() >= request.deadline) throw failure(); int end = PetOfficialAccountPolicy.utf8Boundary(text, MAX_CHUNK); if (end == 0) throw failure(); JSONObject message = new JSONObject().put("chunk", text.substring(0, end)); if (request.sequence == 0) message.put("status", 200); reply(request, message); text = text.substring(end); } }
    private void infer(Running request, JSONObject input) {
        HttpURLConnection connection = null;
        ScheduledFuture<?> timeout = null;
        try {
            timeout = clock.schedule(() -> { request.timedOut = true; HttpURLConnection active = request.connection; if (active != null) active.disconnect(); }, Math.max(0, request.deadline - System.nanoTime()), TimeUnit.NANOSECONDS);
            check(request); JSONObject credentials = access(request.relay.scope, false); check(request); if (!request.relay.revision.equals(credentials.getString("revision"))) throw failure(); String model = PetOfficialAccountPolicy.text(input.getString("model"), 200, false); boolean known = false; synchronized (gate) { for (int i = 0; i < models.length(); i++) if (model.equals(models.getJSONObject(i).getString("model"))) known = true; } if (!known) throw failure();
            JSONObject body = new JSONObject(input.toString()); body.put("store", false).put("stream", true); byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8); if (bytes.length > MAX_REQUEST) throw failure();
            connection = open(URI.create(RESPONSES), true); request.connection = connection; connections.put(connection, request.relay.scope); check(request); if (request.timedOut || System.nanoTime() >= request.deadline) throw failure(); connection.setReadTimeout(600000); connection.setRequestMethod("POST"); connection.setRequestProperty("Authorization", "Bearer " + credentials.getString("accessToken")); connection.setRequestProperty("Accept", "text/event-stream"); connection.setRequestProperty("Content-Type", "application/json"); connection.setDoOutput(true); connection.setFixedLengthStreamingMode(bytes.length); try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
            int status = connection.getResponseCode(); if (status != 200) { if (status == 401) expireAccess(request, credentials); observeFailure(request, status, connection.getErrorStream()); throw failure(); } String mime = connection.getContentType(); if (mime != null && !mime.trim().isEmpty() && !mime.toLowerCase(java.util.Locale.ROOT).startsWith("text/event-stream")) throw failure();
            boolean completed = false, terminal = false; StringBuilder frame = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)))) {
                for (String line; (line = line(reader, MAX_JSON)) != null;) {
                    check(request); if (request.timedOut || System.nanoTime() >= request.deadline) throw failure(); frame.append(line).append('\n'); if (frame.length() > MAX_JSON) throw failure();
                    if (!line.isEmpty()) continue; String raw = frame.toString(); frame.setLength(0); if (raw.getBytes(StandardCharsets.UTF_8).length > MAX_JSON) throw failure(); StringBuilder data = new StringBuilder(); String event = ""; for (String row : raw.split("\n")) { if (row.startsWith("data:")) { if (data.length() > 0) data.append('\n'); data.append(row.substring(5).replaceFirst("^ ", "")); } else if (row.startsWith("event:")) event = row.substring(6).trim(); }
                    if (data.length() == 0) { if (!terminal) send(request, ": ping\n\n"); continue; } if (terminal) throw failure(); JSONObject parsed = new JSONObject(data.toString()); String type = parsed.optString("type", event); if (!type.matches("(?:response\\.[A-Za-z][A-Za-z0-9_.]*|error|ping)") || !event.isEmpty() && !event.equals(type)) throw failure();
                    if ("error".equals(type) || "response.failed".equals(type) || "response.incomplete".equals(type) || "response.error".equals(type) || parsed.has("error") && !parsed.isNull("error") || parsed.optJSONObject("response") != null && parsed.getJSONObject("response").has("error") && !parsed.getJSONObject("response").isNull("error")) { observeFailure(request, 0, parsed); throw failure(); }
                    if ("response.completed".equals(type)) { JSONObject response = parsed.getJSONObject("response"); if (!"completed".equals(response.optString("status"))) throw failure(); completed = true; terminal = true; observeCompleted(request, model, response.optJSONObject("usage")); }
                    String filtered = "event: " + type + "\ndata: " + parsed + "\n\n"; for (String name : new String[] {"accessToken", "refreshToken", "idToken"}) { String secret = credentials.optString(name); if (!secret.isEmpty()) filtered = filtered.replace(secret, "[redacted]"); } send(request, filtered);
                    if (terminal) break;
                }
            }
            if (!completed || request.timedOut || System.nanoTime() >= request.deadline) throw failure(); reply(request, new JSONObject().put("done", true)); emit();
        } catch (Exception failure) { try { if (!request.cancelled) reply(request, new JSONObject().put("error", "手机官方模型请求未完成。")); } catch (Exception ignored) { } }
        finally { if (timeout != null) timeout.cancel(false); if (connection != null) { connections.remove(connection); connection.disconnect(); } running.remove(request.id, request); request.connection = null; }
    }
    private void observeCompleted(Running request, String model, JSONObject counts) throws Exception {
        check(request); synchronized (gate) { assertRelay(request.relay); JSONObject draft = new JSONObject(vault.toString()), user = user(request.relay.scope, draft), usage = user.optJSONObject("usage"); if (usage == null) usage = emptyUsage(); usage.put("state", "available").put("checkedAt", stamp()).put("lastModel", model).put("completedRequests", PetOfficialAccountPolicy.add(usage.optLong("completedRequests"), 1)); String[][] names = {{"inputTokens", "input_tokens"}, {"outputTokens", "output_tokens"}, {"totalTokens", "total_tokens"}}; for (String[] name : names) usage.put(name[0], PetOfficialAccountPolicy.add(usage.optLong(name[0]), counts == null ? 0 : PetOfficialAccountPolicy.count(counts.opt(name[1])))); user.put("usage", usage); save(draft); }
    }
    /** Never replay inference. Only a later explicit request may refresh auth. */
    private void expireAccess(Running request, JSONObject credentials) throws Exception {
        check(request); synchronized (gate) { assertRelay(request.relay); JSONObject draft = new JSONObject(vault.toString()), profile = profile(request.relay.scope, draft); if (profile != null && profile.getString("id").equals(credentials.getString("id")) && profile.getString("revision").equals(credentials.getString("revision")) && PetOfficialAccountPolicy.equal(profile.optString("accessToken"), credentials.getString("accessToken"))) { profile.put("accessToken", "").put("expiresAt", 0); save(draft); } }
    }
    private void observeFailure(Running request, int status, InputStream input) { try { observeFailure(request, status, input == null ? new JSONObject() : new JSONObject(new String(bytes(input, 65536), StandardCharsets.UTF_8))); } catch (Exception ignored) { } }
    private void observeFailure(Running request, int status, JSONObject data) throws Exception {
        JSONObject error = data.optJSONObject("error"); if (error == null && data.optJSONObject("response") != null) error = data.getJSONObject("response").optJSONObject("error"); String code = error == null ? "" : error.optString("code"), state = "";
        if ("subscription_sharing_usage_limit_exceeded".equals(code)) state = "limit-reached"; else if ("subscription_sharing_user_not_eligible".equals(code)) state = "not-eligible"; else if ("subscription_sharing_usage_unavailable".equals(code) || "subscription_sharing_user_unavailable".equals(code)) state = "temporarily-unavailable";
        if (!state.isEmpty()) { synchronized (gate) { assertRelay(request.relay); JSONObject draft = new JSONObject(vault.toString()), usage = user(request.relay.scope, draft).getJSONObject("usage"); usage.put("state", state).put("checkedAt", stamp()); save(draft); } emit(); }
    }
    private void stopRelay(Relay previous) { if (previous == null) return; previous.stopped = true; HttpURLConnection poll = previous.poll; if (poll != null) poll.disconnect(); for (Running request : running.values()) if (request.relay == previous) request.cancel(); }
    private Relay detachRelayLocked() { Relay previous = relay; relay = null; models = new JSONArray(); modelsError = ""; return previous; }
    private void disconnectRelay(Relay previous) {
        stopRelay(previous);
        if (previous != null) { Thread worker = new Thread(() -> { try { backend(previous.scope, "/api/mobile-official/" + previous.id + "/disconnect", new JSONObject(), 5000, false); } catch (Exception ignored) { } }, "petpal-official-disconnect"); worker.setDaemon(true); worker.start(); }
    }
    private void revokeRelay() { Relay previous; synchronized (gate) { previous = detachRelayLocked(); } disconnectRelay(previous); }
    private Relay clearScopeLocked() { generation++; refreshGeneration++; scope = null; if (attempt != null) attempt.close(); attempt = null; returnNavigation = null; callbackReceipt = null; retryClients.clear(); error = ""; return detachRelayLocked(); }
    void clearScope() { clearScope(null); }
    private void clearScope(Scope expected) {
        final Relay previous; final long cancelledBefore;
        synchronized (gate) { if (expected != null && (scope != expected || expected.generation != generation)) return; bindingGeneration++; previous = clearScopeLocked(); cancelledBefore = generation; }
        disconnectRelay(previous);
        for (Map.Entry<HttpURLConnection, Scope> entry : connections.entrySet()) if (entry.getValue().generation < cancelledBefore) entry.getKey().disconnect();
        emit();
    }
    @Override public void close() { synchronized (gate) { closed = true; } clearScope(); callbacks.shutdownNow(); requests.shutdownNow(); clock.shutdownNow(); }
}
