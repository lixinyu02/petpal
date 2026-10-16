package com.petpal.app;

import static org.junit.Assert.*;
import android.app.AlertDialog;
import android.os.Build;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.Plugin;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.URLEncoder;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Explicit isolated-emulator acceptance (-e petpalOfficialReturnRuntime true).
 * Actual trusted WebView -> Capacitor -> native dialog; callback URLs are only
 * placed into native EditText. All official HTTP is the synthetic native fixture.
 * The host and fixture Activity are restored/closed by Session on every path.
 */
@RunWith(AndroidJUnit4.class)
public class PetOfficialCallbackInputTest {
    private interface Probe { boolean ready() throws Exception; }
    private static <T> T main(Callable<T> work) throws Exception {
        AtomicReference<T> value = new AtomicReference<>(); AtomicReference<Throwable> failure = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> { try { value.set(work.call()); } catch (Throwable error) { failure.set(error); } });
        if (failure.get() != null) throw new AssertionError("Native callback input main-thread acceptance failed", failure.get());
        return value.get();
    }
    private static void until(String label, Probe probe) throws Exception {
        until(label, probe, 15000);
    }
    private static void until(String label, Probe probe, long milliseconds) throws Exception {
        long end = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(milliseconds);
        do { if (probe.ready()) return; Thread.sleep(40); } while (System.nanoTime() < end);
        fail("Native callback input acceptance timeout: " + label);
    }
    private static Field field(String name) throws Exception { Field value = PetOfficialAccountPlugin.class.getDeclaredField(name); value.setAccessible(true); return value; }

    private static final class InputSession implements AutoCloseable {
        final PetOfficialReturnActivityTest.Session app;
        final PetOfficialAccountPlugin plugin;
        final String scope, attempt, callback;
        EditText displayedInput;
        InputSession() throws Exception {
            app = new PetOfficialReturnActivityTest.Session();
            try {
                String marker = UUID.randomUUID().toString();
                String url = main(() -> app.activity.get().getBridge().getLocalUrl().replaceAll("/+$", "") + "/?chat=1&manualNativeFixture=" + marker);
                // Load the real packaged application with JS enabled before
                // navigation. Its own document bootstrap installs Capacitor;
                // this test never exports/re-evaluates the native bridge.
                main(() -> {
                    app.activity.get().getBridge().getWebView().getSettings().setJavaScriptEnabled(true);
                    app.activity.get().getBridge().getWebView().loadUrl(url); return null;
                });
                plugin = main(() -> (PetOfficialAccountPlugin) app.activity.get().getBridge().getPlugin("PetOfficialAccount").getInstance());
                assertSame(app.fixture.runtime, field("runtime").get(plugin));
                Method listening = Plugin.class.getDeclaredMethod("hasListeners", String.class); listening.setAccessible(true);
                // The isolated image has only a synthetic, offline app login.
                // Wait for the real login gate and official session lifecycle's
                // listener, so any initial clearScope finishes before rebinding
                // the native fake account used by this dialog-only acceptance.
                try {
                    until("real packaged Android bridge and settled login gate", () -> "true".equals(app.js("Boolean(location.search.includes(" + JSONObject.quote(marker) + ")&&window.androidBridge&&typeof window.androidBridge.postMessage==='function'&&window.Capacitor?.getPlatform?.()==='android'&&window.Capacitor?.Plugins?.PetOfficialAccount?.completeCallback&&document.querySelector('.login-form input[autocomplete=username]')&&!document.querySelector('button[aria-label=\"我的账号\"]'))"))
                        && main(() -> (Boolean) listening.invoke(plugin, "status")), 45000);
                } catch (AssertionError unavailable) {
                    String flags = app.js("({fixturePage:location.search.includes(" + JSONObject.quote(marker) + "),nativeBridge:Boolean(window.androidBridge&&typeof window.androidBridge.postMessage==='function'),android:window.Capacitor?.getPlatform?.()==='android',plugin:Boolean(window.Capacitor?.Plugins?.PetOfficialAccount?.completeCallback),loginGate:Boolean(document.querySelector('.login-form input[autocomplete=username]')),verifiedWorkspace:Boolean(document.querySelector('button[aria-label=\"我的账号\"]'))})");
                    throw new AssertionError("Packaged fixture not ready; safe page flags=" + flags + "; statusListener=" + main(() -> (Boolean) listening.invoke(plugin, "status")), unavailable);
                }
                scope = app.fixture.bind(); attempt = app.startProtectedAttempt();
                Map<String, String> auth = app.fixture.auth();
                callback = auth.get("redirect_uri") + "?state=" + URLEncoder.encode(auth.get("state"), "UTF-8") + "&code=synthetic-code&client_id=fixture-issued-client";
                assertTrue(app.fixture.runtime.status().getBoolean("manualCallbackSupported"));
            } catch (Throwable error) { app.close(); throw error; }
        }
        void open() throws Exception {
            // The web side knows the small account scope only. It never sees or
            // serializes the callback URL, state, code or native input contents.
            app.js("window.__manualCallbackAcceptance=null;(async()=>{try{const value=await window.Capacitor.Plugins.PetOfficialAccount.completeCallback({scopeId:" + JSONObject.quote(scope) + "});window.__manualCallbackAcceptance={ok:true,value};}catch(error){window.__manualCallbackAcceptance={ok:false,message:String(error?.message||'')};}})()");
            until("actual native callback dialog displayed", () -> {
                boolean displayed = main(() -> {
                    AlertDialog dialog = (AlertDialog) field("callbackDialog").get(plugin);
                    return dialog != null && dialog.isShowing() && field("callbackInput").get(plugin) instanceof EditText;
                });
                if (displayed) return true;
                // Emit only fixed diagnostic categories. Never stringify the
                // bridge call, native input, callback URL or arbitrary errors.
                String rejection = app.js("(()=>{const r=window.__manualCallbackAcceptance;if(!r||r.ok!==false)return 'pending';const m=r.message||'';return m.includes('安全的小伴主页面')?'untrusted-page':m.includes('本次登录已结束')?'no-pending-attempt':m.includes('已经打开')?'already-open':m.includes('请返回小伴主页面')?'no-activity':m.includes('回调输入已关闭')?'input-closed':'unexpected-rejection';})()");
                assertEquals("Native callback dialog request rejected before display; safe category=" + rejection, "\"pending\"", rejection);
                return false;
            });
            displayedInput = main(() -> (EditText) field("callbackInput").get(plugin));
            main(() -> {
                assertFalse("Input text cannot be saved into Activity/view state", displayedInput.isSaveEnabled());
                assertFalse("The parent cannot save callback text", displayedInput.isSaveFromParentEnabled());
                if (Build.VERSION.SDK_INT >= 26) assertEquals("OAuth callback and descendants must be excluded from autofill", View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS, displayedInput.getImportantForAutofill());
                assertTrue("IME cannot learn from authorization fields", (displayedInput.getImeOptions() & EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING) != 0);
                AlertDialog dialog = (AlertDialog) field("callbackDialog").get(plugin);
                assertTrue("Authorization input is excluded from screenshots and recents", (dialog.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_SECURE) != 0);
                displayedInput.setText(callback); return null;
            });
            assertEquals("Native input must not be mirrored into the document", "false", app.js("document.documentElement.textContent.includes('synthetic-code')"));
        }
        JSONObject result() throws Exception {
            AtomicReference<JSONObject> result = new AtomicReference<>();
            until("native dialog promise completed", () -> {
                String value = app.js("window.__manualCallbackAcceptance");
                if (value == null || "null".equals(value)) return false;
                result.set(new JSONObject(value)); return true;
            });
            String serialized = result.get().toString();
            for (String secret : new String[] { callback, "synthetic-code", "code=", "state=", "client_id=", app.fixture.auth().get("state"), "synthetic-access", "synthetic-refresh", "synthetic-petpal-session" }) {
                assertFalse("WebView result must expose public account status only", serialized.contains(secret));
            }
            return result.get();
        }
        void cleared() throws Exception {
            until("dialog and pending call references cleared", () -> main(() -> field("callbackDialog").get(plugin) == null && field("callbackInput").get(plugin) == null && field("callbackInputCall").get(plugin) == null && field("callbackInputScope").get(plugin) == null));
            main(() -> { assertEquals("The detached native input contains no callback", 0, displayedInput.getText().length()); return null; });
        }
        @Override public void close() throws Exception { app.close(); }
    }

    @Test public void actualBridgeSubmitsNativeInputAndReturnsOnlyPublicAccountStatus() throws Exception {
        try (InputSession session = new InputSession()) {
            session.open();
            main(() -> { ((AlertDialog) field("callbackDialog").get(session.plugin)).getButton(AlertDialog.BUTTON_POSITIVE).performClick(); return null; });
            JSONObject result = session.result(); assertTrue(result.getBoolean("ok"));
            until("synthetic official account verified", () -> "signed-in".equals(session.app.fixture.runtime.status().getString("state")));
            assertEquals(1, session.app.fixture.grants.size()); assertNull(session.app.fixture.runtime.pendingAttemptId()); session.cleared();
        }
    }

    @Test public void cancellingNativeInputKeepsTheBrowserAuthorizationAttempt() throws Exception {
        try (InputSession session = new InputSession()) {
            session.open(); main(() -> { ((AlertDialog) field("callbackDialog").get(session.plugin)).cancel(); return null; });
            JSONObject result = session.result(); assertTrue(result.getBoolean("ok"));
            assertEquals(session.attempt, session.app.fixture.runtime.pendingAttemptId()); assertTrue(session.app.fixture.grants.isEmpty()); session.cleared();
        }
    }

    @Test public void browserCompletionClosesAnOpenManualInputAndReportsTheVerifiedAccount() throws Exception {
        try (InputSession session = new InputSession()) {
            session.open();
            assertEquals(200, session.app.fixture.callback(session.app.fixture.auth().get("state"), "fixture-issued-client"));
            until("browser channel completes the synthetic account", () -> session.app.fixture.runtime.pendingAttemptId() == null && "signed-in".equals(session.app.fixture.runtime.status().getString("state")));
            // Fixture HTTP has a no-op runtime listener. Dispatch through the
            // actual host notification path so the attached plugin's real
            // checkCallbackInput handles browser completion of the same attempt.
            main(() -> {
                Method changed = PetOfficialAccountHost.class.getDeclaredMethod("changed"); changed.setAccessible(true); changed.invoke(session.app.host); return null;
            });
            JSONObject result = session.result(); assertTrue(result.getBoolean("ok")); assertEquals("signed-in", result.getJSONObject("value").getString("state"));
            assertEquals("Only the browser channel redeems this authorization", 1, session.app.fixture.grants.size());
            assertNull(session.app.fixture.runtime.pendingAttemptId()); session.cleared();
        }
    }

    @Test public void clearingAccountScopeDismissesInputRejectsItsCallAndDropsTheCallback() throws Exception {
        try (InputSession session = new InputSession()) {
            session.open(); session.app.js("window.__manualClearFinished=false;window.Capacitor.Plugins.PetOfficialAccount.clearScope().then(()=>{window.__manualClearFinished=true;});");
            JSONObject result = session.result(); assertFalse(result.getBoolean("ok"));
            until("real clearScope bridge call completed", () -> "true".equals(session.app.js("window.__manualClearFinished")));
            assertNull(session.app.fixture.runtime.pendingAttemptId()); assertTrue(session.app.fixture.grants.isEmpty()); session.cleared();
        }
    }

    @Test public void destroyingNativePluginDismissesAndErasesInputWithoutClosingTheAppAttempt() throws Exception {
        try (InputSession session = new InputSession()) {
            session.open();
            // Exercise the actual native destroy hook while keeping its old
            // document alive long enough to observe the pending-call rejection.
            // Full Activity recreation is covered by the separate Activity test.
            main(() -> { session.plugin.handleOnDestroy(); return null; });
            JSONObject result = session.result(); assertFalse(result.getBoolean("ok"));
            assertEquals(session.attempt, session.app.fixture.runtime.pendingAttemptId()); assertTrue(session.app.fixture.grants.isEmpty()); session.cleared();
        }
    }
}
