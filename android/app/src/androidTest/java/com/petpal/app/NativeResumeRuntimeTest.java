package com.petpal.app;

import android.accessibilityservice.AccessibilityService;
import android.app.Activity;
import android.app.Application;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayInputStream;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.io.File;
import java.util.Collections;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Owned-emulator lifecycle test with no account, external page or network transport. */
@RunWith(AndroidJUnit4.class)
public class NativeResumeRuntimeTest {
    private static final Instrumentation TEST = InstrumentationRegistry.getInstrumentation();
    @CapacitorPlugin(name="NativeResumeStartupGate")
    public static class StartupGate extends Plugin {
        @Override public void load() { getBridge().getWebView().getSettings().setJavaScriptEnabled(false); getBridge().getWebView().getSettings().setBlockNetworkLoads(true); }
    }
    private interface Probe { boolean ready() throws Exception; }
    private static <T> T main(Callable<T> action) throws Exception {
        AtomicReference<T> value=new AtomicReference<>();AtomicReference<Exception> failure=new AtomicReference<>();
        TEST.runOnMainSync(()->{try{value.set(action.call());}catch(Exception error){failure.set(error);}});
        if(failure.get()!=null)throw failure.get();return value.get();
    }
    private static void until(String label, Probe probe) throws Exception {
        long end=SystemClock.elapsedRealtime()+25_000;
        do{if(probe.ready())return;Thread.sleep(80);}while(SystemClock.elapsedRealtime()<end);
        fail("Native resume acceptance timeout: "+label);
    }
    private static class Session implements AutoCloseable {
        final Context context=TEST.getTargetContext();final Application app=(Application)context.getApplicationContext();
        MainActivity activity;boolean registered;
        final Application.ActivityLifecycleCallbacks lifecycle=new Application.ActivityLifecycleCallbacks(){
            @Override public void onActivityPreCreated(Activity value,Bundle state){if(value instanceof MainActivity)((MainActivity)value).registerPlugin(StartupGate.class);}
            @Override public void onActivityCreated(Activity value,Bundle state){}
            @Override public void onActivityStarted(Activity value){}
            @Override public void onActivityResumed(Activity value){}
            @Override public void onActivityPaused(Activity value){}
            @Override public void onActivityStopped(Activity value){}
            @Override public void onActivitySaveInstanceState(Activity value,Bundle state){}
            @Override public void onActivityDestroyed(Activity value){}
        };
        Session() throws Exception {
            main(()->{app.registerActivityLifecycleCallbacks(lifecycle);registered=true;return null;});
            try{start();}catch(Throwable failure){close();throw failure;}
        }
        void start() throws Exception {
            activity=(MainActivity)TEST.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
            until("secure real foreground Activity",()->main(()->activity.isUpdaterForeground()&&activity.hasSecureUpdaterBridge()));
        }
        WebView view(){return activity.getBridge().getWebView();}
        String js(String source) throws Exception {
            AtomicReference<String> value=new AtomicReference<>();CountDownLatch ready=new CountDownLatch(1);
            main(()->{view().evaluateJavascript(source,result->{value.set(result);ready.countDown();});return null;});
            assertTrue("Actual provider responds",ready.await(8,TimeUnit.SECONDS));return value.get();
        }
        int count() throws Exception {return Integer.parseInt(js("window.__nativeResumes"));}
        void load(String origin,String query) throws Exception {
            String url=origin+"/?nativeResumeFixture="+UUID.randomUUID()+query;
            String html="<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><p>Native lifecycle acceptance</p>"
                +"<iframe id=child srcdoc=\"&lt;script&gt;window.childResumes=0;window.addEventListener('petpal:native-resume',function(){window.childResumes++})&lt;/script&gt;\"></iframe>"
                +"<script>window.__nativeResumes=0;window.__nativePayloads=0;window.addEventListener('petpal:native-resume',event=>{window.__nativeResumes++;if(event.detail!==undefined)window.__nativePayloads++;});</script>";
            main(()->{
                WebView view=view();view.stopLoading();view.getSettings().setJavaScriptEnabled(true);
                view.setWebViewClient(new BridgeWebViewClient(activity.getBridge()){
                    @Override public WebResourceResponse shouldInterceptRequest(WebView web,WebResourceRequest request){
                        boolean accepted=request.isForMainFrame()&&url.equals(request.getUrl().toString());
                        return new WebResourceResponse("text/html","UTF-8",accepted?200:403,accepted?"OK":"Forbidden",Collections.singletonMap("Cache-Control","no-store"),new ByteArrayInputStream((accepted?html:"").getBytes(StandardCharsets.UTF_8)));
                    }
                    @Override public boolean shouldOverrideUrlLoading(WebView web,WebResourceRequest request){return false;}
                });
                view.getSettings().setBlockNetworkLoads(false);view.loadUrl(url);return null;
            });
            until("isolated main document and same-origin child",()->"true".equals(js("Boolean(location.href==="+JSONObject.quote(url)+"&&typeof window.__nativeResumes==='number'&&document.getElementById('child')?.contentWindow.childResumes===0)")));
            assertEquals("New document has received no lifecycle event",0,count());
        }
        void home() throws Exception {
            assertTrue("Actual HOME action accepted",TEST.getUiAutomation().performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME));
            until("original Activity is backgrounded",()->main(()->!activity.isUpdaterForeground()));
        }
        void foreground() throws Exception {
            main(()->{context.startActivity(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP));return null;});
            until("same Activity resumes",()->main(()->activity.isUpdaterForeground()&&!activity.isFinishing()&&!activity.isDestroyed()));
            // Drain the posted native callback and its provider evaluation.
            main(()->null);js("true");
        }
        void notifyNative() throws Exception {Method method=MainActivity.class.getDeclaredMethod("notifyPageResumed");method.setAccessible(true);main(()->{method.invoke(activity);return null;});}
        @Override public void close() throws Exception {
            try{main(()->{if(activity!=null&&!activity.isDestroyed()){view().getSettings().setJavaScriptEnabled(false);activity.finishAndRemoveTask();}return null;});}
            finally{main(()->{if(registered){app.unregisterActivityLifecycleCallbacks(lifecycle);registered=false;}return null;});}
        }
    }
    @Test public void actualHomeResumeNotifiesOnlyTheLiveTrustedMainFrameWithoutPayload() throws Exception {
        Assume.assumeTrue("Explicit owned-emulator native lifecycle acceptance only","true".equals(InstrumentationRegistry.getArguments().getString("petpalResumeRuntime")));
        Assume.assumeTrue("Never a personal phone",Build.HARDWARE.contains("ranchu")||Build.HARDWARE.contains("goldfish"));
        try(Session s=new Session()){
            s.load("https://localhost","");MainActivity original=s.activity;
            s.home();s.notifyNative();assertEquals("Background Activity cannot emit",0,s.count());
            s.foreground();until("real onResume event reaches main document",()->s.count()==1);assertSame("Foreground preserves the Activity",original,s.activity);
            assertEquals("No same-origin iframe broadcast","0",s.js("document.getElementById('child').contentWindow.childResumes"));
            assertEquals("Event carries no payload","0",s.js("window.__nativePayloads"));
            s.load("https://localhost","&overlay=1");s.home();s.foreground();assertEquals("Overlay documents receive no resume",0,s.count());
            s.load("https://foreign.petpal.invalid","");s.home();s.foreground();assertEquals("Foreign document receives no resume",0,s.count());
            s.load("https://localhost","");MainActivity obsolete=s.activity;
            Method notify=MainActivity.class.getDeclaredMethod("notifyPageResumed");notify.setAccessible(true);
            main(()->{notify.invoke(obsolete);obsolete.finishAndRemoveTask();return null;});
            until("obsolete Activity destroyed",()->main(obsolete::isDestroyed));s.start();s.load("https://localhost","");
            assertNotSame("Replacement is a different native owner",obsolete,s.activity);assertEquals("Queued obsolete owner cannot notify replacement",0,s.count());
            JSONObject report=new JSONObject().put("passed",true).put("api",Build.VERSION.SDK_INT).put("realHomeResume",true).put("sameActivity",true)
                .put("mainFrameOnly",true).put("payloadAbsent",true).put("backgroundRejected",true).put("overlayRejected",true).put("foreignOriginRejected",true).put("obsoleteOwnerRejected",true)
                .put("externalNetworkBlocked",true).put("physicalDevice",false);
            Files.write(new File(s.context.getExternalFilesDir(null),"native-resume-runtime-result.json").toPath(),report.toString().getBytes(StandardCharsets.UTF_8));
        }
    }
}
