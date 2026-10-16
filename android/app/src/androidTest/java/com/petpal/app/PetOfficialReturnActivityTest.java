package com.petpal.app;

import static org.junit.Assert.*;
import android.app.Activity;
import android.app.Application;
import android.app.Instrumentation;
import android.app.Notification;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.URLEncoder;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Explicit isolated-emulator acceptance of the native Activity/host/service path.
 * The trusted local document intentionally has no application/session scripts:
 * the real account UI is covered separately, and every OAuth HTTP response here
 * is synthetic. No real OpenAI authorization, production login or storage is used.
 */
@RunWith(AndroidJUnit4.class)
public class PetOfficialReturnActivityTest {
    private interface Probe { boolean ready() throws Exception; }
    private static final Instrumentation INSTRUMENTATION = InstrumentationRegistry.getInstrumentation();

    private static <T> T main(Callable<T> work) throws Exception {
        AtomicReference<T> value = new AtomicReference<>(); AtomicReference<Throwable> failure = new AtomicReference<>();
        INSTRUMENTATION.runOnMainSync(() -> { try { value.set(work.call()); } catch (Throwable error) { failure.set(error); } });
        if (failure.get() != null) throw new AssertionError("Native main-thread acceptance failed", failure.get());
        return value.get();
    }
    private static void until(String label, Probe probe, long milliseconds) throws Exception {
        long end = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(milliseconds);
        do { if (probe.ready()) return; Thread.sleep(50); } while (System.nanoTime() < end);
        fail("Official return acceptance timeout: " + label);
    }
    private static Field field(Class<?> type, String name) throws Exception { Field value = type.getDeclaredField(name); value.setAccessible(true); return value; }
    private static PetOfficialAccountService service() throws Exception { return main(() -> (PetOfficialAccountService) field(PetOfficialAccountService.class, "current").get(null)); }
    private static boolean chromeFirstRun(AccessibilityNodeInfo root) {
        if (!"com.android.chrome".contentEquals(root.getPackageName() == null ? "" : root.getPackageName())) return false;
        for (String id : new String[] { "fre_pager", "signin_fre_continue_button", "signin_fre_dismiss_button", "signin_fre_footer" }) {
            List<AccessibilityNodeInfo> nodes = root.findAccessibilityNodeInfosByViewId("com.android.chrome:id/" + id);
            boolean found = !nodes.isEmpty(); for (AccessibilityNodeInfo node : nodes) node.recycle();
            if (found) return true;
        }
        // Some accessibility configurations omit resource IDs. Require the exact
        // Chrome onboarding title, action and terms wording together in that case.
        boolean title = false, action = false, terms = false;
        List<AccessibilityNodeInfo> nodes = root.findAccessibilityNodeInfosByText("Chrome");
        try {
            for (AccessibilityNodeInfo node : nodes) {
                CharSequence text = node.getText();
                if (text != null && "Make Chrome your own".contentEquals(text)) title = true;
                if (text != null && text.toString().startsWith("By continuing, you agree to the Terms of Service.")) terms = true;
            }
        } finally { for (AccessibilityNodeInfo node : nodes) node.recycle(); }
        nodes = root.findAccessibilityNodeInfosByText("Use without an account");
        try { for (AccessibilityNodeInfo node : nodes) if ("Use without an account".contentEquals(node.getText() == null ? "" : node.getText())) action = true; }
        finally { for (AccessibilityNodeInfo node : nodes) node.recycle(); }
        return title && action && terms;
    }

