package com.petpal.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class ScreenInsetsPolicyTest {
    private final ScreenInsetsPolicy.Edges zero = new ScreenInsetsPolicy.Edges(0, 0, 0, 0);
    private void equals(ScreenInsetsPolicy.Edges value, int left, int top, int right, int bottom) {
        assertEquals(left, value.left); assertEquals(top, value.top);
        assertEquals(right, value.right); assertEquals(bottom, value.bottom);
    }

    @Test public void imeAndNavigationOverlapRatherThanAddingTwoBottomGaps() {
        equals(ScreenInsetsPolicy.margins(new ScreenInsetsPolicy.Edges(0, 28, 0, 24), zero,
            new ScreenInsetsPolicy.Edges(0, 0, 0, 336)), 0, 28, 0, 336);
    }
    @Test public void cutoutWorksOnEveryEdgeAfterRotation() {
        equals(ScreenInsetsPolicy.margins(new ScreenInsetsPolicy.Edges(0, 24, 0, 20),
            new ScreenInsetsPolicy.Edges(48, 0, 0, 0), zero), 48, 24, 0, 20);
        equals(ScreenInsetsPolicy.margins(new ScreenInsetsPolicy.Edges(0, 24, 0, 20),
            new ScreenInsetsPolicy.Edges(0, 0, 48, 0), zero), 0, 24, 48, 20);
    }
    @Test public void hidingImeRestoresTheNormalSafeRectangleWithoutRetainingOldHeight() {
        ScreenInsetsPolicy.Edges bars = new ScreenInsetsPolicy.Edges(0, 26, 0, 24);
        equals(ScreenInsetsPolicy.margins(bars, zero, new ScreenInsetsPolicy.Edges(0, 0, 0, 360)), 0, 26, 0, 360);
        equals(ScreenInsetsPolicy.margins(bars, zero, zero), 0, 26, 0, 24);
    }
    @Test public void threeButtonNavigationAndFloatingImeRemainInsideBars() {
        equals(ScreenInsetsPolicy.margins(new ScreenInsetsPolicy.Edges(0, 28, 0, 48), zero, zero), 0, 28, 0, 48);
    }
    @Test public void malformedNegativeInputsNeverMoveTheWebViewOutsideTheWindow() {
        equals(ScreenInsetsPolicy.margins(new ScreenInsetsPolicy.Edges(-1, -4, -20, -8), zero, zero), 0, 0, 0, 0);
    }
    @Test public void legacyAndroidRetainsItsExistingAdjustResizePath() {
        assertFalse(ScreenInsetsPolicy.nativeInsets(23)); assertFalse(ScreenInsetsPolicy.nativeInsets(29));
        assertTrue(ScreenInsetsPolicy.nativeInsets(30)); assertTrue(ScreenInsetsPolicy.nativeInsets(35)); assertTrue(ScreenInsetsPolicy.nativeInsets(36));
    }
    @Test public void appearanceBridgeOnlyAcceptsTwoFixedThemes() {
        assertTrue(ScreenInsetsPolicy.validTheme("day")); assertTrue(ScreenInsetsPolicy.validTheme("night"));
        for (String value : new String[] {null, "", "system", "DAY", "night ", "javascript:alert(1)"}) assertFalse(ScreenInsetsPolicy.validTheme(value));
    }
    @Test public void persistedAutoUsesTheSameLocalBoundariesAsTheWebWithoutFollowingSystemTheme() {
        for (int hour = 0; hour < 24; hour++) {
            assertEquals("day", ScreenInsetsPolicy.effectiveTheme("day", hour));
            assertEquals("night", ScreenInsetsPolicy.effectiveTheme("night", hour));
            assertEquals(hour >= 7 && hour < 19 ? "day" : "night", ScreenInsetsPolicy.effectiveTheme("auto", hour));
        }
        assertTrue(ScreenInsetsPolicy.validPreference("auto"));
        assertFalse(ScreenInsetsPolicy.validPreference("system"));
        assertEquals("day", ScreenInsetsPolicy.effectiveTheme(null, 23));
    }
}
