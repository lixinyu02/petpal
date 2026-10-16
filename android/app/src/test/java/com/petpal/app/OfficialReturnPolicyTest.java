package com.petpal.app;

import static org.junit.Assert.*;
import org.junit.Test;

/** The return route is a strict navigation capability, never an OAuth callback. */
public class OfficialReturnPolicyTest {
    private static final String TICKET = "A".repeat(42) + "_";
    private static final String NONCE = "B".repeat(42) + "-";

    @Test public void exactReturnRouteRoundTripsWithoutOauthParameters() {
        String uri = OfficialReturnPolicy.uri(TICKET);
        assertEquals("petpal://official-account/return?ticket=" + TICKET, uri);
        assertEquals(TICKET, OfficialReturnPolicy.parse(uri));
        assertEquals("intent://official-account/return?ticket=" + TICKET + "#Intent;scheme=petpal;package=com.petpal.app;end", OfficialReturnPolicy.intent(TICKET));
    }

    @Test public void forgedAuthorityPathQueryFragmentAndOversizedInputAreRejected() {
        String route = OfficialReturnPolicy.uri(TICKET);
        for (String value : new String[] {
            null, "", "petpal:official-account/return?ticket=" + TICKET,
            "PETPAL://official-account/return?ticket=" + TICKET,
            "petpal://OFFICIAL-ACCOUNT/return?ticket=" + TICKET,
            "https://official-account/return?ticket=" + TICKET,
            "petpal://official-account.evil/return?ticket=" + TICKET,
            "petpal://user@official-account/return?ticket=" + TICKET,
            "petpal://official-account:80/return?ticket=" + TICKET,
            "petpal://official-account/return/?ticket=" + TICKET,
            "petpal://official-account//return?ticket=" + TICKET,
            "petpal://official-account/%72eturn?ticket=" + TICKET,
            "petpal://official-account/other?ticket=" + TICKET,
            "petpal://official-account/return", "petpal://official-account/return?ticket=",
            "petpal://official-account/return?TICKET=" + TICKET,
            "petpal://official-account/return?ticket=%41" + TICKET.substring(1),
            route + "&ticket=" + TICKET, route + "&code=secret", route + "&state=secret",
            route + "&", route + "=", route + "#", route + "#fragment", route + "\r\n",
            "petpal://official-account/return?ticket=" + "A".repeat(300),
            OfficialReturnPolicy.intent(TICKET)
        }) assertThrows(String.valueOf(value), IllegalArgumentException.class, () -> OfficialReturnPolicy.parse(value));
    }

    @Test public void ticketsAndCspNoncesHaveFixedUnambiguousSafeAlphabet() {
        for (String value : new String[] { null, "", "A".repeat(42), "A".repeat(44), "A".repeat(42) + "=", "A".repeat(42) + "+", "A".repeat(42) + "/", "A".repeat(42) + " ", "A".repeat(42) + "\n", "A".repeat(42) + "'", "A".repeat(42) + "中" }) {
            assertThrows(IllegalArgumentException.class, () -> OfficialReturnPolicy.ticket(value));
            assertThrows(IllegalArgumentException.class, () -> OfficialReturnPolicy.uri(value));
            assertThrows(IllegalArgumentException.class, () -> OfficialReturnPolicy.intent(value));
            assertThrows(IllegalArgumentException.class, () -> OfficialReturnPolicy.csp(value));
            assertThrows(IllegalArgumentException.class, () -> OfficialReturnPolicy.html(value, NONCE));
            assertThrows(IllegalArgumentException.class, () -> OfficialReturnPolicy.html(TICKET, value));
        }
    }

    @Test public void monotonicExpiryRejectsBoundaryNegativeAndOverflowedValues() {
        assertTrue(OfficialReturnPolicy.live(0, 1)); assertTrue(OfficialReturnPolicy.live(99, 100));
        assertFalse(OfficialReturnPolicy.live(100, 100)); assertFalse(OfficialReturnPolicy.live(101, 100));
        assertFalse(OfficialReturnPolicy.live(-1, 100)); assertFalse(OfficialReturnPolicy.live(0, 0));
        assertFalse(OfficialReturnPolicy.live(0, Long.MIN_VALUE)); assertFalse(OfficialReturnPolicy.live(Long.MAX_VALUE, Long.MIN_VALUE));
        assertTrue(OfficialReturnPolicy.live(Long.MAX_VALUE - 1, Long.MAX_VALUE)); assertFalse(OfficialReturnPolicy.live(Long.MAX_VALUE, Long.MAX_VALUE));
    }

    @Test public void returnPageKeepsManualFallbackAndNeverContainsOauthCredentials() {
        String html = OfficialReturnPolicy.html(TICKET, NONCE), csp = OfficialReturnPolicy.csp(NONCE);
        assertTrue(html.contains("href=\"" + OfficialReturnPolicy.intent(TICKET) + "\""));
        assertTrue(html.contains("href=\"" + OfficialReturnPolicy.uri(TICKET) + "\""));
        assertTrue(html.contains("window.location.replace('" + OfficialReturnPolicy.intent(TICKET) + "')"));
        assertTrue(html.contains("正在验证")); assertTrue(html.contains("以小伴中的账号状态为准"));
        assertTrue(html.contains("<script nonce=\"" + NONCE + "\"")); assertTrue(html.contains("<style nonce=\"" + NONCE + "\""));
        assertTrue(html.contains("name=\"referrer\" content=\"no-referrer\""));
        for (String field : new String[] { "code=", "state=", "access_token", "refresh_token", "id_token", "code_verifier", "client_id", "http://", "https://" }) assertFalse(field, html.contains(field));
        assertTrue(csp.contains("default-src 'none'")); assertTrue(csp.contains("script-src 'nonce-" + NONCE + "'")); assertTrue(csp.contains("style-src 'nonce-" + NONCE + "'"));
        assertTrue(csp.contains("base-uri 'none'")); assertTrue(csp.contains("frame-ancestors 'none'")); assertTrue(csp.contains("form-action 'none'")); assertFalse(csp.contains("unsafe-inline")); assertFalse(csp.contains("unsafe-eval"));
    }
}
