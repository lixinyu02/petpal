package com.petpal.app;

import java.net.URI;
import org.junit.Test;
import static org.junit.Assert.*;

public class UpdaterPolicyTest {
    private static final String URL = "https://github.com/lixinyu02/petpal/releases/download/v0.7.0/PetPal-0.7.0-Android.apk";
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
}
