package com.petpal.app;

import android.content.Context;
import android.content.Intent;
import android.os.Looper;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.lang.reflect.Method;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real local WebView -> CapacitorPlugins -> UI -> IO path, no login or network. */
@RunWith(AndroidJUnit4.class)
public class PetAppProxyBridgeTest {
    private MainActivity activity;
    private String js(String source) throws Exception {
        CountDownLatch done = new CountDownLatch(1); AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.getBridge().getWebView().evaluateJavascript(source, value -> { result.set(value); done.countDown(); }));
        assertTrue("Local WebView callback", done.await(8, TimeUnit.SECONDS)); return result.get();
    }
    @Test public void realBridgeDispatchesScopeAndFileChecksOnTheWebViewThread() throws Exception {
        Assume.assumeTrue("Explicit isolated emulator acceptance only", "true".equals(InstrumentationRegistry.getArguments().getString("petpalAppProxyBridgeRuntime")));
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        activity = (MainActivity) InstrumentationRegistry.getInstrumentation().startActivitySync(new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30); boolean ready = false;
        while (System.nanoTime() < deadline) {
            if (activity.hasSecureUpdaterBridge() && activity.isUpdaterForeground() && "true".equals(js("Boolean(window.Capacitor?.Plugins?.PetAppProxy)"))) { ready = true; break; }
            Thread.sleep(100);
        }
        assertTrue("Secure foreground local plugin bridge", ready);
        // The rejected bind fails its bounded token check before opening a URL.
        // importFile uses an unbound scope, so no picker or external Activity opens.
        js("window.__proxyBridgeAcceptance=null;(async()=>{try{const p=window.Capacitor.Plugins.PetAppProxy;const cleared=await p.clearScope();let bindRejected=false,fileRejected=false;try{await p.bindScope({url:'https://bridge-fixture.petpal.invalid',token:'invalid',instanceId:'bridge-fixture',userId:'bridge-user'});}catch{bindRejected=true;}try{await p.importFile({scope:'not-a-current-scope'});}catch{fileRejected=true;}const status=await p.status();window.__proxyBridgeAcceptance={ok:true,cleared:cleared.scope==='',bindRejected,fileRejected,unbound:status.scope===''};}catch{window.__proxyBridgeAcceptance={ok:false};}})()");
        AtomicReference<JSONObject> result = new AtomicReference<>(); deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
        while (System.nanoTime() < deadline) { String value = js("window.__proxyBridgeAcceptance"); if (value != null && !"null".equals(value)) { result.set(new JSONObject(value)); break; } Thread.sleep(100); }
        assertNotNull("Real plugin calls completed without a WebView thread crash", result.get());
        for (String key : new String[]{"ok", "cleared", "bindRejected", "fileRejected", "unbound"}) assertTrue("Native bridge outcome: " + key, result.get().optBoolean(key));
        AtomicReference<PetAppProxyPlugin> plugin = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> plugin.set((PetAppProxyPlugin) activity.getBridge().getPlugin("PetAppProxy").getInstance()));
        assertNotNull(plugin.get()); assertNotSame(Looper.getMainLooper(), Looper.myLooper());
        Method trusted = PetAppProxyPlugin.class.getDeclaredMethod("trusted", boolean.class); trusted.setAccessible(true);
        assertEquals("An accidental off-main trust probe must fail closed before touching WebView", false, trusted.invoke(plugin.get(), false));
    }
}
