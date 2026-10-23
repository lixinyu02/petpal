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
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.Plugin;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.UUID;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
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
    private RuntimeUiAutomation windows;
    @org.junit.Before public void initializeWindowObserver() {
        if (!"true".equals(InstrumentationRegistry.getArguments().getString("petpalPermissionRuntime"))) return;
        Assume.assumeTrue("Owned emulator only", Build.HARDWARE.contains("ranchu") || Build.HARDWARE.contains("goldfish"));
        windows = new RuntimeUiAutomation();
    }
    @org.junit.After public void restoreWindowObserverFlags() { if (windows != null) windows.close(); }
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
        fail("Permission acceptance timeout: "+label+"; windows="+RuntimeUiAutomation.describe());
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
                    // Older WebViews expose loadDataWithBaseURL as a data: URL.
                    // Serve a real local-origin document through an intercepting
                    // client and retain the actual packaged Capacitor injection.
                    // Every other request is denied, including remote resources.
                    view.setWebViewClient(new BridgeWebViewClient(activity.getBridge()) {
                        @Override public WebResourceResponse shouldInterceptRequest(WebView web,WebResourceRequest request) {
                            String html="<!doctype html><html><body>Isolated fixture unavailable</body></html>";
                            if(request.isForMainFrame()&&url.equals(request.getUrl().toString())) {
                                try {
                                    WebResourceResponse packaged=super.shouldInterceptRequest(web,request);
                                    try(InputStream input=packaged.getData();ByteArrayOutputStream bytes=new ByteArrayOutputStream()) {
                                        byte[] buffer=new byte[8192];int read;while((read=input.read(buffer))!=-1)bytes.write(buffer,0,read);
                                        String content=new String(bytes.toByteArray(),StandardCharsets.UTF_8);
                                        String marker="<script type=\"text/javascript\">";
                                        int start=content.indexOf(marker),end=content.indexOf("</script>",start);
                                        if(start>=0&&end>start||WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                                            String injection=start>=0&&end>start?content.substring(start,end+9):"";
                                            html="<!doctype html><html><head>"+injection+"</head><body><h1>Permission acceptance</h1><script>window.__permissionFixture=true</script></body></html>";
                                        }
                                    }
                                }catch(Exception ignored){ }
                            }
                            return new WebResourceResponse("text/html","UTF-8",new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
                        }
                        @Override public boolean shouldOverrideUrlLoading(WebView web,WebResourceRequest request) {return !url.equals(request.getUrl().toString());}
                    });
                    view.getSettings().setBlockNetworkLoads(false);view.loadUrl(url);return null;
                });
                until("native permissions plugin in isolated local page",()->"true".equals(js("Boolean(window.__permissionFixture&&window.Capacitor?.Plugins?.PetPermissions)")));
                foreground();
            }catch(Throwable error){close();throw error;}
        }
        String js(String code) throws Exception {
            AtomicReference<String> result=new AtomicReference<>();CountDownLatch ready=new CountDownLatch(1);
            main(()->{activity.getBridge().getWebView().evaluateJavascript(code,value->{result.set(value);ready.countDown();});return null;});
            assertTrue("WebView evaluation",ready.await(8,TimeUnit.SECONDS));return result.get();
        }
        JSONObject invoke(String method,JSONObject input) throws Exception {
            return invokePlugin("PetPermissions",method,input);
        }
        JSONObject invokePlugin(String plugin,String method,JSONObject input) throws Exception {
            js("window.__permissionResult=null;window.Capacitor.Plugins."+plugin+"."+method+"("+input+").then(value=>window.__permissionResult={ok:true,value}).catch(error=>window.__permissionResult={ok:false,message:String(error.message)});true");
            until("native "+method+" completed",()->!"null".equals(js("window.__permissionResult")));
            return new JSONObject(js("window.__permissionResult"));
        }
        void foreground() throws Exception {
            try {until("settled visible local foreground",()->main(()->activity.isUpdaterForeground()&&activity.getBridge().getWebView().isShown()
                &&UpdaterPolicy.trustedPage(activity.getBridge().getLocalUrl(),activity.getBridge().getWebView().getUrl())));}
            catch(AssertionError error){throw new AssertionError(main(()->"Fixture state: resumed="+activity.isUpdaterForeground()+", shown="+activity.getBridge().getWebView().isShown()+", local="+activity.getBridge().getLocalUrl()+", url="+activity.getBridge().getWebView().getUrl()+", finishing="+activity.isFinishing()+", destroyed="+activity.isDestroyed()),error);}
        }
        JSONObject status() throws Exception {
            AtomicReference<JSONObject> snapshot=new AtomicReference<>();
            // Settings/permission-controller transitions can deliver onResume
            // before the final visible window settles. Read-only retries keep
            // the production foreground guard intact.
            until("native foreground snapshot",()->{foreground();JSONObject result=invoke("status",new JSONObject());if(!result.getBoolean("ok"))return false;snapshot.set(result.getJSONObject("value"));return true;});
            return snapshot.get();
        }
        void clickPermission(String suffix) throws Exception {
            until("system permission button "+suffix,()->{
                AccessibilityNodeInfo root=TEST.getUiAutomation().getRootInActiveWindow();if(root==null)return false;
                try{return click(root,suffix)||("permission_deny_button".equals(suffix)&&click(root,"permission_deny_and_dont_ask_again_button"));}finally{root.recycle();}
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
            requestMedia(false);
        }
        void requestMedia(boolean camera) throws Exception {
            js("window.__mediaResult=null;navigator.mediaDevices.getUserMedia({audio:"+!camera+",video:"+camera+"}).then(stream=>{stream.getTracks().forEach(track=>track.stop());window.__mediaResult={ok:true}}).catch(error=>window.__mediaResult={ok:false,name:error.name});true");
        }
        void returned() throws Exception {
            TEST.getUiAutomation().performGlobalAction(1);
            long settle=System.nanoTime()+TimeUnit.SECONDS.toNanos(2);
            while(System.nanoTime()<settle&&!main(()->activity.isUpdaterForeground()))Thread.sleep(80);
            // Some Settings versions keep a separate task/list page on Back.
            // Model the user reopening their app instead of sending rapid Back
            // presses that can accidentally dismiss the returning Activity.
            if(!main(()->activity.isUpdaterForeground()))main(()->{context.startActivity(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP));return null;});
            until("returned to foreground",()->main(()->activity.isUpdaterForeground()));
            foreground();
        }
        @Override public void close() throws Exception {
            MainActivity closing=activity;
            try {
                main(()->{if(closing!=null&&!closing.isDestroyed()){closing.getBridge().getWebView().getSettings().setJavaScriptEnabled(false);closing.finishAndRemoveTask();}return null;});
                // singleTask would otherwise allow the next test to join a task
                // still being removed by this asynchronous Activity teardown.
                if(closing!=null)until("fixture Activity fully destroyed",()->main(closing::isDestroyed));
            }finally{main(()->{if(registered){app.unregisterActivityLifecycleCallbacks(lifecycle);registered=false;}return null;});}
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
                s.foreground();
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
            String cameraBefore=s.status().getJSONObject("camera").getString("state");
            s.requestMicrophone();s.clickPermission("permission_deny_button");
            until("actual denied getUserMedia",()->!"null".equals(s.js("window.__mediaResult")));
            assertFalse(new JSONObject(s.js("window.__mediaResult")).getBoolean("ok"));
            assertEquals("First denial remains retryable","denied",s.status().getJSONObject("microphone").getString("state"));
            s.requestMicrophone();s.clickPermission("permission_allow_one_time_button");
            until("actual granted stream returned and stopped",()->!"null".equals(s.js("window.__mediaResult")));
            assertTrue("No recording retained",new JSONObject(s.js("window.__mediaResult")).getBoolean("ok"));
            assertEquals("granted",s.status().getJSONObject("microphone").getString("state"));
            assertEquals("Audio-only test never changes camera",cameraBefore,s.status().getJSONObject("camera").getString("state"));
        }
    }
    @Test public void actualOverlayServiceStartsAndStopsFromForeground() throws Exception {
        Assume.assumeTrue("Explicit fresh-emulator overlay service acceptance only","true".equals(InstrumentationRegistry.getArguments().getString("petpalOverlayServiceRuntime")));
        try(Session s=new Session()) {
            Assume.assumeFalse("Do not interrupt an existing companion",PetOverlayService.running);
            assertTrue("Runner must explicitly provision this disposable emulator's overlay permission",android.provider.Settings.canDrawOverlays(s.context));
            try {
                JSONObject start=s.invokePlugin("PetOverlay","start",new JSONObject().put("companionKind","anime"));assertTrue(start.toString(),start.getBoolean("ok"));
                until("actual companion service running",()->PetOverlayService.running);
                NotificationManager manager=s.context.getSystemService(NotificationManager.class);
                until("visible stoppable foreground notification",()->manager.getActiveNotifications().length>0);
                boolean stoppable=false;
                for(android.service.notification.StatusBarNotification item:manager.getActiveNotifications()) {
                    if(!"petpal_companion".equals(item.getNotification().getChannelId()))continue;
                    android.app.Notification.Action[] actions=item.getNotification().actions;
                    if(actions!=null)for(android.app.Notification.Action action:actions)if(action.actionIntent!=null)stoppable=true;
                }
                assertTrue("Overlay notification offers a stop action",stoppable);
            }finally{
                s.foreground();assertTrue(s.invokePlugin("PetOverlay","stop",new JSONObject()).getBoolean("ok"));
                until("companion service stopped",()->!PetOverlayService.running);
            }
        }
    }
    @Test public void cameraRepeatedDenialRequiresSettingsThenRecovers() throws Exception {
        try(Session s=new Session()) {
            assertEquals("Fresh camera history","prompt",s.status().getJSONObject("camera").getString("state"));
            for(int attempt=0;attempt<2;attempt++) {
                s.foreground();s.requestMedia(true);s.clickPermission("permission_deny_button");
                until("denied camera request",()->!"null".equals(s.js("window.__mediaResult")));
                assertFalse(new JSONObject(s.js("window.__mediaResult")).getBoolean("ok"));
                assertEquals(attempt==0?"denied":"settings",s.status().getJSONObject("camera").getString("state"));
            }
            // Only this opt-in disposable emulator is modified. A real user must
            // use the fixed app-permissions Settings route tested above.
            TEST.getUiAutomation().grantRuntimePermission(s.context.getPackageName(),android.Manifest.permission.CAMERA);
            assertEquals("granted",s.status().getJSONObject("camera").getString("state"));
            assertEquals("A Settings grant supersedes the old repeated-denial history","granted",s.context.getSharedPreferences("petpal_permission_history_v1",Context.MODE_PRIVATE).getString(android.Manifest.permission.CAMERA+".result",""));
            s.requestMedia(true);until("camera stream returned and immediately released",()->!"null".equals(s.js("window.__mediaResult")));
            assertTrue(new JSONObject(s.js("window.__mediaResult")).toString(),new JSONObject(s.js("window.__mediaResult")).getBoolean("ok"));
        }
    }
}
