package com.petpal.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class BackNavigationPolicyTest {
    private static final String LOCAL = "https://localhost";
    private static final String CHAT = LOCAL + "/?chat=1";

    @Test public void acceptsOnlyTheLocalMainPageOriginAndRejectsOverlayUrls() {
        assertTrue(BackNavigationPolicy.trustedPage(LOCAL, CHAT));
        assertTrue(BackNavigationPolicy.trustedPage(LOCAL + "/", LOCAL + "/?settings=1"));
        for (String bad : new String[] { null, "", "about:blank", "http://localhost/?chat=1", "https://example.test/?chat=1",
            "https://localhost.example.test/?chat=1", "https://localhost:443/?chat=1", "https://user@localhost/?chat=1",
            LOCAL + "/?overlay=1", LOCAL + "/?pet=1", LOCAL + "/?%6fverlay=1", LOCAL + "/?%70et=1" }) {
            assertFalse(String.valueOf(bad), BackNavigationPolicy.trustedPage(LOCAL, bad));
        }
        assertFalse(BackNavigationPolicy.trustedPage("https://example.test", CHAT));
        assertFalse(BackNavigationPolicy.trustedPage("http://localhost", CHAT));
    }

    @Test public void onePendingPressCanBeConsumedAndASecondPressWaitsForCompletion() {
        BackNavigationPolicy policy = new BackNavigationPolicy();
        BackNavigationPolicy.Request first = policy.begin(LOCAL, CHAT);
        assertNotNull(first); assertTrue(policy.isPending()); assertNull(policy.begin(LOCAL, CHAT));
        assertEquals(BackNavigationPolicy.Result.CONSUMED, policy.complete(first, LOCAL, CHAT, true, "true"));
        assertFalse(policy.isPending()); assertNotNull(policy.begin(LOCAL, CHAT));
    }

    @Test public void anUnconsumedPressCanReachSystemBackExactlyOnce() {
        BackNavigationPolicy policy = new BackNavigationPolicy();
        BackNavigationPolicy.Request request = policy.begin(LOCAL, CHAT);
        assertEquals(BackNavigationPolicy.Result.FALLBACK, policy.complete(request, LOCAL, CHAT, true, "false"));
        assertEquals(BackNavigationPolicy.Result.IGNORED, policy.complete(request, LOCAL, CHAT, true, "false"));
        assertEquals(BackNavigationPolicy.Result.IGNORED, policy.complete(request, LOCAL, CHAT, true, "true"));
    }

    @Test public void navigationIncludingSameUrlReloadInvalidatesTheOldMainFrameRequest() {
        BackNavigationPolicy policy = new BackNavigationPolicy();
        BackNavigationPolicy.Request request = policy.begin(LOCAL, CHAT);
        assertEquals(BackNavigationPolicy.Result.IGNORED, policy.complete(request, LOCAL, LOCAL + "/", true, "false"));
        BackNavigationPolicy.Request beforeReload = policy.begin(LOCAL, CHAT);
        policy.cancel();
        BackNavigationPolicy.Request afterReload = policy.begin(LOCAL, CHAT);
        assertEquals(BackNavigationPolicy.Result.IGNORED, policy.complete(beforeReload, LOCAL, CHAT, true, "false"));
        assertTrue(policy.isPending());
        assertEquals(BackNavigationPolicy.Result.CONSUMED, policy.complete(afterReload, LOCAL, CHAT, true, "true"));
    }

    @Test public void foregroundLossDifferentWebviewAndOriginChangesCannotExitFromALateCallback() {
        for (String changed : new String[] { CHAT, "https://example.test/?chat=1", LOCAL + "/?overlay=1" }) {
            BackNavigationPolicy policy = new BackNavigationPolicy();
            BackNavigationPolicy.Request request = policy.begin(LOCAL, CHAT);
            assertEquals(BackNavigationPolicy.Result.IGNORED, policy.complete(request, LOCAL, changed, false, "false"));
            assertFalse(policy.isPending());
        }
        BackNavigationPolicy policy = new BackNavigationPolicy();
        BackNavigationPolicy.Request request = policy.begin(LOCAL, CHAT);
        assertEquals(BackNavigationPolicy.Result.IGNORED, policy.complete(request, "https://example.test", CHAT, true, "false"));
    }

    @Test public void onlyAnExactBooleanJavascriptResultCanSelectFallback() {
        for (String value : new String[] { null, "null", "undefined", "\"false\"", "0", "{}", "", "false " }) {
            BackNavigationPolicy policy = new BackNavigationPolicy();
            BackNavigationPolicy.Request request = policy.begin(LOCAL, CHAT);
            assertEquals(String.valueOf(value), BackNavigationPolicy.Result.IGNORED, policy.complete(request, LOCAL, CHAT, true, value));
            assertFalse(policy.isPending());
        }
    }

    @Test public void cancellationCannotConsumeOrReleaseTheNextPress() {
        BackNavigationPolicy policy = new BackNavigationPolicy();
        BackNavigationPolicy.Request old = policy.begin(LOCAL, CHAT);
        policy.cancel();
        BackNavigationPolicy.Request current = policy.begin(LOCAL, CHAT);
        assertEquals(BackNavigationPolicy.Result.IGNORED, policy.complete(old, LOCAL, CHAT, true, "false"));
        assertTrue(policy.isPending());
        assertEquals(BackNavigationPolicy.Result.FALLBACK, policy.complete(current, LOCAL, CHAT, true, "false"));
    }

    @Test public void anUntrustedPageNeverAllocatesAPendingHandoff() {
        BackNavigationPolicy policy = new BackNavigationPolicy();
        assertNull(policy.begin(LOCAL, "https://example.test"));
        assertNull(policy.begin(LOCAL, LOCAL + "/?pet=1"));
        assertFalse(policy.isPending());
        assertEquals(BackNavigationPolicy.Result.IGNORED, policy.complete(null, LOCAL, CHAT, true, "false"));
    }
}
