package com.petpal.app;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.service.notification.StatusBarNotification;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Opt-in device acceptance. An owned fixture supplies expiring credentials outside both APKs. */
@RunWith(AndroidJUnit4.class)
public class TaskNotificationRuntimeTest {
    private MainActivity activity;
    private void diagnostic(Context context, String phase) throws Exception {
        TaskNotificationState.init(context);
        java.lang.reflect.Field field = TaskNotificationState.class.getDeclaredField("state"); field.setAccessible(true);
        JSONObject saved = (JSONObject) field.get(null);
        JSONObject result = new JSONObject().put("phase", phase).put("enabled", saved != null)
            .put("hasPending", saved != null && !saved.optString("pending").isEmpty())
            .put("routeCount", saved == null ? 0 : saved.optJSONArray("routes").length())
            .put("query", js("location.search")).put("loginVisible", js("document.body.innerText.includes('登录你的小伴')"));
        Files.write(new File(context.getExternalFilesDir(null), "notification-runtime-diagnostic-" + phase + ".json").toPath(), result.toString().getBytes(StandardCharsets.UTF_8));
    }
    private void screenshot(Context context, String name) throws Exception {
        android.graphics.Bitmap bitmap = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        if (bitmap == null) return;
        try (java.io.OutputStream output = Files.newOutputStream(new File(context.getExternalFilesDir(null), name).toPath())) { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output); }
        finally { bitmap.recycle(); }
    }
    private interface Probe { boolean check() throws Exception; }
    private void await(String label, Probe probe, long milliseconds) throws Exception {
        long deadline = System.currentTimeMillis() + milliseconds;
        while (System.currentTimeMillis() < deadline) { if (probe.check()) return; Thread.sleep(150); }
        fail("Device acceptance timed out: " + label);
    }
    private String js(String source) throws Exception {
        CountDownLatch ready = new CountDownLatch(1); AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.getBridge().getWebView().evaluateJavascript(source, value -> { result.set(value); ready.countDown(); }));
        assertTrue("WebView callback", ready.await(8, TimeUnit.SECONDS)); return result.get();
    }
    private JSONObject plugin(String method, JSONObject input) throws Exception {
        js("window.__petpalRuntimeResult=null; window.Capacitor.Plugins.PetTaskNotifications." + method + "(" + input.toString() + ").then(value=>window.__petpalRuntimeResult={ok:true,value}).catch(error=>window.__petpalRuntimeResult={ok:false,error:String(error.message||'native error')});");
        AtomicReference<JSONObject> result = new AtomicReference<>();
        await(method, () -> { String raw = js("window.__petpalRuntimeResult"); if (raw == null || "null".equals(raw)) return false; result.set(new JSONObject(raw)); return true; }, 15000);
        assertTrue("Native plugin " + method + ": " + result.get().optString("error"), result.get().getBoolean("ok")); return result.get().getJSONObject("value");
    }
    @Test public void backgroundResultTapAndLogout() throws Exception {
        org.junit.Assume.assumeTrue("Runtime acceptance requires Android 13+", android.os.Build.VERSION.SDK_INT >= 33);
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File configFile = new File(context.getExternalFilesDir(null), "notification-runtime-config.json");
        org.junit.Assume.assumeTrue("Provide an owned HTTPS runtime fixture outside the APK", configFile.isFile());
        JSONObject config = new JSONObject(new String(Files.readAllBytes(configFile.toPath()), StandardCharsets.UTF_8));
        String url = TaskNotificationPolicy.baseUrl(config.getString("url")), conversationId = TaskNotificationPolicy.id(config.getString("conversationId"));
        boolean verifying = "verify".equals(config.optString("phase"));
        if (verifying) {
            // Start the observer before the real notification tap. Restarting
            // instrumentation after a tap destroys the target delivery process.
            Files.write(new File(context.getExternalFilesDir(null), "notification-runtime-tap-ready.json").toPath(), "{\"ready\":true}".getBytes(StandardCharsets.UTF_8));
            await("actual notification Activity", () -> {
                InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                    for (android.app.Activity candidate : androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED)) {
                        if (candidate instanceof MainActivity) activity = (MainActivity) candidate;
                    }
                });
                return activity != null;
            }, 30000);
        } else activity = (MainActivity) InstrumentationRegistry.getInstrumentation().startActivitySync(new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        await("trusted foreground activity", () -> activity.hasSecureUpdaterBridge() && activity.isUpdaterForeground() && js("Boolean(window.Capacitor?.Plugins?.PetTaskNotifications)").equals("true"), 30000);
        JSONObject connection = new JSONObject().put("url", url).put("token", config.getString("sessionToken")).put("credentialKind", "session").put("target", "remote");
        if (verifying) {
            // The external fixture taps the system notification between the two
            // instrumentation runs. Login must preserve its encrypted pending route.
            diagnostic(context, "before-login");
            js("sessionStorage.setItem('petpal.connection'," + JSONObject.quote(connection.toString()) + "); location.assign('/?chat=1');");
            finish(context, config, configFile, true); return;
        }
        String installation = plugin("installation", new JSONObject()).getString("deviceId");
        javax.net.ssl.HttpsURLConnection registration = (javax.net.ssl.HttpsURLConnection) new java.net.URL(url + "/api/notifications/devices").openConnection();
        JSONObject device;
        try {
            registration.setInstanceFollowRedirects(false); registration.setConnectTimeout(10000); registration.setReadTimeout(10000); registration.setRequestMethod("POST"); registration.setDoOutput(true);
            registration.setRequestProperty("Authorization", "Bearer " + config.getString("sessionToken")); registration.setRequestProperty("Content-Type", "application/json");
            try (java.io.OutputStream output = registration.getOutputStream()) { output.write(new JSONObject().put("deviceId", installation).toString().getBytes(StandardCharsets.UTF_8)); }
            assertEquals(201, registration.getResponseCode());
            try (java.io.InputStream input = registration.getInputStream()) { device = new JSONObject(new String(input.readAllBytes(), StandardCharsets.UTF_8)); }
        } finally { registration.disconnect(); }
        js("sessionStorage.setItem('petpal.connection'," + JSONObject.quote(connection.toString()) + "); location.assign('/?chat=1&settings=1');");
        await("settings loaded", () -> js("Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='账号')").equals("true"), 30000);
        js("Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='账号').click();");
        await("account settings", () -> js("document.body.innerText.includes('后台任务提醒')").equals("true"), 10000);
        JSONObject start = new JSONObject(device.toString()).put("url", url); plugin("start", start);
        await("connected foreground service", () -> PetTaskNotificationService.running && "connected".equals(TaskNotificationState.status(context).optString("connection")), 45000);
        File prefs = new File(context.getApplicationInfo().dataDir, "shared_prefs/petpal_task_notifications_v1.xml");
        String encrypted = new String(Files.readAllBytes(prefs.toPath()), StandardCharsets.UTF_8);
        assertFalse("Device token encrypted at rest", encrypted.contains(device.getString("token")));
        if ("background".equals(config.optString("phase"))) {
            // Actually unload the authenticated JS controller. Removing storage
            // alone leaves its in-memory identity able to consume the tap before
            // the next instrumentation process starts.
            js("sessionStorage.removeItem('petpal.connection'); sessionStorage.removeItem('petpal.connection.remote'); location.assign('/?chat=1');");
            await("unauthenticated cold-start entry", () -> js("document.body.innerText.includes('登录你的小伴')").equals("true"), 30000);
            assertNotNull("Native listener survives an unauthenticated WebView reload", TaskNotificationState.snapshot(context));
        }
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.moveTaskToBack(true));
        await("activity backgrounded", () -> !activity.isUpdaterForeground(), 5000);
        File ready = new File(context.getExternalFilesDir(null), "notification-runtime-ready.json");
        Files.write(ready.toPath(), new JSONObject().put("deviceId", installation).put("conversationId", conversationId).put("ready", true).toString().getBytes(StandardCharsets.UTF_8));
        AtomicReference<StatusBarNotification> delivered = new AtomicReference<>();
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        await("real Agent result while WebView backgrounded", () -> {
            for (StatusBarNotification notification : manager.getActiveNotifications()) if (notification.getTag() != null && notification.getTag().startsWith("petpal-agent-")) { delivered.set(notification); return true; }
            return false;
        }, 240000);
        assertEquals("Agent 任务已完成", delivered.get().getNotification().extras.getString("android.title"));
        assertEquals("点击查看任务结果", delivered.get().getNotification().extras.getString("android.text"));
        assertFalse("Completion did not require foreground WebView", activity.isUpdaterForeground());
        if ("background".equals(config.optString("phase"))) {
            Files.write(new File(context.getExternalFilesDir(null), "notification-runtime-delivered.json").toPath(), new JSONObject().put("ok", true).put("deviceId", installation).put("backgroundCompletion", true).put("encryptedDeviceToken", true).toString().getBytes(StandardCharsets.UTF_8));
            return;
        }
        delivered.get().getNotification().contentIntent.send();
        await("notification resumes activity", activity::isUpdaterForeground, 10000);
        finish(context, config, configFile, false);
    }
    private void finish(Context context, JSONObject config, File configFile, boolean actualTap) throws Exception {
        try { await("verified conversation opened", () -> js("document.body.innerText.includes('" + config.getString("marker").replace("'", "") + "')").equals("true"), 30000); }
        finally { diagnostic(context, "after-login"); }
        screenshot(context, "notification-runtime-conversation.png");
        js("location.assign('/?chat=1&settings=1');");
        await("settings return", () -> js("Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='账号')").equals("true"), 30000);
        js("Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='账号').click();");
        await("logout entry", () -> js("document.body.innerText.includes('退出登录')").equals("true"), 10000);
        js("Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('退出登录')).click();");
        await("logout stops and clears service", () -> !PetTaskNotificationService.running && TaskNotificationState.snapshot(context) == null, 20000);
        for (StatusBarNotification notification : context.getSystemService(NotificationManager.class).getActiveNotifications()) assertFalse("Old result removed on logout", notification.getTag() != null && notification.getTag().startsWith("petpal-agent-"));
        Files.write(new File(context.getExternalFilesDir(null), "notification-runtime-result.json").toPath(), new JSONObject().put("ok", true).put("apiLevel", android.os.Build.VERSION.SDK_INT).put("backgroundCompletion", true).put("actualSystemNotificationTap", actualTap).put("tapOpenedConversation", true).put("logoutCleared", true).put("encryptedDeviceToken", true).toString().getBytes(StandardCharsets.UTF_8));
        Files.deleteIfExists(configFile.toPath());
    }
}
