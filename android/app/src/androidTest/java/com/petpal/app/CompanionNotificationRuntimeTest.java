package com.petpal.app;

import static org.junit.Assert.*;

import android.Manifest;
import android.app.Activity;
import android.app.Application;
import android.app.Instrumentation;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.StatusBarNotification;
import android.util.Log;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry;
import androidx.test.runner.lifecycle.Stage;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Explicit owned-emulator acceptance: -e petpalCompanionRuntime true.
 *
 * Uses the actual encrypted state, production notification builder, Android
 * NotificationManager and MainActivity PendingIntent receiver. No poster or
 * displayed-notification assertion is mocked. In the synthetic event test, the detached Service is only a
 * Context for its real builder: onCreate/onStartCommand never run, so no poll,
 * revoke, foreground listener or server request is started. This is native
 * posting/navigation acceptance, not an HTTPS feed transport acceptance.
 *
 * The separate HTTPS opt-in test uses a short-lived notification-device fixture
 * from the target app's private files, starts the real Service, and only reads
 * feeds plus acknowledges this fixture device's v1 cursor. The fixture owner
 * revokes the server token separately. No task, run or companion event is made.
 *
 * A document-start gate disables app JavaScript/WebView network before any packaged
 * page executes. Only a script-free local document is shown. No real account,
 * backend, device registration or system permission is created or modified.
 * Refuses a pre-existing notification vault, listener or running MainActivity;
 * cleanup clears only the two synthetic epochs owned by this test.
 */
@RunWith(AndroidJUnit4.class)
public class CompanionNotificationRuntimeTest {
    private static final String TAG = "PetCompanionRuntime";
    private static final String PREFS = "petpal_task_notifications_v1";
    private static final Instrumentation INSTRUMENTATION = InstrumentationRegistry.getInstrumentation();
    private static final AtomicBoolean GATED = new AtomicBoolean();
    private static final DateTimeFormatter ISO = new DateTimeFormatterBuilder().appendInstant(3).toFormatter();

    @CapacitorPlugin(name = "CompanionRuntimeStartupGate")
    public static final class StartupGate extends Plugin {
        @Override public void load() {
            getBridge().getWebView().getSettings().setJavaScriptEnabled(false);
            getBridge().getWebView().getSettings().setBlockNetworkLoads(true);
            GATED.set(true);
        }
    }

