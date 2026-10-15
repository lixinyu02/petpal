package com.petpal.app;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.URL;
import java.util.Locale;

/** Explicit app-client proxy only. Never changes JVM or Android proxy defaults. */
public final class PetNetwork {
    private static volatile int proxyPort;
    private PetNetwork() { }
    static void proxy(int port) { if (port < 0 || port > 65535) throw new IllegalArgumentException(); proxyPort = port; }
    public static boolean bypass(String value) {
        if (value == null) return true;
        String host = value.toLowerCase(Locale.ROOT);
        if (host.startsWith("[") && host.endsWith("]")) host = host.substring(1, host.length() - 1);
        if (host.equals("localhost") || host.endsWith(".localhost") || host.endsWith(".local") || host.indexOf('.') < 0 && host.indexOf(':') < 0) return true;
        if (host.indexOf(':') >= 0) return host.equals("::1") || host.equals("::") || host.startsWith("fc") || host.startsWith("fd") || host.matches("fe[89ab].*") || host.startsWith("::ffff:127.") || host.startsWith("::ffff:192.168.") || host.startsWith("::ffff:10.");
        String[] parts = host.split("\\.");
        if (parts.length != 4) return false;
        int[] octets = new int[4];
        try { for (int i = 0; i < 4; i++) { if (!parts[i].matches("[0-9]{1,3}")) return false; octets[i] = Integer.parseInt(parts[i]); if (octets[i] > 255) return false; } }
        catch (NumberFormatException invalid) { return false; }
        return octets[0] == 0 || octets[0] == 10 || octets[0] == 127 || octets[0] == 169 && octets[1] == 254 || octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31 || octets[0] == 192 && octets[1] == 168;
    }
    public static HttpURLConnection open(URL url) throws IOException {
        if (url == null || !("https".equalsIgnoreCase(url.getProtocol()) || "http".equalsIgnoreCase(url.getProtocol()))) throw new IOException("不支持的联网地址。");
        int port = proxyPort;
        return (HttpURLConnection) url.openConnection(port > 0 && !bypass(url.getHost()) ? new Proxy(Proxy.Type.HTTP, new InetSocketAddress("127.0.0.1", port)) : Proxy.NO_PROXY);
    }
}
