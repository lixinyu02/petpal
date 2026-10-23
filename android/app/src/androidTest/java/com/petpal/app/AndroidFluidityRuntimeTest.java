package com.petpal.app;

import android.app.Activity;
import android.app.Application;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Opt-in performance instrumentation. The APK's HTML/modules and React state remain real. */
@RunWith(AndroidJUnit4.class)
public class AndroidFluidityRuntimeTest {
    private static final Instrumentation TEST=InstrumentationRegistry.getInstrumentation();
    private static final AtomicInteger BLOCKED=new AtomicInteger();
    @CapacitorPlugin(name="FluidityTestMonitor")
    public static class StartupGate extends Plugin {
        @Override public void load() {
            try {
                assertTrue("Document-start measurement is supported",WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT));
                String script;
                try(InputStream input=TEST.getContext().getAssets().open("fluidity-monitor.js")){script=new String(read(input),StandardCharsets.UTF_8);}
                if("startup".equals(InstrumentationRegistry.getArguments().getString("perfStage")))script+="\nwindow.__petpalFluidity.begin('startup');";
                WebViewCompat.addDocumentStartJavaScript(getBridge().getWebView(),script,Collections.singleton("https://localhost"));
                getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()){
                    @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                        Uri uri=request.getUrl();
                        if("https".equals(uri.getScheme())&&"localhost".equals(uri.getHost())&&uri.getPort()==-1)return super.shouldInterceptRequest(view,request);
                        if("http".equals(uri.getScheme())&&"127.0.0.1".equals(uri.getHost())&&uri.getPort()==45331)return null;
                        BLOCKED.incrementAndGet();
                        return new WebResourceResponse("text/plain","UTF-8",403,"Blocked by isolated test",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
                    }
                });
            }catch(Exception failure){throw new AssertionError("Test-only monitor setup failed",failure);}
        }
    }
    private interface Probe{boolean ready()throws Exception;}
    private static byte[] read(InputStream input)throws Exception{try(ByteArrayOutputStream bytes=new ByteArrayOutputStream()){byte[] buffer=new byte[8192];int length;while((length=input.read(buffer))!=-1)bytes.write(buffer,0,length);return bytes.toByteArray();}}
    private static <T>T main(Callable<T> action)throws Exception{AtomicReference<T> value=new AtomicReference<>();AtomicReference<Exception> error=new AtomicReference<>();TEST.runOnMainSync(()->{try{value.set(action.call());}catch(Exception failure){error.set(failure);}});if(error.get()!=null)throw error.get();return value.get();}
    private static void until(String label,Probe probe,long timeout)throws Exception{long end=SystemClock.elapsedRealtime()+timeout;do{if(probe.ready())return;Thread.sleep(80);}while(SystemClock.elapsedRealtime()<end);fail("Performance fixture timeout: "+label);}
    private static String digest(String text)throws Exception{byte[] hash=MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));StringBuilder value=new StringBuilder();for(byte item:hash)value.append(String.format(java.util.Locale.ROOT,"%02x",item&255));return value.toString();}
    private MainActivity activity;private Context context;private Application app;
    private final Application.ActivityLifecycleCallbacks lifecycle=new Application.ActivityLifecycleCallbacks(){
        @Override public void onActivityPreCreated(Activity value,Bundle state){if(value instanceof MainActivity)((MainActivity)value).registerPlugin(StartupGate.class);}
        @Override public void onActivityCreated(Activity value,Bundle state){}
        @Override public void onActivityStarted(Activity value){}
        @Override public void onActivityResumed(Activity value){}
        @Override public void onActivityPaused(Activity value){}
        @Override public void onActivityStopped(Activity value){}
        @Override public void onActivitySaveInstanceState(Activity value,Bundle state){}
        @Override public void onActivityDestroyed(Activity value){}
    };
    private WebView view(){return activity.getBridge().getWebView();}
    private String js(String script)throws Exception{CountDownLatch ready=new CountDownLatch(1);AtomicReference<String> value=new AtomicReference<>();main(()->{view().evaluateJavascript(script,result->{value.set(result);ready.countDown();});return null;});assertTrue("Actual provider callback",ready.await(10,TimeUnit.SECONDS));return value.get();}
    private boolean bool(String source)throws Exception{return"true".equals(js("Boolean("+source+")"));}
    private void save(String name,byte[] bytes)throws Exception{try(FileOutputStream output=new FileOutputStream(new File(context.getExternalFilesDir(null),name))){output.write(bytes);output.flush();output.getFD().sync();}}
    private void dump(String name,String command)throws Exception{try(InputStream input=new ParcelFileDescriptor.AutoCloseInputStream(TEST.getUiAutomation().executeShellCommand(command))){save(name,read(input));}}
    private void loginForm()throws Exception{until("real login form",()->bool("document.querySelector('.login-form input[autocomplete=username]')&&document.querySelector('.login-form button[type=submit]')&&!document.querySelector('.login-fields').disabled"),45000);}
    private void login()throws Exception{
        loginForm();
        assertTrue(bool("(()=>{const form=document.querySelector('.login-form form');const values=[['input[autocomplete=url]','http://127.0.0.1:45331'],['input[autocomplete=username]','syncfixture'],['input[autocomplete=current-password]','SyntheticSync123a']];for(const[selector,value]of values){const input=form.querySelector(selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}return true;})()"));
        Thread.sleep(160);assertTrue(bool("(()=>{document.querySelector('.login-form form').requestSubmit();return true;})()"));
        until("synthetic account authenticated",()->bool("!document.querySelector('.login-form')&&!document.querySelector('.login-retry')&&(document.querySelector('.companion-world')||document.querySelector('button[aria-label=\"我的账号\"]'))"),45000);
    }
    private void chat(String conversation)throws Exception{
        assertTrue("Known synthetic conversation id",conversation.matches("[0-9a-f-]{36}"));
        main(()->{view().loadUrl("https://localhost/?chat=1&conversation="+conversation);return null;});
        until("actual chat workspace and monitor",()->bool("window.__petpalFluidity&&document.querySelector('.chat-scroll')&&document.querySelector('textarea[aria-label=\"消息\"]')&&!document.querySelector('textarea[aria-label=\"消息\"]').disabled&&!document.querySelector('.login-retry')"),60000);
    }
    private void begin(String name,boolean stream)throws Exception{
        dump(name+"-gfx-reset.txt","dumpsys gfxinfo com.petpal.app reset");dump(name+"-memory-before.txt","dumpsys meminfo com.petpal.app");
        assertTrue(bool("window.__petpalFluidity.begin("+JSONObject.quote(name)+","+stream+")"));
    }
    private JSONObject end(String name)throws Exception{
        JSONObject value=new JSONObject(js("window.__petpalFluidity.end()"));value.put("nativeForeground",activity.isUpdaterForeground()).put("blockedExternalRequests",BLOCKED.get()).put("api",Build.VERSION.SDK_INT);
        dump(name+"-gfx.txt","dumpsys gfxinfo com.petpal.app framestats");dump(name+"-memory-after.txt","dumpsys meminfo com.petpal.app");return value;
    }
    private void swipe(float x,float from,float to)throws Exception{
        long start=SystemClock.uptimeMillis();MotionEvent event=MotionEvent.obtain(start,start,MotionEvent.ACTION_DOWN,x,from,0);TEST.sendPointerSync(event);event.recycle();
        for(int step=1;step<=18;step++){Thread.sleep(18);long now=SystemClock.uptimeMillis();event=MotionEvent.obtain(start,now,MotionEvent.ACTION_MOVE,x,from+(to-from)*step/18,0);TEST.sendPointerSync(event);event.recycle();}
        long now=SystemClock.uptimeMillis();event=MotionEvent.obtain(start,now,MotionEvent.ACTION_UP,x,to,0);TEST.sendPointerSync(event);event.recycle();Thread.sleep(120);
    }
    @Test public void measurePackagedApplication()throws Exception{
        Assume.assumeTrue("Explicit isolated measurement only","true".equals(InstrumentationRegistry.getArguments().getString("petpalFluidityRuntime")));
        Assume.assumeTrue("Owned API36 emulator only",Build.VERSION.SDK_INT==36&&(Build.HARDWARE.contains("ranchu")||Build.HARDWARE.contains("goldfish")));
        String stage=InstrumentationRegistry.getArguments().getString("perfStage"),iteration=InstrumentationRegistry.getArguments().getString("iteration","1"),name=stage+"-"+iteration;
        assertTrue("Known performance stage",java.util.Arrays.asList("startup","login","scroll","stream").contains(stage));
        context=TEST.getTargetContext();app=(Application)context.getApplicationContext();BLOCKED.set(0);app.registerActivityLifecycleCallbacks(lifecycle);long started=SystemClock.uptimeMillis();
        try{
            activity=(MainActivity)TEST.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            until("secure foreground bridge",()->activity.hasSecureUpdaterBridge()&&activity.isUpdaterForeground()&&bool("window.__petpalFluidity"),30000);
            JSONObject result;
            if("startup".equals(stage)){
                loginForm();until("usable login controls",()->bool("(()=>{const button=document.querySelector('.login-fields button[type=submit]');const r=button.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight&&getComputedStyle(document.querySelector('.login-page')).opacity>.99})()"),15000);
                result=new JSONObject(js("window.__petpalFluidity.end()"));result.put("nativeStartupToUsableMs",SystemClock.uptimeMillis()-started).put("readyKind","unauthed-real-login");
                dump(name+"-gfx.txt","dumpsys gfxinfo com.petpal.app framestats");dump(name+"-memory-after.txt","dumpsys meminfo com.petpal.app");
            }else if("login".equals(stage)){
                login();result=new JSONObject().put("name",name).put("valid",true).put("setupOnly",true);
            }else{
                chat(InstrumentationRegistry.getArguments().getString("conversation"));
                if("scroll".equals(stage)){
                    String last=InstrumentationRegistry.getArguments().getString("lastMessage");
                    until("latest synthetic history message ready",()->bool("document.querySelector('[data-message-id=\""+last+"\"]')&&!document.querySelector('.message-markdown[aria-busy=true]')"),60000);Thread.sleep(700);
                    JSONObject rect=new JSONObject(js("(()=>{const r=document.querySelector('.chat-scroll').getBoundingClientRect();return{x:r.x+r.width/2,top:r.y+r.height*.25,bottom:r.y+r.height*.75,ratio:devicePixelRatio}})()"));
                    int[] offset=new int[2];main(()->{view().getLocationOnScreen(offset);return null;});float x=(float)(offset[0]+rect.getDouble("x")*rect.getDouble("ratio")),top=(float)(offset[1]+rect.getDouble("top")*rect.getDouble("ratio")),bottom=(float)(offset[1]+rect.getDouble("bottom")*rect.getDouble("ratio"));
                    begin(name,false);for(int i=0;i<18;i++)swipe(x,i<9?top:bottom,i<9?bottom:top);Thread.sleep(300);result=end(name);assertTrue("Actual native swipes scrolled content",result.getDouble("scrollRange")>100&&result.getInt("scrollEvents")>0);
                }else{
                    until("empty synthetic stream conversation",()->bool("document.querySelectorAll('.message').length===0"),30000);
                    assertTrue(bool("(()=>{const input=document.querySelector('textarea[aria-label=\"消息\"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'性能流式合成测试');input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()"));
                    until("send becomes available",()->bool("document.querySelector('button[aria-label=\"发送消息\"]')&&!document.querySelector('button[aria-label=\"发送消息\"]').disabled"),5000);
                    begin(name,true);assertTrue(bool("(()=>{document.querySelector('form.composer').requestSubmit();return true;})()"));
                    until("actual stream completed",()->bool("document.querySelector('.message-assistant .message-read')&&!document.querySelector('button[aria-label=\"停止生成\"]')"),90000);
                    result=end(name);String text=new JSONObject(js("({text:document.querySelector('.message-assistant .message-text').textContent})")).getString("text");String expected=InstrumentationRegistry.getArguments().getString("expectedSha");
                    result.put("finalCharacters",text.length()).put("finalTextSha256",digest(text)).put("finalTextMatches",expected.equals(digest(text)));assertTrue("Actual final visible text is complete",result.getBoolean("finalTextMatches"));
                }
            }
            result.put("passed",true).put("stage",stage).put("iteration",Integer.parseInt(iteration)).put("nativeForeground",activity.isUpdaterForeground()).put("blockedExternalRequests",BLOCKED.get()).put("physicalDevice",false);
            save(name+".json",result.toString().getBytes(StandardCharsets.UTF_8));
            assertTrue("Hidden/background measurements are invalid",result.getBoolean("valid")&&activity.isUpdaterForeground());
        }catch(Throwable failure){
            JSONObject error=new JSONObject().put("passed",false).put("stage",stage).put("iteration",iteration).put("error",String.valueOf(failure));
            try{error.put("page",new JSONObject(js("({origin:location.origin,path:location.pathname,hidden:document.hidden,loginForm:!!document.querySelector('.login-form'),chat:!!document.querySelector('.chat-scroll'),messages:document.querySelectorAll('.message').length,monitor:!!window.__petpalFluidity})")));}catch(Throwable ignored){}
            try{save(name+"-failure.json",error.toString().getBytes(StandardCharsets.UTF_8));}catch(Throwable ignored){}
            try{android.graphics.Bitmap screenshot=TEST.getUiAutomation().takeScreenshot();if(screenshot!=null){try(FileOutputStream out=new FileOutputStream(new File(context.getExternalFilesDir(null),name+"-failure.png"))){screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}screenshot.recycle();}}catch(Throwable ignored){}
            if(failure instanceof Exception)throw(Exception)failure;if(failure instanceof Error)throw(Error)failure;throw new AssertionError(failure);
        }finally{main(()->{if(activity!=null&&!activity.isDestroyed())activity.finishAndRemoveTask();app.unregisterActivityLifecycleCallbacks(lifecycle);return null;});}
    }
}
