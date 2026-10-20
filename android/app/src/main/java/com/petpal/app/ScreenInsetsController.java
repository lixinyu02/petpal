package com.petpal.app;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

/** The only edge-to-edge inset consumer. Legacy devices retain platform adjustResize. */
public final class ScreenInsetsController {
    private final Activity activity;
    private final WebView webView;
    private boolean disposed;

    public ScreenInsetsController(Activity activity, WebView webView) {
        this.activity = activity; this.webView = webView;
        if (ScreenInsetsPolicy.nativeInsets(Build.VERSION.SDK_INT)) {
            WindowCompat.setDecorFitsSystemWindows(activity.getWindow(), false);
            ViewCompat.setOnApplyWindowInsetsListener(webView, (view, windowInsets) -> {
                if (disposed) return windowInsets;
                ScreenInsetsPolicy.Edges safe = ScreenInsetsPolicy.margins(
                    edges(windowInsets.getInsets(WindowInsetsCompat.Type.systemBars())),
                    edges(windowInsets.getInsets(WindowInsetsCompat.Type.displayCutout())),
                    edges(windowInsets.getInsets(WindowInsetsCompat.Type.ime())));
                ViewGroup.LayoutParams current = view.getLayoutParams();
                if (current instanceof ViewGroup.MarginLayoutParams) {
                    ViewGroup.MarginLayoutParams margins = (ViewGroup.MarginLayoutParams) current;
                    if (margins.leftMargin != safe.left || margins.topMargin != safe.top
                        || margins.rightMargin != safe.right || margins.bottomMargin != safe.bottom) {
                        margins.setMargins(safe.left, safe.top, safe.right, safe.bottom);
                        view.setLayoutParams(margins);
                    }
                }
                // Do not let WebView translate the same physical insets into CSS env()
                // padding after the native margins have already excluded those pixels.
                return WindowInsetsCompat.CONSUMED;
            });
            webView.post(() -> { if (!disposed) ViewCompat.requestApplyInsets(webView); });
        }
        setAppearance("day");
    }

    private static ScreenInsetsPolicy.Edges edges(Insets value) {
        return new ScreenInsetsPolicy.Edges(value.left, value.top, value.right, value.bottom);
    }

    public boolean hideImeIfVisible() {
        if (disposed) return false;
        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(webView);
        if (insets == null || !insets.isVisible(WindowInsetsCompat.Type.ime())) return false;
        WindowCompat.getInsetsController(activity.getWindow(), webView).hide(WindowInsetsCompat.Type.ime());
        return true;
    }

    @SuppressWarnings("deprecation")
    public void setAppearance(String theme) {
        if (disposed || !ScreenInsetsPolicy.validTheme(theme)) return;
        boolean night = "night".equals(theme);
        int background = Color.parseColor(night ? "#181d1b" : "#fafbf8");
        activity.getWindow().setBackgroundDrawable(new ColorDrawable(background));
        webView.setBackgroundColor(background);
        if (Build.VERSION.SDK_INT >= 30) {
            activity.getWindow().setStatusBarColor(Color.TRANSPARENT);
            activity.getWindow().setNavigationBarColor(Color.TRANSPARENT);
        } else {
            activity.getWindow().setStatusBarColor(background);
            activity.getWindow().setNavigationBarColor(background);
        }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(activity.getWindow(), webView);
        controller.setAppearanceLightStatusBars(!night);
        controller.setAppearanceLightNavigationBars(!night);
    }

    public void close() {
        disposed = true;
        if (ScreenInsetsPolicy.nativeInsets(Build.VERSION.SDK_INT)) ViewCompat.setOnApplyWindowInsetsListener(webView, null);
    }
}
