package com.petpal.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Collections;
import java.util.Set;
import org.json.JSONObject;

@CapacitorPlugin(name = "PetLoginSession")
public final class PetLoginSessionPlugin extends Plugin {
    private static final ExecutorService IO = new ThreadPoolExecutor(0,4,30,TimeUnit.SECONDS,new SynchronousQueue<>(),new ThreadPoolExecutor.AbortPolicy());
    private static final ExecutorService CLEAR = Executors.newSingleThreadExecutor();
    private final Set<Long> writes = Collections.newSetFromMap(new ConcurrentHashMap<Long,Boolean>());
    private PetLoginSessionState state;
    private volatile boolean destroyed;
    @Override public void load() { state = new PetLoginSessionState(getContext()); state.claimOwner(); }
    private boolean trusted() {
        return !destroyed && getActivity() instanceof MainActivity && !getActivity().isFinishing() && !getActivity().isDestroyed()
            && ((MainActivity) getActivity()).hasSecureUpdaterBridge() && getBridge() != null && getBridge().getWebView() != null
            && UpdaterPolicy.trustedPage(getBridge().getLocalUrl(), getBridge().getWebView().getUrl());
    }
    private void action(PluginCall call, String kind) {
        if (getActivity() == null) { call.reject("设备登录只能由小伴主页面管理。"); return; }
        getActivity().runOnUiThread(() -> {
            if (!trusted()) { call.reject("设备登录只能由安全的小伴主页面管理。"); return; }
            boolean clear = "clear".equals(kind), write = "write".equals(kind);
            long revision = "read".equals(kind) ? 0 : clear ? state.reserveClear() : state.reserve();
            if (write) writes.add(revision);
            JSONObject input;
            try { input = write ? new JSONObject(call.getData().toString()) : null; }
            catch (Exception invalid) { writes.remove(revision); state.cancelWrite(revision); call.reject("设备登录信息无效。"); return; }
            Runnable work = () -> {
                try {
                    if (destroyed && !clear) throw new IllegalStateException();
                    JSObject result;
                    if ("read".equals(kind)) result = new JSObject(state.read().toString());
                    else { if (write) state.write(input, revision); else state.clear(revision); result = new JSObject(); }
                    if (clear) call.resolve(result);
                    else getActivity().runOnUiThread(() -> { if (trusted()) call.resolve(result); else call.reject("登录页面已变化，请重试。"); });
                } catch (Exception failure) { call.reject(clear ? "无法清除设备登录，请重试。" : "设备登录操作未完成，请重新登录或重试。"); }
                finally { if (write) writes.remove(revision); }
            };
            try { (clear ? CLEAR : IO).execute(work); }
            catch (RejectedExecutionException busy) { if(write){writes.remove(revision);state.cancelWrite(revision);}call.reject("设备登录正在处理中，请稍后重试。"); }
        });
    }
    @PluginMethod public void read(PluginCall call) { action(call, "read"); }
    @PluginMethod public void write(PluginCall call) { action(call, "write"); }
    @PluginMethod public void clear(PluginCall call) { action(call, "clear"); }
    @Override protected void handleOnDestroy() { destroyed = true; for(long revision:writes)state.cancelWrite(revision); super.handleOnDestroy(); }
}
