package com.petpal.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Looper;
import android.text.InputFilter;
import android.text.InputType;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.FrameLayout;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;

@CapacitorPlugin(name = "PetOfficialAccount")
public final class PetOfficialAccountPlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private PetOfficialAccountHost host;
    private PetOfficialAccountHost.Binding binding;
    private PetOfficialAccountRuntime runtime;
    private volatile boolean destroyed;
    private AlertDialog callbackDialog;
    private EditText callbackInput;
    private PluginCall callbackInputCall;
    private String callbackInputScope;
    @Override public void load() {
        host = PetOfficialAccountHost.get(getContext()); runtime = host.runtime();
        binding = host.attach(this::openBrowser, () -> { checkCallbackInput(); if (trusted(false)) notifyListeners("status", new JSObject().put("changed", true)); });
    }
    private boolean trusted(boolean foreground) {
        return Looper.myLooper() == Looper.getMainLooper() && !destroyed && getActivity() instanceof MainActivity && !getActivity().isFinishing() && !getActivity().isDestroyed()
            && ((MainActivity) getActivity()).hasSecureUpdaterBridge() && getBridge() != null && getBridge().getWebView() != null
            && UpdaterPolicy.trustedPage(getBridge().getLocalUrl(), getBridge().getWebView().getUrl())
            && (!foreground || ((MainActivity) getActivity()).isUpdaterForeground() && getBridge().getWebView().isShown());
    }
    private void openBrowser(String url) throws Exception {
        Activity activity = getActivity();
        if (activity == null) throw new IllegalStateException(); CountDownLatch ready = new CountDownLatch(1); AtomicReference<Exception> failure = new AtomicReference<>();
        Runnable open = () -> {
            try {
                if (!trusted(true) || binding == null || !binding.isCurrentBrowser() || !url.startsWith("https://auth.openai.com/api/accounts/authorize?")) throw new IllegalStateException();
                host.startAuthorizationService();
                activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE));
            }
            catch (Exception error) { failure.set(error); }
            finally { ready.countDown(); }
        };
        if (Looper.myLooper() == Looper.getMainLooper()) open.run(); else activity.runOnUiThread(open);
        if (!ready.await(10, TimeUnit.SECONDS) || failure.get() != null) throw new IllegalStateException("无法打开官方登录浏览器。");
    }
    private interface Action { JSONObject run(String scopeId) throws Exception; }
    private void action(PluginCall call, boolean binding, boolean foreground, Action work) {
        Activity activity = getActivity();
        if (activity == null) { call.reject("官方账号只允许由小伴主页面管理。"); return; }
        activity.runOnUiThread(() -> {
            if (!trusted(foreground)) { call.reject("官方账号只允许由安全的小伴主页面管理。"); return; }
            final String id;
            try { id = binding ? null : PetOfficialAccountPolicy.uuid(call.getString("scopeId")); if (!binding) runtime.checkScope(id); }
            catch (Exception failure) { call.reject("小伴登录已变化，请重新打开官方账号设置。"); return; }
            io.execute(() -> {
                try {
                    if (destroyed) throw new IllegalStateException();
                    if (!binding) runtime.checkScope(id); JSONObject result = work.run(id); if (!binding) runtime.checkScope(id);
                    JSObject output = new JSObject(result.toString()); String expected = binding ? result.getString("scopeId") : id;
                    activity.runOnUiThread(() -> {
                        try { if (!trusted(false)) throw new IllegalStateException(); runtime.checkScope(expected); call.resolve(output); }
                        catch (Exception failure) { call.reject("官方账号页面或登录已变化，请重新打开设置。"); }
                    });
                } catch (Exception failure) { call.reject("官方账号操作未完成，请检查网络、登录状态后重试。"); }
            });
        });
    }
    @PluginMethod public void bind(PluginCall call) { action(call, true, true, ignored -> runtime.bind(call.getData())); }
    @PluginMethod public void status(PluginCall call) { action(call, false, false, runtime::scopedStatus); }
    @PluginMethod public void start(PluginCall call) { action(call, false, true, ignored -> runtime.start(call.getString("profileId"))); }
    /** The page requests a dialog, never sends or receives an OAuth callback URL. */
    @PluginMethod public void completeCallback(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) { call.reject("请返回小伴主页面后输入回调地址。"); return; }
        activity.runOnUiThread(() -> {
            if (!trusted(true)) { call.reject("回调地址只允许在安全的小伴主页面输入。"); return; }
            if (callbackInputCall != null) { call.reject("回调输入框已经打开。"); return; }
            final String scopeId;
            try {
                scopeId = PetOfficialAccountPolicy.uuid(call.getString("scopeId")); runtime.checkScope(scopeId);
                if (runtime.pendingAttemptId() == null) throw new IllegalStateException();
            } catch (Exception invalid) { call.reject("本次登录已结束，请刷新官方账号状态或重新登录。"); return; }
            EditText input = new EditText(activity);
            input.setHint("http://127.0.0.1:端口/auth/callback?…"); input.setSingleLine(true);
            input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
            input.setImeOptions(EditorInfo.IME_ACTION_DONE | EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING);
            if (Build.VERSION.SDK_INT >= 26) input.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
            input.setSaveEnabled(false); input.setSaveFromParentEnabled(false);
            // Reject an oversized paste as a whole; never silently truncate an authorization URL.
            input.setFilters(new InputFilter[]{(source, start, end, dest, dstart, dend) -> {
                if ((long) dest.length() - (dend - dstart) + end - start > 16384) {
                    input.post(() -> input.setError("地址过长，请复制本次授权完成后的完整地址。"));
                    return dest.subSequence(dstart, dend);
                } return null;
            }});
            FrameLayout frame = new FrameLayout(activity); int padding = (int) (24 * activity.getResources().getDisplayMetrics().density);
            frame.setPadding(padding, 0, padding, 0); frame.setSaveEnabled(false); frame.addView(input);
            AlertDialog dialog = new AlertDialog.Builder(activity).setTitle("手动完成 ChatGPT 登录")
                .setMessage("复制授权完成后浏览器地址栏的完整地址，返回这里粘贴。地址只在此手机上处理。")
                .setView(frame).setNegativeButton("暂不输入", (ignored, which) -> finishCallbackInput(false))
                .setPositiveButton("验证并完成", null).create();
            callbackDialog = dialog; callbackInput = input; callbackInputCall = call; callbackInputScope = scopeId;
            dialog.setOnCancelListener(ignored -> finishCallbackInput(false));
            dialog.setOnDismissListener(ignored -> { if (callbackDialog == dialog) finishCallbackInput(false); });
            try {
                dialog.show(); dialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(ignored -> {
                    if (callbackDialog != dialog || callbackInputCall != call || !trusted(true)) { finishCallbackInput(true); return; }
                    final String url = input.getText().toString();
                    if (url.trim().isEmpty()) { input.setError("请粘贴浏览器最终回调地址。"); return; }
                    clearCallbackInput();
                    action(call, false, true, id -> runtime.completeCallback(id, url));
                });
                input.setOnEditorActionListener((view, actionId, event) -> {
                    if (actionId == EditorInfo.IME_ACTION_DONE) { dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick(); return true; } return false;
                });
            } catch (Exception unavailable) { finishCallbackInput(true); }
        });
    }
    private void clearCallbackInput() {
        AlertDialog dialog = callbackDialog; EditText input = callbackInput;
        callbackDialog = null; callbackInput = null; callbackInputCall = null; callbackInputScope = null;
        if (input != null) { input.setOnEditorActionListener(null); input.getText().clear(); }
        if (dialog != null) dialog.dismiss();
    }
    private void finishCallbackInput(boolean reject) {
        PluginCall call = callbackInputCall; String scopeId = callbackInputScope;
        clearCallbackInput(); if (call == null) return;
        try { if (reject || !trusted(false)) throw new IllegalStateException(); runtime.checkScope(scopeId); call.resolve(new JSObject(runtime.status().toString())); }
        catch (Exception unavailable) { call.reject("回调输入已关闭，请确认当前小伴登录后重试。"); }
    }
    private void checkCallbackInput() {
        if (callbackInputCall == null) return;
        try {
            if (!trusted(false)) throw new IllegalStateException(); runtime.checkScope(callbackInputScope);
            // A browser callback can finish while this fallback is open.
            if (runtime.pendingAttemptId() == null) finishCallbackInput(false);
        }
        catch (Exception changed) { finishCallbackInput(true); }
    }
    @PluginMethod public void cancel(PluginCall call) {
        if (getActivity() == null) { call.reject("官方账号页面不可用。"); return; }
        getActivity().runOnUiThread(() -> {
            if (!trusted(false)) { call.reject("官方账号只允许由安全的小伴主页面管理。"); return; }
            try { call.resolve(new JSObject(runtime.cancelLocal(PetOfficialAccountPolicy.uuid(call.getString("scopeId"))).toString())); }
            catch (Exception failure) { call.reject("小伴登录已变化，请重新打开官方账号设置。"); }
        });
    }
    @PluginMethod public void select(PluginCall call) { action(call, false, true, ignored -> runtime.select(call.getString("profileId"))); }
    @PluginMethod public void logout(PluginCall call) { action(call, false, true, ignored -> runtime.logout()); }
    @PluginMethod public void refresh(PluginCall call) { action(call, false, true, ignored -> runtime.refresh()); }
    @PluginMethod public void resumeUsage(PluginCall call) { action(call, false, true, ignored -> runtime.resumeUsage()); }
    @PluginMethod public void clearScope(PluginCall call) {
        if (getActivity() == null) { call.reject("官方账号页面不可用。"); return; }
        getActivity().runOnUiThread(() -> { if (!trusted(false)) { call.reject("官方账号只允许由安全的小伴主页面管理。"); return; } finishCallbackInput(true); runtime.clearScope(); call.resolve(); });
    }
    @Override protected void handleOnStop() { finishCallbackInput(false); super.handleOnStop(); }
    @Override protected void handleOnDestroy() {
        destroyed = true; finishCallbackInput(true); if (binding != null) { binding.detach(); binding = null; }
        // Already-started native work belongs to the application, not this WebView.
        io.shutdown(); super.handleOnDestroy();
    }
}
