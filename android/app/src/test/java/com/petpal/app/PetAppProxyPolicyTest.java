package com.petpal.app;

import java.net.HttpURLConnection;
import java.net.Proxy;
import java.net.URL;
import java.net.URLConnection;
import java.net.URLStreamHandler;
import java.util.List;
import java.util.Map;
import org.junit.Test;
import static org.junit.Assert.*;

public class PetAppProxyPolicyTest {
    private static final String CONFIG = "proxies:\n  - {name: fixture, type: socks5, server: 127.0.0.1, port: 49001}\nproxy-groups:\n  - {name: choose, type: select, proxies: [fixture, DIRECT]}\nrules: [MATCH,choose]\n";
    @Test public void forcesLoopbackWithoutTunDnsOrExtraServers() {
        String source = CONFIG + "tun: {enable: true}\ndns: {enable: true}\nallow-lan: true\nexternal-controller: 0.0.0.0:9090\nlisteners: [{name: public, type: mixed, port: 5000}]\nscript: {code: unsafe}\n";
        Map<String, Object> runtime = PetAppProxyPolicy.parse(PetAppProxyPolicy.runtime(source, 49002, 49003, "fixture-controller-secret"));
        assertEquals("127.0.0.1", runtime.get("bind-address")); assertEquals(false, runtime.get("allow-lan")); assertEquals(0, runtime.get("tproxy-port")); assertEquals(0, runtime.get("redir-port"));
        assertEquals(false, ((Map<?, ?>) runtime.get("tun")).get("enable")); assertEquals(false, ((Map<?, ?>) runtime.get("dns")).get("enable"));
        assertFalse(runtime.containsKey("listeners")); assertFalse(runtime.containsKey("script")); assertFalse(runtime.containsKey("external-controller"));
        assertEquals("IP-CIDR,127.0.0.0/8,DIRECT,no-resolve", ((List<?>) runtime.get("rules")).get(0));
    }
    @Test public void rejectsUnsafeYamlWithoutInterpretingObjectTags() {
        for (String input : new String[]{"!!javax.script.ScriptEngineManager []", "a: &a [*a]", "a: 1\na: 2", "- list-root", "x: 2026-10-16", "__proto__: {x: 1}", "proxy-providers: {outside: {type: file, path: /sdcard/private.yaml}}"}) assertThrows(IllegalArgumentException.class, () -> PetAppProxyPolicy.normalize(input));
        assertThrows(IllegalArgumentException.class, () -> PetAppProxyPolicy.normalize("x: " + "a".repeat(PetAppProxyPolicy.MAX_BYTES)));
    }
    @Test public void confinesRemoteProviderCachesAndRemovesExternalCertificatePaths() {
        Map<String, Object> value = PetAppProxyPolicy.parse("proxy-providers: {first: {type: http, url: 'https://example.com/nodes.yaml', path: /sdcard/private.yaml}}\nproxies: [{type: http, name: a, certificate-path: /sdcard/cert}]\n");
        Map<?, ?> provider = (Map<?, ?>) ((Map<?, ?>) value.get("proxy-providers")).get("first"); assertEquals("./providers/proxy-providers-0.yaml", provider.get("path"));
        assertFalse(((Map<?, ?>) ((List<?>) value.get("proxies")).get(0)).containsKey("certificate-path"));
    }
    @Test public void remoteSourcesRequireHttpsAndNeverAcceptUrlCredentials() {
        assertEquals("https://example.com/config.yaml?key=fixture", PetAppProxyPolicy.remoteUrl("https://example.com/config.yaml?key=fixture"));
        for (String url : new String[]{"http://example.com/a", "https://user:password@example.com/a", "https://example.com/a#fragment", "file:///sdcard/config.yaml", "https://example.com/a\nX-Header: secret", "https://example.com:0/a"}) assertThrows(IllegalArgumentException.class, () -> PetAppProxyPolicy.remoteUrl(url));
    }
    @Test public void retainsExplicitGlobalOrDirectModeInsteadOfSilentlyRoutingEverythingDirect() {
        assertEquals("global", PetAppProxyPolicy.parse(PetAppProxyPolicy.runtime("mode: global\nproxies: []\n", 49002, 49003, "fixture")).get("mode"));
        assertEquals("direct", PetAppProxyPolicy.parse(PetAppProxyPolicy.runtime("mode: direct\n", 49002, 49003, "fixture")).get("mode"));
        assertThrows(IllegalArgumentException.class, () -> PetAppProxyPolicy.runtime("mode: script\n", 49002, 49003, "fixture"));
    }
    @Test public void missingProviderPathsAreStillConfinedAndSshKeysCannotReadLocalVaults() {
        Map<String, Object> value = PetAppProxyPolicy.parse("proxy-providers: {nodes: {type: http, url: 'https://example.com/nodes.yaml'}}\n");
        assertEquals("./providers/proxy-providers-0.yaml", ((Map<?, ?>) ((Map<?, ?>) value.get("proxy-providers")).get("nodes")).get("path"));
        assertThrows(IllegalArgumentException.class, () -> PetAppProxyPolicy.parse("proxies: [{type: ssh, name: a, private-key: ../../no_backup/official-vault}]\n"));
        assertThrows(IllegalArgumentException.class, () -> PetAppProxyPolicy.parse("proxy-providers: {nodes: {type: http, url: 'http://example.com/nodes.yaml'}}\n"));
    }
    @Test public void nativeClientsOnlyProxyPublicDestinationsAndLeaveGlobalDefaultsAlone() throws Exception {
        for (String host : new String[]{"localhost", "device.local", "computer", "127.0.0.1", "10.20.30.40", "172.31.255.1", "192.168.60.10", "169.254.1.2", "[::1]", "[fd12::1]", "[fe80::1]"}) assertTrue(host, PetNetwork.bypass(host));
        for (String host : new String[]{"api.openai.com", "chatgpt.com", "172.32.0.1", "8.8.8.8", "[2001:4860:4860::8888]"}) assertFalse(host, PetNetwork.bypass(host));
        final Proxy[] selected = {null};
        URLStreamHandler handler = new URLStreamHandler() {
            @Override protected URLConnection openConnection(URL url) { throw new AssertionError("Must supply explicit Proxy"); }
            @Override protected URLConnection openConnection(URL url, Proxy proxy) { selected[0] = proxy; return new HttpURLConnection(url) { @Override public void disconnect() {} @Override public boolean usingProxy() { return proxy != Proxy.NO_PROXY; } @Override public void connect() {} }; }
        };
        java.net.ProxySelector original = java.net.ProxySelector.getDefault();
        try {
            PetNetwork.proxy(49004); PetNetwork.open(new URL(null, "https://chatgpt.com/", handler)); assertEquals(Proxy.Type.HTTP, selected[0].type());
            PetNetwork.open(new URL(null, "https://192.168.60.10/", handler)); assertSame(Proxy.NO_PROXY, selected[0]);
            PetNetwork.proxy(0); PetNetwork.open(new URL(null, "https://chatgpt.com/", handler)); assertSame(Proxy.NO_PROXY, selected[0]);
            assertSame(original, java.net.ProxySelector.getDefault());
        } finally { PetNetwork.proxy(0); }
    }
    @Test public void serverProfilesCannotInjectPathsEtagsOrUnboundedChoices() {
        assertEquals("assigned-profile_1", PetAppProxyPolicy.profileId("assigned-profile_1")); assertEquals("r1:abc.2", PetAppProxyPolicy.revision("r1:abc.2"));
        for (String value : new String[]{"../other", "a/config?token=x", "", "a%2fb", "a\nHeader"}) assertThrows(IllegalArgumentException.class, () -> PetAppProxyPolicy.profileId(value));
        for (String value : new String[]{"\"r1\"", "*", "r1\r\nX: secret", "a/b", ""}) assertThrows(IllegalArgumentException.class, () -> PetAppProxyPolicy.revision(value));
        assertEquals(Map.of("地区", "日本 01"), PetAppProxyPolicy.selections(Map.of("地区", "日本 01")));
        assertThrows(IllegalArgumentException.class, () -> PetAppProxyPolicy.selections(Map.of("地区", 1)));
        assertThrows(IllegalArgumentException.class, () -> PetAppProxyPolicy.selections(Map.of("地区\n", "节点")));
        Map<String, String> tooMany = new java.util.LinkedHashMap<>(); for (int i = 0; i < 129; i++) tooMany.put("group" + i, "node");
        assertThrows(IllegalArgumentException.class, () -> PetAppProxyPolicy.selections(tooMany));
        assertEquals("a".repeat(64), PetAppProxyPolicy.contentHash("a".repeat(64))); assertThrows(IllegalArgumentException.class, () -> PetAppProxyPolicy.contentHash("A".repeat(64)));
    }
    @Test public void explicitPolicyModeIsBoundedAndDoesNotReenableHostFeatures() {
        assertEquals("global", PetAppProxyPolicy.parse(PetAppProxyPolicy.withMode(CONFIG, "global")).get("mode"));
        for (String value : new String[]{"Global", "script", "tun", "direct\nallow-lan: true"}) assertThrows(IllegalArgumentException.class, () -> PetAppProxyPolicy.withMode(CONFIG, value));
    }
    @Test public void startupReadinessIncludesRealGroupsAndInlineProviderNodes() {
        String source = "proxy-providers:\n  catalog:\n    type: inline\n    payload: [{name: provider-node, type: socks5, server: 127.0.0.1, port: 49001}]\nproxy-groups: [{name: region, type: select, proxies: [DIRECT], use: [catalog]}]\n";
        assertEquals(java.util.Set.of("region", "provider-node"), PetAppProxyPolicy.requiredProxyNames(source));
        assertEquals(Map.of("region", List.of("catalog")), PetAppProxyPolicy.dynamicGroups(source));
        assertEquals(java.util.Set.of("fixture", "choose"), PetAppProxyPolicy.requiredProxyNames(CONFIG));
    }
    @Test public void backendAllowsOnlyCanonicalSameDeviceHttpWithoutWeakeningOtherTlsPolicies() {
        assertEquals("https://example.com:44318/petpal", PetAppProxyPolicy.backendUrl("https://example.com:44318/petpal/"));
        for (String value : new String[]{"http://127.0.0.1:45321", "http://127.0.0.1:65535", "http://[::1]:45321", "http://127.0.0.1", "http://[::1]"}) {
            assertEquals(value, PetAppProxyPolicy.backendUrl(value)); assertEquals(value, PetAppProxyPolicy.backendUrl(value + "/"));
        }
        for (String value : new String[]{"http://192.168.60.10:45321", "http://10.0.2.2:45321", "http://localhost:45321", "http://127.1:45321", "http://127.000.000.001:45321", "http://2130706433:45321", "http://[0:0:0:0:0:0:0:1]:45321", "http://[::ffff:127.0.0.1]:45321", "http://127.0.0.1.evil:45321", "http://user@127.0.0.1:45321", "http://127.0.0.1@evil:45321", "http://127%2e0%2e0%2e1:45321", "http://%31%32%37.0.0.1:45321", "http://127.0.0.1:0", "http://127.0.0.1:65536", "http://127.0.0.1:-1", "http://127.0.0.1:", "http://127.0.0.1:045321", "http://127.0.0.1:45321/path", "http://127.0.0.1:45321//", "http://127.0.0.1:45321?query", "http://127.0.0.1:45321#fragment", "http://127.0.0.1:45321\\evil", "http://127.0.0.1:45321\n"}) assertThrows(value, IllegalArgumentException.class, () -> PetAppProxyPolicy.backendUrl(value));
        assertThrows(IllegalArgumentException.class, () -> PetAppProxyPolicy.backendUrl(null));
        assertThrows(IllegalArgumentException.class, () -> TaskNotificationPolicy.baseUrl("http://127.0.0.1:45321"));
        assertThrows(IllegalArgumentException.class, () -> PetAppProxyPolicy.remoteUrl("http://127.0.0.1:45321/config.yaml"));
    }
}
