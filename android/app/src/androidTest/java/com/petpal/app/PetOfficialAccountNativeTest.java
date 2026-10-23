package com.petpal.app;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.ContextWrapper;
import android.util.Base64;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Proxy;
import java.net.Socket;
import java.net.URI;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.interfaces.RSAPublicKey;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Real Android Keystore/loopback, fake official and relay HTTP. No real login. */
@RunWith(AndroidJUnit4.class)
public class PetOfficialAccountNativeTest {
    interface Check { boolean ready() throws Exception; }
    private static void until(Check check) throws Exception { long end = System.currentTimeMillis() + 10000; do { if (check.ready()) return; Thread.sleep(20); } while (System.currentTimeMillis() < end); fail("Native fixture did not reach the expected state"); }
    private static String b64(byte[] bytes) { return Base64.encodeToString(bytes, Base64.NO_WRAP | Base64.NO_PADDING | Base64.URL_SAFE); }
    private static Map<String, String> fields(String input) throws Exception { Map<String, String> out = new HashMap<>(); for (String part : input.split("&")) { String[] pair = part.split("=", 2); out.put(URLDecoder.decode(pair[0], "UTF-8"), pair.length > 1 ? URLDecoder.decode(pair[1], "UTF-8") : ""); } return out; }
    private static byte[] bytes(InputStream input) throws Exception { ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] data = new byte[4096]; for (int count; (count = input.read(data)) != -1;) out.write(data, 0, count); return out.toByteArray(); }

    static final class Fixture implements AutoCloseable {
        final File directory;
        final Context context;
        final KeyPair rsa;
        final BlockingQueue<JSONObject> commands = new LinkedBlockingQueue<>();
        final CopyOnWriteArrayList<JSONObject> replies = new CopyOnWriteArrayList<>();
        final CopyOnWriteArrayList<JSONObject> inferenceBodies = new CopyOnWriteArrayList<>();
        final CopyOnWriteArrayList<Map<String, String>> grants = new CopyOnWriteArrayList<>();
        final CountDownLatch tokenEntered = new CountDownLatch(1), tokenContinue = new CountDownLatch(1), tokenPrepared = new CountDownLatch(1);
        final CountDownLatch modelsEntered = new CountDownLatch(1), modelsContinue = new CountDownLatch(1), connectEntered = new CountDownLatch(1), connectContinue = new CountDownLatch(1), verifyEntered = new CountDownLatch(1), verifyContinue = new CountDownLatch(1);
        final AtomicInteger modelCalls = new AtomicInteger(), connectCalls = new AtomicInteger(), verifyCalls = new AtomicInteger();
        final CopyOnWriteArrayList<String> disconnectedRelays = new CopyOnWriteArrayList<>();
        final Object relayServerGate = new Object();
        volatile int blockModelsAt = -1, blockConnectAt = -1, blockVerifyAt = -1;
        volatile int unauthorizedVerifyAt = -1, unauthorizedModelsAt = -1;
        volatile String modelDisplay = "GPT 6 Luna", activeRelay = "";
        volatile String authorize, user = "native-user", endpoint = "https://fixture.invalid", responseMode = "complete", badClaim = "";
        volatile String callbackBody = "";
        volatile Map<String, String> callbackHeaders = new HashMap<>();
        volatile boolean invalidGrant, blockToken, shortExpiry;
        volatile int refreshes, revoked, disconnected;
        final PetOfficialAccountRuntime runtime;
        Fixture() throws Exception {
            Context app = InstrumentationRegistry.getInstrumentation().getTargetContext(); directory = new File(app.getCacheDir(), "official-fixture-" + UUID.randomUUID()); assertTrue(directory.mkdirs());
            context = new ContextWrapper(app) { @Override public Context getApplicationContext() { return this; } @Override public File getNoBackupFilesDir() { return directory; } };
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA"); generator.initialize(2048); rsa = generator.generateKeyPair();
            runtime = create();
        }
        PetOfficialAccountRuntime create() { return new PetOfficialAccountRuntime(context, url -> authorize = url, () -> {}) { @Override protected HttpURLConnection open(URI uri, boolean official) throws Exception { return new Fake(uri); } }; }
        JSONObject binding() throws Exception { return new JSONObject().put("url", endpoint).put("token", "synthetic-petpal-session").put("instanceId", "native-instance").put("userId", user); }
        String bind() throws Exception { return runtime.bind(binding()).getString("scopeId"); }
        Map<String, String> auth() throws Exception { return fields(new URI(authorize).getRawQuery()); }
        String callbackUrl(String state, String client) throws Exception { return auth().get("redirect_uri") + "?state=" + URLEncoder.encode(state, "UTF-8") + "&code=synthetic-code&client_id=" + URLEncoder.encode(client, "UTF-8"); }
        int callback(String state, String client) throws Exception {
            String address = callbackUrl(state, client); HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection(Proxy.NO_PROXY); connection.setConnectTimeout(5000); connection.setReadTimeout(5000);
            try {
                int status = connection.getResponseCode(); Map<String, String> headers = new HashMap<>();
                for (String name : new String[] { "Content-Type", "Cache-Control", "Referrer-Policy", "Content-Security-Policy", "X-Content-Type-Options" }) headers.put(name, connection.getHeaderField(name));
                callbackHeaders = headers;
                try (InputStream input = status == 200 ? connection.getInputStream() : connection.getErrorStream()) { callbackBody = input == null ? "" : new String(bytes(input), StandardCharsets.UTF_8); }
                return status;
            } finally { connection.disconnect(); }
        }
        String returnUri() {
            Matcher link = Pattern.compile("petpal://official-account/return\\?ticket=[A-Za-z0-9_-]{43}").matcher(callbackBody);
            assertTrue("Successful callback must contain a navigation-only return link", link.find());
            String uri = link.group(); assertEquals(43, OfficialReturnPolicy.parse(uri).length()); return uri;
        }
        void assertSafeReturnPage() throws Exception {
            assertEquals("text/html; charset=utf-8", callbackHeaders.get("Content-Type"));
            assertEquals("no-store", callbackHeaders.get("Cache-Control")); assertEquals("no-referrer", callbackHeaders.get("Referrer-Policy")); assertEquals("nosniff", callbackHeaders.get("X-Content-Type-Options"));
            String csp = callbackHeaders.get("Content-Security-Policy"); assertNotNull(csp); Matcher nonce = Pattern.compile("script-src 'nonce-([A-Za-z0-9_-]{43})'").matcher(csp); assertTrue(nonce.find());
            assertTrue(callbackBody.contains("<script nonce=\"" + nonce.group(1) + "\"")); assertTrue(callbackBody.contains("<style nonce=\"" + nonce.group(1) + "\""));
            assertTrue(callbackBody.contains("正在验证")); assertTrue(callbackBody.contains("package=com.petpal.app;end"));
            for (String secret : new String[] { "synthetic-code", auth().get("state"), auth().get("nonce"), "synthetic-access", "synthetic-refresh", "synthetic-petpal-session", "code=", "state=", "code_verifier=", "client_id=" }) assertFalse("Return page leaked an OAuth field or credential", callbackBody.contains(secret));
        }
        void login() throws Exception { runtime.start(null); assertEquals(200, callback(auth().get("state"), "fixture-issued-client")); until(() -> runtime.status().getJSONArray("models").length() == 1); }
        String jwt() throws Exception {
            Map<String, String> auth = auth(); JSONObject claims = new JSONObject().put("iss", "issuer".equals(badClaim) ? "https://wrong.invalid" : "https://auth.openai.com").put("aud", "audience".equals(badClaim) ? "wrong-client" : "fixture-issued-client").put("sub", "synthetic-subject").put("email", "fixture@example.invalid").put("exp", System.currentTimeMillis() / 1000 + ("expired".equals(badClaim) ? -60 : 3600)).put("nonce", "nonce".equals(badClaim) ? "wrong-nonce" : auth.get("nonce"));
            if ("nbf".equals(badClaim)) claims.put("nbf", System.currentTimeMillis() / 1000 + 3600);
            String head = b64(new JSONObject().put("alg", "RS256").put("kid", "fixture-key").toString().getBytes(StandardCharsets.UTF_8)), body = b64(claims.toString().getBytes(StandardCharsets.UTF_8)); Signature signer = Signature.getInstance("SHA256withRSA"); signer.initSign(rsa.getPrivate()); signer.update((head + "." + body).getBytes(StandardCharsets.US_ASCII)); byte[] signature = signer.sign(); if ("signature".equals(badClaim)) signature[0] ^= 1; return head + "." + body + "." + b64(signature);
        }
        JSONObject tokens(boolean refreshed) throws Exception { return new JSONObject().put("access_token", refreshed ? "synthetic-refreshed-access" : "synthetic-access").put("refresh_token", "synthetic-refresh").put("id_token", jwt()).put("token_type", "Bearer").put("expires_in", shortExpiry && !refreshed ? 1 : 3600).put("scope", "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"); }
        void request(String id) throws Exception { commands.put(new JSONObject().put("type", "request").put("id", id).put("body", new JSONObject().put("model", "gpt-6-luna").put("store", true).put("stream", false).put("input", new JSONArray().put(new JSONObject().put("role", "user").put("content", "synthetic message"))))); }
        boolean reply(String id, String field) { for (JSONObject item : replies) if (id.equals(item.optString("id")) && item.has(field)) return true; return false; }
        final class Fake extends HttpURLConnection {
            final URI uri; final ByteArrayOutputStream posted = new ByteArrayOutputStream(); byte[] response; boolean connected, cancelled;
            Fake(URI uri) throws Exception { super(uri.toURL()); this.uri = uri; }
            private void prepare() throws IOException {
                if (connected) return; connected = true;
                try {
                    JSONObject json = new JSONObject(); String path = uri.getPath(); responseCode = 200;
                    if (path.equals("/api/auth/me")) { int call = verifyCalls.incrementAndGet(); if (call == blockVerifyAt) { verifyEntered.countDown(); if (!verifyContinue.await(10, TimeUnit.SECONDS)) throw new IOException(); } if (call == unauthorizedVerifyAt) responseCode = 401; json.put("instanceId", "native-instance").put("user", new JSONObject().put("id", user)); }
                    else if (path.endsWith("/oauth/token")) {
                        Map<String, String> grant = fields(posted.toString("UTF-8")); grants.add(grant);
                        if (blockToken) { tokenEntered.countDown(); if (!tokenContinue.await(10, TimeUnit.SECONDS)) throw new IOException(); }
                        if (cancelled) throw new IOException();
                        if (invalidGrant) { invalidGrant = false; responseCode = 400; json.put("error", "invalid_grant"); }
                        else { boolean refreshing = "refresh_token".equals(grant.get("grant_type")); if (refreshing) refreshes++; else assertEquals(auth().get("code_challenge"), b64(MessageDigest.getInstance("SHA-256").digest(grant.get("code_verifier").getBytes(StandardCharsets.US_ASCII)))); json = tokens(refreshing); }
                        tokenPrepared.countDown();
                    } else if (path.endsWith("/oauth/revoke")) revoked++;
                    else if (path.equals("/.well-known/jwks.json")) { RSAPublicKey key = (RSAPublicKey) rsa.getPublic(); json.put("keys", new JSONArray().put(new JSONObject().put("kid", "fixture-key").put("kty", "RSA").put("alg", "RS256").put("use", "sig").put("n", b64(unsigned(key.getModulus().toByteArray()))).put("e", b64(unsigned(key.getPublicExponent().toByteArray()))))); }
                    else if (path.equals("/v1/models")) { String display = modelDisplay; int call = modelCalls.incrementAndGet(); if (call == blockModelsAt) { modelsEntered.countDown(); if (!modelsContinue.await(10, TimeUnit.SECONDS)) throw new IOException(); } if (call == unauthorizedModelsAt) responseCode = 401; assertTrue(getRequestProperty("Authorization").startsWith("Bearer synthetic-")); json.put("models", new JSONArray().put(new JSONObject().put("slug", "gpt-6-luna").put("visibility", "list").put("display_name", display).put("input_modalities", new JSONArray().put("text").put("image")))); }
                    else if (path.equals("/api/mobile-official/connect")) { int call = connectCalls.incrementAndGet(); if (call == blockConnectAt) { connectEntered.countDown(); if (!connectContinue.await(10, TimeUnit.SECONDS)) throw new IOException(); } JSONObject body = new JSONObject(posted.toString("UTF-8")); JSONArray available = body.getJSONArray("models"), out = new JSONArray(); for (int i = 0; i < available.length(); i++) out.put(new JSONObject(available.getJSONObject(i).toString()).put("id", "fixture-provider")); String id = "fixture_relay_" + call; synchronized (relayServerGate) { activeRelay = id; } json.put("relayId", id).put("models", out).put("pollMs", 25000); }
                    else if (path.endsWith("/poll")) { JSONObject command = commands.poll(200, TimeUnit.MILLISECONDS); if (cancelled) throw new IOException(); json.put("commands", command == null ? new JSONArray() : new JSONArray().put(command)); }
                    else if (path.endsWith("/reply")) replies.add(new JSONObject(posted.toString("UTF-8")));
                    else if (path.endsWith("/disconnect")) { String id = path.split("/")[3]; disconnectedRelays.add(id); synchronized (relayServerGate) { if (id.equals(activeRelay)) activeRelay = ""; } disconnected++; }
                    else if (path.equals("/v1/responses")) { inferenceBodies.add(new JSONObject(posted.toString("UTF-8"))); if ("unauthorized".equals(responseMode)) { responseCode = 401; response = "{\"error\":{\"code\":\"invalid_api_key\"}}".getBytes(StandardCharsets.UTF_8); return; } if ("blocked".equals(responseMode)) { while (!cancelled) Thread.sleep(20); throw new IOException(); } String delta = "large".equals(responseMode) ? "中文🧡".repeat(12000) + "synthetic-access" : "hello synthetic-access"; String stream = "event: response.output_text.delta\ndata: " + new JSONObject().put("type", "response.output_text.delta").put("delta", delta) + "\n\n"; if ("complete".equals(responseMode) || "large".equals(responseMode)) stream += "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"usage\":{\"input_tokens\":3,\"output_tokens\":5,\"total_tokens\":8}}}\n\n"; response = stream.getBytes(StandardCharsets.UTF_8); return; }
                    else throw new IOException("Unexpected synthetic route");
                    response = json.toString().getBytes(StandardCharsets.UTF_8);
                } catch (Exception error) { throw new IOException("Synthetic fixture request failed", error); }
            }
            @Override public void connect() throws IOException { prepare(); }
            @Override public int getResponseCode() throws IOException { prepare(); return responseCode; }
            @Override public long getContentLengthLong() { return -1; }
            @Override public String getContentType() { return uri.getPath().equals("/v1/responses") ? "text/event-stream" : "application/json"; }
            @Override public OutputStream getOutputStream() { return posted; }
            @Override public InputStream getInputStream() throws IOException { prepare(); if (cancelled) throw new IOException(); return new ByteArrayInputStream(response); }
            @Override public InputStream getErrorStream() { try { prepare(); return new ByteArrayInputStream(response); } catch (Exception failure) { return null; } }
            @Override public void disconnect() { cancelled = true; }
            @Override public boolean usingProxy() { return false; }
        }
        @Override public void close() { tokenContinue.countDown(); modelsContinue.countDown(); connectContinue.countDown(); verifyContinue.countDown(); runtime.close(); }
    }
    private static byte[] unsigned(byte[] value) { return value.length > 1 && value[0] == 0 ? java.util.Arrays.copyOfRange(value, 1, value.length) : value; }

    @Test public void lateModelDirectoryAfterLogoutCannotReconnectOrPublishAnError() throws Exception {
        try (Fixture fixture = new Fixture()) {
            fixture.bind(); fixture.login(); int before = fixture.connectCalls.get(); fixture.blockModelsAt = fixture.modelCalls.get() + 1;
            ExecutorService workers = Executors.newSingleThreadExecutor();
            try {
                Future<?> old = workers.submit(() -> { try { fixture.runtime.refresh(); } catch (Exception error) { throw new RuntimeException(error); } });
                assertTrue(fixture.modelsEntered.await(5, TimeUnit.SECONDS)); fixture.runtime.logout(); fixture.modelsContinue.countDown(); old.get(10, TimeUnit.SECONDS);
                JSONObject status = fixture.runtime.status(); assertEquals("signed-out", status.getString("state")); assertFalse(status.getBoolean("relayConnected")); assertEquals(0, status.getJSONArray("models").length());
                assertEquals(before, fixture.connectCalls.get()); assertFalse(status.has("modelsError"));
            } finally { fixture.modelsContinue.countDown(); workers.shutdownNow(); }
        }
    }

    @Test public void selectedProfileRevisionWinsOverALateOldModelDirectory() throws Exception {
        try (Fixture fixture = new Fixture()) {
            fixture.bind(); fixture.login(); String profile = fixture.runtime.status().getString("activeProfileId"); fixture.blockModelsAt = fixture.modelCalls.get() + 1;
            ExecutorService workers = Executors.newSingleThreadExecutor();
            try {
                Future<?> old = workers.submit(() -> { try { fixture.runtime.refresh(); } catch (Exception error) { throw new RuntimeException(error); } });
                assertTrue(fixture.modelsEntered.await(5, TimeUnit.SECONDS)); fixture.modelDisplay = "Latest selected profile"; fixture.runtime.select(profile);
                fixture.modelsContinue.countDown(); old.get(10, TimeUnit.SECONDS);
                JSONObject status = fixture.runtime.status(); assertTrue(status.getBoolean("relayConnected")); assertEquals("Latest selected profile", status.getJSONArray("models").getJSONObject(0).getString("displayName")); assertFalse(status.has("modelsError"));
            } finally { fixture.modelsContinue.countDown(); workers.shutdownNow(); }
        }
    }

    @Test public void aRelayRegistrationReturningAfterLogoutIsDisposedWithoutPublishing() throws Exception {
        try (Fixture fixture = new Fixture()) {
            fixture.bind(); fixture.login(); fixture.modelDisplay = "Force a new registration"; fixture.blockConnectAt = fixture.connectCalls.get() + 1;
            ExecutorService workers = Executors.newSingleThreadExecutor();
            try {
                Future<?> old = workers.submit(() -> { try { fixture.runtime.refresh(); } catch (Exception error) { throw new RuntimeException(error); } });
                assertTrue(fixture.connectEntered.await(5, TimeUnit.SECONDS)); fixture.runtime.logout(); fixture.connectContinue.countDown(); old.get(10, TimeUnit.SECONDS);
                String stale = "fixture_relay_" + fixture.blockConnectAt; until(() -> fixture.disconnectedRelays.contains(stale));
                assertFalse(fixture.runtime.status().getBoolean("relayConnected")); assertEquals(0, fixture.runtime.status().getJSONArray("models").length()); assertEquals("", fixture.activeRelay);
            } finally { fixture.connectContinue.countDown(); workers.shutdownNow(); }
        }
    }

    @Test public void overlappingRefreshRegistrationsRemainOrderedAndOnlyTheNewestDirectoryWins() throws Exception {
        try (Fixture fixture = new Fixture()) {
            fixture.bind(); fixture.login(); fixture.modelDisplay = "Older directory"; fixture.blockConnectAt = fixture.connectCalls.get() + 1;
            ExecutorService workers = Executors.newFixedThreadPool(2);
            try {
                Future<?> old = workers.submit(() -> { try { fixture.runtime.refresh(); } catch (Exception error) { throw new RuntimeException(error); } });
                assertTrue(fixture.connectEntered.await(5, TimeUnit.SECONDS)); int directoryCalls = fixture.modelCalls.get(); fixture.modelDisplay = "Newest directory";
                Future<?> latest = workers.submit(() -> { try { fixture.runtime.refresh(); } catch (Exception error) { throw new RuntimeException(error); } });
                until(() -> fixture.modelCalls.get() > directoryCalls); assertEquals(fixture.blockConnectAt, fixture.connectCalls.get());
                fixture.connectContinue.countDown(); old.get(10, TimeUnit.SECONDS); latest.get(10, TimeUnit.SECONDS);
                JSONObject status = fixture.runtime.status(); assertTrue(status.getBoolean("relayConnected")); assertEquals("Newest directory", status.getJSONArray("models").getJSONObject(0).getString("displayName")); assertFalse(status.has("modelsError"));
                until(() -> fixture.disconnectedRelays.contains("fixture_relay_" + fixture.blockConnectAt));
                assertEquals("fixture_relay_" + (fixture.blockConnectAt + 1), fixture.activeRelay); assertFalse(fixture.disconnectedRelays.contains(fixture.activeRelay));
            } finally { fixture.connectContinue.countDown(); workers.shutdownNow(); }
        }
    }

    @Test public void aLateInitialBindCannotReplaceTheNewScopeOrItsAuthorizationAttempt() throws Exception {
        try (Fixture fixture = new Fixture()) {
            fixture.blockVerifyAt = 1; ExecutorService workers = Executors.newSingleThreadExecutor();
            try {
                Future<?> old = workers.submit(() -> { try { return fixture.bind(); } catch (Exception error) { throw new RuntimeException(error); } });
                assertTrue(fixture.verifyEntered.await(5, TimeUnit.SECONDS)); String current = fixture.bind(); fixture.runtime.start(null); String attempt = fixture.runtime.pendingAttemptId(); assertNotNull(attempt);
                fixture.verifyContinue.countDown(); assertThrows(java.util.concurrent.ExecutionException.class, () -> old.get(10, TimeUnit.SECONDS));
                fixture.runtime.checkScope(current); assertEquals(attempt, fixture.runtime.pendingAttemptId()); assertEquals("signing-in", fixture.runtime.status().getString("state"));
            } finally { fixture.verifyContinue.countDown(); workers.shutdownNow(); }
        }
    }

    @Test public void anOldRequired401CannotClearTheNewScopeOrAuthorizationAttempt() throws Exception {
        try (Fixture fixture = new Fixture()) {
            fixture.bind(); fixture.blockVerifyAt = fixture.verifyCalls.get() + 1; fixture.unauthorizedVerifyAt = fixture.blockVerifyAt;
            ExecutorService workers = Executors.newSingleThreadExecutor();
            try {
                Future<?> old = workers.submit(() -> { try { return fixture.runtime.refresh(); } catch (Exception error) { throw new RuntimeException(error); } });
                assertTrue(fixture.verifyEntered.await(5, TimeUnit.SECONDS)); fixture.user = "new-synthetic-user"; String current = fixture.bind(); fixture.runtime.start(null); String attempt = fixture.runtime.pendingAttemptId();
                fixture.verifyContinue.countDown(); assertThrows(java.util.concurrent.ExecutionException.class, () -> old.get(10, TimeUnit.SECONDS));
                fixture.runtime.checkScope(current); assertNotNull(attempt); assertEquals(attempt, fixture.runtime.pendingAttemptId());
            } finally { fixture.verifyContinue.countDown(); workers.shutdownNow(); }
        }
    }

    @Test public void lateInvalidGrantCannotClearTheNewlySelectedProfileRevision() throws Exception {
        try (Fixture fixture = new Fixture()) {
            fixture.bind(); fixture.login(); String selected = fixture.runtime.status().getString("activeProfileId");
            fixture.unauthorizedModelsAt = fixture.modelCalls.get() + 1; fixture.blockToken = true; fixture.invalidGrant = true;
            ExecutorService workers = Executors.newFixedThreadPool(2);
            try {
                Future<?> old = workers.submit(() -> { try { return fixture.runtime.refresh(); } catch (Exception error) { throw new RuntimeException(error); } });
                assertTrue(fixture.tokenEntered.await(5, TimeUnit.SECONDS)); fixture.modelDisplay = "Current revision survives";
                Future<?> current = workers.submit(() -> { try { return fixture.runtime.select(selected); } catch (Exception error) { throw new RuntimeException(error); } });
                // select saves its new revision before waiting behind accessGate.
                until(() -> fixture.runtime.status().getJSONArray("models").length() == 0);
                fixture.tokenContinue.countDown(); old.get(10, TimeUnit.SECONDS); current.get(10, TimeUnit.SECONDS);
                JSONObject status = fixture.runtime.status(); assertEquals("signed-in", status.getString("state")); assertTrue(status.getBoolean("relayConnected"));
                assertEquals("Current revision survives", status.getJSONArray("models").getJSONObject(0).getString("displayName")); assertFalse(status.has("modelsError"));
            } finally { fixture.tokenContinue.countDown(); workers.shutdownNow(); }
        }
    }

    @Test public void pkceSignedCallbackRealKeystoreAndNativeRelayComplete() throws Exception {
        try (Fixture fixture = new Fixture()) {
            String scope = fixture.bind(); fixture.runtime.start(null); Map<String, String> auth = fixture.auth(); assertEquals("dynamic_agent_client", auth.get("client_id")); assertTrue(auth.get("ext_agent_host_id").startsWith("urn:uuid:")); assertEquals("S256", auth.get("code_challenge_method")); assertEquals(400, fixture.callback("wrong-state", "fixture-issued-client")); assertEquals("signing-in", fixture.runtime.status().getString("state")); assertEquals(200, fixture.callback(auth.get("state"), "fixture-issued-client")); until(() -> fixture.runtime.status().getJSONArray("models").length() == 1);
            JSONObject status = fixture.runtime.status(); assertEquals("signed-in", status.getString("state")); assertTrue(status.getBoolean("planUsageEnabled")); assertTrue(status.getJSONArray("models").getJSONObject(0).getBoolean("supportsImages")); assertFalse(status.toString().contains("synthetic-access"));
            fixture.request("task-complete"); until(() -> fixture.reply("task-complete", "done")); JSONObject body = fixture.inferenceBodies.get(0); assertFalse(body.getBoolean("store")); assertTrue(body.getBoolean("stream")); JSONObject usage = fixture.runtime.status().getJSONObject("usage"); assertEquals(1, usage.getInt("completedRequests")); assertEquals(8, usage.getInt("totalTokens"));
            for (JSONObject reply : fixture.replies) if (reply.has("chunk")) { assertFalse(reply.getString("chunk").contains("synthetic-access")); assertTrue(reply.getString("chunk").getBytes(StandardCharsets.UTF_8).length <= 48 * 1024); }
            fixture.runtime.resumeUsage(); assertEquals(8, fixture.runtime.status().getJSONObject("usage").getInt("totalTokens")); assertEquals("unverified", fixture.runtime.status().getJSONObject("usage").getString("state"));
            byte[] persisted; try (InputStream input = new java.io.FileInputStream(new File(fixture.directory, "official-account-v1.enc"))) { persisted = bytes(input); } assertFalse(new String(persisted, StandardCharsets.UTF_8).contains("synthetic-refresh"));
            fixture.runtime.close(); try (PetOfficialAccountRuntime reopened = fixture.create()) { JSONObject restored = reopened.bind(fixture.binding()); assertEquals("signed-in", restored.getJSONObject("status").getString("state")); assertEquals(8, restored.getJSONObject("status").getJSONObject("usage").getInt("totalTokens")); reopened.logout(); assertEquals("signed-out", reopened.status().getString("state")); assertTrue(fixture.revoked > 0); }
        }
    }
    @Test public void invalidGrantReusesIssuedClientAndExpiredAccessRefreshes() throws Exception {
        try (Fixture fixture = new Fixture()) {
            fixture.bind(); fixture.invalidGrant = true; fixture.runtime.start(null); fixture.callback(fixture.auth().get("state"), "fixture-issued-client"); until(() -> "signed-out".equals(fixture.runtime.status().getString("state"))); fixture.runtime.start(null); assertEquals("fixture-issued-client", fixture.auth().get("client_id")); assertFalse(fixture.auth().containsKey("agent_name_hint")); fixture.shortExpiry = true; fixture.callback(fixture.auth().get("state"), "fixture-issued-client"); until(() -> fixture.runtime.status().getJSONArray("models").length() == 1); assertEquals(1, fixture.refreshes);
        }
    }
    @Test public void forgedSignatureNonceIssuerAndAudienceAreRejected() throws Exception {
        try (Fixture fixture = new Fixture()) {
            fixture.bind(); for (String failure : new String[] { "signature", "nonce", "issuer", "audience", "expired", "nbf" }) { fixture.badClaim = failure; fixture.runtime.start(null); fixture.callback(fixture.auth().get("state"), "fixture-issued-client"); until(() -> !"signing-in".equals(fixture.runtime.status().getString("state"))); assertEquals("signed-out", fixture.runtime.status().getString("state")); assertEquals(0, fixture.runtime.status().getJSONArray("profiles").length()); }
        }
    }
    @Test public void eofDoesNotCompleteAndCancelStopsBlockedNativeInference() throws Exception {
        try (Fixture fixture = new Fixture()) {
            fixture.bind(); fixture.login(); fixture.responseMode = "eof"; fixture.request("task-eof"); until(() -> fixture.reply("task-eof", "error")); assertFalse(fixture.reply("task-eof", "done")); assertEquals(0, fixture.runtime.status().getJSONObject("usage").getInt("completedRequests"));
            fixture.responseMode = "blocked"; fixture.request("task-cancel"); until(() -> fixture.inferenceBodies.size() == 2); fixture.commands.put(new JSONObject().put("type", "cancel").put("id", "task-cancel")); Thread.sleep(300); assertFalse(fixture.reply("task-cancel", "done")); fixture.runtime.clearScope(); assertEquals(0, fixture.runtime.status().getJSONArray("models").length());
        }
    }
    @Test public void scopesAreIsolatedAndClearDuringExchangeCannotSaveCredentials() throws Exception {
        try (Fixture fixture = new Fixture()) {
            String old = fixture.bind(); fixture.runtime.start(null); fixture.blockToken = true; fixture.callback(fixture.auth().get("state"), "fixture-issued-client"); assertTrue(fixture.tokenEntered.await(5, TimeUnit.SECONDS)); fixture.runtime.clearScope(); fixture.tokenContinue.countDown(); Thread.sleep(200); fixture.blockToken = false; fixture.bind(); assertEquals("signed-out", fixture.runtime.status().getString("state")); fixture.login(); fixture.user = "other-user"; fixture.bind(); assertEquals(0, fixture.runtime.status().getJSONArray("profiles").length()); assertThrows(Exception.class, () -> fixture.runtime.checkScope(old)); fixture.user = "native-user"; fixture.bind(); assertEquals("signed-in", fixture.runtime.status().getString("state")); fixture.endpoint = "https://another.invalid"; fixture.bind(); assertEquals(0, fixture.runtime.status().getJSONArray("profiles").length()); fixture.endpoint = "https://fixture.invalid"; fixture.bind(); assertEquals("signed-in", fixture.runtime.status().getString("state"));
        }
    }
    @Test public void cancelLoginDoesNotWaitForBlockedTokenExchange() throws Exception {
        try (Fixture fixture = new Fixture()) {
            String id = fixture.bind(); fixture.runtime.start(null); fixture.blockToken = true; fixture.callback(fixture.auth().get("state"), "fixture-issued-client"); assertTrue(fixture.tokenEntered.await(5, TimeUnit.SECONDS)); long start = System.nanoTime(); assertEquals("signed-out", fixture.runtime.cancelLocal(id).getString("state")); assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) < 1000); fixture.tokenContinue.countDown(); Thread.sleep(200); assertEquals(0, fixture.runtime.status().getJSONArray("profiles").length());
        }
    }
    @Test public void callbackCanReturnOnceWhileNativeTokenVerificationIsStillPending() throws Exception {
        try (Fixture fixture = new Fixture()) {
            fixture.bind(); fixture.runtime.start(null); fixture.blockToken = true;
            assertEquals(200, fixture.callback(fixture.auth().get("state"), "fixture-issued-client")); assertTrue(fixture.tokenEntered.await(5, TimeUnit.SECONDS)); fixture.assertSafeReturnPage();
            JSONObject pending = fixture.runtime.status(); assertEquals("signing-in", pending.getString("state")); assertEquals("verifying", pending.getString("signInStage")); assertEquals(0, pending.getJSONArray("profiles").length());
            String uri = fixture.returnUri(); assertTrue(fixture.runtime.consumeReturn(uri)); assertFalse(fixture.runtime.consumeReturn(uri)); assertNotNull(fixture.runtime.pendingAttemptId());
            fixture.tokenContinue.countDown(); until(() -> "signed-in".equals(fixture.runtime.status().getString("state"))); assertNull(fixture.runtime.pendingAttemptId());
        }
    }
    @Test public void invalidCallbackStateCannotMintNavigationTicketOrConsumeTheAttempt() throws Exception {
        try (Fixture fixture = new Fixture()) {
            fixture.bind(); fixture.runtime.start(null); String attempt = fixture.runtime.pendingAttemptId(); assertNotNull(attempt);
            assertEquals(400, fixture.callback("wrong-state", "fixture-issued-client")); assertFalse(fixture.callbackBody.contains("ticket=")); assertFalse(fixture.callbackBody.contains("intent://")); assertTrue(fixture.grants.isEmpty());
            assertFalse(fixture.runtime.consumeReturn(OfficialReturnPolicy.uri("A".repeat(43)))); assertEquals(attempt, fixture.runtime.pendingAttemptId()); assertEquals("browser", fixture.runtime.status().getString("signInStage"));
            assertEquals(200, fixture.callback(fixture.auth().get("state"), "fixture-issued-client")); assertTrue(fixture.runtime.consumeReturn(fixture.returnUri())); until(() -> "signed-in".equals(fixture.runtime.status().getString("state")));
        }
    }
    @Test public void cancellingOrChangingScopeInvalidatesPreviouslyIssuedReturnTickets() throws Exception {
        try (Fixture fixture = new Fixture()) {
            fixture.bind(); fixture.runtime.start(null); fixture.blockToken = true; fixture.callback(fixture.auth().get("state"), "fixture-issued-client"); assertTrue(fixture.tokenEntered.await(5, TimeUnit.SECONDS));
            String uri = fixture.returnUri(), attempt = fixture.runtime.pendingAttemptId(); fixture.runtime.cancelAttempt(attempt, "Synthetic cancellation"); assertNull(fixture.runtime.pendingAttemptId()); assertFalse(fixture.runtime.consumeReturn(uri));
            fixture.tokenContinue.countDown(); assertTrue(fixture.tokenPrepared.await(5, TimeUnit.SECONDS)); fixture.blockToken = false; fixture.runtime.start(null); String replacement = fixture.runtime.pendingAttemptId(); fixture.runtime.cancelAttempt(attempt, "Stale notification"); assertEquals(replacement, fixture.runtime.pendingAttemptId());
            fixture.callback(fixture.auth().get("state"), "fixture-issued-client"); String replacementUri = fixture.returnUri(); until(() -> "signed-in".equals(fixture.runtime.status().getString("state")));
            fixture.user = "other-user"; fixture.bind(); assertFalse(fixture.runtime.consumeReturn(uri)); assertFalse(fixture.runtime.consumeReturn(replacementUri)); assertEquals("signed-out", fixture.runtime.status().getString("state"));
        }
    }
    @Test public void sameVerifiedScopeRebindKeepsPendingAttemptAndReturnTicket() throws Exception {
        try (Fixture fixture = new Fixture()) {
            String scope = fixture.bind(); fixture.runtime.start(null); String attempt = fixture.runtime.pendingAttemptId(), authorize = fixture.authorize;
            assertEquals(scope, fixture.bind()); assertEquals(attempt, fixture.runtime.pendingAttemptId()); assertEquals(authorize, fixture.authorize); assertEquals("browser", fixture.runtime.status().getString("signInStage"));
            fixture.blockToken = true; fixture.callback(fixture.auth().get("state"), "fixture-issued-client"); assertTrue(fixture.tokenEntered.await(5, TimeUnit.SECONDS)); String uri = fixture.returnUri();
            assertEquals(scope, fixture.bind()); assertEquals(attempt, fixture.runtime.pendingAttemptId()); assertEquals("verifying", fixture.runtime.status().getString("signInStage")); assertTrue(fixture.runtime.consumeReturn(uri));
            fixture.tokenContinue.countDown(); until(() -> "signed-in".equals(fixture.runtime.status().getString("state")));
        }
    }
    @Test public void failedTokenExchangeStillAllowsReturnButDoesNotClaimSuccessfulLogin() throws Exception {
        try (Fixture fixture = new Fixture()) {
            fixture.bind(); fixture.invalidGrant = true; fixture.runtime.start(null); assertEquals(200, fixture.callback(fixture.auth().get("state"), "fixture-issued-client")); fixture.assertSafeReturnPage(); String uri = fixture.returnUri();
            until(() -> fixture.runtime.pendingAttemptId() == null); JSONObject result = fixture.runtime.status(); assertEquals("signed-out", result.getString("state")); assertTrue(result.has("error")); assertFalse(result.has("signInStage")); assertEquals(0, result.getJSONArray("profiles").length());
            assertTrue(fixture.runtime.consumeReturn(uri)); assertFalse(fixture.runtime.consumeReturn(uri)); assertFalse(fixture.runtime.status().getBoolean("planUsageEnabled"));
        }
    }
    @Test public void invalidManualAddressesLeaveTheOriginalBrowserAttemptWaiting() throws Exception {
        try (Fixture fixture = new Fixture()) {
            String scope = fixture.bind(); fixture.runtime.start(null); String attempt = fixture.runtime.pendingAttemptId(), url = fixture.callbackUrl(fixture.auth().get("state"), "fixture-issued-client");
            assertTrue(fixture.runtime.status().getBoolean("manualCallbackSupported"));
            for (String invalid : new String[] { url.replace("127.0.0.1", "localhost"), url.replace("http://", "https://"), url.replace("/auth/callback", "/auth/other"), url + "&code=other", url + "#fragment", fixture.callbackUrl("wrong-state", "fixture-issued-client"), fixture.callbackUrl(fixture.auth().get("state"), "dynamic_agent_client") }) {
                assertThrows(Exception.class, () -> fixture.runtime.completeCallback(scope, invalid)); assertEquals(attempt, fixture.runtime.pendingAttemptId()); assertEquals("browser", fixture.runtime.status().getString("signInStage")); assertTrue(fixture.grants.isEmpty());
            }
            assertEquals(200, fixture.callback(fixture.auth().get("state"), "fixture-issued-client")); until(() -> "signed-in".equals(fixture.runtime.status().getString("state")));
        }
    }
    @Test public void manualCallbackInterruptsAPartialHttpRequestAndDeduplicatesPendingAndCompletedResults() throws Exception {
        try (Fixture fixture = new Fixture()) {
            String scope = fixture.bind(); fixture.runtime.start(null); fixture.blockToken = true; String url = fixture.callbackUrl(fixture.auth().get("state"), "fixture-issued-client"); URI destination = new URI(url);
            try (Socket partial = new Socket("127.0.0.1", destination.getPort())) {
                partial.getOutputStream().write("GET /auth/callback?".getBytes(StandardCharsets.US_ASCII)); partial.getOutputStream().flush();
                java.lang.reflect.Field attemptField = PetOfficialAccountRuntime.class.getDeclaredField("attempt"); attemptField.setAccessible(true); Object attempt = attemptField.get(fixture.runtime); java.lang.reflect.Field inbound = attempt.getClass().getDeclaredField("inbound"); inbound.setAccessible(true); until(() -> inbound.get(attempt) != null);
                JSONObject pending = fixture.runtime.completeCallback(scope, url); assertEquals("verifying", pending.getString("signInStage")); assertTrue(fixture.tokenEntered.await(5, TimeUnit.SECONDS));
                assertEquals("verifying", fixture.runtime.completeCallback(scope, url).getString("signInStage")); assertEquals(1, fixture.grants.size());
                assertThrows(Exception.class, () -> fixture.runtime.completeCallback(scope, url.replace("synthetic-code", "other-code"))); assertEquals("verifying", fixture.runtime.status().getString("signInStage"));
                fixture.tokenContinue.countDown(); until(() -> "signed-in".equals(fixture.runtime.status().getString("state"))); assertEquals("signed-in", fixture.runtime.completeCallback(scope, url).getString("state")); assertEquals(1, fixture.grants.size());
                String status = fixture.runtime.status().toString(); assertFalse(status.contains("synthetic-code")); assertFalse(status.contains(fixture.auth().get("state"))); assertFalse(status.contains("synthetic-access"));
                java.lang.reflect.Field receiptField = PetOfficialAccountRuntime.class.getDeclaredField("callbackReceipt"); receiptField.setAccessible(true); Object receipt = receiptField.get(fixture.runtime); java.lang.reflect.Field expires = receipt.getClass().getDeclaredField("expiresAt"); expires.setAccessible(true);
                assertTrue(expires.getLong(receipt) <= android.os.SystemClock.elapsedRealtime() + 120000); expires.setLong(receipt, android.os.SystemClock.elapsedRealtime() - 1);
                assertThrows(Exception.class, () -> fixture.runtime.completeCallback(scope, url)); assertEquals(1, fixture.grants.size());
            }
        }
    }
    @Test public void browserAndManualCallbackRaceCanOnlyExchangeOneAuthorizationCode() throws Exception {
        try (Fixture fixture = new Fixture()) {
            String scope = fixture.bind(); fixture.runtime.start(null); fixture.blockToken = true; String url = fixture.callbackUrl(fixture.auth().get("state"), "fixture-issued-client");
            ExecutorService workers = Executors.newFixedThreadPool(2); CountDownLatch ready = new CountDownLatch(2), go = new CountDownLatch(1);
            try {
                Future<JSONObject> manual = workers.submit(() -> { ready.countDown(); assertTrue(go.await(5, TimeUnit.SECONDS)); return fixture.runtime.completeCallback(scope, url); });
                Future<Integer> browser = workers.submit(() -> {
                    ready.countDown(); assertTrue(go.await(5, TimeUnit.SECONDS)); HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection(Proxy.NO_PROXY); connection.setConnectTimeout(3000); connection.setReadTimeout(3000);
                    try { return connection.getResponseCode(); } catch (IOException listenerClosedByManual) { return -1; } finally { connection.disconnect(); }
                });
                assertTrue(ready.await(5, TimeUnit.SECONDS)); go.countDown(); assertEquals("verifying", manual.get(5, TimeUnit.SECONDS).getString("signInStage")); int http = browser.get(5, TimeUnit.SECONDS); assertTrue(http == -1 || http == 200 || http == 410);
                assertTrue(fixture.tokenEntered.await(5, TimeUnit.SECONDS)); assertEquals(1, fixture.grants.size()); assertEquals("verifying", fixture.runtime.completeCallback(scope, url).getString("signInStage"));
                fixture.tokenContinue.countDown(); until(() -> "signed-in".equals(fixture.runtime.status().getString("state"))); assertEquals(1, fixture.grants.size());
            } finally { go.countDown(); workers.shutdownNow(); }
        }
    }
    @Test public void receivedBrowserCallbackCanBePastedAfterSuccessOrInvalidGrantWithoutReexchange() throws Exception {
        for (boolean invalidGrant : new boolean[] { false, true }) try (Fixture fixture = new Fixture()) {
            String scope = fixture.bind(); fixture.runtime.start(null); fixture.invalidGrant = invalidGrant; String url = fixture.callbackUrl(fixture.auth().get("state"), "fixture-issued-client");
            assertEquals(200, fixture.callback(fixture.auth().get("state"), "fixture-issued-client")); until(() -> fixture.runtime.pendingAttemptId() == null);
            JSONObject status = fixture.runtime.completeCallback(scope, url); assertEquals(invalidGrant ? "signed-out" : "signed-in", status.getString("state")); assertEquals(invalidGrant, status.has("error")); assertEquals(1, fixture.grants.size());
            assertEquals(status.getString("state"), fixture.runtime.completeCallback(scope, url).getString("state")); assertEquals(1, fixture.grants.size());
            assertThrows(Exception.class, () -> fixture.runtime.completeCallback(scope, url + "&unrecognized=1")); assertEquals(1, fixture.grants.size());
        }
    }
    @Test public void cancellationNewAttemptLogoutAndScopeChangesRevokeManualCallbackReceipts() throws Exception {
        try (Fixture fixture = new Fixture()) {
            String scope = fixture.bind(); fixture.runtime.start(null); String cancelled = fixture.callbackUrl(fixture.auth().get("state"), "fixture-issued-client"); fixture.runtime.cancelLocal(scope);
            assertThrows(Exception.class, () -> fixture.runtime.completeCallback(scope, cancelled)); assertTrue(fixture.grants.isEmpty());
            fixture.runtime.start(null); String first = fixture.callbackUrl(fixture.auth().get("state"), "fixture-issued-client"); fixture.runtime.completeCallback(scope, first); until(() -> "signed-in".equals(fixture.runtime.status().getString("state")));
            fixture.runtime.start(null); String replacement = fixture.callbackUrl(fixture.auth().get("state"), "fixture-issued-client"); assertThrows(Exception.class, () -> fixture.runtime.completeCallback(scope, first)); assertEquals("browser", fixture.runtime.status().getString("signInStage"));
            fixture.runtime.completeCallback(scope, replacement); until(() -> fixture.runtime.pendingAttemptId() == null); assertEquals(2, fixture.grants.size()); fixture.runtime.logout(); assertThrows(Exception.class, () -> fixture.runtime.completeCallback(scope, replacement));
            fixture.runtime.start(null); String otherScope = fixture.callbackUrl(fixture.auth().get("state"), "fixture-issued-client"); fixture.user = "other-user"; String nextScope = fixture.bind(); assertThrows(Exception.class, () -> fixture.runtime.completeCallback(scope, otherScope)); assertThrows(Exception.class, () -> fixture.runtime.completeCallback(nextScope, otherScope)); assertEquals(2, fixture.grants.size());
        }
    }
    @Test public void imagePollAboveTwoMiBAndUnicodeSseFramesRemainBoundedAndOrdered() throws Exception {
        try (Fixture fixture = new Fixture()) {
            fixture.bind(); fixture.login(); fixture.responseMode = "large";
            JSONObject content = new JSONObject().put("type", "input_image").put("image_url", "data:image/png;base64," + "A".repeat(3 * 1024 * 1024));
            fixture.commands.put(new JSONObject().put("type", "request").put("id", "task-image").put("body", new JSONObject().put("model", "gpt-6-luna").put("input", new JSONArray().put(new JSONObject().put("role", "user").put("content", new JSONArray().put(content))))));
            until(() -> fixture.reply("task-image", "done")); assertEquals(content.getString("image_url"), fixture.inferenceBodies.get(0).getJSONArray("input").getJSONObject(0).getJSONArray("content").getJSONObject(0).getString("image_url"));
            int sequence = 0, chunks = 0; StringBuilder stream = new StringBuilder();
            for (JSONObject reply : fixture.replies) if ("task-image".equals(reply.optString("id"))) { assertEquals(sequence++, reply.getInt("sequence")); if (reply.has("chunk")) { String chunk = reply.getString("chunk"); assertTrue(chunk.getBytes(StandardCharsets.UTF_8).length <= 48 * 1024); assertEquals(chunk, new String(chunk.getBytes(StandardCharsets.UTF_8), StandardCharsets.UTF_8)); stream.append(chunk); chunks++; } }
            assertTrue(chunks > 2); assertFalse(stream.toString().contains("synthetic-access")); assertTrue(stream.toString().contains("[redacted]")); assertTrue(stream.toString().contains("response.completed"));
        }
    }
    @Test public void unauthorizedInferenceIsNotReplayedAndNextExplicitRequestRefreshes() throws Exception {
        try (Fixture fixture = new Fixture()) {
            fixture.bind(); fixture.login(); fixture.responseMode = "unauthorized"; fixture.request("task-expired"); until(() -> fixture.reply("task-expired", "error")); assertEquals(1, fixture.inferenceBodies.size()); assertEquals(0, fixture.refreshes); assertEquals(0, fixture.runtime.status().getJSONObject("usage").getInt("completedRequests"));
            fixture.responseMode = "complete"; fixture.request("task-new"); until(() -> fixture.reply("task-new", "done")); assertEquals(2, fixture.inferenceBodies.size()); assertEquals(1, fixture.refreshes); assertEquals(1, fixture.runtime.status().getJSONObject("usage").getInt("completedRequests"));
        }
    }
}
