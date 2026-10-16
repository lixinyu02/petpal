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
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
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
        int callback(String state, String client) throws Exception {
            Map<String, String> auth = auth(); String address = auth.get("redirect_uri") + "?state=" + URLEncoder.encode(state, "UTF-8") + "&code=synthetic-code&client_id=" + URLEncoder.encode(client, "UTF-8"); HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection(Proxy.NO_PROXY); connection.setConnectTimeout(5000); connection.setReadTimeout(5000);
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
                    if (path.equals("/api/auth/me")) json.put("instanceId", "native-instance").put("user", new JSONObject().put("id", user));
                    else if (path.endsWith("/oauth/token")) {
                        Map<String, String> grant = fields(posted.toString("UTF-8")); grants.add(grant);
                        if (blockToken) { tokenEntered.countDown(); if (!tokenContinue.await(10, TimeUnit.SECONDS)) throw new IOException(); }
                        if (cancelled) throw new IOException();
                        if (invalidGrant) { invalidGrant = false; responseCode = 400; json.put("error", "invalid_grant"); }
                        else { boolean refreshing = "refresh_token".equals(grant.get("grant_type")); if (refreshing) refreshes++; else assertEquals(auth().get("code_challenge"), b64(MessageDigest.getInstance("SHA-256").digest(grant.get("code_verifier").getBytes(StandardCharsets.US_ASCII)))); json = tokens(refreshing); }
                        tokenPrepared.countDown();
                    } else if (path.endsWith("/oauth/revoke")) revoked++;
                    else if (path.equals("/.well-known/jwks.json")) { RSAPublicKey key = (RSAPublicKey) rsa.getPublic(); json.put("keys", new JSONArray().put(new JSONObject().put("kid", "fixture-key").put("kty", "RSA").put("alg", "RS256").put("use", "sig").put("n", b64(unsigned(key.getModulus().toByteArray()))).put("e", b64(unsigned(key.getPublicExponent().toByteArray()))))); }
                    else if (path.equals("/v1/models")) { assertTrue(getRequestProperty("Authorization").startsWith("Bearer synthetic-")); json.put("models", new JSONArray().put(new JSONObject().put("slug", "gpt-6-luna").put("visibility", "list").put("display_name", "GPT 6 Luna").put("input_modalities", new JSONArray().put("text").put("image")))); }
                    else if (path.equals("/api/mobile-official/connect")) { JSONObject body = new JSONObject(posted.toString("UTF-8")); JSONArray available = body.getJSONArray("models"), out = new JSONArray(); for (int i = 0; i < available.length(); i++) out.put(new JSONObject(available.getJSONObject(i).toString()).put("id", "fixture-provider")); json.put("relayId", "fixture_relay").put("models", out).put("pollMs", 25000); }
                    else if (path.endsWith("/poll")) { JSONObject command = commands.poll(200, TimeUnit.MILLISECONDS); if (cancelled) throw new IOException(); json.put("commands", command == null ? new JSONArray() : new JSONArray().put(command)); }
                    else if (path.endsWith("/reply")) replies.add(new JSONObject(posted.toString("UTF-8")));
                    else if (path.endsWith("/disconnect")) disconnected++;
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
        @Override public void close() { runtime.close(); tokenContinue.countDown(); }
    }
    private static byte[] unsigned(byte[] value) { return value.length > 1 && value[0] == 0 ? java.util.Arrays.copyOfRange(value, 1, value.length) : value; }

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
