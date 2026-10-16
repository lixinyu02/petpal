package com.petpal.app;

import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.ContextCompat;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.Set;

/** Process-lifetime owner; only attached, live plugins may open a browser. */
final class PetOfficialAccountHost {
    private static volatile PetOfficialAccountHost instance;
    private final Context application;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Object gate = new Object();
    private final Set<Binding> bindings = new LinkedHashSet<>();
    private final PetOfficialAccountRuntime runtime;
    private Binding browserBinding;

    static PetOfficialAccountHost get(Context context) {
        PetOfficialAccountHost value = instance;
        if (value == null) synchronized (PetOfficialAccountHost.class) {
            value = instance;
            if (value == null) instance = value = new PetOfficialAccountHost(context.getApplicationContext());
        }
        return value;
    }

    static PetOfficialAccountHost existing() { return instance; }

    private PetOfficialAccountHost(Context context) {
        application = context;
        runtime = new PetOfficialAccountRuntime(application, this::openBrowser, this::changed);
    }

    PetOfficialAccountRuntime runtime() { return runtime; }

    Binding attach(PetOfficialAccountRuntime.Browser opener, PetOfficialAccountRuntime.Listener listener) {
        if (opener == null || listener == null) throw new IllegalArgumentException();
        Binding result = new Binding(opener, listener);
        synchronized (gate) { bindings.add(result); browserBinding = result; }
        return result;
    }

    final class Binding {
        private PetOfficialAccountRuntime.Browser opener;
        private PetOfficialAccountRuntime.Listener listener;
        private Binding(PetOfficialAccountRuntime.Browser opener, PetOfficialAccountRuntime.Listener listener) { this.opener = opener; this.listener = listener; }
        boolean isCurrentBrowser() { synchronized (gate) { return browserBinding == this && opener != null; } }
        void detach() {
            synchronized (gate) {
                bindings.remove(this);
                if (browserBinding == this) {
                    browserBinding = null;
                    for (Binding remaining : bindings) browserBinding = remaining;
                }
                opener = null; listener = null;
            }
        }
    }

    private void openBrowser(String url) throws Exception {
        PetOfficialAccountRuntime.Browser opener;
        synchronized (gate) { opener = browserBinding == null ? null : browserBinding.opener; }
        if (opener == null) throw new IllegalStateException("请返回小伴主页面后重新登录官方账号。");
        // Never hold the host lock while an opener waits for the main thread.
        opener.open(url);
    }

    /** Called only after the plugin has verified its visible, trusted main page. */
    void startAuthorizationService() {
        if (Looper.myLooper() != Looper.getMainLooper()) throw new IllegalStateException();
        String attemptId = runtime.pendingAttemptId();
        if (attemptId == null) throw new IllegalStateException("官方登录已结束，请重新开始。");
        ContextCompat.startForegroundService(application, new Intent(application, PetOfficialAccountService.class)
            .setAction(PetOfficialAccountService.START).putExtra(PetOfficialAccountService.ATTEMPT_ID, attemptId));
    }

    private void changed() {
        // Runtime can emit during I/O or with its own lock held. Read it only later.
        main.post(() -> {
            PetOfficialAccountService.reconcileCurrent();
            ArrayList<Binding> snapshot;
            synchronized (gate) { snapshot = new ArrayList<>(bindings); }
            for (Binding binding : snapshot) {
                PetOfficialAccountRuntime.Listener listener;
                synchronized (gate) { listener = binding.listener; }
                if (listener != null) try { listener.changed(); } catch (Exception ignored) { }
            }
        });
    }
}
