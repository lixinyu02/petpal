package com.petpal.app;

import android.app.Activity;
import android.app.UiModeManager;
import android.content.Context;
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
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.app.AppCompatDelegate;
import java.util.Calendar;

/** The only edge-to-edge inset consumer. Legacy devices retain platform adjustResize. */
public final class ScreenInsetsController {
    static final String APPEARANCE_PREFS = "petpal_screen_appearance", PREFERENCE = "preference";
    private static int lastApplicationMode = Integer.MIN_VALUE;
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
        applyAppearance(savedPreference(activity), false);
    }

    static String savedPreference(Context context) {
        try {
            String value = context.getSharedPreferences(APPEARANCE_PREFS, Context.MODE_PRIVATE).getString(PREFERENCE, "day");
            return ScreenInsetsPolicy.validPreference(value) ? value : "day";
        } catch (RuntimeException unavailable) { return "day"; }
    }

    static String currentTheme(String preference) {
        return ScreenInsetsPolicy.effectiveTheme(preference, Calendar.getInstance().get(Calendar.HOUR_OF_DAY));
    }

    /** App-local configuration only; never changes the system or external IME theme. */
    static void prepareAppearance(AppCompatActivity activity) { appNightMode(activity, currentTheme(savedPreference(activity))); }

    private static void appNightMode(Activity activity, String theme) {
        boolean night = "night".equals(theme);
        if (activity instanceof AppCompatActivity) {
            AppCompatDelegate delegate = ((AppCompatActivity) activity).getDelegate();
            int mode = night ? AppCompatDelegate.MODE_NIGHT_YES : AppCompatDelegate.MODE_NIGHT_NO;
            if (delegate.getLocalNightMode() != mode) delegate.setLocalNightMode(mode);
        }
        // Android 12+ remembers the application-specific mode for its next
        // system splash. setNightMode(), which changes all apps, is never used.
        if (Build.VERSION.SDK_INT >= 31) {
            UiModeManager manager = activity.getSystemService(UiModeManager.class);
            int mode = night ? UiModeManager.MODE_NIGHT_YES : UiModeManager.MODE_NIGHT_NO;
            if (manager != null && lastApplicationMode != mode) {
                try { manager.setApplicationNightMode(mode); lastApplicationMode = mode; }
                catch (RuntimeException unavailable) { /* Keep Activity-local appearance on restricted OEM builds. */ }
            }
        }
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
        applyAppearance(theme, true);
    }

    public void setAppearance(String theme, String preference) {
        if (disposed || !ScreenInsetsPolicy.validTheme(theme) || !ScreenInsetsPolicy.validPreference(preference)
            || !"auto".equals(preference) && !theme.equals(preference)) return;
        applyAppearance(preference, true);
    }

    @SuppressWarnings("deprecation")
    private void applyAppearance(String preference, boolean persist) {
        String theme = currentTheme(preference);
        if (persist && !preference.equals(savedPreference(activity))) activity.getSharedPreferences(APPEARANCE_PREFS, Context.MODE_PRIVATE).edit().putString(PREFERENCE, preference).apply();
        appNightMode(activity, theme);
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
