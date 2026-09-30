package com.petpal.app;

import java.net.URI;
import org.junit.Test;
import static org.junit.Assert.*;

public class UpdaterPolicyTest {
    private static final String URL = "https://github.com/lixinyu02/petpal/releases/download/v0.7.0/PetPal-0.7.0-Android.apk";
    private static final String MANIFEST = "https://magicdatou.top:44318/updates/stable/petpal-update.json";
    private static final String SERVER_APK = "https://magicdatou.top:44318/updates/stable/android/PetPal-0.9.0-Android.apk";
    private static final String SHA = new String(new char[64]).replace('\0', 'a');
    @Test public void acceptsOnlyExactGithubReleaseApkAssets() {
        assertEquals(URL, UpdaterPolicy.initialUrl(URL).toString());
        String[] rejected = { "http://github.com/o/r/releases/download/v1/a.apk", URL + "?token=private", URL + "#x", URL.replace("github.com", "github.com.evil.test"),
            URL.replace("github.com", "user:secret@github.com"), URL.replace("github.com", "github.com:443"), URL.replace("v0.7.0", ".."), URL.replace("v0.7.0", "%2f.."),
            URL.replace(".apk", ".exe"), URL.replace("/download/", "/latest/download/"), "file:///tmp/app.apk", "content://download/app.apk", URL + "/", URL + "\nfoo\n" };
        for (String value : rejected) assertThrows(value, IllegalArgumentException.class, () -> UpdaterPolicy.initialUrl(value));
    }
    @Test public void limitsRedirectHostRepositoryAndCount() {
        URI original = UpdaterPolicy.initialUrl(URL);
        URI asset = UpdaterPolicy.redirect(original, original, "https://release-assets.githubusercontent.com/github-production-release-asset/123/app?sp=r&sig=test", 1);
        assertEquals("release-assets.githubusercontent.com", asset.getHost());
        assertEquals(original, UpdaterPolicy.redirect(original, original, URL, 3));
        for (String bad : new String[]{ "https://evil.test/app.apk", "http://release-assets.githubusercontent.com/a", "https://release-assets.githubusercontent.com.evil.test/a", "https://github.com/other/petpal/releases/download/v1/a.apk", "https://user@release-assets.githubusercontent.com/a", "https://release-assets.githubusercontent.com:443/a", "//localhost/a.apk" }) {
            assertThrows(bad, IllegalArgumentException.class, () -> UpdaterPolicy.redirect(original, original, bad, 1));
        }
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.redirect(original, original, asset.toString(), 4));
    }
    @Test public void supportsServerApkWithinTheManifestDirectoryAndPort() {
        assertEquals(SERVER_APK, UpdaterPolicy.initialUrl(SERVER_APK, "server", MANIFEST).toString());
        String sameDirectory = "https://magicdatou.top:44318/updates/stable/PetPal.apk";
        assertEquals(sameDirectory, UpdaterPolicy.initialUrl(sameDirectory, "server", MANIFEST).toString());
        assertEquals("https://magicdatou.top/updates/PetPal.apk", UpdaterPolicy.initialUrl("https://magicdatou.top/updates/PetPal.apk", "server", "https://magicdatou.top/updates/petpal-update.json").toString());
        assertEquals("https://magicdatou.top:443/updates/PetPal.apk", UpdaterPolicy.initialUrl("https://magicdatou.top:443/updates/PetPal.apk", "server", "https://magicdatou.top/updates/petpal-update.json").toString());
        assertEquals("https://192.168.60.230:44318/updates/PetPal.apk", UpdaterPolicy.initialUrl("https://192.168.60.230:44318/updates/PetPal.apk", "server", "https://192.168.60.230:44318/updates/petpal-update.json").toString());
        assertEquals("https://magicdatou.top:44318/updates/stable/android/download", UpdaterPolicy.initialUrl("https://magicdatou.top:44318/updates/stable/android/download", "server", MANIFEST).toString());
    }
    @Test public void rejectsAmbiguousOrUnsafeServerManifestAddresses() {
        String[] rejected = { null, "", MANIFEST.replace("https:", "http:"), MANIFEST + "?key=private", MANIFEST + "#hash",
            MANIFEST.replace("magicdatou.top", "user:password@magicdatou.top"), MANIFEST.replace("44318", "0"), MANIFEST.replace("44318", "65536"),
            MANIFEST.replace("petpal-update.json", "other.json"), MANIFEST.replace("/stable/", "/stable//"), MANIFEST.replace("/stable/", "/stable/./"),
            MANIFEST.replace("/stable/", "/stable/../stable/"), MANIFEST.replace("stable", "%73table"), MANIFEST.replace("stable", "stable\\child"),
            MANIFEST.replace("stable", "稳定版"), MANIFEST + "\n" };
        for (String manifest : rejected) assertThrows(String.valueOf(manifest), IllegalArgumentException.class, () -> UpdaterPolicy.initialUrl(SERVER_APK, "server", manifest));
    }
    @Test public void rejectsServerApkOutsideBoundOriginAndDirectoryBeforeNormalization() {
        String[] rejected = { SERVER_APK.replace("https:", "http:"), SERVER_APK.replace("magicdatou.top", "other.test"),
            SERVER_APK.replace("magicdatou.top", "magicdatou.top.evil.test"), SERVER_APK.replace(":44318", ""), SERVER_APK.replace(":44318", ":44319"),
            SERVER_APK.replace("magicdatou.top", "user:secret@magicdatou.top"), SERVER_APK.replace("/stable/android/", "/elsewhere/android/"),
            SERVER_APK.replace("/stable/android/", "/stable-other/android/"), SERVER_APK.replace("/android/", "/android//"),
            SERVER_APK.replace("/android/", "/android/../android/"), SERVER_APK.replace("/android/", "/android/./"),
            SERVER_APK.replace("android", "%61ndroid"), SERVER_APK.replace("/android/", "/android%2f/"), SERVER_APK.replace("/android/", "/android\\child/"),
            SERVER_APK + "?token=private", SERVER_APK + "#x", SERVER_APK + "/", SERVER_APK + "\r\n" };
        for (String url : rejected) assertThrows(url, IllegalArgumentException.class, () -> UpdaterPolicy.initialUrl(url, "server", MANIFEST));
    }
    @Test public void serverRedirectsRemainWithinDirectoryAndRejectRawTraversal() {
        URI original = UpdaterPolicy.initialUrl(SERVER_APK, "server", MANIFEST);
        URI relative = UpdaterPolicy.redirect(original, original, "new/PetPal-new.apk", 1, "server", MANIFEST);
        assertEquals("https://magicdatou.top:44318/updates/stable/android/new/PetPal-new.apk", relative.toString());
        assertEquals(original, UpdaterPolicy.redirect(original, relative, SERVER_APK, 3, "server", MANIFEST));
        assertEquals("https://magicdatou.top:44318/updates/stable/PetPal.apk", UpdaterPolicy.redirect(original, original, "/updates/stable/PetPal.apk", 1, "server", MANIFEST).toString());
        assertEquals("https://magicdatou.top:44318/updates/stable/android/download", UpdaterPolicy.redirect(original, original, "download", 1, "server", MANIFEST).toString());
        String[] rejected = { "../PetPal.apk", "./PetPal.apk", "new/../PetPal.apk", "new/%2e%2e/PetPal.apk", "new//PetPal.apk", "new\\PetPal.apk",
            "//other.test/updates/stable/PetPal.apk", "//magicdatou.top:44318/updates/stable/PetPal.apk", "https://magicdatou.top:44319/updates/stable/PetPal.apk", "https://user@magicdatou.top:44318/updates/stable/PetPal.apk",
            "/outside/PetPal.apk", "https://release-assets.githubusercontent.com/asset.apk?sig=test", "PetPal.apk?token=private", "PetPal.apk#x", "", null };
        for (String location : rejected) assertThrows(String.valueOf(location), IllegalArgumentException.class, () -> UpdaterPolicy.redirect(original, original, location, 1, "server", MANIFEST));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.redirect(original, original, SERVER_APK, 4, "server", MANIFEST));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.redirect(original, original, SERVER_APK, 0, "server", MANIFEST));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.redirect(original, URI.create("https://other.test/updates/stable/PetPal.apk"), SERVER_APK, 1, "server", MANIFEST));
    }
    @Test public void legacyGithubOverloadsAndOfficialCdnRemainSupported() {
        assertEquals(UpdaterPolicy.initialUrl(URL), UpdaterPolicy.initialUrl(URL, null, null));
        assertEquals(UpdaterPolicy.initialUrl(URL), UpdaterPolicy.initialUrl(URL, "github", ""));
        URI original = UpdaterPolicy.initialUrl(URL);
        String cdn = "https://release-assets.githubusercontent.com/github-production-release-asset/123/app?sp=r&sig=test";
        assertEquals(UpdaterPolicy.redirect(original, original, cdn, 1), UpdaterPolicy.redirect(original, original, cdn, 1, "github", null));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.initialUrl(URL, "mirror", null));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.initialUrl(URL, "github", MANIFEST));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.initialUrl(SERVER_APK, null, MANIFEST));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.initialUrl(URL, "server", MANIFEST));
    }
    @Test public void rejectsDowngradesAndInvalidMetadataBeforeDownloading() {
        UpdaterPolicy.metadata("android-7", "android", "apk", "0.7.0", 7, URL, SHA, 123, 6);
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.metadata("id", "android", "apk", "0.7.0", 6, URL, SHA, 123, 6));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.metadata("id", "android", "apk", "0.7.0", 7, URL, SHA, UpdaterPolicy.MAX_BYTES + 1, 6));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.metadata("id", "android", "apk", "0.7.0", 7, URL, "not-a-hash", 123, 6));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.metadata("id", "windows-x64", "apk", "0.7.0", 7, URL, SHA, 123, 6));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.metadata("id", "android", "apk", "0.7.0-beta", 7, URL, SHA, 123, 6));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.metadata("id\nfoo\n", "android", "apk", "0.7.0", 7, URL, SHA, 123, 6));
    }
    @Test public void comparesActualApkPackageVersionAndAllCurrentSigners() {
        UpdaterPolicy.apkIdentity("com.petpal.app", 7, "0.7.0", new String[]{"a", "b"}, new String[]{"b", "a"}, 6, 7, "0.7.0");
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.apkIdentity("com.evil.app", 7, "0.7.0", new String[]{"a"}, new String[]{"a"}, 6, 7, "0.7.0"));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.apkIdentity("com.petpal.app", 6, "0.7.0", new String[]{"a"}, new String[]{"a"}, 6, 7, "0.7.0"));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.apkIdentity("com.petpal.app", 7, "0.8.0", new String[]{"a"}, new String[]{"a"}, 6, 7, "0.7.0"));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.apkIdentity("com.petpal.app", 7, "0.7.0", new String[]{"a", "b"}, new String[]{"a"}, 6, 7, "0.7.0"));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.apkIdentity("com.petpal.app", 7, "0.7.0", new String[]{"a"}, new String[]{"new-key"}, 6, 7, "0.7.0"));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.apkIdentity("com.petpal.app", 7, "0.7.0", new String[]{"a"}, new String[]{"a", "a"}, 6, 7, "0.7.0"));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.apkIdentity("com.petpal.app", 7, "0.7.0", new String[]{"a"}, new String[0], 6, 7, "0.7.0"));
    }
    @Test public void onlyLocalMainPageMayUseNativeUpdater() {
        assertTrue(UpdaterPolicy.trustedPage("https://localhost", "https://localhost/?chat=1"));
        for (String page : new String[]{ "https://evil.test/", "http://localhost/", "https://localhost.evil.test/", "https://user@localhost/", "https://localhost:443/", "https://localhost/?overlay=1", "https://localhost/?pet=1", "https://localhost/?%6fverlay=1", "https://appassets.androidplatform.net/assets/public/index.html", "file:///android_asset/public/index.html", "about:blank" }) assertFalse(page, UpdaterPolicy.trustedPage("https://localhost", page));
        assertFalse(UpdaterPolicy.trustedPage("https://remote.example", "https://remote.example"));
    }
    @Test public void bindsOpaqueCheckIdentityAndExactRepository() {
        UpdaterPolicy.binding("revision-1", SHA, 42, "lixinyu02/petpal", URL);
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.binding(null, SHA, 42, "lixinyu02/petpal", URL));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.binding("revision-1", "bad", 42, "lixinyu02/petpal", URL));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.binding("revision-1", SHA, 0, "lixinyu02/petpal", URL));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.binding("revision-1", SHA, 9007199254740992L, "lixinyu02/petpal", URL));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.binding("revision-1", SHA, 42, "other/petpal", URL));
    }
    @Test public void serverMetadataPreservesVersionSizeAndCheckBindingRequirements() {
        UpdaterPolicy.metadata("android-9", "android", "apk", "0.9.0", 11, SERVER_APK, SHA, 123, 10, "server", MANIFEST);
        UpdaterPolicy.binding("revision-server", SHA, 43, null, SERVER_APK, "server", MANIFEST);
        UpdaterPolicy.binding("revision-server", SHA, 43, "lixinyu02/petpal", SERVER_APK, "server", MANIFEST);
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.metadata("android-9", "android", "apk", "0.9.0", 10, SERVER_APK, SHA, 123, 10, "server", MANIFEST));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.metadata("android-9", "android", "apk", "0.9.0", 11, SERVER_APK, SHA, UpdaterPolicy.MAX_BYTES + 1, 10, "server", MANIFEST));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.binding(null, SHA, 43, "", SERVER_APK, "server", MANIFEST));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.binding("revision-server", "bad", 43, "", SERVER_APK, "server", MANIFEST));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.binding("revision-server", SHA, 0, "", SERVER_APK, "server", MANIFEST));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.binding("revision-server", SHA, 9007199254740992L, "", SERVER_APK, "server", MANIFEST));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.binding("revision-server", SHA, 43, "", SERVER_APK, "server", MANIFEST.replace("/stable/", "/other/")));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.binding("revision-server", SHA, 43, "lixinyu02/petpal", SERVER_APK, "github", null));
        assertThrows(IllegalArgumentException.class, () -> UpdaterPolicy.binding("revision-server", SHA, 43, "other/petpal", URL, "github", null));
    }
}
