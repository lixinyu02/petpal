package com.petpal.app;

/** Display-frame-relative pixel geometry, independent of Android for boundary tests. */
final class OverlayGeometry {
    final int x, y, width, height;

    private OverlayGeometry(int x, int y, int width, int height) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
    }

    static OverlayGeometry fit(int availableWidth, int availableHeight, float density, long x, long y) {
        int areaWidth = Math.max(1, availableWidth), areaHeight = Math.max(1, availableHeight);
        double scale = !Float.isNaN(density) && !Float.isInfinite(density) && density > 0 ? density : 1;
        // Preserve the companion's aspect ratio when even its usual dp size will not fit.
        scale = Math.min(scale, Math.min(areaWidth / 184.0, areaHeight / 232.0));
        int width = Math.max(1, Math.min(areaWidth, (int) Math.round(184 * scale)));
        int height = Math.max(1, Math.min(areaHeight, (int) Math.round(232 * scale)));
        return new OverlayGeometry(clamp(x, areaWidth - width), clamp(y, areaHeight - height), width, height);
    }

    private static int clamp(long position, int maximum) {
        return (int) Math.max(0, Math.min(maximum, position));
    }
}
