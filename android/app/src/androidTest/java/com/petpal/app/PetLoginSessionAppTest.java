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
 * Run only this class with -e stage
 * login/restored/offline/offlineThenForeground/logout/cleared/proxy/proxyRestored.
 * Reports contain booleans only; neither a token nor form password is emitted.
 */
@RunWith(AndroidJUnit4.class)
public class PetLoginSessionAppTest {
    private static final String URL = "http://127.0.0.1:45321";
    private static final String USER = "syncfixture";
    private static final String PASSWORD = "SyntheticSync123a";
    private static final String PROXY_PROFILE = "验收配置 · 地点策略";
    private MainActivity activity;
    private Context context;
    private String lastWait = "not-started";
    private interface Probe { boolean ready() throws Exception; }
    private void until(String label, Probe probe, long timeout) throws Exception {
        lastWait = label;
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
    private void assertTheme(String expected) throws Exception {
        until("real document and native appearance agree", () -> bool("document.documentElement.dataset.theme===" + JSONObject.quote(expected))
            && expected.equals(context.getSharedPreferences(ScreenInsetsController.APPEARANCE_PREFS, Context.MODE_PRIVATE).getString(ScreenInsetsController.PREFERENCE, null)), 15000);
        String cssColor = "night".equals(expected) ? "rgb(24, 29, 27)" : "rgb(250, 251, 248)";
        until("real computed document background follows the preference", () -> bool("getComputedStyle(document.documentElement).backgroundColor===" + JSONObject.quote(cssColor)), 5000);
        android.app.UiModeManager manager = context.getSystemService(android.app.UiModeManager.class);
        int expectedMode = "night".equals(expected) ? android.content.res.Configuration.UI_MODE_NIGHT_YES : android.content.res.Configuration.UI_MODE_NIGHT_NO;
        assertEquals("Actual Activity configuration follows its own theme", expectedMode, activity.getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK);
        assertTrue("Theme changes preserve the authenticated session", sessionSnapshot().getBoolean("hasToken"));
        assertEncryptedFile();
    }
    private void chooseTheme(String selected) throws Exception {
        accountPage();
        android.app.UiModeManager manager = context.getSystemService(android.app.UiModeManager.class);
        int systemMode = manager.getNightMode();
        MainActivity original = activity;
        assertTrue("Actual device tab clicked", bool("(()=>{const tab=Array.from(document.querySelectorAll('[role=tab]')).find(node=>node.textContent.trim()==='设备连接');if(!tab||tab.disabled)return false;tab.click();return true;})()"));
        until("actual appearance radio is available", () -> bool("document.querySelector('.theme-settings input[value=" + selected + "]')&&!document.querySelector('.theme-settings fieldset').disabled"), 30000);
        assertTrue("Actual theme radio clicked", bool("(()=>{const input=document.querySelector('.theme-settings input[value=" + selected + "]');if(!input||input.disabled)return false;input.click();return true;})()"));
        assertTheme(selected);
        assertFalse("Appearance does not finish the authenticated Activity", original.isFinishing() || original.isDestroyed());
        assertEquals("External system night mode is unchanged", systemMode, manager.getNightMode());
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
        assertFalse("Saved login reconnect never asks for the password again", bool("document.querySelector('.login-form input[autocomplete=current-password]')"));
    }
    private void offlineThenForeground() throws Exception {
        offline();
        MainActivity retained = activity;
        String marker = "retained-" + Long.toHexString(System.nanoTime());
        assertTrue("Marker belongs to the actual current WebView", bool("(()=>{window.__loginReconnectFixture="+JSONObject.quote(marker)+";return true;})()"));
        File ready = new File(context.getExternalFilesDir(null), "login-reconnect-ready.json");
        File background = new File(context.getExternalFilesDir(null), "login-reconnect-background.json");
        File release = new File(context.getExternalFilesDir(null), "login-reconnect-release");
        assertFalse("Each isolated fixture uses a fresh reconnect handshake", ready.exists() || background.exists() || release.exists());
        Files.write(ready.toPath(), "{\"offlineReady\":true}".getBytes(StandardCharsets.UTF_8));
        // The host removes only this emulator's loopback reverse for offline
        // startup, then backgrounds the existing Activity, restores that reverse
        // and resumes this same Activity. No page reload or retry button is used.
        until("host backgrounds original Activity", () -> !retained.isUpdaterForeground(), 120000);
        Files.write(background.toPath(), "{\"backgroundObserved\":true}".getBytes(StandardCharsets.UTF_8));
        until("host restores the isolated loopback transport", release::isFile, 120000);
        until("original Activity returns to foreground", retained::isUpdaterForeground, 30000);
        assertFalse("Foreground reconnect does not recreate the Activity", retained.isDestroyed() || retained.isFinishing());
        assertSame("Native Activity reference remains unchanged", retained, activity);
        assertTrue("Foreground reconnect does not reload its WebView", bool("window.__loginReconnectFixture==="+JSONObject.quote(marker)));
        accountPage();
        assertTrue("Automatic reconnect preserves the WebView after verification", bool("window.__loginReconnectFixture==="+JSONObject.quote(marker)));
        Files.write(new File(context.getExternalFilesDir(null), "login-reconnect-result.json").toPath(),
            "{\"sameActivity\":true,\"sameWebView\":true,\"automaticForegroundReconnect\":true,\"passwordNotEntered\":true}".getBytes(StandardCharsets.UTF_8));
    }
    private void proxyPage() throws Exception {
        accountPage();
        assertTrue("Actual device settings tab clicked", bool("(()=>{const tab=Array.from(document.querySelectorAll('[role=tab]')).find(node=>node.textContent.trim()==='设备连接');if(!tab||tab.disabled)return false;tab.click();return true;})()"));
        until("Android proxy settings and server catalog loaded", () -> bool("(()=>{const section=document.querySelector('section.app-proxy-settings');const picker=section?.querySelector('.app-proxy-server-picker select');return section&&section.getAttribute('aria-busy')==='false'&&picker&&!picker.disabled&&Array.from(picker.options).some(option=>option.textContent===" + JSONObject.quote(PROXY_PROFILE) + ");})()"), 45000);
    }
    private void proxyIdle() throws Exception {
        until("proxy operation finished in the actual settings view", () -> bool("document.querySelector('section.app-proxy-settings')?.getAttribute('aria-busy')==='false'"), 45000);
        assertFalse("Proxy view did not report an operation error", bool("document.querySelector('section.app-proxy-settings [role=alert]')"));
    }
    private boolean proxyButton(String label) throws Exception {
        return bool("(()=>{const section=document.querySelector('section.app-proxy-settings');const button=Array.from(section?.querySelectorAll('button')||[]).find(node=>node.textContent.trim()===" + JSONObject.quote(label) + ");if(!button||button.disabled)return false;button.click();return true;})()");
    }
    private JSONObject nativeProxySnapshot() throws Exception {
        // Read the real registered native bridge, without replacing its HTTP
        // factory or exposing its complete status in a test report.
        js("window.__petpalProxyAppAcceptance=null;window.Capacitor.Plugins.PetAppProxy.status().then(value=>{window.__petpalProxyAppAcceptance={ok:true,running:value.running===true,serverSource:value.source==='server',profileMatches:value.serverProfileName===" + JSONObject.quote(PROXY_PROFILE) + ",profilePresent:typeof value.serverProfileId==='string'&&value.serverProfileId.length>0,revisionPresent:typeof value.serverProfileRevision==='string'&&value.serverProfileRevision.length>0,direct:value.mode==='direct',autoStart:value.autoStart===true,rejectSelected:Array.isArray(value.groups)&&value.groups.some(group=>group.name==='地点'&&group.selected==='REJECT')};}).catch(()=>{window.__petpalProxyAppAcceptance={ok:false};});");
        AtomicReference<JSONObject> value = new AtomicReference<>();
        until("read-only real native proxy status", () -> { String raw = js("window.__petpalProxyAppAcceptance"); if (raw == null || "null".equals(raw)) return false; value.set(new JSONObject(raw)); return true; }, 15000);
        assertTrue("Real native bridge status succeeded", value.get().getBoolean("ok")); return value.get();
    }
    private void assertProxyRestored() throws Exception {
        until("server proxy running with the saved mode, selector and autostart", () -> bool("(()=>{const section=document.querySelector('section.app-proxy-settings');const group=Array.from(section?.querySelectorAll('.app-proxy-group')||[]).find(node=>node.querySelector('span')?.textContent==='地点');return section&&section.getAttribute('aria-busy')==='false'&&section.querySelector('.app-proxy-state')?.textContent.includes('已启用')&&section.querySelector('.app-proxy-summary')?.textContent.includes(" + JSONObject.quote(PROXY_PROFILE) + ")&&section.querySelector('select[aria-label=\"应用代理模式\"]')?.value==='direct'&&section.querySelector('.app-proxy-startup input')?.checked===true&&group?.querySelector('select')?.value==='REJECT';})()"), 45000);
        proxyIdle(); JSONObject snapshot = nativeProxySnapshot();
        for (String key : new String[] { "running", "serverSource", "profileMatches", "profilePresent", "revisionPresent", "direct", "autoStart", "rejectSelected" }) assertTrue("Native proxy restored flag: " + key, snapshot.getBoolean(key));
        // Keep the Android portrait evidence focused on the real proxy controls.
        js("document.querySelector('section.app-proxy-settings')?.scrollIntoView({block:'start'});");
    }
    private void proxy() throws Exception {
        proxyPage();
        // A repeat of this explicit fixture stage may already have a running
        // fixture core. Stop it through the actual UI before choosing its file.
        if (bool("Array.from(document.querySelectorAll('section.app-proxy-settings button')).some(node=>node.textContent.trim()==='关闭代理'&&!node.disabled)")) {
            assertTrue("Existing fixture proxy stopped through UI", proxyButton("关闭代理")); proxyIdle();
        }
        assertTrue("Actual assigned profile selected", bool("(()=>{const select=document.querySelector('section.app-proxy-settings .app-proxy-server-picker select');const option=Array.from(select?.options||[]).find(node=>node.textContent===" + JSONObject.quote(PROXY_PROFILE) + ");if(!select||select.disabled||!option)return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,option.value);select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()"));
        until("assigned server profile selection accepted", () -> bool("(()=>{const select=document.querySelector('section.app-proxy-settings .app-proxy-server-picker select');return select&&select.options[select.selectedIndex]?.textContent===" + JSONObject.quote(PROXY_PROFILE) + ";})()"), 5000);
        assertTrue("Server file imported using the actual UI and HTTP path", proxyButton("使用此配置"));
        until("server configuration shown after native validation and persistence", () -> bool("(()=>{const section=document.querySelector('section.app-proxy-settings');return section&&section.getAttribute('aria-busy')==='false'&&section.querySelector('.app-proxy-summary')?.textContent.includes(" + JSONObject.quote(PROXY_PROFILE) + ");})()"), 45000); proxyIdle();
        assertTrue("Bundled Mihomo started using the actual UI", proxyButton("启用代理"));
        until("actual Mihomo selector became available", () -> bool("(()=>{const section=document.querySelector('section.app-proxy-settings');const group=Array.from(section?.querySelectorAll('.app-proxy-group')||[]).find(node=>node.querySelector('span')?.textContent==='地点');return section&&section.getAttribute('aria-busy')==='false'&&section.querySelector('.app-proxy-state')?.textContent.includes('已启用')&&group?.querySelector('select')&&!group.querySelector('select').disabled;})()"), 45000); proxyIdle();
        assertTrue("Location policy changed through its real selector", bool("(()=>{const group=Array.from(document.querySelectorAll('section.app-proxy-settings .app-proxy-group')).find(node=>node.querySelector('span')?.textContent==='地点');const select=group?.querySelector('select');if(!select||select.disabled||!Array.from(select.options).some(option=>option.value==='REJECT'))return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'REJECT');select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()"));
        until("location selector accepted", () -> bool("(()=>{const section=document.querySelector('section.app-proxy-settings');const group=Array.from(section?.querySelectorAll('.app-proxy-group')||[]).find(node=>node.querySelector('span')?.textContent==='地点');return section?.getAttribute('aria-busy')==='false'&&group?.querySelector('select')?.value==='REJECT';})()"), 15000); proxyIdle();
        assertTrue("Direct mode selected through its real mode control", bool("(()=>{const select=document.querySelector('section.app-proxy-settings select[aria-label=\"应用代理模式\"]');if(!select||select.disabled)return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'direct');select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()"));
        until("direct mode accepted", () -> bool("document.querySelector('section.app-proxy-settings')?.getAttribute('aria-busy')==='false'&&document.querySelector('section.app-proxy-settings select[aria-label=\"应用代理模式\"]')?.value==='direct'"), 15000); proxyIdle();
        assertTrue("Autostart enabled through the real checkbox", bool("(()=>{const input=document.querySelector('section.app-proxy-settings .app-proxy-startup input');if(!input||input.disabled)return false;if(!input.checked)input.click();return true;})()"));
        until("autostart preference accepted", () -> bool("document.querySelector('section.app-proxy-settings')?.getAttribute('aria-busy')==='false'&&document.querySelector('section.app-proxy-settings .app-proxy-startup input')?.checked===true"), 15000); assertProxyRestored();
    }
    private void evidence(String stage) throws Exception {
        // The native bar transaction and WebView compositor are independent.
        // Wait for actual page frames before capturing a just-changed theme.
        js("window.__loginAcceptancePaint=false;requestAnimationFrame(()=>requestAnimationFrame(()=>window.__loginAcceptancePaint=true));true");
        until("actual page compositor frames before screenshot", () -> bool("window.__loginAcceptancePaint"), 5000);
        InstrumentationRegistry.getInstrumentation().getUiAutomation().waitForIdle(250, 5000);
        Thread.sleep(250);
        JSONObject report = new JSONObject().put("passed", true).put("stage", stage).put("actualMainActivity", true).put("actualFormOrUi", true)
            .put("hasSession", sessionSnapshot().getBoolean("hasToken")).put("encryptedVaultExists", vault().isFile()).put("apiLevel", Build.VERSION.SDK_INT);
        if (stage.startsWith("proxy")) report.put("proxy", nativeProxySnapshot());
        Files.write(new File(context.getExternalFilesDir(null), "login-app-" + stage + ".json").toPath(), report.toString().getBytes(StandardCharsets.UTF_8));
        Bitmap screenshot = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot(); assertNotNull("Visible app screenshot", screenshot);
        try (FileOutputStream output = new FileOutputStream(new File(context.getExternalFilesDir(null), "login-app-" + stage + ".png"))) { assertTrue(screenshot.compress(Bitmap.CompressFormat.PNG, 100, output)); }
        finally { screenshot.recycle(); }
    }
    private void failureEvidence(String stage) {
        // Capture before AndroidJUnitRunner closes the Activity. Never call
        // evidence()/until() here, which would start another wait on failure.
        JSONObject report = new JSONObject();
        try {
            report.put("passed", false).put("stage", stage).put("lastWait", lastWait);
            if (activity != null && activity.getBridge() != null && activity.getBridge().getWebView() != null) {
                String snapshot = js("(()=>{const section=document.querySelector('section.app-proxy-settings');const clean=(value,max=220)=>String(value||'').replace(/[\\x00-\\x1f\\x7f]/g,' ').slice(0,max);const picker=section?.querySelector('.app-proxy-server-picker select');return {chatRoute:new URLSearchParams(location.search).get('chat')==='1',nativeProxyPluginAvailable:Boolean(window.Capacitor?.isPluginAvailable?.('PetAppProxy')),loginFormPresent:Boolean(document.querySelector('.login-form')),accountPanelPresent:Boolean(document.querySelector('.account-identity')),activeTabs:Array.from(document.querySelectorAll('[role=tab][aria-selected=true]')).slice(0,8).map(node=>clean(node.textContent,60)),sectionExists:Boolean(section),sectionCount:document.querySelectorAll('section.app-proxy-settings').length,busy:section?.getAttribute('aria-busy')||'',heading:clean(section?.querySelector('h3')?.textContent),state:clean(section?.querySelector('.app-proxy-state')?.textContent),summary:Array.from(section?.querySelectorAll('.app-proxy-summary span')||[]).slice(0,8).map(node=>clean(node.textContent)),notes:Array.from(section?.querySelectorAll('.app-proxy-note')||[]).slice(0,12).map(node=>clean(node.textContent)),errors:Array.from(section?.querySelectorAll('[role=alert]')||[]).slice(0,6).map(node=>clean(node.textContent)),pickerExists:Boolean(picker),pickerDisabled:picker?picker.disabled:null,selectedLabel:clean(picker?.options[picker.selectedIndex]?.textContent,100),optionLabels:Array.from(picker?.options||[]).slice(0,128).map(option=>clean(option.textContent,100)),buttons:Array.from(section?.querySelectorAll('button')||[]).slice(0,24).map(button=>({label:clean(button.textContent,100),disabled:button.disabled})),mode:section?.querySelector('select[aria-label=\"应用代理模式\"]')?.value||'',autoStart:Boolean(section?.querySelector('.app-proxy-startup input')?.checked)};})()");
                report.put("ui", new JSONObject(snapshot)); report.put("session", sessionSnapshot());
            } else report.put("domCaptured", false);
        } catch (Exception | AssertionError ignored) { try { report.put("domCaptured", false); } catch (Exception ignoredAgain) { } }
        try { Files.write(new File(context.getExternalFilesDir(null), "login-app-" + stage + "-failure.json").toPath(), report.toString().getBytes(StandardCharsets.UTF_8)); } catch (Exception ignored) { }
        Bitmap screenshot = null;
        try {
            screenshot = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
            if (screenshot != null) try (FileOutputStream output = new FileOutputStream(new File(context.getExternalFilesDir(null), "login-app-" + stage + "-failure.png"))) { screenshot.compress(Bitmap.CompressFormat.PNG, 100, output); }
        } catch (Exception ignored) { }
        finally { if (screenshot != null) screenshot.recycle(); }
    }
    @Test public void stagedActualApplicationLoginPersistence() throws Exception {
        String stage = InstrumentationRegistry.getArguments().getString("stage");
        org.junit.Assume.assumeTrue("Explicit staged emulator acceptance only", stage != null);
        assertTrue("Known staged login operation", Arrays.asList("login", "restored", "offline", "offlineThenForeground", "logout", "cleared", "proxy", "proxyRestored", "themeNight", "themeDay", "nightRestored").contains(stage));
        org.junit.Assume.assumeTrue("Only an isolated Android emulator may run this fixture", Build.HARDWARE.contains("ranchu") || Build.HARDWARE.contains("goldfish") || Build.MODEL.contains("sdk"));
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        try {
            startChat();
            switch (stage) { case "login": submitLogin(); break; case "restored": accountPage(); break; case "offline": offline(); break; case "offlineThenForeground": offlineThenForeground(); break; case "logout": logout(); break; case "cleared": cleared(); break; case "proxy": proxy(); break; case "proxyRestored": proxyPage(); assertProxyRestored(); break; case "themeNight": chooseTheme("night"); break; case "themeDay": chooseTheme("day"); break; case "nightRestored": accountPage(); assertTheme("night"); break; default: throw new AssertionError(); }
            evidence(stage);
        } catch (Exception | AssertionError failure) { failureEvidence(stage); throw failure; }
    }
}
