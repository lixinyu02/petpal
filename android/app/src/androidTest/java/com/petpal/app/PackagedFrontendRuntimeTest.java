package com.petpal.app;

import static org.junit.Assert.*;
import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Actual packaged React startup on a fresh task emulator; never logs in or replaces its HTML. */
@RunWith(AndroidJUnit4.class)
public class PackagedFrontendRuntimeTest {
    private static final AtomicBoolean GATED = new AtomicBoolean();
    @CapacitorPlugin(name = "PackagedFrontendNetworkGate")
    public static final class NetworkGate extends Plugin {
        @Override public void load() {
            // Capacitor's local asset interceptor remains in place. Unlike the
            // geometry fixture, this gate keeps the real application's JS on.
            getBridge().getWebView().getSettings().setBlockNetworkLoads(true);
            GATED.set(true);
        }
    }
    private interface Probe { boolean ready() throws Exception; }
    private static <T> T main(Callable<T> work) throws Exception {
        AtomicReference<T> value = new AtomicReference<>();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            try { value.set(work.call()); } catch (Throwable error) { failure.set(error); }
        });
        if (failure.get() != null) throw new AssertionError("Packaged startup main-thread failure", failure.get());
        return value.get();
    }
    private static void until(String label, Probe probe) throws Exception {
        long end = SystemClock.uptimeMillis() + 30000;
        do { if (probe.ready()) return; Thread.sleep(75); } while (SystemClock.uptimeMillis() < end);
        fail("Packaged startup timeout: " + label);
    }
    private static String js(WebView view, String source) throws Exception {
        CountDownLatch ready = new CountDownLatch(1); AtomicReference<String> value = new AtomicReference<>();
        main(() -> { view.evaluateJavascript(source, result -> { value.set(result); ready.countDown(); }); return null; });
        assertTrue("Actual product DOM callback", ready.await(8, TimeUnit.SECONDS));
        return value.get();
    }
    private static boolean safeRectangle(MainActivity activity) {
        WebView view = activity.getBridge().getWebView(); View root = activity.getWindow().getDecorView();
        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(root);
        if (insets == null || view.getWidth() <= 0 || root.getWidth() <= 0) return false;
        Insets safe = Insets.max(Insets.max(insets.getInsets(WindowInsetsCompat.Type.systemBars()),
            insets.getInsets(WindowInsetsCompat.Type.displayCutout())), insets.getInsets(WindowInsetsCompat.Type.ime()));
        int[] child = new int[2], parent = new int[2]; view.getLocationOnScreen(child); root.getLocationOnScreen(parent);
        ViewGroup.MarginLayoutParams margins = (ViewGroup.MarginLayoutParams) view.getLayoutParams();
        return margins.leftMargin == safe.left && margins.topMargin == safe.top && margins.rightMargin == safe.right && margins.bottomMargin == safe.bottom
            && Math.abs(child[0] - parent[0] - safe.left) <= 2 && Math.abs(child[1] - parent[1] - safe.top) <= 2
            && Math.abs(child[0] + view.getWidth() - parent[0] - root.getWidth() + safe.right) <= 2
            && Math.abs(child[1] + view.getHeight() - parent[1] - root.getHeight() + safe.bottom) <= 2;
    }
    @Test public void realPackagedJavascriptShowsUsableLoginWithoutNetworkOrAccount() throws Exception {
        Assume.assumeTrue("Explicit packaged frontend acceptance only", "true".equals(InstrumentationRegistry.getArguments().getString("petpalFrontendRuntime")));
        Assume.assumeTrue("Fresh owned emulator only; never a personal phone", Build.HARDWARE.contains("ranchu") || Build.HARDWARE.contains("goldfish"));
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Application application = (Application) context.getApplicationContext();
        AtomicReference<MainActivity> active = new AtomicReference<>();
        Application.ActivityLifecycleCallbacks callbacks = new Application.ActivityLifecycleCallbacks() {
            @Override public void onActivityPreCreated(Activity value, Bundle state) {
                if (value instanceof MainActivity) ((MainActivity) value).registerPlugin(NetworkGate.class);
            }
            @Override public void onActivityCreated(Activity value, Bundle state) { if (value instanceof MainActivity) active.set((MainActivity) value); }
            @Override public void onActivityStarted(Activity value) { }
            @Override public void onActivityResumed(Activity value) { }
            @Override public void onActivityPaused(Activity value) { }
            @Override public void onActivityStopped(Activity value) { }
            @Override public void onActivitySaveInstanceState(Activity value, Bundle state) { }
            @Override public void onActivityDestroyed(Activity value) { }
        };
        main(() -> { GATED.set(false); application.registerActivityLifecycleCallbacks(callbacks); return null; });
        long started = SystemClock.uptimeMillis();
        try {
            MainActivity activity = (MainActivity) InstrumentationRegistry.getInstrumentation().startActivitySync(
                new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
            active.set(activity);
            until("secure foreground local WebView", () -> main(() -> activity.hasSecureUpdaterBridge() && activity.isUpdaterForeground()));
            WebView view = main(() -> activity.getBridge().getWebView());
            assertTrue("Network gate ran before Bridge.loadWebView", GATED.get());
            assertTrue("Real product JavaScript remains enabled", main(() -> view.getSettings().getJavaScriptEnabled()));
            assertTrue("External WebView network is blocked", main(() -> view.getSettings().getBlockNetworkLoads()));
            until("real React login form, not a static or replacement fixture", () -> "true".equals(js(view,
                "Boolean(document.querySelector('.login-page .login-form form .login-fields input[autocomplete=url]')&&document.querySelector('.login-fields input[autocomplete=username]')&&document.querySelector('.login-fields input[type=password]')&&document.querySelector('.login-fields button[type=submit]')&&document.querySelector('#connection-title')?.textContent.includes('登录')&&[...document.scripts].some(s=>s.type==='module'&&s.src.includes('/assets/')))")));
            until("settled native safe rectangle", () -> main(() -> safeRectangle(activity)));
            until("real login entrance animation settled", () -> "true".equals(js(view,
                "(()=>{const n=document.querySelector('.login-page');return n&&parseFloat(getComputedStyle(n).opacity)>.99&&n.getAnimations({subtree:true}).every(a=>a.playState!=='running')})()")));
            JSONObject layout = new JSONObject(js(view,
                "(()=>{const selectors=['.login-fields input[autocomplete=url]','.login-fields input[autocomplete=username]','.login-fields input[type=password]','.login-fields button[type=submit]'];const controls=selectors.map(selector=>{const n=document.querySelector(selector),r=n.getBoundingClientRect(),s=getComputedStyle(n),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{selector,x:r.x,y:r.y,width:r.width,height:r.height,visible:r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&s.display!=='none'&&s.visibility==='visible'&&parseFloat(s.opacity)>0,reachable:h===n||n.contains(h),disabled:n.disabled}});return{width:innerWidth,height:innerHeight,ratio:devicePixelRatio,rootOverflow:document.documentElement.scrollWidth>innerWidth+1||document.body.scrollWidth>innerWidth+1,emptyUsername:document.querySelector('input[autocomplete=username]').value==='',emptyPassword:document.querySelector('input[type=password]').value==='',serverAddressPresent:document.querySelector('input[autocomplete=url]').value.length>0,controls}})()"));
            assertFalse("Real login page has no horizontal overflow: " + layout, layout.getBoolean("rootOverflow"));
            assertTrue("Fresh emulator has no entered username", layout.getBoolean("emptyUsername"));
            assertTrue("Fresh emulator has no entered password", layout.getBoolean("emptyPassword"));
            assertTrue("Actual configured server address is present", layout.getBoolean("serverAddressPresent"));
            for (int i = 0; i < layout.getJSONArray("controls").length(); i++) {
                JSONObject control = layout.getJSONArray("controls").getJSONObject(i);
                assertTrue("Real login control is inside safe viewport: " + control, control.getBoolean("visible"));
                assertTrue("Real login control is unobscured: " + control, control.getBoolean("reachable"));
                assertFalse("Real login control is enabled: " + control, control.getBoolean("disabled"));
            }
            assertTrue("Actual local product URL remains trusted", main(() -> UpdaterPolicy.trustedPage(activity.getBridge().getLocalUrl(), view.getUrl())));
            JSONObject report = new JSONObject().put("ok", true).put("apiLevel", Build.VERSION.SDK_INT)
                .put("emulatorStartupToUsableLoginMs", SystemClock.uptimeMillis() - started).put("actualPackagedFrontend", true)
                .put("externalWebViewNetworkBlocked", true).put("accountLoginAttempted", false).put("layout", layout)
                .put("realHonorPerformanceClaim", false);
            File directory = context.getExternalFilesDir(null);
            Files.write(new File(directory, "packaged-frontend-runtime-result.json").toPath(), report.toString().getBytes(StandardCharsets.UTF_8));
            android.graphics.Bitmap image = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
            assertNotNull("Actual rendered product screenshot", image);
            try (OutputStream output = Files.newOutputStream(new File(directory, "packaged-frontend-runtime.png").toPath())) {
                assertTrue("Actual product screenshot saved", image.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output));
            } finally { image.recycle(); }
            android.util.Log.i("PetPalFrontendRuntime", report.toString());
        } finally {
            try {
                if (active.get() != null) main(() -> {
                    MainActivity value = active.get();
                    if (!value.isDestroyed()) {
                        if (value.getBridge() != null) value.getBridge().getWebView().getSettings().setJavaScriptEnabled(false);
                        value.finishAndRemoveTask();
                    }
                    return null;
                });
            } finally { main(() -> { application.unregisterActivityLifecycleCallbacks(callbacks); return null; }); }
        }
    }
}