    private interface Probe { boolean ready() throws Exception; }
    private static <T> T main(Callable<T> work) throws Exception {
        AtomicReference<T> value = new AtomicReference<>();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        INSTRUMENTATION.runOnMainSync(() -> {
            try { value.set(work.call()); } catch (Throwable error) { failure.set(error); }
        });
        if (failure.get() != null) throw new AssertionError("Companion fixture main-thread operation failed", failure.get());
        return value.get();
    }
    private static void until(String label, Probe probe) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
        do { if (probe.ready()) return; Thread.sleep(50); } while (System.nanoTime() < deadline);
        fail("Companion runtime acceptance timeout: " + label);
    }
    private static String iso(long millis) { return ISO.format(Instant.ofEpochMilli(millis)); }
    private static JSONObject event(long seq, long createdAt, long validUntil) throws Exception {
        return new JSONObject().put("seq", seq).put("id", "fixture-event-" + UUID.randomUUID())
            .put("runId", "fixture-run-" + UUID.randomUUID()).put("createdAt", iso(createdAt)).put("validUntil", iso(validUntil))
            .put("title", "小伴的本地验收问候").put("body", "今天也要好好照顾自己。\n这是隔离模拟器中的真实系统通知。");
    }

    /** Calls only the production builder; no Service lifecycle/network worker. */
    private static final class DetachedPoster extends PetTaskNotificationService implements AutoCloseable {
        private final Method builder;
        DetachedPoster(Context context) throws Exception {
            attachBaseContext(context);
            builder = PetTaskNotificationService.class.getDeclaredMethod("companionResult", String.class, JSONObject.class);
            builder.setAccessible(true);
        }
        void post(String tag, JSONObject route) throws Exception {
            try { builder.invoke(this, tag, route); }
            catch (InvocationTargetException wrapper) {
                Throwable cause = wrapper.getCause();
                if (cause instanceof Exception) throw (Exception) cause;
                throw new AssertionError("Production companion builder failed", cause);
            }
        }
        @Override public void close() throws Exception {
            Field field = PetTaskNotificationService.class.getDeclaredField("executor");
            field.setAccessible(true);
            ((ExecutorService) field.get(this)).shutdownNow();
        }
    }

    private static final class Session implements AutoCloseable {
        final Context context = INSTRUMENTATION.getTargetContext();
        final Application application = (Application) context.getApplicationContext();
        final NotificationManager manager = context.getSystemService(NotificationManager.class);
        final SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        final AtomicReference<MainActivity> activity = new AtomicReference<>();
        final Set<String> epochs = new HashSet<>(), tags = new HashSet<>();
        boolean registered, installationCreated, startedRealService;
        String localEntry, installation;
        DetachedPoster poster;
        final Application.ActivityLifecycleCallbacks lifecycle = new Application.ActivityLifecycleCallbacks() {
            @Override public void onActivityPreCreated(Activity value, Bundle state) {
                if (value instanceof MainActivity) ((MainActivity) value).registerPlugin(StartupGate.class);
            }
            @Override public void onActivityCreated(Activity value, Bundle state) {
                if (!(value instanceof MainActivity)) return;
                MainActivity next = (MainActivity) value;
                activity.set(next);
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
        Session() throws Exception { this("petpalCompanionRuntime"); }
        Session(String optIn) throws Exception {
            Assume.assumeTrue("Explicit companion emulator acceptance only", "true".equals(InstrumentationRegistry.getArguments().getString(optIn)));
            Assume.assumeTrue("Owned task emulator only, never a personal phone", Build.HARDWARE.contains("ranchu") || Build.HARDWARE.contains("goldfish"));
            Assume.assumeTrue("Notification runtime fixture requires Android 13+", Build.VERSION.SDK_INT >= 33);
            // Check raw vault presence before init(), which intentionally clears
            // expired real credentials. Unsafe preconditions must cause no write.
            assertFalse("Use a fresh owned emulator: existing notification vault is preserved", prefs.contains("vault"));
            assertFalse("Existing notification listener must remain untouched", PetTaskNotificationService.running);
            assertNull("No active in-process notification account", TaskNotificationState.snapshot(context));
            main(() -> {
                for (Stage stage : Stage.values()) if (stage != Stage.DESTROYED) {
                    for (Activity value : ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(stage)) {
                        assertFalse("No existing MainActivity may be replaced", value instanceof MainActivity);
                    }
                }
                return null;
            });
            for (StatusBarNotification value : manager.getActiveNotifications()) {
                String tag = value.getTag();
                assertFalse("Existing task/companion notifications are preserved", tag != null && (tag.startsWith("petpal-agent-") || tag.startsWith("petpal-companion-")));
            }
            assertEquals("Runner must pregrant notification permission on the owned emulator", PackageManager.PERMISSION_GRANTED, context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS));
            assertTrue("Runner must enable OS notifications", manager.areNotificationsEnabled());
            PetTaskNotificationService.channels(context);
            NotificationChannel channel = manager.getNotificationChannel(PetTaskNotificationService.COMPANION_CHANNEL);
            assertNotNull("Real companion channel exists", channel);
            assertTrue("Companion channel must be enabled by the emulator owner", channel.getImportance() != NotificationManager.IMPORTANCE_NONE);
            try {
                main(() -> { GATED.set(false); application.registerActivityLifecycleCallbacks(lifecycle); registered = true; return null; });
                MainActivity started = (MainActivity) INSTRUMENTATION.startActivitySync(new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                activity.set(started);
                until("gated foreground Activity", () -> main(() -> activity.get().hasSecureUpdaterBridge() && activity.get().isUpdaterForeground()));
                assertTrue("Gate ran before Bridge.loadWebView", GATED.get());
                localEntry = main(() -> activity.get().getBridge().getLocalUrl());
                final String fixture = localEntry.replaceAll("/+$", "") + "/?chat=1&companionNativeFixture=" + UUID.randomUUID();
                main(() -> {
                    WebView view = activity.get().getBridge().getWebView();
                    view.stopLoading();
                    assertFalse("Real application JavaScript never runs", view.getSettings().getJavaScriptEnabled());
                    assertTrue("Fixture blocks external WebView requests", view.getSettings().getBlockNetworkLoads());
                    view.loadDataWithBaseURL(fixture, "<!doctype html><html lang=zh-CN><meta name=viewport content='width=device-width,initial-scale=1'><title>隔离通知验收</title><body>每日陪伴系统通知验收：无脚本、无账号、无网络。</body></html>", "text/html", "UTF-8", fixture);
                    return null;
                });
                until("script-free fixture document", () -> main(() -> fixture.equals(activity.get().getBridge().getWebView().getUrl())));
                installationCreated = !prefs.contains("installation");
                installation = TaskNotificationState.installation(context);
                poster = new DetachedPoster(context);
            } catch (Throwable error) { close(); throw error; }
        }
        TaskNotificationState.Snapshot activate(long agentCursor) throws Exception {
            JSONObject input = new JSONObject().put("url", "https://companion-runtime.invalid")
                .put("token", "fixture_" + UUID.randomUUID().toString().replace("-", "") + "_no_network")
                .put("deviceId", installation).put("instanceId", "fixture-instance-" + UUID.randomUUID())
                .put("userId", "fixture-user-" + UUID.randomUUID()).put("cursor", agentCursor)
                .put("expiresAt", iso(System.currentTimeMillis() + TimeUnit.HOURS.toMillis(1)));
            TaskNotificationState.Snapshot state = TaskNotificationState.activate(context, input, TaskNotificationState.generation(context));
            epochs.add(state.epoch);
            assertFalse("No Service worker was started", PetTaskNotificationService.running);
            return state;
        }
        String tag(TaskNotificationState.Snapshot state, JSONObject event) throws Exception {
            String result = CompanionNotificationPolicy.tag(state.instanceId, state.userId, event.getString("id"));
            tags.add(result);
            return result;
        }
        StatusBarNotification active(String tag) {
            for (StatusBarNotification value : manager.getActiveNotifications()) if (tag.equals(value.getTag())) return value;
            return null;
        }
        void background() throws Exception {
            assertTrue("Fixture Activity moved to background", main(() -> activity.get().moveTaskToBack(true)));
            until("Activity actually backgrounded", () -> !main(() -> activity.get().isUpdaterForeground()));
        }
        void send(PendingIntent intent) throws Exception {
            intent.send();
            until("real PendingIntent resumes MainActivity", () -> main(() -> activity.get().isUpdaterForeground()));
            main(() -> {
                Intent received = activity.get().getIntent();
                assertEquals("Notification action sanitized before Capacitor", Intent.ACTION_MAIN, received.getAction());
                assertNull("Internal route URI never reaches WebView", received.getData());
                assertFalse("Tag removed from Activity intent", received.hasExtra(PetTaskNotificationService.TAG_EXTRA));
                assertFalse("Epoch removed from Activity intent", received.hasExtra(PetTaskNotificationService.EPOCH_EXTRA));
                assertFalse("No application JS consumes the pending fixture route", activity.get().getBridge().getWebView().getSettings().getJavaScriptEnabled());
                return null;
            });
        }
        @Override public void close() throws Exception {
            try {
                TaskNotificationState.Snapshot state = TaskNotificationState.snapshot(context);
                if (state != null && epochs.contains(state.epoch)) TaskNotificationState.clear("disabled", "");
                if (startedRealService) {
                    // STOP intentionally revokes its credential. Tests leave
                    // server revocation to the fixture owner, so clear our
                    // epoch first and stop only this real listener instance.
                    main(() -> { context.stopService(new Intent(context, PetTaskNotificationService.class)); return null; });
                    until("owned HTTPS notification listener stopped", () -> !PetTaskNotificationService.running);
                }
                for (String tag : tags) manager.cancel(tag, 0);
                if (installationCreated && installation != null && TaskNotificationState.snapshot(context) == null && installation.equals(prefs.getString("installation", null))) prefs.edit().remove("installation").commit();
            } finally {
                try {
                    if (poster != null) poster.close();
                } finally {
                    try {
                        if (activity.get() != null) main(() -> {
                            MainActivity value = activity.get();
                            if (!value.isDestroyed()) {
                                WebView view = value.getBridge() == null ? null : value.getBridge().getWebView();
                                if (view != null) {
                                    view.stopLoading(); view.getSettings().setJavaScriptEnabled(false);
                                    if (localEntry != null) view.loadUrl(localEntry);
                                }
                                value.finishAndRemoveTask();
                            }
                            return null;
                        });
                    } finally {
                        if (registered) main(() -> { application.unregisterActivityLifecycleCallbacks(lifecycle); registered = false; return null; });
                    }
                }
            }
        }
    }

    @Test public void actualBackgroundNotificationTapExpiryAndAccountIsolation() throws Exception {
        try (Session session = new Session()) {
            TaskNotificationState.Snapshot first = session.activate(17);
            assertNull("Old encrypted vault baselines new companion feed independently", first.companionCursor);
            TaskNotificationState.advanceCompanion(first.epoch, 5, true);
            session.background();
            long now = System.currentTimeMillis();
            JSONObject current = event(6, now - 1000, now + TimeUnit.HOURS.toMillis(6));
            String tag = session.tag(first, current);
            TaskNotificationState.deliverCompanion(first.epoch, current, session.poster::post);
            until("real OS companion notification while Activity backgrounded", () -> session.active(tag) != null);
            assertFalse("Posting did not require foreground WebView", main(() -> session.activity.get().isUpdaterForeground()));
            Notification notification = session.active(tag).getNotification();
            assertEquals("Real companion channel", PetTaskNotificationService.COMPANION_CHANNEL, notification.getChannelId());
            assertEquals("Private lockscreen notification", Notification.VISIBILITY_PRIVATE, notification.visibility);
            assertEquals("Real BigText includes complete multiline body", current.getString("body"), notification.extras.getCharSequence(Notification.EXTRA_BIG_TEXT).toString());
            assertEquals("Real title", current.getString("title"), notification.extras.getCharSequence(Notification.EXTRA_TITLE).toString());
            assertNotNull("Generic public lockscreen version exists", notification.publicVersion);
            assertEquals("Public version contains no private greeting", "小伴有新的每日问候", notification.publicVersion.extras.getCharSequence(Notification.EXTRA_TITLE).toString());
            assertNull("Public version does not expose body", notification.publicVersion.extras.getCharSequence(Notification.EXTRA_TEXT));
            assertNull("Public version does not expose BigText body", notification.publicVersion.extras.getCharSequence(Notification.EXTRA_BIG_TEXT));
            assertTrue("OS notification has a bounded timeout", notification.getTimeoutAfter() > 0 && notification.getTimeoutAfter() <= TimeUnit.HOURS.toMillis(6));
            assertNotNull("Real content PendingIntent", notification.contentIntent);
            assertTrue("Immutable Activity PendingIntent", notification.contentIntent.isImmutable() && notification.contentIntent.isActivity());
            assertEquals("PendingIntent belongs to target application", session.context.getPackageName(), notification.contentIntent.getCreatorPackage());
            Log.i(TAG, "actualNotification=" + new JSONObject().put("channelId", notification.getChannelId())
                .put("visibility", notification.visibility).put("body", notification.extras.getCharSequence(Notification.EXTRA_BIG_TEXT))
                .put("publicTitle", notification.publicVersion.extras.getCharSequence(Notification.EXTRA_TITLE))
                .put("activityBackgrounded", !main(() -> session.activity.get().isUpdaterForeground()))
                .put("immutableActivityPendingIntent", notification.contentIntent.isImmutable() && notification.contentIntent.isActivity())
                .put("timeoutMs", notification.getTimeoutAfter()));
            PendingIntent oldIntent = notification.contentIntent;
            assertEquals("Agent cursor unchanged by companion post", 17, TaskNotificationState.snapshot(session.context).cursor);
            assertEquals(Long.valueOf(6), TaskNotificationState.snapshot(session.context).companionCursor);

            session.send(oldIntent);
            assertEquals("Click preserves the exact current epoch", first.epoch, TaskNotificationState.snapshot(session.context).epoch);
            assertEquals("Wrong account cannot consume captured notification", 0, TaskNotificationState.consume(session.context, first.instanceId, "other-user").length());
            assertEquals("Wrong instance cannot consume captured notification", 0, TaskNotificationState.consume(session.context, "other-instance", first.userId).length());
            assertFalse("Wrong epoch cannot capture an encrypted route", TaskNotificationState.capture(session.context, tag, UUID.randomUUID().toString()));
            JSONObject navigation = TaskNotificationState.consume(session.context, first.instanceId, first.userId).getJSONObject("navigation");
            assertEquals("companion", navigation.getString("source"));
            assertEquals("Exact runId survived real MainActivity route capture", current.getString("runId"), navigation.getString("runId"));
            assertEquals(current.getString("id"), navigation.getString("eventId"));
            assertFalse("No fabricated conversation", navigation.has("conversationId") || navigation.has("agentConversationId"));
            assertEquals("Click consumption is one-shot", 0, TaskNotificationState.consume(session.context, first.instanceId, first.userId).length());

            JSONObject expired = event(7, now - TimeUnit.HOURS.toMillis(2), now - 1000);
            String expiredTag = session.tag(first, expired);
            TaskNotificationState.deliverCompanion(first.epoch, expired, (unusedTag, unusedRoute) -> fail("Expired companion event must never invoke a poster"));
            assertNull("Expired event is absent from real activeNotifications", session.active(expiredTag));
            assertEquals("Expired event advances companion cursor only", Long.valueOf(7), TaskNotificationState.snapshot(session.context).companionCursor);
            assertEquals("Expired event cannot alter v1 Agent cursor", 17, TaskNotificationState.snapshot(session.context).cursor);
            assertFalse("Expired event leaves no capturable route", TaskNotificationState.capture(session.context, expiredTag, first.epoch));

            // Account replacement creates a new epoch and cancels only this
            // fixture's old notifications. The retained real PendingIntent must
            // not capture a route in the new account, even after MainActivity.
            TaskNotificationState.Snapshot second = session.activate(31);
            TaskNotificationState.advanceCompanion(second.epoch, 22, true);
            assertNotEquals(first.epoch, second.epoch);
            // NotificationManager cancellation is an asynchronous Binder/OS
            // operation. Inspect the eventual real system state, not the instant
            // after enqueueing cancel(), which may still return the old entry.
            until("account switch removes old real active notification", () -> session.active(tag) == null);
            JSONObject late = event(8, now, now + TimeUnit.HOURS.toMillis(1));
            String lateTag = session.tag(first, late);
            TaskNotificationState.deliverCompanion(first.epoch, late, (unusedTag, unusedRoute) -> fail("Stale epoch must never invoke a poster"));
            TaskNotificationState.advanceCompanion(first.epoch, 999, true);
            assertNull("Stale delivery is absent from activeNotifications", session.active(lateTag));
            assertEquals("Late old event preserves current account", second.epoch, TaskNotificationState.snapshot(session.context).epoch);
            assertEquals(Long.valueOf(22), TaskNotificationState.snapshot(session.context).companionCursor);
            assertEquals("Stale delivery preserves v1 cursor", 31, TaskNotificationState.snapshot(session.context).cursor);
            session.background();
            session.send(oldIntent);
            assertFalse("Old epoch route cannot be captured after account switch", TaskNotificationState.capture(session.context, tag, first.epoch));
            assertEquals("Old account cannot consume current state", 0, TaskNotificationState.consume(session.context, first.instanceId, first.userId).length());
            assertEquals("Old notification tap does not route new account", 0, TaskNotificationState.consume(session.context, second.instanceId, second.userId).length());
            assertEquals("Stale tap preserves current epoch", second.epoch, TaskNotificationState.snapshot(session.context).epoch);
            assertEquals("Stale tap preserves Agent cursor", 31, TaskNotificationState.snapshot(session.context).cursor);
            assertEquals("Stale tap preserves companion cursor", Long.valueOf(22), TaskNotificationState.snapshot(session.context).companionCursor);
            assertFalse("No polling/production registration occurred", PetTaskNotificationService.running);
            Log.i(TAG, "PASS: actual background NotificationManager PRIVATE/BigText, PendingIntent MainActivity run/epoch, expired cursor isolation and stale account rejection; no server transport exercised");
        }
    }

    @Test public void actualHttpsCompanionFeedAndForegroundServicePolling() throws Exception {
        // Separate flag: running the synthetic event test can never accidentally
        // use a real notification-device credential left on a task emulator.
        Assume.assumeTrue("Explicit production HTTPS read-only acceptance only", "true".equals(InstrumentationRegistry.getArguments().getString("petpalCompanionFeedRuntime")));
        Context target = INSTRUMENTATION.getTargetContext();
        File fixture = new File(target.getFilesDir(), "companion-https-fixture.json");
        assertTrue("Runner must inject private short-lived device fixture", fixture.isFile());
        assertTrue("Private fixture is bounded", fixture.length() > 0 && fixture.length() <= 16384);
        try (Session session = new Session("petpalCompanionFeedRuntime")) {
            JSONObject input = new JSONObject(new String(Files.readAllBytes(fixture.toPath()), StandardCharsets.UTF_8));
            assertEquals("Only the authorized production HTTPS endpoint is tested", "https://magicdatou.top:44318", TaskNotificationPolicy.baseUrl(input.getString("url")));
            String device = TaskNotificationPolicy.deviceId(input.getString("deviceId"));
            if (!session.installationCreated) assertEquals("Existing installation cannot be replaced", session.installation, device);
            else {
                assertTrue("Set this empty emulator's fixture-only installation", session.prefs.edit().putString("installation", device).commit());
                session.installation = device;
            }
            long originalCursor = TaskNotificationPolicy.parseCursor(input.get("cursor"));
            long expectedCompanion = TaskNotificationPolicy.parseCursor(input.has("expectedCompanionCursor") ? input.get("expectedCompanionCursor") : 0);
            TaskNotificationState.Snapshot config = TaskNotificationState.activate(session.context, input, TaskNotificationState.generation(session.context));
            session.epochs.add(config.epoch);
            assertNull("First real companion request omits independent after cursor", config.companionCursor);
            main(() -> {
                assertTrue("Real FGS starts from a foreground Activity", session.activity.get().isUpdaterForeground());
                session.startedRealService = true;
                session.context.startForegroundService(new Intent(session.context, PetTaskNotificationService.class));
                return null;
            });
            until("actual foreground notification listener", () -> PetTaskNotificationService.running);
            session.background();
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(80);
            boolean connected = false;
            do {
                JSONObject status = TaskNotificationState.status(session.context);
                if (!status.getBoolean("enabled")) fail("HTTPS listener lost its scoped credential: " + status.optString("connection"));
                if ("connected".equals(status.optString("companionConnection")) && "connected".equals(status.optString("connection"))) {
                    connected = true;
                    break;
                }
                Thread.sleep(100);
            } while (System.nanoTime() < deadline);
            JSONObject status = TaskNotificationState.status(session.context);
            assertTrue("Real HTTPS companion baseline and v1 long poll/ack must connect: " + status.optString("companionConnection") + "/" + status.optString("connection"), connected);
            TaskNotificationState.Snapshot after = TaskNotificationState.snapshot(session.context);
            assertEquals("Native service keeps v1 cursor at current baseline", originalCursor, after.cursor);
            assertEquals("Real HTTPS baseline stores companion cursor", Long.valueOf(expectedCompanion), after.companionCursor);
            assertEquals("Server identity/epoch remains bound", config.epoch, after.epoch);
            assertFalse("Listener remains alive with WebView in background", main(() -> session.activity.get().isUpdaterForeground()));
            assertTrue("Actual Service still running after feed success", PetTaskNotificationService.running);
            boolean ongoing = false;
            for (StatusBarNotification value : session.manager.getActiveNotifications()) {
                String tag = value.getTag();
                assertFalse("Read-only acceptance creates no Agent/companion result notification", tag != null && (tag.startsWith("petpal-agent-") || tag.startsWith("petpal-companion-")));
                if (PetTaskNotificationService.WATCH_CHANNEL.equals(value.getNotification().getChannelId())) ongoing = true;
            }
            assertTrue("Real visible foreground Service notification exists", ongoing);
            Log.i(TAG, "actualHttpsService=" + new JSONObject().put("url", config.url).put("api", Build.VERSION.SDK_INT)
                .put("running", PetTaskNotificationService.running).put("activityBackgrounded", true)
                .put("companionConnection", status.getString("companionConnection")).put("companionCursor", after.companionCursor)
                .put("v1Connection", status.getString("connection")).put("v1CursorPreserved", after.cursor == originalCursor)
                .put("visibleForegroundNotification", ongoing).put("tasksCreated", 0).put("resultNotificationsCreated", 0));
        } finally { Files.deleteIfExists(fixture.toPath()); }
        assertNull("Real HTTPS acceptance clears private device credential locally", TaskNotificationState.snapshot(target));
        assertFalse("Real HTTPS Service stops after acceptance", PetTaskNotificationService.running);
        Log.i(TAG, "PASS: actual production HTTPS companion baseline, v1 feed/ack and background foreground-Service polling; isolated fixture stopped/cleared, server revocation remains with fixture owner");
    }
}