    static final class Session implements AutoCloseable {
        final Context context = INSTRUMENTATION.getTargetContext();
        final Application application = (Application) context.getApplicationContext();
        final AtomicReference<MainActivity> activity = new AtomicReference<>();
        final PetOfficialAccountNativeTest.Fixture fixture;
        final PetOfficialAccountHost host;
        final PetOfficialAccountRuntime original;
        final Application.ActivityLifecycleCallbacks lifecycle = new Application.ActivityLifecycleCallbacks() {
            @Override public void onActivityCreated(Activity value, Bundle saved) {
                if (value instanceof MainActivity) {
                    MainActivity next = (MainActivity) value; activity.set(next);
                    // Prevent unrelated app login restoration from binding a fake scope.
                    // This callback runs before WebView's queued script execution.
                    if (next.getBridge() != null) next.getBridge().getWebView().getSettings().setJavaScriptEnabled(false);
                }
            }
            @Override public void onActivityStarted(Activity value) { }
            @Override public void onActivityResumed(Activity value) { }
            @Override public void onActivityPaused(Activity value) { }
            @Override public void onActivityStopped(Activity value) { }
            @Override public void onActivitySaveInstanceState(Activity value, Bundle out) { }
            @Override public void onActivityDestroyed(Activity value) { }
        };
        boolean replaced, registered;

