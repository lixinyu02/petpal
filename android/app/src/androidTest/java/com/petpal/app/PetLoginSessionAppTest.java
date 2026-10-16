package com.petpal.app;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Build;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Staged actual-form acceptance, never a production account. The external
 * orchestrator owns adb reverse, backend availability, force-stop and relaunch.
 * Run only this class with -e stage login/restored/offline/logout/cleared.
 * Reports contain booleans only; neither a token nor form password is emitted.
 */
@RunWith(AndroidJUnit4.class)
public class PetLoginSessionAppTest {
    private static final String URL = "http://127.0.0.1:45321";
    private static final String USER = "syncfixture";
    private static final String PASSWORD = "SyntheticSync123a";
    private MainActivity activity;
    private Context context;
    private interface Probe { boolean ready() throws Exception; }
    private void until(String label, Probe probe, long timeout) throws Exception {
        long end = System.currentTimeMillis() + timeout;
        do { if (probe.ready()) return; Thread.sleep(150); } while (System.currentTimeMillis() < end);
        fail("Login app acceptance timeout: " + label);
    }
    private String js(String source) throws Exception {
        CountDownLatch ready = new CountDownLatch(1); AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.getBridge().getWebView().evaluateJavascript(source, value -> { result.set(value); ready.countDown(); }));
        assertTrue("WebView callback completed", ready.await(8, TimeUnit.SECONDS)); return result.get();
    }
    private boolean bool(String expression) throws Exception { return "true".equals(js("Boolean(" + expression + ")")); }
    private File vault() { return new File(context.getNoBackupFilesDir(), "login-session-v1.enc"); }
    private void assertEncryptedFile() throws Exception {
        assertTrue("Encrypted no-backup login file exists", vault().isFile());
        assertTrue("Encrypted login file is bounded", vault().length() > 40 && vault().length() <= 32768);
        String bytes = new String(Files.readAllBytes(vault().toPath()), StandardCharsets.UTF_8); JSONObject envelope = new JSONObject(bytes);
        assertEquals("Only an encryption envelope is stored", 3, envelope.length()); assertEquals(1, envelope.getInt("version"));
        assertTrue(envelope.getString("iv").length() > 8); assertTrue(envelope.getString("data").length() > 20);
        assertFalse("No plaintext password", bytes.contains(PASSWORD)); assertFalse("No plaintext username", bytes.contains(USER));
        assertFalse("No plaintext endpoint", bytes.contains(URL)); assertFalse("No plaintext credential field", envelope.has("token"));
    }
    private JSONObject sessionSnapshot() throws Exception {
        // Deliberately return booleans instead of a token or serialized storage.
        return new JSONObject(js("(()=>{try{const c=JSON.parse(sessionStorage.getItem('petpal.connection')||'null');return {hasToken:Boolean(c&&typeof c.token==='string'&&c.token),correctUrl:Boolean(c&&c.url===" + JSONObject.quote(URL) + "),sessionKind:Boolean(c&&c.credentialKind==='session')};}catch{return {hasToken:false,correctUrl:false,sessionKind:false};}})()"));
    }
    private void startChat() throws Exception {
        activity = (MainActivity) InstrumentationRegistry.getInstrumentation().startActivitySync(new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        until("secure local main page", () -> activity.hasSecureUpdaterBridge() && activity.isUpdaterForeground()
            && activity.getBridge() != null && activity.getBridge().getWebView() != null, 30000);
        String navigation = "loginAcceptance=" + Long.toHexString(System.nanoTime());
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            String local = activity.getBridge().getLocalUrl().replaceAll("/+$", "");
            activity.getBridge().getWebView().loadUrl(local + "/?chat=1&" + navigation);
        });
        until("local login session bridge installed", () -> bool("location.search.includes(" + JSONObject.quote(navigation) + ")&&window.petpalLoginSession&&typeof window.petpalLoginSession.read==='function'"), 30000);
    }
    private void loginForm() throws Exception {
        until("actual account/password login form", () -> bool("document.querySelector('.login-form input[autocomplete=username]')&&document.querySelector('.login-form input[autocomplete=current-password]')"), 45000);
    }
    private void accountPage() throws Exception {
        until("authenticated workspace account button", () -> bool("document.querySelector('button[aria-label=\"我的账号\"]')"), 45000);
        assertTrue("Account button clicked", bool("(()=>{const button=document.querySelector('button[aria-label=\"我的账号\"]');if(!button)return false;button.click();return true;})()"));
        until("fixture account rendered by the actual application", () -> bool("Array.from(document.querySelectorAll('.account-identity span')).some(node=>node.textContent.includes('@" + USER + "'))"), 30000);
        assertFalse("No login form over the authenticated workspace", bool("document.querySelector('.login-form')"));
        JSONObject session = sessionSnapshot(); assertTrue("Restored login is present", session.getBoolean("hasToken"));
        assertTrue("The fixture endpoint is unchanged", session.getBoolean("correctUrl")); assertTrue("Password login session kind retained", session.getBoolean("sessionKind"));
        assertEncryptedFile();
    }
    private void submitLogin() throws Exception {
        loginForm(); assertFalse("Fixture login starts without another saved account", vault().exists());
        String script = "(()=>{const form=document.querySelector('.login-form form');if(!form)return false;const fields=[[form.querySelector('input[autocomplete=url]')," + JSONObject.quote(URL) + "],[form.querySelector('input[autocomplete=username]')," + JSONObject.quote(USER) + "],[form.querySelector('input[autocomplete=current-password]')," + JSONObject.quote(PASSWORD) + "]];if(fields.some(([field])=>!field))return false;for(const[field,value]of fields){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));}return true;})()";
        assertTrue("Actual controlled form fields filled", bool(script));
        until("React-controlled form values accepted", () -> bool("(()=>{const form=document.querySelector('.login-form form');return form&&form.querySelector('input[autocomplete=url]').value===" + JSONObject.quote(URL) + "&&form.querySelector('input[autocomplete=username]').value===" + JSONObject.quote(USER) + "&&form.querySelector('input[autocomplete=current-password]').value.length>0;})()"), 5000);
        assertTrue("Actual form submitted", bool("(()=>{const form=document.querySelector('.login-form form');if(!form)return false;form.requestSubmit();return true;})()"));
        accountPage();
    }
    private void logout() throws Exception {
        accountPage();
        assertTrue("Actual logout control clicked", bool("(()=>{const button=Array.from(document.querySelectorAll('button')).find(node=>node.textContent.trim()==='退出登录');if(!button||button.disabled)return false;button.click();return true;})()"));
        loginForm(); until("native persisted credential removed", () -> !vault().exists(), 10000);
        assertFalse("Session credential removed from the page", sessionSnapshot().getBoolean("hasToken"));
        assertFalse("Previous account is no longer rendered", bool("document.querySelector('.account-identity')"));
    }
    private void cleared() throws Exception {
        loginForm(); assertFalse("Cold start does not resurrect the vault", vault().exists());
        assertFalse("Cold start does not resurrect a session", sessionSnapshot().getBoolean("hasToken"));
        assertTrue("No password is restored", bool("document.querySelector('input[autocomplete=current-password]').value.length===0"));
        assertFalse("No authenticated workspace before login", bool("document.querySelector('button[aria-label=\"我的账号\"]')"));
    }
    private void offline() throws Exception {
        until("offline cold-start credential restoration", () -> sessionSnapshot().getBoolean("hasToken"), 15000);
        until("offline validation shows a retry state", () -> bool("document.querySelector('.login-retry[role=alert]')"), 30000);
        JSONObject session = sessionSnapshot(); assertTrue("Offline retry preserves the session", session.getBoolean("hasToken")); assertTrue("Offline retry retains its destination", session.getBoolean("correctUrl"));
        assertEncryptedFile(); assertFalse("Offline authentication does not unlock the workspace", bool("document.querySelector('button[aria-label=\"我的账号\"]')"));
    }
    private void evidence(String stage) throws Exception {
        JSONObject report = new JSONObject().put("passed", true).put("stage", stage).put("actualMainActivity", true).put("actualFormOrUi", true)
            .put("hasSession", sessionSnapshot().getBoolean("hasToken")).put("encryptedVaultExists", vault().isFile()).put("apiLevel", Build.VERSION.SDK_INT);
        Files.write(new File(context.getExternalFilesDir(null), "login-app-" + stage + ".json").toPath(), report.toString().getBytes(StandardCharsets.UTF_8));
        Bitmap screenshot = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot(); assertNotNull("Visible app screenshot", screenshot);
        try (FileOutputStream output = new FileOutputStream(new File(context.getExternalFilesDir(null), "login-app-" + stage + ".png"))) { assertTrue(screenshot.compress(Bitmap.CompressFormat.PNG, 100, output)); }
        finally { screenshot.recycle(); }
    }
    @Test public void stagedActualApplicationLoginPersistence() throws Exception {
        String stage = InstrumentationRegistry.getArguments().getString("stage");
        org.junit.Assume.assumeTrue("Explicit staged emulator acceptance only", stage != null);
        assertTrue("Known staged login operation", Arrays.asList("login", "restored", "offline", "logout", "cleared").contains(stage));
        org.junit.Assume.assumeTrue("Only an isolated Android emulator may run this fixture", Build.HARDWARE.contains("ranchu") || Build.HARDWARE.contains("goldfish") || Build.MODEL.contains("sdk"));
        context = InstrumentationRegistry.getInstrumentation().getTargetContext(); startChat();
        switch (stage) { case "login": submitLogin(); break; case "restored": accountPage(); break; case "offline": offline(); break; case "logout": logout(); break; case "cleared": cleared(); break; default: throw new AssertionError(); }
        evidence(stage);
    }
}
