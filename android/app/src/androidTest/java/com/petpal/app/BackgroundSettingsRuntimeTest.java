package com.petpal.app;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.content.Intent;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Opt-in setting navigation acceptance; it never changes any system switches. */
@RunWith(AndroidJUnit4.class)
public class BackgroundSettingsRuntimeTest {
    private MainActivity activity;
    private interface Probe { boolean check() throws Exception; }
    private void await(String label, Probe probe, long timeout) throws Exception {
        long end = System.currentTimeMillis() + timeout;
        while (System.currentTimeMillis() < end) { if (probe.check()) return; Thread.sleep(150); }
        fail("Settings runtime timed out: " + label);
    }
    private String js(String source) throws Exception {
        CountDownLatch ready = new CountDownLatch(1); AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.getBridge().getWebView().evaluateJavascript(source, value -> { result.set(value); ready.countDown(); }));
        assertTrue("WebView callback", ready.await(8, TimeUnit.SECONDS)); return result.get();
    }
    private void invoke(String method, JSONObject input) throws Exception {
        js("window.__settingsRuntime=null;window.Capacitor.Plugins.PetTaskNotifications." + method + "(" + input + ").then(value=>window.__settingsRuntime={ok:true,value}).catch(error=>window.__settingsRuntime={ok:false,error:String(error.message||'native error')});");
    }
    private JSONObject result() throws Exception {
        AtomicReference<JSONObject> result = new AtomicReference<>();
        await("native result", () -> { String raw=js("window.__settingsRuntime"); if(raw==null||"null".equals(raw))return false; result.set(new JSONObject(raw));return true; }, 15000);
        return result.get();
    }
    private String systemPackage() {
        AccessibilityNodeInfo root = InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
        if (root == null) return "";
        try { return String.valueOf(root.getPackageName()); } finally { root.recycle(); }
    }
    private void screenshot(Context context, String kind) throws Exception {
        // Lifecycle/AX can switch before the window transition renders its final frame.
        InstrumentationRegistry.getInstrumentation().getUiAutomation().waitForIdle(350,5000);
        Thread.sleep(700);
        assertEquals("Settings still visible for screenshot: " + kind,"com.android.settings",systemPackage());
        android.graphics.Bitmap image = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        assertNotNull("Rendered Settings screenshot: " + kind,image);
        try (java.io.OutputStream output = Files.newOutputStream(new File(context.getExternalFilesDir(null), "background-settings-"+kind+".png").toPath())) { image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,output); }
        finally { image.recycle(); }
    }
    @Test public void standardSettingsAndReturn() throws Exception {
        org.junit.Assume.assumeTrue("Explicit emulator settings acceptance only", "true".equals(InstrumentationRegistry.getArguments().getString("petpalSettingsRuntime")));
        org.junit.Assume.assumeTrue("This runtime matrix uses Android 13+", android.os.Build.VERSION.SDK_INT >= 33);
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        activity = (MainActivity) InstrumentationRegistry.getInstrumentation().startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        await("secure local foreground bridge", () -> activity.hasSecureUpdaterBridge() && activity.isUpdaterForeground() && "true".equals(js("Boolean(window.Capacitor?.Plugins?.PetTaskNotifications)")),30000);
        invoke("backgroundSettings",new JSONObject()); JSONObject initial=result(); assertTrue(initial.toString(),initial.getBoolean("ok"));
        JSONObject status=initial.getJSONObject("value"); assertEquals("generic",status.getString("vendor"));
        assertEquals(36,status.getInt("apiLevel")); assertTrue(status.has("batteryExempt"));
        invoke("openBackgroundSettings",new JSONObject().put("kind","intent://arbitrary")); JSONObject denied=result(); assertFalse(denied.getBoolean("ok")); assertTrue(activity.isUpdaterForeground());
        JSONArray routes=new JSONArray();
        for(String kind:new String[]{"battery","autostart","notifications","app"}) {
            assertTrue("AOSP fallback available: "+kind,status.getJSONObject("routes").getJSONObject(kind).getBoolean("available"));
            invoke("openBackgroundSettings",new JSONObject().put("kind",kind));
            await("actual Settings Activity: "+kind,() -> !activity.isUpdaterForeground() && "com.android.settings".equals(systemPackage()),15000);
            screenshot(context,kind);
            for(int attempt=0;attempt<4&&!activity.isUpdaterForeground();attempt++) {
                InstrumentationRegistry.getInstrumentation().getUiAutomation().performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK); Thread.sleep(350);
            }
            await("returned to PetPal: "+kind,activity::isUpdaterForeground,10000);
            InstrumentationRegistry.getInstrumentation().getUiAutomation().waitForIdle(350,5000);
            Thread.sleep(400);
            JSONObject opened=result(); assertTrue(opened.toString(),opened.getBoolean("ok"));
            JSONObject value=opened.getJSONObject("value");assertTrue(value.getBoolean("opened"));assertEquals(kind,value.getString("kind"));
            if("autostart".equals(kind)){assertTrue(value.getBoolean("fallback"));assertEquals("android-app-details",value.getString("route"));}
            routes.put(value);
        }
        invoke("backgroundSettings",new JSONObject());JSONObject after=result().getJSONObject("value");
        assertEquals("No system optimization switch changed",status.opt("batteryExempt"),after.opt("batteryExempt"));
        JSONObject report=new JSONObject().put("ok",true).put("apiLevel",android.os.Build.VERSION.SDK_INT).put("vendor","generic")
            .put("actualSettingsActivity",true).put("returnsToApp",true).put("unknownActionRejected",true).put("settingsSwitchesUnchanged",true).put("routes",routes);
        Files.write(new File(context.getExternalFilesDir(null),"background-settings-runtime-result.json").toPath(),report.toString().getBytes(StandardCharsets.UTF_8));
    }
}
