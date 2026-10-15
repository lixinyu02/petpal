package com.petpal.app;

import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.net.HttpURLConnection;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real packaged core; entirely synthetic nodes and no user credentials/network. */
@RunWith(AndroidJUnit4.class)
public class PetAppProxyRuntimeTest {
    private static void field(Object target, String name, Object value) throws Exception { Field member = target.getClass().getDeclaredField(name); member.setAccessible(true); member.set(target, value); }
    private static Object field(Object target, String name) throws Exception { Field member = target.getClass().getDeclaredField(name); member.setAccessible(true); return member.get(target); }
    private static byte[] bytes(InputStream input, int count) throws Exception { byte[] value = new byte[count]; int at = 0; while (at < count) { int n = input.read(value, at, count - at); if (n < 0) throw new java.io.EOFException(); at += n; } return value; }
    private static final class Node implements AutoCloseable {
        final ServerSocket listener = new ServerSocket(0, 10, java.net.InetAddress.getByName("127.0.0.1"));
        final ExecutorService io = Executors.newCachedThreadPool();
        final Set<String> hosts = ConcurrentHashMap.newKeySet();
        volatile boolean closed;
        Node() throws Exception { io.execute(() -> { while (!closed) try { Socket socket = listener.accept(); io.execute(() -> serve(socket)); } catch (Exception done) { } }); }
        void serve(Socket socket) {
            try (Socket client = socket) {
                client.setSoTimeout(5000); InputStream input = client.getInputStream(); OutputStream output = client.getOutputStream();
                byte[] greeting = bytes(input, 2); if (greeting[0] != 5) return; bytes(input, greeting[1] & 255); output.write(new byte[]{5, 0}); output.flush();
                byte[] request = bytes(input, 4); String host;
                if (request[3] == 3) host = new String(bytes(input, input.read()), StandardCharsets.UTF_8);
                else if (request[3] == 1) { byte[] ip = bytes(input, 4); host = (ip[0] & 255) + "." + (ip[1] & 255) + "." + (ip[2] & 255) + "." + (ip[3] & 255); }
                else { bytes(input, 16); host = "ipv6"; }
                bytes(input, 2); hosts.add(host); output.write(new byte[]{5, 0, 0, 1, 127, 0, 0, 1, 0, 1}); output.flush();
                int first = input.read();
                // HTTPS is intentionally closed at the synthetic node. Seeing
                // the exact host here proves the native/WebView proxy route;
                // it is not advertised as successful TLS or model inference.
                if (first != 'G' && first != 'P') return;
                output.write("HTTP/1.1 200 OK\r\nContent-Length: 18\r\nConnection: close\r\n\r\npetpal-proxy-proof".getBytes(StandardCharsets.US_ASCII)); output.flush();
            } catch (Exception ignored) { }
        }
        boolean saw(String host) throws Exception { long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(10); while (System.nanoTime() < end) { if (hosts.contains(host)) return true; Thread.sleep(40); } return false; }
        @Override public void close() throws Exception { closed = true; listener.close(); io.shutdownNow(); io.awaitTermination(6, TimeUnit.SECONDS); }
    }
    @Test public void packagedCoreRoutesNativeAndWebViewWithoutVpnAndStopsCleanly() throws Exception {
        Assume.assumeTrue(Build.VERSION.SDK_INT >= 34);
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        PetAppProxyState manager = new PetAppProxyState(context); JSONObject initial = manager.status(); assertTrue(initial.toString(), initial.getBoolean("supported"));
        File directory = new File(context.getCacheDir(), "proxy-runtime-" + UUID.randomUUID()); assertTrue(directory.mkdir());
        WebView[] web = {null}; Process running = null;
        try (Node node = new Node()) {
            // Test-only injection avoids touching saved accounts or subscriptions.
            field(manager, "directory", directory); field(manager, "scope", "synthetic-scope");
            field(manager, "yaml", "proxies:\n  - {name: synthetic, type: socks5, server: 127.0.0.1, port: " + node.listener.getLocalPort() + "}\nrules:\n  - MATCH,synthetic\n");
            JSONObject enabled = manager.start("synthetic-scope", manager.generation()); assertTrue(enabled.toString(), enabled.getBoolean("running"));
            running = (Process) field(manager, "process"); assertNotNull(running); assertTrue(running.isAlive());
            int port = (Integer) field(manager, "port");
            try (Socket proxy = new Socket("127.0.0.1", port)) {
                proxy.setSoTimeout(5000); proxy.getOutputStream().write("GET http://raw.petpal.invalid/ HTTP/1.1\r\nHost: raw.petpal.invalid\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                String body = new String(PetAppProxyState.read(proxy.getInputStream(), 4096), StandardCharsets.US_ASCII); assertTrue(body, body.contains("petpal-proxy-proof"));
            }
            assertTrue(node.saw("raw.petpal.invalid"));
            HttpURLConnection nativeRequest = PetNetwork.open(new URL("https://native.petpal.invalid/probe"));
            nativeRequest.setConnectTimeout(3000); nativeRequest.setReadTimeout(3000);
            try { nativeRequest.getResponseCode(); fail("Synthetic node deliberately does not provide TLS"); } catch (java.io.IOException expected) { } finally { nativeRequest.disconnect(); }
            assertTrue("Native HTTPS must reach the synthetic SOCKS node through the packaged core", node.saw("native.petpal.invalid"));
            Handler main = new Handler(Looper.getMainLooper()); CountDownLatch created = new CountDownLatch(1);
            main.post(() -> {
                web[0] = new WebView(context); web[0].getSettings().setJavaScriptEnabled(true); web[0].setWebViewClient(new WebViewClient());
                web[0].loadDataWithBaseURL("https://localhost/", "<html><script>fetch('https://webview.petpal.invalid/probe').catch(function(){});</script></html>", "text/html", "UTF-8", null); created.countDown();
            });
            assertTrue(created.await(5, TimeUnit.SECONDS)); assertTrue("WebView HTTPS must use the asynchronously installed proxy override", node.saw("webview.petpal.invalid"));
            int seen = node.hosts.size();
            try (ServerSocket local = new ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))) {
                Thread serve = new Thread(() -> { try (Socket peer = local.accept()) { peer.getInputStream().read(new byte[2048]); peer.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\ndirect".getBytes(StandardCharsets.US_ASCII)); } catch (Exception ignored) { } }); serve.start();
                HttpURLConnection direct = PetNetwork.open(new URL("http://127.0.0.1:" + local.getLocalPort() + "/")); direct.setConnectTimeout(2000); direct.setReadTimeout(2000);
                try { assertEquals("direct", new String(PetAppProxyState.read(direct.getInputStream(), 32), StandardCharsets.US_ASCII)); } finally { direct.disconnect(); } serve.join(3000);
            }
            assertEquals("Loopback request must bypass the proxy core", seen, node.hosts.size());
            assertFalse(manager.stop().getBoolean("running")); assertFalse(running.isAlive());
        } finally {
            if (web[0] != null) { CountDownLatch closed = new CountDownLatch(1); new Handler(Looper.getMainLooper()).post(() -> { web[0].destroy(); closed.countDown(); }); closed.await(5, TimeUnit.SECONDS); }
            manager.invalidate(); manager.clear();
            // Fixture files stay within an isolated app-cache directory. No
            // account vault, subscription or preference directory is changed.
        }
    }
}
