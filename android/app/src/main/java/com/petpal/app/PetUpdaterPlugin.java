package com.petpal.app;

import android.content.ClipData;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;

@CapacitorPlugin(name = "PetUpdater")
public final class PetUpdaterPlugin extends Plugin {
    private static final String MIME = "application/vnd.android.package-archive";
    private final Object gate = new Object();
    private final ExecutorService worker = Executors.newSingleThreadExecutor(runnable -> { Thread thread = new Thread(runnable, "petpal-apk-update"); thread.setDaemon(true); return thread; });
    private String currentVersion = "", phase = "idle", message = "", error = "";
    private long versionCode, received;
    private Release release;
    private File downloaded;
    private Operation active;
    private boolean destroyed;

    private static final class Release {
        final String id, target, format, version, url, sha256, revision, manifestHash, repository, source, manifestUrl;
        final long versionCode, bytes, sequence;
        Release(JSObject data, long installedCode) {
            if (data == null) throw new IllegalArgumentException("缺少已检查的发布信息。");
            id = data.getString("id"); target = data.getString("target"); format = data.getString("format"); version = data.getString("version");
            url = data.getString("url"); sha256 = data.getString("sha256"); versionCode = integer(data, "versionCode"); bytes = integer(data, "bytes");
            if (data.has("source") && !(data.opt("source") instanceof String)) throw new IllegalArgumentException("更新发布源无效。");
            source = data.has("source") ? data.getString("source") : "github"; manifestUrl = data.getString("manifestUrl");
            UpdaterPolicy.metadata(id, target, format, version, versionCode, url, sha256, bytes, installedCode, source, manifestUrl);
            revision = data.getString("revision"); manifestHash = data.getString("manifestHash"); repository = data.getString("repository"); sequence = integer(data, "sequence", 9007199254740991L);
            UpdaterPolicy.binding(revision, manifestHash, sequence, repository, url, source, manifestUrl);
        }
        JSObject json() { JSObject out = new JSObject(); out.put("id", id); out.put("target", target); out.put("format", format); out.put("version", version); out.put("versionCode", versionCode); out.put("url", url); out.put("sha256", sha256); out.put("bytes", bytes); out.put("revision", revision); out.put("manifestHash", manifestHash); out.put("sequence", sequence); out.put("repository", repository); out.put("source", source); if (manifestUrl != null && !manifestUrl.isEmpty()) out.put("manifestUrl", manifestUrl); return out; }
        private static long integer(JSObject data, String key) {
            return integer(data, key, UpdaterPolicy.MAX_BYTES);
        }
        private static long integer(JSObject data, String key, long max) {
            Object raw = data.opt(key);
            if (!(raw instanceof Number)) throw new IllegalArgumentException("更新数值字段无效。");
            double number = ((Number) raw).doubleValue();
            if (!Double.isFinite(number) || Math.floor(number) != number || number < 1 || number > max) throw new IllegalArgumentException("更新数值字段无效。");
            return ((Number) raw).longValue();
        }
    }
    private static final class Operation {
        final AtomicBoolean cancelled = new AtomicBoolean();
        final long deadline = System.nanoTime() + 10L * 60 * 1_000_000_000;
        volatile HttpsURLConnection connection;
        void check() throws IOException { if (cancelled.get() || Thread.currentThread().isInterrupted()) throw new IOException("更新操作已取消。"); if (System.nanoTime() > deadline) throw new IOException("更新操作超时。"); }
        void cancel() { cancelled.set(true); HttpsURLConnection value = connection; if (value != null) value.disconnect(); }
    }

