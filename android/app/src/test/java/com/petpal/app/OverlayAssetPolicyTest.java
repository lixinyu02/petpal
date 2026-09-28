package com.petpal.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class OverlayAssetPolicyTest {
    @Test public void mapsEntryAndViteAbsoluteAssetsToTheSamePublicRoot() {
        assertEquals("public/index.html", OverlayAssetPolicy.assetPath(OverlayAssetPolicy.ENTRY_URL, "GET"));
        assertEquals("public/assets/main.js", OverlayAssetPolicy.assetPath("https://appassets.androidplatform.net/assets/main.js", "GET"));
        assertEquals("public/pets/model.glb", OverlayAssetPolicy.assetPath("https://appassets.androidplatform.net/pets/model.glb", "GET"));
        assertEquals("public/assets/main.css", OverlayAssetPolicy.resourcePath("assets/public/assets/main.css"));
    }

    @Test public void preventsExternalNetworkSchemesCredentialsAndWrites() {
        String[] blocked = {"https://example.com/model.glb", "http://appassets.androidplatform.net/index.html", "file:///etc/passwd",
            "content://appassets.androidplatform.net/secret", "https://appassets.androidplatform.net.evil.test/index.html",
            "https://user@appassets.androidplatform.net/index.html", "https://appassets.androidplatform.net:8000/index.html"};
        for (String url : blocked) assertNull(url, OverlayAssetPolicy.assetPath(url, "GET"));
        assertNull(OverlayAssetPolicy.assetPath(OverlayAssetPolicy.ENTRY_URL, "POST"));
        assertNull(OverlayAssetPolicy.assetPath(OverlayAssetPolicy.ENTRY_URL, "PUT"));
    }

    @Test public void preventsEscapingThePublicDirectoryIncludingEncodedPaths() {
        String[] paths = {"/../secret", "/assets/../../secret", "/assets/%2e%2e/secret", "/assets/%2e%2e%2fsecret", "/assets/%5csecret", "/assets/%00secret"};
        for (String path : paths) assertNull(path, OverlayAssetPolicy.assetPath("https://appassets.androidplatform.net" + path, "GET"));
        assertNull(OverlayAssetPolicy.resourcePath("//outside/file"));
        assertNull(OverlayAssetPolicy.resourcePath("assets/./main.js"));
    }

    @Test public void navigationCanOnlyReturnToTheFixedOverlayRoute() {
        assertTrue(OverlayAssetPolicy.canNavigate(OverlayAssetPolicy.ENTRY_URL));
        assertTrue(OverlayAssetPolicy.canNavigate(OverlayAssetPolicy.entryUrl("cat")));
        assertFalse(OverlayAssetPolicy.canNavigate("https://appassets.androidplatform.net/assets/public/index.html?chat=1"));
        assertFalse(OverlayAssetPolicy.canNavigate("https://appassets.androidplatform.net/assets/public/index.html?overlay=1&avatar=https://example.com"));
        assertFalse(OverlayAssetPolicy.canNavigate(OverlayAssetPolicy.ENTRY_URL + "&next=https://example.com"));
        assertFalse(OverlayAssetPolicy.canNavigate("https://example.com"));
        assertFalse(OverlayAssetPolicy.canNavigate("javascript:alert(1)"));
    }

    @Test public void companionKindIsOnlyAnimeOrCatWithAnimeDefault() {
        assertEquals("cat", OverlayAssetPolicy.normalizeCompanionKind("cat"));
        assertEquals("anime", OverlayAssetPolicy.normalizeCompanionKind("anime"));
        for (String kind : new String[] { null, "", "CAT", "unknown", "cat&next=https://example.com", "../cat" }) {
            assertEquals("anime", OverlayAssetPolicy.normalizeCompanionKind(kind));
            assertEquals(OverlayAssetPolicy.ENTRY_URL, OverlayAssetPolicy.entryUrl(kind));
        }
    }
}
