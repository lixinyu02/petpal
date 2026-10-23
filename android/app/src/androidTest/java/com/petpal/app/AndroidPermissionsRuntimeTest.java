package com.petpal.app;

import static org.junit.Assert.*;
import android.app.Activity;
import android.app.Application;
import android.app.Instrumentation;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.accessibility.AccessibilityNodeInfo;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Opt-in only on a fresh owned emulator. Never launches account/network code. */
@RunWith(AndroidJUnit4.class)
public class AndroidPermissionsRuntimeTest {
    private static final Instrumentation TEST = InstrumentationRegistry.getInstrumentation();
    private static final AtomicBoolean GATED = new AtomicBoolean();
    @CapacitorPlugin(name = "PermissionRuntimeStartupGate")
    public static class StartupGate extends Plugin {
        @Override public void load() {
            getBridge().getWebView().getSettings().setJavaScriptEnabled(false);
            getBridge().getWebView().getSettings().setBlockNetworkLoads(true);
            GATED.set(true);
        }
    }
    private interface Probe { boolean ready() throws Exception; }
    private static <T> T main(Callable<T> action) throws Exception {
        AtomicReference<T> result = new AtomicReference<>(); AtomicReference<Throwable> failure = new AtomicReference<>();
        TEST.runOnMainSync(() -> { try { result.set(action.call()); } catch(Throwable error) { failure.set(error); } });
        if(failure.get()!=null) throw new AssertionError("Native fixture action",failure.get());
        return result.get();
    }
    private static void until(String label, Probe probe) throws Exception {
        long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(20);
        do { if(probe.ready()) return; Thread.sleep(80); } while(System.nanoTime()<end);
        fail("Permission acceptance timeout: "+label);
    }
    private static class Session implements AutoCloseable {
        final Context context=TEST.getTargetContext();
        final Application app=(Application)context.getApplicationContext();
        MainActivity activity; boolean registered;
        final Application.ActivityLifecycleCallbacks lifecycle=new Application.ActivityLifecycleCallbacks() {
            @Override public void onActivityPreCreated(Activity value, Bundle state) { if(value instanceof MainActivity)((MainActivity)value).registerPlugin(StartupGate.class); }
            @Override public void onActivityCreated(Activity value, Bundle state) { if(value instanceof MainActivity)activity=(MainActivity)value; }
            @Override public void onActivityStarted(Activity value) { }
            @Override public void onActivityResumed(Activity value) { }
            @Override public void onActivityPaused(Activity value) { }
            @Override public void onActivityStopped(Activity value) { }
            @Override public void onActivitySaveInstanceState(Activity value, Bundle state) { }
            @Override public void onActivityDestroyed(Activity value) { }
        };
        Session() throws Exception {
            Assume.assumeTrue("Explicit emulator permission acceptance only","true".equals(InstrumentationRegistry.getArguments().getString("petpalPermissionRuntime")));
            Assume.assumeTrue("Never run on a personal phone",Build.HARDWARE.contains("ranchu")||Build.HARDWARE.contains("goldfish"));
            Assume.assumeTrue(Build.VERSION.SDK_INT>=33);
            try {
                main(()->{GATED.set(false); app.registerActivityLifecycleCallbacks(lifecycle);registered=true;return null;});
                activity=(MainActivity)TEST.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
                until("secure foreground bridge",()->main(()->activity.hasSecureUpdaterBridge()&&activity.isUpdaterForeground()));
                assertTrue("Startup gate runs before packaged page",GATED.get());
                main(()->{
                    WebView view=activity.getBridge().getWebView();view.stopLoading();view.getSettings().setJavaScriptEnabled(true);
                    String url=activity.getBridge().getLocalUrl()+"/?permissionRuntime="+UUID.randomUUID();
                    view.loadDataWithBaseURL(url,"<!doctype html><html><body><h1>Permission acceptance</h1><script>window.__permissionFixture=true</script></body></html>","text/html","UTF-8",url);return null;
                });
                until("native permissions plugin in isolated local page",()->"true".equals(js("Boolean(window.__permissionFixture&&window.Capacitor?.Plugins?.PetPermissions)")));
            }catch(Throwable error){close();throw error;}
        }
        String js(String code) throws Exception {
            AtomicReference<String> result=new AtomicReference<>();CountDownLatch ready=new CountDownLatch(1);
            main(()->{activity.getBridge().getWebView().evaluateJavascript(code,value->{result.set(value);ready.countDown();});return null;});
            assertTrue("WebView evaluation",ready.await(8,TimeUnit.SECONDS));return result.get();
        }
        JSONObject invoke(String method,JSONObject input) throws Exception {
            js("window.__permissionResult=null;window.Capacitor.Plugins.PetPermissions."+method+"("+input+").then(value=>window.__permissionResult={ok:true,value}).catch(error=>window.__permissionResult={ok:false,message:String(error.message)});true");
            until("native "+method+" completed",()->!"null".equals(js("window.__permissionResult")));
            return new JSONObject(js("window.__permissionResult"));
        }
        JSONObject status() throws Exception {JSONObject result=invoke("status",new JSONObject());assertTrue(result.toString(),result.getBoolean("ok"));return result.getJSONObject("value");}
        void clickPermission(String suffix) throws Exception {
            until("system permission button "+suffix,()->{
                AccessibilityNodeInfo root=TEST.getUiAutomation().getRootInActiveWindow();if(root==null)return false;
                try{return click(root,suffix);}finally{root.recycle();}
            });
        }
        private boolean click(AccessibilityNodeInfo node,String suffix) {
            String id=node.getViewIdResourceName();
            if(id!=null&&id.endsWith("/"+suffix)&&node.isVisibleToUser()&&node.isEnabled())return node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            for(int i=0;i<node.getChildCount();i++){
                AccessibilityNodeInfo child=node.getChild(i);if(child==null)continue;
                try{if(click(child,suffix))return true;}finally{child.recycle();}
            }
            return false;
        }
        void requestMicrophone() throws Exception {
            js("window.__mediaResult=null;navigator.mediaDevices.getUserMedia({audio:true,video:false}).then(stream=>{stream.getTracks().forEach(track=>track.stop());window.__mediaResult={ok:true}}).catch(error=>window.__mediaResult={ok:false,name:error.name});true");
        }
        void returned() throws Exception {
            for(int i=0;i<5&&!main(()->activity.isUpdaterForeground());i++){TEST.getUiAutomation().performGlobalAction(1);Thread.sleep(300);}
            until("returned to foreground",()->main(()->activity.isUpdaterForeground()));
        }
        @Override public void close() throws Exception {
            main(()->{if(activity!=null&&!activity.isDestroyed()){activity.getBridge().getWebView().getSettings().setJavaScriptEnabled(false);activity.finishAndRemoveTask();}if(registered){app.unregisterActivityLifecycleCallbacks(lifecycle);registered=false;}return null;});
        }
    }
    @Test public void nativeStatusDoesNotRequestPermissionsAndSeparatesChannels() throws Exception {
        try(Session s=new Session()) {
            JSONObject before=s.status();
            assertEquals(Build.VERSION.SDK_INT,before.getJSONObject("device").getInt("apiLevel"));
            assertTrue(before.getJSONObject("microphone").has("state"));assertTrue(before.getJSONObject("camera").has("supported"));
            assertTrue("Public SDK cannot read sensor switches reliably",before.getJSONObject("microphone").isNull("blocked"));
            assertEquals(android.provider.Settings.canDrawOverlays(s.context),before.getJSONObject("overlay").getBoolean("granted"));
            assertEquals(s.context.getPackageManager().canRequestPackageInstalls(),before.getJSONObject("install").getBoolean("granted"));
            NotificationManager manager=s.context.getSystemService(NotificationManager.class);
            String id=PetTaskNotificationService.RESULT_CHANNEL;
            assertNull("Use a fresh isolated emulator; never overwrite a user's channel",manager.getNotificationChannel(id));
            try {
                manager.createNotificationChannel(new NotificationChannel(id,"Permission acceptance result channel",NotificationManager.IMPORTANCE_NONE));
                JSONObject blocked=s.status().getJSONObject("notifications").getJSONObject("channels");
                assertTrue(blocked.getJSONObject("task").getBoolean("created"));assertFalse(blocked.getJSONObject("task").getBoolean("enabled"));
                assertFalse(blocked.getJSONObject("watch").getBoolean("created"));assertTrue(blocked.getJSONObject("watch").getBoolean("enabled"));
                JSONObject after=s.status();
                assertEquals("Reading status never grants microphone",before.getJSONObject("microphone").getString("state"),after.getJSONObject("microphone").getString("state"));
                assertEquals("Reading status never grants camera",before.getJSONObject("camera").getString("state"),after.getJSONObject("camera").getString("state"));
            }finally{manager.deleteNotificationChannel(id);}
        }
    }
    @Test public void fixedSettingsRoutesAndForegroundGuards() throws Exception {
        try(Session s=new Session()) {
            JSONObject invalid=s.invoke("openSettings",new JSONObject().put("kind","intent://arbitrary"));assertFalse(invalid.getBoolean("ok"));
            assertTrue(s.activity.isUpdaterForeground());
            for(String kind:new String[]{"microphone","camera","notifications","overlay","install"}) {
                JSONObject response=s.invoke("openSettings",new JSONObject().put("kind",kind));
                assertTrue(response.toString(),response.getBoolean("ok"));assertTrue(response.getJSONObject("value").getBoolean("opened"));
                until("system settings opened",()->!main(()->s.activity.isUpdaterForeground()));
                until("actual trusted Settings window",()->{
                    AccessibilityNodeInfo root=TEST.getUiAutomation().getRootInActiveWindow();if(root==null)return false;
                    try{return "com.android.settings".equals(String.valueOf(root.getPackageName()));}finally{root.recycle();}
                });
                // A local page left in the background cannot launch another settings window.
                assertFalse(s.invoke("openSettings",new JSONObject().put("kind","app")).getBoolean("ok"));
                s.returned();assertEquals(Build.VERSION.SDK_INT,s.status().getJSONObject("device").getInt("apiLevel"));
            }
        }
    }
    @Test public void realMicrophonePromptDenialThenOneTimeGrant() throws Exception {
        try(Session s=new Session()) {
            assertEquals("Fresh isolated emulator has never asked microphone","prompt",s.status().getJSONObject("microphone").getString("state"));
            s.requestMicrophone();s.clickPermission("permission_deny_button");
            until("actual denied getUserMedia",()->!"null".equals(s.js("window.__mediaResult")));
            assertFalse(new JSONObject(s.js("window.__mediaResult")).getBoolean("ok"));
            assertEquals("First denial remains retryable","denied",s.status().getJSONObject("microphone").getString("state"));
            s.requestMicrophone();s.clickPermission("permission_allow_one_time_button");
            until("actual granted stream returned and stopped",()->!"null".equals(s.js("window.__mediaResult")));
            assertTrue("No recording retained",new JSONObject(s.js("window.__mediaResult")).getBoolean("ok"));
            assertEquals("granted",s.status().getJSONObject("microphone").getString("state"));
            assertEquals("Audio-only test never requests camera","prompt",s.status().getJSONObject("camera").getString("state"));
        }
    }
}
