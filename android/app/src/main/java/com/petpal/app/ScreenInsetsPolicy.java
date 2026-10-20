package com.petpal.app;

/** Pure geometry: the WebView owns one safe rectangle, including a visible IME. */
public final class ScreenInsetsPolicy {
    private ScreenInsetsPolicy() { }

    public static final class Edges {
        public final int left, top, right, bottom;
        public Edges(int left, int top, int right, int bottom) {
            this.left = Math.max(0, left); this.top = Math.max(0, top);
            this.right = Math.max(0, right); this.bottom = Math.max(0, bottom);
        }
    }

    public static Edges margins(Edges bars, Edges cutout, Edges ime) {
        return new Edges(Math.max(bars.left, Math.max(cutout.left, ime.left)),
            Math.max(bars.top, Math.max(cutout.top, ime.top)),
            Math.max(bars.right, Math.max(cutout.right, ime.right)),
            Math.max(bars.bottom, Math.max(cutout.bottom, ime.bottom)));
    }

    public static boolean nativeInsets(int sdk) { return sdk >= 30; }
    public static boolean validTheme(String value) { return "day".equals(value) || "night".equals(value); }
}
