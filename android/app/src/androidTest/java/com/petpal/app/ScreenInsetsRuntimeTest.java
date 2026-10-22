package com.petpal.app;

import static org.junit.Assert.*;
import android.app.Activity;
import android.app.Application;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Explicit emulator-only native screen acceptance: -e petpalScreenRuntime true.
 * A network-blocked, script-free local form replaces the app document before app
 * scripts execute. No account, proxy, storage, remote server or personal data is
 * accessed. Every path restores the local entry with scripts disabled and closes
 * only this fixture's Activity. Set -e requireCutout true to require a real cutout.
 */
@RunWith(AndroidJUnit4.class)
public class ScreenInsetsRuntimeTest {
    private static final String TAG = "PetPalScreenRuntime";
    private static final Instrumentation INSTRUMENTATION = InstrumentationRegistry.getInstrumentation();
    private static final AtomicBoolean GATED = new AtomicBoolean();
    @CapacitorPlugin(name = "ScreenRuntimeStartupGate")
    public static final class StartupGate extends Plugin {
        @Override public void load() {
            // Plugin.load precedes Bridge.loadWebView(): disable application JS
            // and network before the first packaged document can execute.
            getBridge().getWebView().getSettings().setJavaScriptEnabled(false);
            getBridge().getWebView().getSettings().setBlockNetworkLoads(true);
            GATED.set(true);
        }
    }
    private interface Probe { boolean ready() throws Exception; }
    private static <T> T main(Callable<T> work) throws Exception {
        AtomicReference<T> value = new AtomicReference<>(); AtomicReference<Throwable> failure = new AtomicReference<>();
        INSTRUMENTATION.runOnMainSync(() -> { try { value.set(work.call()); } catch (Throwable error) { failure.set(error); } });
        if (failure.get() != null) throw new AssertionError("Screen fixture main-thread operation failed", failure.get());
        return value.get();
    }
    private static void until(String label, Probe probe) throws Exception {
        long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
        do { if (probe.ready()) return; Thread.sleep(50); } while (System.nanoTime() < end);
        fail("Native screen acceptance timeout: " + label);
    }
    private static final class Geometry {
        final int x, y, width, height, rootX, rootY, rootWidth, rootHeight;
        final int left, top, right, bottom;
        final Insets bars, cutout, ime;
        final boolean imeVisible;
        Geometry(MainActivity activity) {
            WebView view = activity.getBridge().getWebView(); View root = activity.getWindow().getDecorView();
            int[] screen = new int[2], origin = new int[2]; view.getLocationOnScreen(screen); root.getLocationOnScreen(origin);
            x = screen[0]; y = screen[1]; width = view.getWidth(); height = view.getHeight();
            rootX = origin[0]; rootY = origin[1]; rootWidth = root.getWidth(); rootHeight = root.getHeight();
            ViewGroup.MarginLayoutParams margins = (ViewGroup.MarginLayoutParams) view.getLayoutParams();
            left = margins.leftMargin; top = margins.topMargin; right = margins.rightMargin; bottom = margins.bottomMargin;
            WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(root); assertNotNull("Actual root WindowInsets exist", insets);
            bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
            ime = insets.getInsets(WindowInsetsCompat.Type.ime()); imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime());
        }
        boolean cutoutPresent() { return cutout.left + cutout.top + cutout.right + cutout.bottom > 0; }
        boolean ready() { return width > 0 && height > 0 && rootWidth > 0 && rootHeight > 0; }
        boolean settled() {
            Insets safe = Insets.max(Insets.max(bars, cutout), ime);
            return ready() && left == safe.left && top == safe.top && right == safe.right && bottom == safe.bottom
                && Math.abs(x - rootX - safe.left) <= 2 && Math.abs(y - rootY - safe.top) <= 2
                && Math.abs(x + width - rootX - rootWidth + safe.right) <= 2
                && Math.abs(y + height - rootY - rootHeight + safe.bottom) <= 2;
        }
        void assertSafeRectangle() {
            Insets safe = Insets.max(Insets.max(bars, cutout), ime);
            assertEquals("Left safe margin", safe.left, left); assertEquals("Top safe margin", safe.top, top);
            assertEquals("Right safe margin", safe.right, right); assertEquals("IME/nav overlap uses max, not sum", safe.bottom, bottom);
            assertEquals("Actual WebView left", rootX + safe.left, x, 2);
            assertEquals("Actual WebView top", rootY + safe.top, y, 2);
            assertEquals("Actual WebView right", rootX + rootWidth - safe.right, x + width, 2);
            assertEquals("Actual WebView bottom", rootY + rootHeight - safe.bottom, y + height, 2);
            assertTrue("Actual safe rectangle remains usable", width > 0 && height > 0);
        }
    }
    private static final class Session implements AutoCloseable {
        final Context context = INSTRUMENTATION.getTargetContext();
        final Application application = (Application) context.getApplicationContext();
        final AtomicReference<MainActivity> activity = new AtomicReference<>();
        String localEntry, fixtureUrl; int requestedOrientation; boolean registered, orientationCaptured;
        final Application.ActivityLifecycleCallbacks lifecycle = new Application.ActivityLifecycleCallbacks() {
            @Override public void onActivityPreCreated(Activity value, Bundle state) {
                if (value instanceof MainActivity) ((MainActivity) value).registerPlugin(StartupGate.class);
            }
            @Override public void onActivityCreated(Activity value, Bundle state) {
                if (!(value instanceof MainActivity)) return;
                MainActivity next = (MainActivity) value; activity.set(next);
                if (next.getBridge() != null) {
                    next.getBridge().getWebView().getSettings().setJavaScriptEnabled(false);
                    next.getBridge().getWebView().getSettings().setBlockNetworkLoads(true);
                }
            }
            @Override public void onActivityStarted(Activity value) { }
            @Override public void onActivityResumed(Activity value) { }
            @Override public void onActivityPaused(Activity value) { }
            @Override public void onActivityStopped(Activity value) { }
            @Override public void onActivitySaveInstanceState(Activity value, Bundle state) { }
            @Override public void onActivityDestroyed(Activity value) { }
        };
        Session() throws Exception {
            Assume.assumeTrue("Explicit emulator screen acceptance only", "true".equals(InstrumentationRegistry.getArguments().getString("petpalScreenRuntime")));
            Assume.assumeTrue("Only a task emulator, never a personal phone", Build.HARDWARE.contains("ranchu") || Build.HARDWARE.contains("goldfish"));
            Assume.assumeTrue("Modern edge-to-edge instrumentation requires API30+", Build.VERSION.SDK_INT >= 30);
            try {
                main(() -> { GATED.set(false); application.registerActivityLifecycleCallbacks(lifecycle); registered = true; return null; });
                MainActivity started = (MainActivity) INSTRUMENTATION.startActivitySync(new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
                activity.set(started);
                until("visible secure native Activity", () -> main(() -> activity.get().hasSecureUpdaterBridge() && activity.get().isUpdaterForeground()));
                assertTrue("Test startup gate ran before Bridge.loadWebView", GATED.get());
                requestedOrientation = main(() -> activity.get().getRequestedOrientation());
                orientationCaptured = true;
                localEntry = main(() -> activity.get().getBridge().getLocalUrl());
                fixtureUrl = localEntry.replaceAll("/+$", "") + "/?screenNativeFixture=" + UUID.randomUUID();
                String html = "<!doctype html><html><head><meta name=viewport content='width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content'>"
                    + "<style>html,body{margin:0;height:100%;background:#faf9f4}main{height:100dvh;display:flex;flex-direction:column;box-sizing:border-box;padding:12px}textarea{font-size:18px;height:84px}button{margin-top:auto;min-height:44px}#safe{position:fixed;left:0;top:0;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);pointer-events:none}</style></head>"
                    + "<body><main><label for=entry>屏幕验收本地表单</label><textarea id=entry></textarea><button id=send type=button>发送</button></main><div id=safe></div>"
                    + "<script>window.__screenBacks=0;window.addEventListener('petpal:native-back',e=>{window.__screenBacks++;e.preventDefault()});window.__screenReady=true;</script></body></html>";
                main(() -> { WebView view = view(); view.stopLoading(); view.getSettings().setJavaScriptEnabled(true); view.loadDataWithBaseURL(fixtureUrl, html, "text/html", "UTF-8", fixtureUrl); return null; });
                until("isolated static form and real native bridge", () -> "true".equals(js("Boolean(window.__screenReady&&window.Capacitor?.Plugins?.PetScreen?.setAppearance&&document.getElementById('entry'))")));
                until("usable laid-out WebView", () -> geometry().ready());
            } catch (Throwable error) { close(); throw error; }
        }
        WebView view() { return activity.get().getBridge().getWebView(); }
        Geometry geometry() throws Exception { return main(() -> new Geometry(activity.get())); }
        String js(String script) throws Exception {
            CountDownLatch ready = new CountDownLatch(1); AtomicReference<String> value = new AtomicReference<>();
            main(() -> { view().evaluateJavascript(script, result -> { value.set(result); ready.countDown(); }); return null; });
            assertTrue("Local fixture JS callback completed", ready.await(8, TimeUnit.SECONDS)); return value.get();
        }
        String asset(String name) throws Exception {
            try (InputStream input = context.getAssets().open(name); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192]; int length;
                while ((length = input.read(buffer)) != -1) {
                    assertTrue("Packaged screen fixture assets remain bounded", output.size() + length <= 8 * 1024 * 1024);
                    output.write(buffer, 0, length);
                }
                return output.toString(StandardCharsets.UTF_8.name());
            }
        }
        List<String> loadPackagedComposer() throws Exception {
            String[] packaged = context.getAssets().list("public/assets"); assertNotNull("Packaged web assets exist", packaged);
            List<String> candidates = new ArrayList<>();
            for (String name : packaged) if (name.startsWith("App-") && name.endsWith(".css") && !name.contains("/")) candidates.add(name);
            assertFalse("APK contains actual App CSS chunks", candidates.isEmpty());
            String index = asset("public/index.html"), references = index;
            Matcher scripts = Pattern.compile("(?:src|href)=[\"'](?:\\./|/)?assets/([^\"'/]+\\.js)[\"']").matcher(index);
            int entries = 0;
            while (scripts.find()) { references += "\n" + asset("public/assets/" + scripts.group(1)); entries++; }
            assertTrue("Actual packaged entry module discovered", entries > 0);
            final String currentReferences = references;
            List<String> active = new ArrayList<>();
            // Old files may remain in assets after incremental sync. Select only
            // App CSS referenced by the APK's current index/entry dependency map.
            for (String name : candidates) if (currentReferences.contains(name)) active.add(name);
            assertFalse("Current entry references at least one packaged App CSS chunk", active.isEmpty());
            Collections.sort(active, Comparator.comparingInt((String name) -> currentReferences.indexOf(name)));
            StringBuilder css = new StringBuilder();
            for (String name : active) css.append('\n').append(asset("public/assets/" + name));
            String html = "<!doctype html><html lang=zh-CN data-theme=day><head><meta charset=UTF-8><meta name=viewport content='width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content'>"
                + "<style id=packaged-app-css>" + css + "</style></head><body><div class=app-shell><main class=main-area>"
                + "<header class=topbar><div class=topbar-title><strong>本地字体缩放验收</strong></div></header><section class=workspace><div class=chat-area>"
                + "<div class=chat-scroll><div class=chat-scroll-content><div class=messages><div class=message><div class=message-text>屏幕适配测试</div></div></div></div></div>"
                + "<div class=composer-area><div class=composer-runtime></div><form class=composer><textarea id=entry aria-label=消息 rows=2>小伴你好</textarea>"
                + "<div class=composer-bottom><div class=composer-tools><button type=button class=attach-image aria-label=添加图片>+</button></div>"
                + "<div class=composer-send-actions><button id=send type=button class=send-button aria-label=发送消息><svg width=21 height=21 viewBox='0 0 24 24' aria-hidden=true><path d='M12 19V5m-6 6 6-6 6 6' fill=none stroke=currentColor stroke-width=2></path></svg></button></div>"
                + "</div></form></div></div></section></main></div><script>window.__screenFontReady=true;</script></body></html>";
            main(() -> { view().stopLoading(); view().loadDataWithBaseURL(fixtureUrl, html, "text/html", "UTF-8", fixtureUrl); view().clearFocus(); WindowCompat.getInsetsController(activity.get().getWindow(), view()).hide(WindowInsetsCompat.Type.ime()); return null; });
            until("actual packaged composer CSS and static form loaded", () -> "true".equals(js("Boolean(window.__screenFontReady&&document.getElementById('packaged-app-css')?.sheet?.cssRules?.length&&document.querySelector('.app-shell .composer textarea')&&document.querySelector('.composer .send-button'))")));
            until("font fixture starts without the keyboard", () -> !geometry().imeVisible);
            return active;
        }
        void assertCssFitsNative() throws Exception {
            until("CSS viewport received the settled native rectangle", () -> {
                JSONObject size = new JSONObject(js("({height:innerHeight,ratio:devicePixelRatio})"));
                return Math.abs(geometry().height - size.getDouble("height") * size.getDouble("ratio")) <= 4;
            });
            JSONObject css = new JSONObject(js("(()=>{const p=getComputedStyle(document.getElementById('safe'));return{top:parseFloat(p.paddingTop),right:parseFloat(p.paddingRight),bottom:parseFloat(p.paddingBottom),left:parseFloat(p.paddingLeft),height:innerHeight,ratio:devicePixelRatio}})()"));
            for (String edge : new String[] {"left", "top", "right", "bottom"}) assertEquals("Native inset must not also become CSS " + edge + " padding", 0, css.getDouble(edge), .5);
            assertEquals("CSS viewport matches the actual native WebView", geometry().height, css.getDouble("height") * css.getDouble("ratio"), 4);
        }
        void appearance(String theme) throws Exception {
            appearance(theme, null);
        }
        void appearance(String theme, String preference) throws Exception {
            JSONObject request = new JSONObject().put("theme", theme);
            if (preference != null) request.put("preference", preference);
            js("window.__screenTheme=null;window.Capacitor.Plugins.PetScreen.setAppearance(" + request + ").then(v=>window.__screenTheme={ok:true,nativeInsets:v.nativeInsets}).catch(()=>window.__screenTheme={ok:false});true");
            until("actual native appearance bridge", () -> "true".equals(js("Boolean(window.__screenTheme?.ok&&window.__screenTheme.nativeInsets)")));
            main(() -> {
                WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(activity.get().getWindow(), view()); boolean day = "day".equals(theme);
                assertEquals("Status icons follow application theme", day, bars.isAppearanceLightStatusBars());
                assertEquals("Navigation icons follow application theme", day, bars.isAppearanceLightNavigationBars());
                assertEquals("Native safe-area background follows application theme", Color.parseColor(day ? "#fafbf8" : "#282828"), ((ColorDrawable) activity.get().getWindow().getDecorView().getBackground()).getColor()); return null;
            });
        }
        @Override public void close() throws Exception {
            try {
                if (activity.get() != null) main(() -> {
                    MainActivity value = activity.get();
                    if (!value.isDestroyed()) {
                        WindowCompat.getInsetsController(value.getWindow(), view()).hide(WindowInsetsCompat.Type.ime());
                        if (orientationCaptured) value.setRequestedOrientation(requestedOrientation);
                        view().stopLoading(); view().getSettings().setJavaScriptEnabled(false);
                        if (localEntry != null) view().loadUrl(localEntry);
                        value.finishAndRemoveTask();
                    }
                    return null;
                });
            } finally { if (registered) main(() -> { application.unregisterActivityLifecycleCallbacks(lifecycle); registered = false; return null; }); }
        }
    }

    @Test public void actualWebViewExcludesSystemBarsAndCutoutWithoutDuplicateCssPadding() throws Exception {
        try (Session session = new Session()) {
            until("stable normal safe rectangle", () -> session.geometry().settled());
            Geometry geometry = session.geometry(); geometry.assertSafeRectangle(); session.assertCssFitsNative();
            Log.i(TAG, "normal rectangle=" + geometry.width + "x" + geometry.height + ", cutoutObserved=" + geometry.cutoutPresent());
            if ("true".equals(InstrumentationRegistry.getArguments().getString("requireCutout"))) assertTrue("A cutout is required by this acceptance run", geometry.cutoutPresent());
        }
    }

    @Test public void realImeResizesTheWebViewAndBackDismissesItBeforePageNavigation() throws Exception {
        try (Session session = new Session()) {
            until("initial keyboard hidden", () -> !session.geometry().imeVisible); Geometry before = session.geometry();
            JSONObject target = new JSONObject(session.js("(()=>{const r=document.getElementById('entry').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,ratio:devicePixelRatio}})()"));
            float x = (float) (before.x + target.getDouble("x") * target.getDouble("ratio")), y = (float) (before.y + target.getDouble("y") * target.getDouble("ratio"));
            long now = SystemClock.uptimeMillis(); INSTRUMENTATION.sendPointerSync(MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, x, y, 0));
            INSTRUMENTATION.sendPointerSync(MotionEvent.obtain(now, now + 80, MotionEvent.ACTION_UP, x, y, 0));
            main(() -> { ((InputMethodManager) session.context.getSystemService(Context.INPUT_METHOD_SERVICE)).showSoftInput(session.view(), InputMethodManager.SHOW_IMPLICIT); return null; });
            until("real keyboard visible and native rectangle shortened", () -> { Geometry g = session.geometry(); return g.imeVisible && g.ime.bottom > g.bars.bottom && g.height < before.height && g.settled(); });
            session.geometry().assertSafeRectangle(); session.assertCssFitsNative();
            assertEquals("Send action stays within the usable viewport", "true", session.js("(()=>{const r=document.getElementById('send').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1})()"));
            main(() -> { session.activity.get().getOnBackPressedDispatcher().onBackPressed(); return null; });
            until("back hides IME and restores native height", () -> !session.geometry().imeVisible && Math.abs(session.geometry().height - before.height) <= 2);
            assertEquals("Keyboard dismissal did not also navigate the page", "0", session.js("window.__screenBacks"));
            assertFalse(main(() -> session.activity.get().isFinishing())); session.geometry().assertSafeRectangle();
            main(() -> { session.activity.get().getOnBackPressedDispatcher().onBackPressed(); return null; });
            until("subsequent back reaches the page", () -> "1".equals(session.js("window.__screenBacks")));
            Log.i(TAG, "real IME show/hide and keyboard-first back verified");
        }
    }

    @Test public void rotationRecomputesTheRealSafeRectangleAndNativeThemeBridgeWorks() throws Exception {
        try (Session session = new Session()) {
            session.appearance("night"); session.appearance("day");
            main(() -> { session.activity.get().setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE); return null; });
            until("landscape safe rectangle", () -> { Geometry g = session.geometry(); return g.rootWidth > g.rootHeight && g.settled(); });
            session.geometry().assertSafeRectangle(); session.assertCssFitsNative();
            main(() -> { session.activity.get().setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT); return null; });
            until("portrait safe rectangle restored", () -> { Geometry g = session.geometry(); return g.rootHeight > g.rootWidth && g.settled(); });
            session.geometry().assertSafeRectangle(); session.assertCssFitsNative(); session.appearance("night");
            Log.i(TAG, "rotation and real local-page theme bridge verified");
        }
    }

    @Test public void nativeThemeAndPreferenceSurviveActivityRestartWithoutChangingSystemNightMode() throws Exception {
        Assume.assumeTrue("Explicit screen acceptance only", "true".equals(InstrumentationRegistry.getArguments().getString("petpalScreenRuntime")));
        Assume.assumeTrue("Only an owned emulator", Build.HARDWARE.contains("ranchu") || Build.HARDWARE.contains("goldfish"));
        android.content.Context context = INSTRUMENTATION.getTargetContext();
        android.content.SharedPreferences prefs = context.getSharedPreferences(ScreenInsetsController.APPEARANCE_PREFS, android.content.Context.MODE_PRIVATE);
        String previous = prefs.getString(ScreenInsetsController.PREFERENCE, null);
        android.app.UiModeManager manager = context.getSystemService(android.app.UiModeManager.class);
        int globalMode = manager.getNightMode();
        try {
            try (Session first = new Session()) {
                MainActivity original = first.activity.get();
                first.appearance("night", "night");
                assertSame("Theme switch retains the Activity and its account/IME state", original, first.activity.get());
                assertEquals("night", prefs.getString(ScreenInsetsController.PREFERENCE, null));
                first.appearance(ScreenInsetsController.currentTheme("auto"), "auto");
                assertEquals("Auto preference persists even when its effective color did not change", "auto", prefs.getString(ScreenInsetsController.PREFERENCE, null));
                first.appearance("night", "night");
            }
            try (Session restarted = new Session()) {
                main(() -> {
                    assertEquals("Stored night theme is restored before the real WebView fixture starts", Color.parseColor("#282828"), ((ColorDrawable) restarted.activity.get().getWindow().getDecorView().getBackground()).getColor());
                    assertEquals(android.content.res.Configuration.UI_MODE_NIGHT_YES, restarted.activity.get().getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK);
                    assertFalse(WindowCompat.getInsetsController(restarted.activity.get().getWindow(), restarted.view()).isAppearanceLightStatusBars());
                    return null;
                });
                restarted.appearance("day", "day");
                assertEquals("day", prefs.getString(ScreenInsetsController.PREFERENCE, null));
                assertEquals("Application theme never changes global system/IME night mode", globalMode, manager.getNightMode());
            }
            Log.i(TAG, "app-local day/night/auto persistence and actual Activity restart verified; global system night mode unchanged");
        } finally {
            android.content.SharedPreferences.Editor edit = prefs.edit();
            if (previous == null) edit.remove(ScreenInsetsController.PREFERENCE); else edit.putString(ScreenInsetsController.PREFERENCE, previous);
            edit.commit();
            if (Build.VERSION.SDK_INT >= 31) manager.setApplicationNightMode("night".equals(ScreenInsetsController.currentTheme(previous)) ? android.app.UiModeManager.MODE_NIGHT_YES : android.app.UiModeManager.MODE_NIGHT_NO);
        }
    }

    @Test public void packagedComposerFitsRealWebViewTextZoomWithoutClippingOrHorizontalOverflow() throws Exception {
        try (Session session = new Session()) {
            List<String> css = session.loadPackagedComposer();
            int originalZoom = main(() -> session.view().getSettings().getTextZoom());
            try {
                for (int zoom : new int[] {100, 160, 200}) {
                    main(() -> { session.view().getSettings().setTextZoom(zoom); return null; });
                    session.js("window.__fontLayoutReady=false;requestAnimationFrame(()=>requestAnimationFrame(()=>window.__fontLayoutReady=true));true");
                    until("text zoom layout " + zoom, () -> "true".equals(session.js("window.__fontLayoutReady")));
                    assertFalse("Font scaling must not open the keyboard", session.geometry().imeVisible);
                    JSONObject layout = new JSONObject(session.js("(()=>{const t=document.querySelector('.composer textarea'),s=getComputedStyle(t),b=document.querySelector('.composer .send-button'),r=b.getBoundingClientRect(),bs=getComputedStyle(b),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);const selectors=['.app-shell','.main-area','.workspace','.chat-area','.composer-area','.composer','.composer-bottom','.composer-tools','.composer-send-actions'];return{textareaClient:t.clientHeight,line:parseFloat(s.lineHeight),font:parseFloat(s.fontSize),padding:parseFloat(s.paddingTop)+parseFloat(s.paddingBottom),buttonVisible:r.width>0&&r.height>0&&r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&bs.display!=='none'&&bs.visibility==='visible'&&parseFloat(bs.opacity)>0&&(hit===b||b.contains(hit)),rootOverflow:document.documentElement.scrollWidth>innerWidth+1||document.body.scrollWidth>innerWidth+1,containerOverflow:selectors.some(selector=>{const n=document.querySelector(selector);return n&&n.scrollWidth>n.clientWidth+1}),width:innerWidth,height:innerHeight}})()"));
                    assertTrue("Real textarea has a measurable line at " + zoom, layout.getDouble("line") > 0 && layout.getDouble("font") > 0);
                    assertTrue("Textarea contains one full text line and padding at " + zoom + ": " + layout,
                        layout.getDouble("textareaClient") + 1 >= layout.getDouble("line") + layout.getDouble("padding"));
                    assertTrue("Real send button remains visible and unobscured at " + zoom + ": " + layout, layout.getBoolean("buttonVisible"));
                    assertFalse("No page horizontal overflow at " + zoom + ": " + layout, layout.getBoolean("rootOverflow"));
                    assertFalse("No composer/container horizontal overflow at " + zoom + ": " + layout, layout.getBoolean("containerOverflow"));
                    Log.i(TAG, "packaged App CSS textZoom=" + zoom + ", css=" + css + ", dimensions=" + layout);
                }
            } finally { main(() -> { session.view().getSettings().setTextZoom(originalZoom); return null; }); }
        }
    }
}