        Session() throws Exception {
            Assume.assumeTrue("Explicit synthetic emulator acceptance only", "true".equals(InstrumentationRegistry.getArguments().getString("petpalOfficialReturnRuntime")));
            host = PetOfficialAccountHost.get(context); original = host.runtime();
            Assume.assumeTrue("Do not replace an ongoing user authorization", original.pendingAttemptId() == null && service() == null);
            fixture = new PetOfficialAccountNativeTest.Fixture();
            try {
                main(() -> { field(PetOfficialAccountHost.class, "runtime").set(host, fixture.runtime); replaced = true; application.registerActivityLifecycleCallbacks(lifecycle); registered = true; return null; });
                MainActivity started = (MainActivity) INSTRUMENTATION.startActivitySync(new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                activity.set(started);
                until("secure visible native Activity", () -> main(() -> activity.get().hasSecureUpdaterBridge() && activity.get().isUpdaterForeground()), 30000);
                fixture.bind();
            } catch (Throwable error) { close(); throw error; }
        }

        String js(String source) throws Exception {
            CountDownLatch ready = new CountDownLatch(1); AtomicReference<String> value = new AtomicReference<>();
            main(() -> { activity.get().getBridge().getWebView().evaluateJavascript(source, result -> { value.set(result); ready.countDown(); }); return null; });
            assertTrue("Trusted local-document JS completed", ready.await(8, TimeUnit.SECONDS)); return value.get();
        }
        String localDocument() throws Exception {
            String url = main(() -> activity.get().getBridge().getLocalUrl().replaceAll("/+$", "") + "/?chat=1&officialNativeFixture=" + UUID.randomUUID());
            main(() -> { activity.get().getBridge().getWebView().getSettings().setJavaScriptEnabled(false); activity.get().getBridge().getWebView().loadUrl(url); return null; });
            until("script-free trusted local document", () -> main(() -> url.equals(activity.get().getBridge().getWebView().getUrl()) && activity.get().getBridge().getWebView().getProgress() == 100), 30000);
            main(() -> { activity.get().getBridge().getWebView().getSettings().setJavaScriptEnabled(true); return null; });
            assertEquals("true", js("(()=>{window.__officialReturnAcceptance={count:0,payloadSafe:true};window.addEventListener('petpal:official-return',e=>{e.preventDefault();window.__officialReturnAcceptance.count++;window.__officialReturnAcceptance.payloadSafe&&=e.detail==null;});return true;})()"));
            return url;
        }
        int returns() throws Exception { return Integer.parseInt(js("window.__officialReturnAcceptance?.count||0")); }
        String startProtectedAttempt() throws Exception {
            fixture.runtime.start(null); String attempt = fixture.runtime.pendingAttemptId(); assertNotNull(attempt);
            main(() -> { assertTrue(activity.get().isUpdaterForeground()); host.startAuthorizationService(); return null; });
            until("visible foreground authorization service", () -> main(() -> {
                PetOfficialAccountService value = (PetOfficialAccountService) field(PetOfficialAccountService.class, "current").get(null);
                return value != null && field(PetOfficialAccountService.class, "foreground").getBoolean(value) && attempt.equals(field(PetOfficialAccountService.class, "activeAttemptId").get(value));
            }), 10000);
            return attempt;
        }
        PendingIntent currentCancelAction() throws Exception {
            return main(() -> {
                PetOfficialAccountService value = (PetOfficialAccountService) field(PetOfficialAccountService.class, "current").get(null); assertNotNull(value);
                Method build = PetOfficialAccountService.class.getDeclaredMethod("ongoing", String.class); build.setAccessible(true);
                Notification notification = (Notification) build.invoke(value, fixture.runtime.pendingAttemptId());
                assertNotNull(notification.actions); assertEquals(1, notification.actions.length); return notification.actions[0].actionIntent;
            });
        }
        void view(String uri) throws Exception {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uri), context, MainActivity.class)
                .addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_GRANT_READ_URI_PERMISSION)
                .putExtra("code", "synthetic-never-forward").putExtra(MainActivity.OPEN_CHAT, true);
            intent.setClipData(ClipData.newPlainText("synthetic", "synthetic-never-forward"));
            context.startActivity(intent);
            INSTRUMENTATION.waitForIdleSync();
        }
        void assertSanitized() throws Exception {
            main(() -> {
                Intent value = activity.get().getIntent(); assertEquals(Intent.ACTION_MAIN, value.getAction()); assertNull(value.getData()); assertNull(value.getClipData()); assertNull(value.getExtras()); assertNull(value.getSelector());
                assertEquals(0, value.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)); return null;
            });
        }
        @Override public void close() throws Exception {
            try {
                fixture.tokenContinue.countDown(); fixture.runtime.clearScope();
                main(() -> { context.stopService(new Intent(context, PetOfficialAccountService.class)); if (activity.get() != null && !activity.get().isFinishing()) activity.get().finishAndRemoveTask(); return null; });
                until("temporary service stopped during fixture cleanup", () -> service() == null, 10000);
                until("fixture Activity destroyed", () -> main(() -> activity.get() == null || activity.get().isDestroyed()), 10000);
            } finally {
                main(() -> {
                    if (registered) { application.unregisterActivityLifecycleCallbacks(lifecycle); registered = false; }
                    if (replaced) { field(PetOfficialAccountHost.class, "runtime").set(host, original); replaced = false; }
                    return null;
                });
                fixture.close();
            }
        }
    }

    @Test public void realActivityReturnIsSanitizedSingleUseAndPendingWaitSurvivesRecreation() throws Exception {
        try (Session session = new Session()) {
            String attempt = session.startProtectedAttempt(); PendingIntent oldCancel = session.currentCancelAction(); MainActivity before = session.activity.get();
            main(() -> { before.recreate(); return null; });
            until("replacement Activity resumed", () -> main(() -> session.activity.get() != before && before.isDestroyed() && session.activity.get().isUpdaterForeground()), 30000);
            assertSame(session.fixture.runtime, session.host.runtime()); assertEquals(attempt, session.fixture.runtime.pendingAttemptId()); assertNotNull(service());
            String local = session.localDocument();
            session.context.startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            until("Activity backgrounded without destroying native wait", () -> main(() -> !session.activity.get().isUpdaterForeground()), 10000);
            assertEquals(attempt, session.fixture.runtime.pendingAttemptId()); assertNotNull(service());

            session.fixture.blockToken = true;
            assertEquals(200, session.fixture.callback(session.fixture.auth().get("state"), "fixture-issued-client"));
            assertTrue(session.fixture.tokenEntered.await(5, TimeUnit.SECONDS)); session.fixture.assertSafeReturnPage();
            String uri = session.fixture.returnUri(); session.view(uri);
            until("accepted native return delivered to fixed settings event", () -> session.returns() == 1 && main(() -> session.activity.get().isUpdaterForeground()), 5000);
            session.assertSanitized(); assertEquals(local, main(() -> session.activity.get().getBridge().getWebView().getUrl())); assertEquals("true", session.js("window.__officialReturnAcceptance.payloadSafe"));
            assertEquals(attempt, session.fixture.runtime.pendingAttemptId()); assertEquals("verifying", session.fixture.runtime.status().getString("signInStage"));
            session.view(uri); session.view("petpal://official-account/return?ticket=" + "A".repeat(43) + "&code=synthetic");
            session.assertSanitized(); assertEquals(1, session.returns());
            session.fixture.tokenContinue.countDown(); session.fixture.blockToken = false;
            until("synthetic signed-in account and relay", () -> session.fixture.runtime.status().getBoolean("relayConnected") && session.fixture.runtime.pendingAttemptId() == null, 10000);
            until("completed authorization service stopped", () -> service() == null, 5000);
            assertTrue("Stopping the temporary wait must preserve the model relay", session.fixture.runtime.status().getBoolean("relayConnected"));

            String successor = session.startProtectedAttempt(); assertNotEquals(attempt, successor); oldCancel.send();
            INSTRUMENTATION.waitForIdleSync(); assertEquals("Old notification cannot cancel the successor", successor, session.fixture.runtime.pendingAttemptId());
            main(() -> { session.context.stopService(new Intent(session.context, PetOfficialAccountService.class)); return null; });
            until("abnormal service destruction cancels its own pending attempt", () -> session.fixture.runtime.pendingAttemptId() == null && service() == null, 5000);
            assertTrue(session.fixture.runtime.status().has("error")); assertTrue(session.fixture.runtime.status().getBoolean("relayConnected"));
        }
    }

    @Test public void chromeReceivesRealLoopbackHtmlAndReturnsToExistingActivity() throws Exception {
        try (Session session = new Session()) {
            String local = session.localDocument(); session.startProtectedAttempt(); MainActivity originalActivity = session.activity.get();
            String callback = session.fixture.auth().get("redirect_uri") + "?state=" + URLEncoder.encode(session.fixture.auth().get("state"), "UTF-8") + "&code=synthetic-code&client_id=fixture-issued-client";
            try { session.context.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(callback)).setPackage("com.android.chrome").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
            catch (ActivityNotFoundException missing) { Assume.assumeNoException("The isolated image has no Chrome", missing); }
            until("Chrome callback automatically returns or exposes the explicit return button", () -> {
                if (session.returns() == 1 && main(() -> session.activity.get().isUpdaterForeground())) return true;
                AccessibilityNodeInfo root = INSTRUMENTATION.getUiAutomation().getRootInActiveWindow();
                if (root != null) {
                    try {
                        // A fresh emulator may require accepting Chrome's own
                        // terms first. Do not accept or bypass that user decision;
                        // only this exact environment condition skips browser QA.
                        // Other missing-return cases retain the normal timeout.
                        Assume.assumeFalse("Chrome first-run initialization requires user acceptance; real Chrome return remains unverified", chromeFirstRun(root));
                        List<AccessibilityNodeInfo> nodes = root.findAccessibilityNodeInfosByText("返回小伴");
                        for (AccessibilityNodeInfo node : nodes) try {
                            if ("返回小伴".contentEquals(node.getText() == null ? "" : node.getText()) && node.isClickable()) { node.performAction(AccessibilityNodeInfo.ACTION_CLICK); break; }
                        } finally { node.recycle(); }
                    } finally { root.recycle(); }
                }
                return false;
            }, 30000);
            assertSame("singleTask return reuses the existing Activity", originalActivity, session.activity.get()); session.assertSanitized();
            assertEquals(local, main(() -> session.activity.get().getBridge().getWebView().getUrl())); assertEquals(1, session.returns()); assertEquals("true", session.js("window.__officialReturnAcceptance.payloadSafe"));
            until("synthetic official response completes after Chrome callback", () -> session.fixture.runtime.status().getBoolean("relayConnected") && service() == null, 10000);
        }
    }
}
