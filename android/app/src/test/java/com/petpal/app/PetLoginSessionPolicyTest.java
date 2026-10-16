package com.petpal.app;

import static org.junit.Assert.*;
import org.junit.Test;

public class PetLoginSessionPolicyTest {
    @Test public void validServiceOriginsAndPathsRetainTheirExactDestination() {
        assertEquals("https://magicdatou.top:44318", PetLoginSessionPolicy.url("https://magicdatou.top:44318/"));
        assertEquals("https://example.test/petpal", PetLoginSessionPolicy.url("https://example.test/petpal/"));
        assertEquals("HTTPS://EXAMPLE.test", PetLoginSessionPolicy.url("HTTPS://EXAMPLE.test/"));
        assertEquals("http://127.0.0.1:4318", PetLoginSessionPolicy.url("http://127.0.0.1:4318"));
        for (String value : new String[] { "", "file:///private", "https://user:password@example.test", "https://example.test?token=x", "https://example.test#token", "https://example.test:0", "https://example.test:65536", "https://example.test\n", "https://example.test\\private", "https:// example.test" }) assertThrows(IllegalArgumentException.class, () -> PetLoginSessionPolicy.url(value));
    }
    @Test public void onlyExistingRemoteCredentialKindsAreSaved() {
        assertEquals("session", PetLoginSessionPolicy.kind("session")); assertEquals("pairing", PetLoginSessionPolicy.kind("pairing"));
        assertEquals("remote", PetLoginSessionPolicy.target("remote")); assertEquals("synthetic-token", PetLoginSessionPolicy.token("synthetic-token"));
        for (String value : new String[] { "none", "password", "owner", "" }) assertThrows(IllegalArgumentException.class, () -> PetLoginSessionPolicy.kind(value));
        for (String value : new String[] { "local", "", "future" }) assertThrows(IllegalArgumentException.class, () -> PetLoginSessionPolicy.target(value));
        for (String value : new String[] { "", "with spaces", "newline\n", "multiple\r\ncontrols", "x".repeat(4097) }) assertThrows(IllegalArgumentException.class, () -> PetLoginSessionPolicy.token(value));
    }
}