    @Override public void load() {
        try { PackageInfo installed = installedInfo(); currentVersion = installed.versionName; versionCode = code(installed); }
        catch (Exception failure) { phase = "error"; error = "无法读取当前应用版本。"; }
    }
    @SuppressWarnings("deprecation") private int signatureFlags() { return Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES; }
    @SuppressWarnings("deprecation") private PackageInfo installedInfo() throws PackageManager.NameNotFoundException { return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), signatureFlags()); }
    @SuppressWarnings("deprecation") private static long code(PackageInfo info) { return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode; }
    @SuppressWarnings("deprecation") private static String[] signers(PackageInfo info) {
        Signature[] signatures = Build.VERSION.SDK_INT >= 28 ? info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners() : info.signatures;
        if (signatures == null) return new String[0];
        String[] hashes = new String[signatures.length];
        for (int i = 0; i < signatures.length; i++) hashes[i] = signatures[i] == null ? null : UpdaterIO.hex(UpdaterIO.sha256().digest(signatures[i].toByteArray()));
        return hashes;
    }
    private boolean trusted() {
        return !destroyed && getActivity() instanceof MainActivity && !getActivity().isFinishing() && !getActivity().isDestroyed()
            && ((MainActivity) getActivity()).hasSecureUpdaterBridge() && ((MainActivity) getActivity()).isUpdaterForeground() && getBridge().getWebView().isShown()
            && UpdaterPolicy.trustedPage(getBridge().getLocalUrl(), getBridge().getWebView().getUrl());
    }
    private void fromMain(PluginCall call, Runnable action) {
        if (getActivity() == null) { call.reject("更新功能只允许由小伴主页面调用。"); return; }
        getActivity().runOnUiThread(() -> {
            if (!trusted()) { call.reject("更新功能只允许由安全的本地主页面调用，请更新 Android System WebView。"); return; }
            try { action.run(); } catch (Exception failure) { call.reject(safeError(failure)); }
        });
    }
    private String safeError(Exception failure) {
        String text = failure.getMessage();
        return text != null && (text.startsWith("更新") || text.startsWith("下载 APK") || text.startsWith("下载文件") || text.startsWith("无法验证 APK") || text.startsWith("缺少已检查")) ? text : "更新操作失败，请重试或检查网络与系统安装器。";
    }
    private boolean installPermission() { return Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls(); }
    private Intent installerIntent(File file) {
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".updater", file);
        Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, MIME).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.setClipData(ClipData.newRawUri("PetPal verified update", uri));
        PackageManager manager = getContext().getPackageManager();
        List<ResolveInfo> system = new ArrayList<>();
        for (ResolveInfo candidate : manager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)) {
            if (candidate.activityInfo != null && candidate.activityInfo.exported && candidate.activityInfo.applicationInfo != null
                && (candidate.activityInfo.applicationInfo.flags & (ApplicationInfo.FLAG_SYSTEM | ApplicationInfo.FLAG_UPDATED_SYSTEM_APP)) != 0) system.add(candidate);
        }
        if (system.isEmpty()) return null;
        ResolveInfo preferred = manager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY);
        ResolveInfo selected = null;
        if (preferred != null && preferred.activityInfo != null) for (ResolveInfo candidate : system) if (candidate.activityInfo.packageName.equals(preferred.activityInfo.packageName) && candidate.activityInfo.name.equals(preferred.activityInfo.name)) selected = candidate;
        if (selected == null && system.size() == 1) selected = system.get(0);
        if (selected == null) return null;
        return intent.setClassName(selected.activityInfo.packageName, selected.activityInfo.name);
    }
    private JSObject snapshot() {
        synchronized (gate) {
            if ("awaiting-permission".equals(phase) && installPermission()) { phase = "downloaded"; message = "已获得安装权限，请再次点击安装更新。"; }
            JSObject out = new JSObject(); out.put("target", "android"); out.put("currentVersion", currentVersion); out.put("versionCode", versionCode);
            out.put("phase", phase); out.put("received", received); out.put("total", release == null ? 0 : release.bytes); out.put("installMode", "android-installer");
            boolean canInstall = active == null && downloaded != null && release != null && downloaded.isFile() && downloaded.length() == release.bytes
                && "downloaded".equals(phase) && installPermission() && installerIntent(downloaded) != null;
            out.put("canInstall", canInstall); if (release != null) out.put("release", release.json()); if (!message.isEmpty()) out.put("message", message); if (!error.isEmpty()) out.put("error", error); return out;
        }
    }
    @PluginMethod public void status(PluginCall call) { fromMain(call, () -> call.resolve(snapshot())); }

    @PluginMethod public void download(PluginCall call) { fromMain(call, () -> {
        final Release requested = new Release(call.getObject("release"), versionCode);
        final Operation operation = new Operation();
        synchronized (gate) {
            if (active != null || "handed-off".equals(phase)) { call.reject("更新操作正在进行，请稍后重试。"); return; }
            if (downloaded != null) downloaded.delete(); downloaded = null;
            release = requested; active = operation; received = 0; phase = "downloading"; message = "正在下载更新…"; error = "";
        }
        worker.execute(() -> downloadFile(requested, operation));
        call.resolve(snapshot());
    }); }

    private void downloadFile(Release requested, Operation operation) {
        String name = UUID.randomUUID().toString();
        File staging = new File(getContext().getCacheDir(), "petpal-updates/staging/" + name + ".part");
        File complete = new File(getContext().getCacheDir(), "petpal-updates/installer/" + name + ".apk");
        try {
            if ((!staging.getParentFile().isDirectory() && !staging.getParentFile().mkdirs()) || (!complete.getParentFile().isDirectory() && !complete.getParentFile().mkdirs())) throw new IOException("更新缓存不可用。");
            URI initial = UpdaterPolicy.initialUrl(requested.url, requested.source, requested.manifestUrl), next = initial;
            HttpsURLConnection connection = null;
            for (int redirects = 0; ; redirects++) {
                operation.check();
                connection = (HttpsURLConnection) next.toURL().openConnection(); operation.connection = connection;
                connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(15000);
                connection.setUseCaches(false); connection.setRequestMethod("GET"); connection.setRequestProperty("Accept", "application/octet-stream");
                connection.setRequestProperty("Accept-Encoding", "identity"); connection.setRequestProperty("User-Agent", "PetPal-Updater/0.6.0");
                // WebView credentials are never part of this native request.
                connection.setRequestProperty("Cookie", ""); connection.setRequestProperty("Authorization", "");
                int status = connection.getResponseCode(); operation.check();
                if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                    String location = connection.getHeaderField("Location"); connection.disconnect(); operation.connection = null;
                    next = UpdaterPolicy.redirect(initial, next, location, redirects + 1, requested.source, requested.manifestUrl); continue;
                }
                if (status != 200) throw new IOException("更新服务器未返回完整文件。");
                String encoding = connection.getHeaderField("Content-Encoding"), length = connection.getHeaderField("Content-Length");
                if (encoding != null && !"identity".equalsIgnoreCase(encoding)) throw new IOException("更新服务器返回了不支持的压缩响应。");
                if (length != null && Long.parseLong(length) != requested.bytes) throw new IOException("更新文件声明大小不匹配。");
                break;
            }
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(staging, false)) {
                UpdaterIO.copyVerified(input, output, requested.bytes, requested.sha256, operation::check, count -> { synchronized (gate) { if (active == operation && !operation.cancelled.get()) received = count; } });
                output.getFD().sync();
            }
            synchronized (gate) { operation.check(); phase = "verifying"; message = "正在校验 APK 版本与安装签名…"; }
            verifyApk(staging, requested, operation);
            synchronized (gate) {
                operation.check(); if (destroyed || active != operation) throw new IOException("更新操作已取消。");
                if (!staging.renameTo(complete)) throw new IOException("更新文件保存失败。");
                downloaded = complete; phase = "downloaded"; message = installPermission() ? "APK 已校验，点击安装交给系统安装器。" : "APK 已校验，安装前需允许小伴安装应用。"; active = null;
            }
        } catch (Exception failure) { fail(operation, failure); complete.delete(); }
        finally { staging.delete(); if (operation.connection != null) operation.connection.disconnect(); synchronized (gate) { if (active == operation) active = null; } }
    }

    private void verifyApk(File file, Release expected, Operation operation) throws Exception {
        operation.check(); if (!file.isFile() || file.length() != expected.bytes) throw new IOException("更新文件大小不匹配。");
        try (InputStream input = new FileInputStream(file)) { UpdaterIO.copyVerified(input, new OutputStream() { @Override public void write(int value) { } @Override public void write(byte[] bytes, int offset, int count) { } }, expected.bytes, expected.sha256, operation::check, count -> { }); }
        PackageInfo installed = installedInfo(), apk = getContext().getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(), signatureFlags());
        if (apk == null) throw new IllegalArgumentException("无法验证 APK 安装签名。");
        UpdaterPolicy.apkIdentity(apk.packageName, code(apk), apk.versionName, signers(installed), signers(apk), code(installed), expected.versionCode, expected.version);
        operation.check();
    }
    private void fail(Operation operation, Exception failure) {
        synchronized (gate) {
            if (active != operation || destroyed) return;
            if (operation.cancelled.get()) { phase = "cancelled"; message = "更新操作已取消。"; error = ""; }
            else { phase = "error"; error = safeError(failure); message = ""; }
        }
    }

    @PluginMethod public void install(PluginCall call) { fromMain(call, () -> {
        final Operation operation = new Operation(); final File file; final Release expected;
        synchronized (gate) {
            if (active != null || downloaded == null || release == null || !("downloaded".equals(phase) || "awaiting-permission".equals(phase))) { call.reject("更新尚未下载并校验完成。"); return; }
            file = downloaded; expected = release; active = operation; phase = "verifying"; error = ""; message = "安装前重新校验 APK…";
        }
        worker.execute(() -> {
            try {
                verifyApk(file, expected, operation);
                getActivity().runOnUiThread(() -> {
                    synchronized (gate) {
                        try {
                            operation.check(); if (!trusted() || active != operation) throw new IOException("更新操作已取消。");
                            if (!installPermission()) {
                                Intent permission = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
                                getActivity().startActivity(permission); phase = "awaiting-permission"; message = "等待系统授权；返回后请再次点击安装更新。";
                            } else {
                                Intent intent = installerIntent(file); if (intent == null) throw new IOException("更新无法找到可用的系统安装器。");
                                getActivity().startActivity(intent); phase = "handed-off"; message = "系统安装器已接管，请在系统界面确认。尚未确认安装成功。";
                            }
                            active = null; call.resolve(snapshot());
                        } catch (Exception failure) { fail(operation, failure); if (active == operation) active = null; call.resolve(snapshot()); }
                    }
                });
            } catch (Exception failure) { fail(operation, failure); synchronized (gate) { if (active == operation) active = null; } call.resolve(snapshot()); }
        });
    }); }

    @PluginMethod public void cancel(PluginCall call) { fromMain(call, () -> {
        synchronized (gate) {
            if ("handed-off".equals(phase)) { message = "系统安装器已经接管，请在系统界面取消。"; call.resolve(snapshot()); return; }
            if (active != null) active.cancel();
            if (downloaded != null) downloaded.delete(); downloaded = null;
            phase = "cancelled"; message = "更新操作已取消。"; error = "";
        }
        call.resolve(snapshot());
    }); }
    @Override protected void handleOnDestroy() {
        synchronized (gate) { destroyed = true; if (active != null) active.cancel(); if (downloaded != null && !"handed-off".equals(phase)) downloaded.delete(); }
        worker.shutdownNow(); super.handleOnDestroy();
    }
}
