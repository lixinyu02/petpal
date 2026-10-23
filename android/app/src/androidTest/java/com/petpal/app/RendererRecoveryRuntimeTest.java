package com.petpal.app;

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
import android.webkit.WebViewRenderProcess;
import android.widget.Button;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Explicit task-emulator only: terminate the real provider, never crash a phone. */
@RunWith(AndroidJUnit4.class)
public class RendererRecoveryRuntimeTest {
    private interface Probe { boolean get() throws Exception; }
    private static void until(String label, Probe probe) throws Exception {
        long end=SystemClock.elapsedRealtime()+45_000;
        do { if(probe.get())return;Thread.sleep(100); } while(SystemClock.elapsedRealtime()<end);
        fail("Renderer recovery did not complete: "+label);
    }
    private static <T> T main(Callable<T> action) throws Exception {
        AtomicReference<T> value=new AtomicReference<>();AtomicReference<Exception> error=new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{try{value.set(action.call());}catch(Exception failure){error.set(failure);}});
        if(error.get()!=null)throw error.get();return value.get();
    }
    private static String js(WebView view,String code)throws Exception {
        CountDownLatch ready=new CountDownLatch(1);AtomicReference<String> value=new AtomicReference<>();
        main(()->{view.evaluateJavascript(code,result->{value.set(result);ready.countDown();});return null;});
        assertTrue("Provider JavaScript responds",ready.await(8,TimeUnit.SECONDS));return value.get();
    }
    private static void ready(MainActivity activity)throws Exception {
        until("new local provider ready",()->main(()->!activity.isDestroyed()&&!activity.isFinishing()&&activity.isUpdaterForeground()
            &&activity.hasSecureUpdaterBridge()&&activity.getBridge()!=null&&activity.getBridge().getWebView().getWebViewRenderProcess()!=null));
        WebView view=activity.getBridge().getWebView();
        until("packaged page renders after restart",()->"true".equals(js(view,"Boolean(document.querySelector('#root')?.children.length)")));
    }
    private static void terminate(MainActivity activity)throws Exception {
        assertTrue("Real WebView render process terminated",main(()->{
            WebViewRenderProcess renderer=activity.getBridge().getWebView().getWebViewRenderProcess();return renderer!=null&&renderer.terminate();
        }));
    }
    private static Button retry(View view) {
        if(view instanceof Button&&"重新打开小伴".contentEquals(((Button)view).getText()))return (Button)view;
        if(view instanceof ViewGroup)for(int n=0;n<((ViewGroup)view).getChildCount();n++){Button found=retry(((ViewGroup)view).getChildAt(n));if(found!=null)return found;}
        return null;
    }
    @Test public void realRendererExitsRecoverTwiceThenOfferNativeManualRetryWithoutClearingLogin()throws Exception {
        Assume.assumeTrue("Explicit renderer emulator acceptance only","true".equals(InstrumentationRegistry.getArguments().getString("petpalRendererRuntime")));
        Assume.assumeTrue("Owned generic emulator only",Build.HARDWARE.contains("ranchu")||Build.HARDWARE.contains("goldfish"));
        Assume.assumeTrue("This matrix uses API33+",Build.VERSION.SDK_INT>=33);
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();Application application=(Application)context.getApplicationContext();
        AtomicReference<MainActivity> active=new AtomicReference<>();AtomicReference<RendererRecoveryActivity> recovery=new AtomicReference<>();
        Application.ActivityLifecycleCallbacks callbacks=new Application.ActivityLifecycleCallbacks(){
            @Override public void onActivityCreated(Activity activity,Bundle state){}
            @Override public void onActivityStarted(Activity activity){}
            @Override public void onActivityResumed(Activity activity){if(activity instanceof MainActivity)active.set((MainActivity)activity);if(activity instanceof RendererRecoveryActivity)recovery.set((RendererRecoveryActivity)activity);}
            @Override public void onActivityPaused(Activity activity){}
            @Override public void onActivityStopped(Activity activity){}
            @Override public void onActivitySaveInstanceState(Activity activity,Bundle state){}
            @Override public void onActivityDestroyed(Activity activity){}
        };
        File vault=new File(context.getNoBackupFilesDir(),"login-session-v1.enc");
        assertFalse("This stage requires fresh task-emulator login data",vault.exists());
        PetLoginSessionState saved=new PetLoginSessionState(context);
        saved.write(new JSONObject().put("url","https://renderer.petpal.invalid").put("token","synthetic-renderer-session")
            .put("credentialKind","session").put("target","remote"),saved.reserve());
        byte[] before=Files.readAllBytes(vault.toPath());
        application.registerActivityLifecycleCallbacks(callbacks);
        try{
            main(()->{MainActivity.retryRendererByUser();return null;});
            InstrumentationRegistry.getInstrumentation().startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            until("initial Activity",()->active.get()!=null);ready(active.get());
            for(int n=0;n<2;n++){
                MainActivity previous=active.get();terminate(previous);
                until("automatic Activity reconstruction",()->active.get()!=previous);ready(active.get());
                assertTrue("The dead Activity is released",main(previous::isDestroyed));
            }
            MainActivity previous=active.get();terminate(previous);until("native recovery screen",()->recovery.get()!=null);
            RendererRecoveryActivity fallback=recovery.get();
            assertTrue("Retry is accessible without a provider",main(()->{Button button=retry(fallback.getWindow().getDecorView());return button!=null&&button.isShown()&&button.isEnabled()&&button.getHeight()>=44*context.getResources().getDisplayMetrics().density;}));
            assertTrue("No automatic reconstruction loop",main(()->active.get()==previous));
            main(()->{retry(fallback.getWindow().getDecorView()).performClick();return null;});
            until("manual native retry",()->active.get()!=previous);ready(active.get());
            assertEquals("Existing encrypted login presence is unchanged",before!=null,vault.exists());
            if(before!=null)assertTrue(Arrays.equals(before,Files.readAllBytes(vault.toPath())));
            JSONObject report=new JSONObject().put("passed",true).put("api",Build.VERSION.SDK_INT).put("realProviderTerminations",3)
                .put("automaticReconstructions",2).put("nativeManualRetry",true).put("loginFileUnchanged",true).put("physicalDevice",false);
            Files.write(new File(context.getExternalFilesDir(null),"renderer-recovery-result.json").toPath(),report.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }finally{
            application.unregisterActivityLifecycleCallbacks(callbacks);
            main(()->{if(active.get()!=null&&!active.get().isDestroyed())active.get().finish();if(recovery.get()!=null&&!recovery.get().isDestroyed())recovery.get().finish();return null;});
            saved.clear(saved.reserveClear());
        }
    }
}
