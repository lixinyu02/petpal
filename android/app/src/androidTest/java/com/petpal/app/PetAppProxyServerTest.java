package com.petpal.app;

import android.content.Context;
import android.os.Build;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Exact installed Mihomo, synthetic fixed server API, no user accounts or network. */
@RunWith(AndroidJUnit4.class)
public class PetAppProxyServerTest {
    private static final String BASE = "https://proxy-server.petpal.invalid";
    private static final String PROFILE = "assigned-profile";
    private static Object field(Object target, String name) throws Exception { Field member = target.getClass().getDeclaredField(name); member.setAccessible(true); return member.get(target); }
    private static String hash(byte[] bytes) throws Exception { StringBuilder value = new StringBuilder(); for (byte b : MessageDigest.getInstance("SHA-256").digest(bytes)) value.append(String.format(Locale.ROOT, "%02x", b & 255)); return value.toString(); }
    private static String configuration(boolean alpha) { return "proxies:\n" + (alpha ? "  - {name: alpha, type: socks5, server: 127.0.0.1, port: 49001}\n" : "") + "  - {name: beta, type: socks5, server: 127.0.0.1, port: 49002}\nproxy-groups:\n  - {name: region, type: select, proxies: [" + (alpha ? "alpha, " : "") + "beta, DIRECT]}\nrules:\n  - MATCH,region\n"; }
    private static String providerConfiguration(boolean alpha) { return "proxy-providers:\n  catalog:\n    type: inline\n    payload:\n" + (alpha ? "      - {name: alpha, type: socks5, server: 127.0.0.1, port: 49001}\n" : "") + "      - {name: beta, type: socks5, server: 127.0.0.1, port: 49002}\nproxy-groups:\n  - {name: region, type: select, proxies: [DIRECT], use: [catalog]}\nrules:\n  - MATCH,region\n"; }
    private static String choice(JSONObject status) throws Exception { JSONArray groups = status.getJSONArray("groups"); for (int i = 0; i < groups.length(); i++) if ("region".equals(groups.getJSONObject(i).getString("name"))) return groups.getJSONObject(i).getString("selected"); throw new AssertionError("missing actual selector"); }
    private static byte[] settings(File directory) throws Exception { return PetAppProxyState.read(new FileInputStream(new File(directory, "settings.json")), 2 * 1024 * 1024); }
    private static void removeFixture(File directory, Context context) throws Exception {
        if (directory == null) return;
        String boundary = new File(context.getFilesDir(), "app-proxy").getCanonicalPath() + File.separator;
        assertTrue(directory.getCanonicalPath().startsWith(boundary)); assertTrue(directory.getName().matches("[a-f0-9]{64}"));
        removeChildren(directory); assertTrue(!directory.exists() || directory.delete());
    }
    private static void removeChildren(File directory) throws Exception { File[] children = directory.listFiles(); if (children == null) return; for (File child : children) { assertTrue(child.getCanonicalPath().startsWith(directory.getCanonicalPath() + File.separator)); if (child.isDirectory()) removeChildren(child); assertTrue(child.delete()); } }
    private static final class Server implements PetAppProxyState.ConnectionFactory {
        final String instance = "proxy-" + UUID.randomUUID(), token = "fixture-app-proxy-session-" + UUID.randomUUID();
        final List<String> paths = new ArrayList<>(), authorizations = new ArrayList<>(), revisions = new ArrayList<>();
        String id = PROFILE, yaml = configuration(true), revision = "r1", mode = "rule", configHashHeader;
        int metadataCode = 200, configCode = 200;
        boolean offline, blockConfig;
        final CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        JSONObject login() throws Exception { return new JSONObject().put("url", BASE).put("token", token).put("instanceId", instance).put("userId", "fixture-user"); }
        JSONObject profile() throws Exception { return new JSONObject().put("id", id).put("name", "Fixture regions").put("revision", revision).put("sha256", hash(yaml.getBytes(StandardCharsets.UTF_8))).put("updatedAt", "2026-10-16T01:00:00.000Z").put("mode", mode).put("selections", new JSONObject().put("region", "beta")).put("groups", new JSONArray()); }
        @Override public HttpURLConnection open(URL url) {
            return new HttpURLConnection(url) {
                byte[] body;
                final boolean auth = "/api/auth/me".equals(url.getPath()), config = url.getPath().endsWith("/config");
                @Override public int getResponseCode() throws java.io.IOException {
                    try {
                        assertEquals(BASE, url.getProtocol() + "://" + url.getAuthority()); assertNull(url.getQuery()); assertFalse(getInstanceFollowRedirects());
                        assertTrue(auth || url.getPath().equals("/api/app-proxy/profiles/" + id) || url.getPath().equals("/api/app-proxy/profiles/" + id + "/config"));
                        paths.add(url.getPath()); authorizations.add(getRequestProperty("Authorization"));
                        assertEquals("Bearer " + token, getRequestProperty("Authorization"));
                        if (auth) { body = new JSONObject().put("instanceId", instance).put("user", new JSONObject().put("id", "fixture-user")).toString().getBytes(StandardCharsets.UTF_8); return 200; }
                        if (offline) throw new java.io.IOException("synthetic offline");
                        if (config) {
                            revisions.add(getRequestProperty("If-Match")); assertEquals("\"" + revision + "\"", getRequestProperty("If-Match"));
                            if (blockConfig) { entered.countDown(); assertTrue(release.await(8, TimeUnit.SECONDS)); }
                            body = yaml.getBytes(StandardCharsets.UTF_8); return configCode;
                        }
                        body = new JSONObject().put("profile", profile()).toString().getBytes(StandardCharsets.UTF_8); return metadataCode;
                    } catch (java.io.IOException failure) { throw failure; } catch (Exception failure) { throw new java.io.IOException(failure); }
                }
                @Override public InputStream getInputStream() { return new ByteArrayInputStream(body); }
                @Override public long getContentLengthLong() { return body == null ? -1 : body.length; }
                @Override public String getContentType() { return config ? "application/yaml; charset=utf-8" : "application/json"; }
                @Override public String getHeaderField(String name) {
                    try {
                        if ("ETag".equalsIgnoreCase(name)) return "\"" + revision + "\"";
                        if ("X-Content-SHA256".equalsIgnoreCase(name)) return configHashHeader == null ? hash(yaml.getBytes(StandardCharsets.UTF_8)) : configHashHeader;
                        if ("Location".equalsIgnoreCase(name)) return "https://untrusted-subscription.petpal.invalid/steal";
                    } catch (Exception ignored) { }
                    return null;
                }
                @Override public void disconnect() { }
                @Override public boolean usingProxy() { return false; }
                @Override public void connect() { }
            };
        }
    }
    @Test public void fixedServerDownloadPersistsPoliciesUpdatesAndRevokesWithoutLeakingCredentials() throws Exception {
        Assume.assumeTrue(Build.VERSION.SDK_INT >= 34);
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext(); Server server = new Server();
        PetAppProxyState manager = new PetAppProxyState(context, server); File directory = null;
        try {
            JSONObject bound = manager.bind(server.login(), manager.generation()); String scope = bound.getString("scope"); directory = (File) field(manager, "directory");
            JSONObject imported = manager.importServer(scope, PROFILE, false, manager.generation()); assertEquals("server", imported.getString("source")); assertEquals("r1", imported.getString("serverProfileRevision")); assertEquals("ready", imported.getString("serverStatus"));
            JSONObject started = manager.start(scope, manager.generation());
            if (!started.getJSONArray("groups").toString().contains("\"name\":\"region\"")) {
                java.lang.reflect.Method inspect = PetAppProxyState.class.getDeclaredMethod("controller", String.class, String.class, JSONObject.class); inspect.setAccessible(true);
                throw new AssertionError("Missing synthetic groups: " + started + " / controller: " + inspect.invoke(manager, "/proxies", "GET", null));
            }
            assertEquals("beta", choice(started));
            manager.mode(scope, "direct", manager.generation()); assertEquals("alpha", choice(manager.select(scope, "region", "alpha", manager.generation()))); manager.preferences(scope, true, manager.generation());
            assertFalse(new String(settings(directory), StandardCharsets.UTF_8).contains(server.token));
            manager.clear();
            manager = new PetAppProxyState(context, server); bound = manager.bind(server.login(), manager.generation()); scope = bound.getString("scope");
            assertTrue("Autostart must restore on the same authenticated server and user", bound.getBoolean("running")); assertEquals("direct", bound.getString("mode")); assertEquals("alpha", choice(bound));
            server.id = "second-profile"; JSONObject second = manager.importServer(scope, server.id, false, manager.generation()); assertEquals("rule", second.getString("mode")); assertEquals("beta", choice(second));
            manager.mode(scope, "global", manager.generation()); server.id = PROFILE;
            JSONObject restored = manager.importServer(scope, PROFILE, false, manager.generation()); assertEquals("direct", restored.getString("mode")); assertEquals("alpha", choice(restored));
            Process previous = (Process) field(manager, "process"); server.revision = "r2"; server.mode = "global";
            JSONObject update = manager.checkServer(scope, manager.generation()); assertTrue(update.getBoolean("serverUpdateAvailable")); assertSame("Foreground check must not restart a core", previous, field(manager, "process"));
            update = manager.updateServer(scope, false, manager.generation()); assertEquals("direct", update.getString("mode")); assertEquals("alpha", choice(update)); assertEquals("r2", update.getString("serverProfileRevision"));
            server.revision = "r3"; server.yaml = configuration(false); update = manager.updateServer(scope, false, manager.generation());
            assertEquals("beta", choice(update)); assertEquals("direct", update.getString("mode"));
            update = manager.updateServer(scope, true, manager.generation()); assertEquals("global", update.getString("mode")); assertEquals("beta", choice(update));
            byte[] before = settings(directory); previous = (Process) field(manager, "process");
            server.revision = "r4"; server.yaml = "proxies: [\n";
            PetAppProxyState captured = manager; String capturedScope = scope;
            assertThrows(Exception.class, () -> captured.updateServer(capturedScope, false, captured.generation())); assertSame(previous, field(manager, "process")); assertArrayEquals(before, settings(directory));
            server.yaml = configuration(false); server.configHashHeader = "0".repeat(64);
            assertThrows(Exception.class, () -> captured.updateServer(capturedScope, false, captured.generation())); assertSame(previous, field(manager, "process")); assertArrayEquals(before, settings(directory)); server.configHashHeader = null;
            for (int code : new int[]{302, 409}) { server.configCode = code; assertThrows(Exception.class, () -> captured.updateServer(capturedScope, false, captured.generation())); assertSame(previous, field(manager, "process")); assertArrayEquals(before, settings(directory)); }
            server.configCode = 200; server.offline = true; update = manager.checkServer(scope, manager.generation()); assertEquals("unavailable", update.getString("serverStatus")); assertTrue(update.getBoolean("running")); assertArrayEquals(before, settings(directory));
            server.offline = false; server.metadataCode = 404; update = manager.checkServer(scope, manager.generation()); assertEquals("revoked", update.getString("serverStatus")); assertFalse(update.getBoolean("running")); assertFalse(previous.isAlive());
            manager.clear(); server.offline = true; manager = new PetAppProxyState(context, server); bound = manager.bind(server.login(), manager.generation());
            assertEquals("revoked", bound.getString("serverStatus")); assertFalse("Known revocation survives an offline restart", bound.getBoolean("running"));
            assertTrue(server.paths.stream().allMatch(path -> path.startsWith("/api/"))); assertTrue(server.authorizations.stream().allMatch(value -> value.equals("Bearer " + server.token))); assertTrue(server.revisions.size() >= 4);
        } finally { manager.invalidate(); manager.clear(); removeFixture(directory, context); }
    }
    @Test public void anInvalidatedDownloadCannotCommitOrRestoreTheOldAccountsProxy() throws Exception {
        Assume.assumeTrue(Build.VERSION.SDK_INT >= 34);
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext(); Server server = new Server(); PetAppProxyState manager = new PetAppProxyState(context, server); File directory = null;
        try {
            String scope = manager.bind(server.login(), manager.generation()).getString("scope"); directory = (File) field(manager, "directory");
            manager.importServer(scope, PROFILE, false, manager.generation()); byte[] before = settings(directory); server.revision = "r2"; server.blockConfig = true;
            AtomicReference<Throwable> result = new AtomicReference<>(); long generation = manager.generation();
            Thread download = new Thread(() -> { try { manager.updateServer(scope, false, generation); result.set(new AssertionError("stale download committed")); } catch (Throwable expected) { result.set(expected); } });
            download.start(); assertTrue(server.entered.await(5, TimeUnit.SECONDS)); manager.invalidate(); server.release.countDown(); download.join(8000);
            assertFalse(download.isAlive()); assertTrue(result.get() instanceof InterruptedException); assertArrayEquals(before, settings(directory)); assertEquals("", field(manager, "serverToken")); assertEquals("", manager.status().getString("scope"));
        } finally { server.release.countDown(); manager.invalidate(); manager.clear(); removeFixture(directory, context); }
    }
    @Test public void inlineProviderSelectorsRestoreDefaultsAndLocalChoicesAfterCoreInitialization() throws Exception {
        Assume.assumeTrue(Build.VERSION.SDK_INT >= 34);
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext(); Server server = new Server(); server.yaml = providerConfiguration(true);
        PetAppProxyState manager = new PetAppProxyState(context, server); File directory = null;
        try {
            String scope = manager.bind(server.login(), manager.generation()).getString("scope"); directory = (File) field(manager, "directory");
            manager.importServer(scope, PROFILE, false, manager.generation()); assertEquals("beta", choice(manager.start(scope, manager.generation())));
            manager.select(scope, "region", "alpha", manager.generation()); manager.mode(scope, "global", manager.generation()); manager.preferences(scope, true, manager.generation()); manager.clear();
            manager = new PetAppProxyState(context, server); JSONObject restored = manager.bind(server.login(), manager.generation()); scope = restored.getString("scope");
            assertTrue(restored.getBoolean("running")); assertEquals("alpha", choice(restored)); assertEquals("global", restored.getString("mode"));
            server.revision = "r2"; server.yaml = providerConfiguration(false); restored = manager.updateServer(scope, false, manager.generation());
            assertEquals("beta", choice(restored)); assertEquals("global", restored.getString("mode"));
            JSONObject stored = new JSONObject(new String(settings(directory), StandardCharsets.UTF_8)); assertFalse(stored.getJSONObject("localSelections").has("region"));
            assertEquals("beta", choice(manager.refreshStatus(manager.generation())));
        } finally { manager.invalidate(); manager.clear(); removeFixture(directory, context); }
    }
}
