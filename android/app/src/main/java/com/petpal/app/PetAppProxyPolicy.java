package com.petpal.app;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.yaml.snakeyaml.DumperOptions;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;

/** Bounded YAML parser. No object construction, external paths or host networking. */
public final class PetAppProxyPolicy {
    public static final int MAX_BYTES = 4 * 1024 * 1024;
    private PetAppProxyPolicy() { }
    private static final List<String> REMOVED = Arrays.asList("external-controller", "external-controller-tls", "external-controller-unix", "external-controller-pipe", "external-ui", "external-ui-url", "external-ui-name", "external-ui-path", "tls", "listeners", "tunnels", "tuic-server", "ss-config", "vmess-config", "iptables", "ntp", "hosts", "geox-url", "geodata-mode", "geodata-loader", "geo-auto-update", "geo-update-interval", "geodata-path", "interface-name", "routing-mark", "authentication", "skip-auth-prefixes", "script");
    private static Yaml yaml() {
        LoaderOptions options = new LoaderOptions(); options.setAllowDuplicateKeys(false); options.setMaxAliasesForCollections(32); options.setNestingDepthLimit(48); options.setCodePointLimit(MAX_BYTES);
        return new Yaml(new SafeConstructor(options));
    }
    public static String remoteUrl(String value) {
        try {
            if (value == null || value.length() > 4096 || value.matches(".*[\\x00-\\x20\\x7f\\\\].*")) throw new Exception();
            URI url = new URI(value);
            if (!"https".equalsIgnoreCase(url.getScheme()) || url.getHost() == null || url.getUserInfo() != null || url.getFragment() != null || url.getPort() == 0 || url.getPort() > 65535 || url.getPort() < -1) throw new Exception();
            return url.toASCIIString();
        } catch (Exception failure) { throw new IllegalArgumentException("远程配置需要不含账号密码的 HTTPS YAML 直链。"); }
    }
    private static void visit(Object value, int depth, IdentityHashMap<Object, Boolean> ancestors, int[] budget) {
        if (++budget[0] > 60000 || depth > 48) throw new IllegalArgumentException("代理配置层级或展开内容过多。");
        budget[1] += value instanceof String ? ((String) value).getBytes(StandardCharsets.UTF_8).length : 16;
        if (budget[1] > MAX_BYTES) throw new IllegalArgumentException("代理配置展开后超过 4 MB。");
        if (value == null || value instanceof String || value instanceof Boolean || value instanceof Number && Double.isFinite(((Number) value).doubleValue())) return;
        if (!(value instanceof List) && !(value instanceof Map)) throw new IllegalArgumentException("代理配置包含不支持的 YAML 类型。");
        if (ancestors.put(value, true) != null) throw new IllegalArgumentException("代理配置不支持循环引用。");
        if (value instanceof List) for (Object item : (List<?>) value) visit(item, depth + 1, ancestors, budget);
        else for (Map.Entry<?, ?> item : ((Map<?, ?>) value).entrySet()) {
            if (!(item.getKey() instanceof String) || Arrays.asList("__proto__", "prototype", "constructor").contains(item.getKey())) throw new IllegalArgumentException("代理配置字段无效。");
            budget[1] += ((String) item.getKey()).getBytes(StandardCharsets.UTF_8).length; visit(item.getValue(), depth + 1, ancestors, budget);
        }
        ancestors.remove(value);
    }
    @SuppressWarnings("unchecked")
    public static Map<String, Object> parse(String source) {
        if (source == null || source.trim().isEmpty() || source.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new IllegalArgumentException("请导入不超过 4 MB 的 Clash YAML 配置。");
        Object parsed;
        try { parsed = yaml().load(source); } catch (RuntimeException failure) { throw new IllegalArgumentException("配置不是有效的 YAML，原配置已保留。"); }
        if (!(parsed instanceof Map)) throw new IllegalArgumentException("代理配置必须是 YAML 对象。");
        visit(parsed, 0, new IdentityHashMap<>(), new int[]{0, 0});
        Map<String, Object> config = (Map<String, Object>) parsed;
        for (String key : REMOVED) config.remove(key);
        for (String key : Arrays.asList("external-doh-server", "external-controller-cors", "external-controller-routing-mark", "clash-for-android", "experimental")) config.remove(key);
        for (String kind : Arrays.asList("proxy-providers", "rule-providers")) {
            Object providers = config.get(kind); if (providers == null) continue;
            if (!(providers instanceof Map)) throw new IllegalArgumentException("代理 provider 配置无效。");
            int index = 0;
            for (Object entry : ((Map<?, ?>) providers).values()) {
                if (!(entry instanceof Map)) throw new IllegalArgumentException("代理 provider 配置无效。");
                Map<String, Object> provider = (Map<String, Object>) entry;
                if ("file".equals(provider.get("type"))) throw new IllegalArgumentException("请将文件型 provider 合并到单个 YAML。");
                if ("http".equals(provider.get("type"))) { if (!(provider.get("url") instanceof String)) throw new IllegalArgumentException("远程 provider 缺少 HTTPS 地址。"); provider.put("url", remoteUrl((String) provider.get("url"))); }
                provider.put("path", "./providers/" + kind + "-" + index++ + ".yaml");
            }
        }
        // Built-in certificates/keys must be inline data, never local file paths.
        Object proxies = config.get("proxies");
        if (proxies instanceof List) for (Object entry : (List<?>) proxies) if (entry instanceof Map) {
            Map<String, Object> proxy = (Map<String, Object>) entry;
            for (String key : Arrays.asList("certificate-path", "private-key-path", "ca-path", "client-cert", "client-key")) proxy.remove(key);
            sanitizeKeyMaterial(proxy);
        }
        return config;
    }
    private static void sanitizeKeyMaterial(Object item) {
        if (item instanceof List) { for (Object value : (List<?>) item) sanitizeKeyMaterial(value); return; }
        if (!(item instanceof Map)) return;
        Map<?, ?> value = (Map<?, ?>) item;
        for (Map.Entry<?, ?> entry : value.entrySet()) {
            String key = entry.getKey().toString(); Object raw = entry.getValue();
            if (Arrays.asList("certificate", "private-key", "ca", "cert").contains(key) && raw instanceof String) {
                String text = ((String) raw).trim();
                // SSH/TLS allow file paths in these fields. Only retain inline
                // PEM or WireGuard's fixed-size base64 private key here.
                if (!text.isEmpty() && !text.startsWith("-----BEGIN ") && !(key.equals("private-key") && text.matches("[A-Za-z0-9+/]{43}="))) throw new IllegalArgumentException("证书和私钥必须内联到 YAML，不可读取外部文件。");
            }
            if (key.endsWith("-path") && !Arrays.asList("path").contains(key)) throw new IllegalArgumentException("代理节点不可引用外部文件路径。");
            sanitizeKeyMaterial(raw);
        }
    }
    public static String dump(Map<String, Object> config) {
        DumperOptions options = new DumperOptions(); options.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK); options.setWidth(120);
        String value = new Yaml(options).dump(config);
        if (value.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new IllegalArgumentException("规范化后的代理配置超过 4 MB。");
        return value;
    }
    public static String normalize(String source) { return dump(parse(source)); }
    public static String runtime(String source, int port, int controller, String secret) {
        Map<String, Object> value = parse(source);
        value.put("mixed-port", port); value.put("port", 0); value.put("socks-port", 0); value.put("redir-port", 0); value.put("tproxy-port", 0);
        value.put("allow-lan", false); value.put("bind-address", "127.0.0.1"); value.put("ipv6", false); value.put("log-level", "silent");
        Object configuredMode = value.get("mode"); String mode = configuredMode == null ? "rule" : configuredMode.toString().toLowerCase(java.util.Locale.ROOT);
        if (!Arrays.asList("rule", "global", "direct").contains(mode)) throw new IllegalArgumentException("代理模式只支持 rule、global 或 direct。"); value.put("mode", mode);
        value.put("external-controller", "127.0.0.1:" + controller); value.put("secret", secret); value.put("find-process-mode", "off");
        Map<String, Object> disabled = new LinkedHashMap<>(); disabled.put("enable", false);
        value.put("tun", disabled); value.put("dns", new LinkedHashMap<>(disabled)); value.put("sniffer", new LinkedHashMap<>(disabled));
        Map<String, Object> profile = new LinkedHashMap<>(); profile.put("store-selected", false); profile.put("store-fake-ip", false); value.put("profile", profile);
        List<Object> rules = new ArrayList<>(Arrays.asList("IP-CIDR,127.0.0.0/8,DIRECT,no-resolve", "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve", "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve", "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve", "IP-CIDR,169.254.0.0/16,DIRECT,no-resolve", "IP-CIDR6,::1/128,DIRECT,no-resolve", "IP-CIDR6,fc00::/7,DIRECT,no-resolve", "IP-CIDR6,fe80::/10,DIRECT,no-resolve", "DOMAIN,localhost,DIRECT", "DOMAIN-SUFFIX,local,DIRECT"));
        if (value.get("rules") instanceof List) rules.addAll((List<?>) value.get("rules")); value.put("rules", rules);
        return dump(value);
    }
}
