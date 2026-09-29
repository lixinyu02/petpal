package com.petpal.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class OverlayGeometryTest {
    private void inside(OverlayGeometry value, int width, int height) {
        assertTrue(value.x >= 0); assertTrue(value.y >= 0);
        assertTrue(value.width > 0); assertTrue(value.height > 0);
        assertTrue((long) value.x + value.width <= width);
        assertTrue((long) value.y + value.height <= height);
    }

    @Test public void portraitAndKeyboardShortenedFramesKeepTheUsualCompanionSize() {
        for (int height : new int[] {960, 560}) {
            OverlayGeometry value = OverlayGeometry.fit(412, height, 1, Integer.MAX_VALUE, 140);
            assertEquals(184, value.width); assertEquals(232, value.height);
            assertEquals(228, value.x); assertEquals(140, value.y);
            inside(value, 412, height);
        }
    }

    @Test public void systemBarsAndCutoutUseTheAvailableFrameRatherThanTheFullDisplay() {
        OverlayGeometry value = OverlayGeometry.fit(412 - 20 - 12, 960 - 32 - 24, 1, Long.MAX_VALUE, Long.MAX_VALUE);
        assertEquals(196, value.x); assertEquals(672, value.y);
        inside(value, 380, 904);
    }

    @Test public void rotationClampsAPreviouslyBottomRightWindowWithoutAnotherDrag() {
        OverlayGeometry portrait = OverlayGeometry.fit(412, 960, 1, 9999, 9999);
        OverlayGeometry landscape = OverlayGeometry.fit(960, 412, 1, portrait.x, portrait.y);
        assertEquals(228, landscape.x); assertEquals(180, landscape.y);
        inside(landscape, 960, 412);
    }

    @Test public void densityAndResolutionChangesRecomputeSizeAsWellAsPosition() {
        OverlayGeometry old = OverlayGeometry.fit(1236, 2880, 3, 9999, 9999);
        OverlayGeometry changed = OverlayGeometry.fit(824, 1120, 2, old.x, old.y);
        assertEquals(368, changed.width); assertEquals(464, changed.height);
        assertEquals(456, changed.x); assertEquals(656, changed.y);
        inside(changed, 824, 1120);
    }

    @Test public void tinyFramesScaleTheWholeCompanionInsteadOfClippingIt() {
        for (int[] area : new int[][] {{100, 120}, {70, 400}, {400, 90}, {1, 1}}) {
            OverlayGeometry value = OverlayGeometry.fit(area[0], area[1], 3, 140, 140);
            inside(value, area[0], area[1]);
            assertTrue(Math.abs(value.width - value.height * 184.0 / 232) <= 1);
        }
    }

    @Test public void dragCannotEscapeAnyEdgeOrOverflowIntegerCoordinates() {
        for (long x : new long[] {Long.MIN_VALUE, -1, 0, 120, 9999, Long.MAX_VALUE})
            for (long y : new long[] {Long.MIN_VALUE, -1, 0, 120, 9999, Long.MAX_VALUE})
                inside(OverlayGeometry.fit(412, 560, 1, x, y), 412, 560);
    }

    @Test public void returningToLargerFrameRestoresDpSizeAndClampingIsIdempotent() {
        OverlayGeometry small = OverlayGeometry.fit(100, 120, 2, 9999, 9999);
        OverlayGeometry restored = OverlayGeometry.fit(824, 1120, 2, small.x, small.y);
        OverlayGeometry repeated = OverlayGeometry.fit(824, 1120, 2, restored.x, restored.y);
        assertEquals(368, restored.width); assertEquals(464, restored.height);
        assertEquals(restored.x, repeated.x); assertEquals(restored.y, repeated.y);
        assertEquals(restored.width, repeated.width); assertEquals(restored.height, repeated.height);
    }

    @Test public void transitionalInvalidMetricsStillProducePositiveBoundedGeometry() {
        for (float density : new float[] {0, -1, Float.NaN, Float.POSITIVE_INFINITY})
            inside(OverlayGeometry.fit(412, 560, density, -999, 999), 412, 560);
        inside(OverlayGeometry.fit(0, -1, 1, 500, 500), 1, 1);
    }
}
