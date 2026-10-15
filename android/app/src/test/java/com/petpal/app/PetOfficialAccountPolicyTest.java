package com.petpal.app;

import java.nio.charset.StandardCharsets;
import org.junit.Test;
import static org.junit.Assert.*;

public class PetOfficialAccountPolicyTest {
    @Test public void backendRequiresHttpsWithoutCredentialQueryOrUnexpectedPath() {
        assertEquals("https://magicdatou.top:44318", PetOfficialAccountPolicy.backend("https://magicdatou.top:44318/").toString());
        assertEquals("https://192.168.60.230:8317", PetOfficialAccountPolicy.backend("https://192.168.60.230:8317").toString());
        assertEquals("http://127.0.0.1:4318", PetOfficialAccountPolicy.backend("http://127.0.0.1:4318").toString());
        assertEquals("https://example.test", PetOfficialAccountPolicy.backend("https://EXAMPLE.TEST:443/").toString());
        for (String value : new String[] { "http://192.168.60.1", "https://user:secret@a.test", "https://a.test/v1", "https://a.test?token=x", "https://a.test#secret", "https://a.test:0", "https://a.test:65536", "https://a.test\\path", "https://a.test\n", "file:///private" }) assertThrows(value, IllegalArgumentException.class, () -> PetOfficialAccountPolicy.backend(value));
    }
    @Test public void callbackRejectsWrongStateDuplicatesOrForeignPath() {
        assertEquals("secret-code", PetOfficialAccountPolicy.callback("/auth/callback?state=known&code=secret-code&client_id=real", "known").get("code"));
        for (String value : new String[] { "/auth/callback?state=wrong&code=x", "/auth/callback?state=known&state=known&code=x", "/auth/callback?state=known&code=x&code=y", "http://127.0.0.1/auth/callback?state=known&code=x", "//evil.test/auth/callback?state=known", "/auth/callback?state=known#x", "/other?state=known&code=x", "/auth/callback?state=known&bad=%XX" }) assertThrows(value, IllegalArgumentException.class, () -> PetOfficialAccountPolicy.callback(value, "known"));
    }
    @Test public void uuidAndHeaderValuesRejectInjection() {
        assertEquals("a41d9b70-f7b9-49d0-a7bd-720f8d5c6db2", PetOfficialAccountPolicy.uuid("a41d9b70-f7b9-49d0-a7bd-720f8d5c6db2"));
        assertThrows(IllegalArgumentException.class, () -> PetOfficialAccountPolicy.uuid("../scope"));
        assertThrows(IllegalArgumentException.class, () -> PetOfficialAccountPolicy.text("token\r\nCookie: x", 100, false));
        assertFalse(PetOfficialAccountPolicy.equal("one", "two")); assertTrue(PetOfficialAccountPolicy.equal("one", "one")); assertFalse(PetOfficialAccountPolicy.equal(null, "one"));
    }
    @Test public void chunkingPreservesUtf8IncludingEmojiAtEveryBoundary() {
        String original = "a中文🧡b".repeat(12000), remaining = original; StringBuilder result = new StringBuilder();
        while (!remaining.isEmpty()) { int end = PetOfficialAccountPolicy.utf8Boundary(remaining, 48 * 1024); assertTrue(end > 0); String chunk = remaining.substring(0, end); assertTrue(chunk.getBytes(StandardCharsets.UTF_8).length <= 48 * 1024); assertEquals(chunk, new String(chunk.getBytes(StandardCharsets.UTF_8), StandardCharsets.UTF_8)); result.append(chunk); remaining = remaining.substring(end); }
        assertEquals(original, result.toString());
        assertEquals(0, PetOfficialAccountPolicy.utf8Boundary("🧡", 3)); assertEquals(2, PetOfficialAccountPolicy.utf8Boundary("🧡", 4));
    }
    @Test public void usageRejectsFractionsNegativesAndUnsafeIntegers() {
        assertEquals(12L, PetOfficialAccountPolicy.count(12));
        for (Object value : new Object[] { null, "12", -1, 0.5, Double.NaN, Double.POSITIVE_INFINITY, Long.MAX_VALUE }) assertEquals(0L, PetOfficialAccountPolicy.count(value));
        assertEquals(9007199254740991L, PetOfficialAccountPolicy.add(9007199254740990L, 2));
    }
}
