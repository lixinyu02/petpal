package com.petpal.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.Lifecycle;
import androidx.lifecycle.LifecycleEventObserver;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/** Retains Capacitor runtime permission prompts only for local camera/microphone requests. */
public final class LocalMediaChromeClient extends BridgeWebChromeClient {
    private final Bridge localBridge;
    private GuardedRequest pending;
    private GuardedFileChooser fileChooser;

    public LocalMediaChromeClient(Bridge bridge) {
        super(bridge);
        localBridge = bridge;
        bridge.getActivity().getLifecycle().addObserver((LifecycleEventObserver) (owner, event) -> {
            if (event == Lifecycle.Event.ON_RESUME) {
                // MainActivity marks itself foreground after super.onResume().
                // Posting also handles OEM permission results delivered before it.
                bridge.getWebView().post(() -> { if (pending != null) pending.flushGrant(); });
            } else if (event == Lifecycle.Event.ON_DESTROY) {
                if (pending != null) { pending.cancelled = true; pending.abort(); }
                if (fileChooser != null) fileChooser.abort();
            }
        });
    }

    private boolean sameOrigin(Uri a, Uri b) {
        return a != null && b != null && a.getHost() != null
            && Objects.equals(a.getScheme(), b.getScheme())
            && Objects.equals(a.getHost(), b.getHost()) && a.getPort() == b.getPort();
    }

    private boolean trustedPage(boolean foreground) {
        if (!(localBridge.getActivity() instanceof MainActivity) || localBridge.getWebView() == null) return false;
        MainActivity activity = (MainActivity) localBridge.getActivity();
        return !activity.isFinishing() && !activity.isDestroyed() && activity.hasSecureUpdaterBridge()
            && (!foreground || activity.isUpdaterForeground() && localBridge.getWebView().isShown())
            && UpdaterPolicy.trustedPage(localBridge.getLocalUrl(), localBridge.getWebView().getUrl());
    }

    private boolean trusted(PermissionRequest request) {
        if (!trustedPage(false)) return false;
        String local = localBridge.getLocalUrl(), current = localBridge.getWebView().getUrl();
        Uri localUri = Uri.parse(local), page = Uri.parse(current);
        if (!sameOrigin(localUri, request.getOrigin()) || !sameOrigin(localUri, page)
            || page.getQueryParameterNames().contains("overlay") || page.getQueryParameterNames().contains("pet")) return false;
        String[] resources = request.getResources();
        if (resources.length == 0) return false;
        for (String resource : resources) {
            if (!PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                && !PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) return false;
        }
        return true;
    }

    private boolean markRequested(String permission) {
        if (ContextCompat.checkSelfPermission(localBridge.getContext(), permission) == PackageManager.PERMISSION_GRANTED) return false;
        AndroidPermissionState.markRequested(localBridge.getContext(), permission);
        return true;
    }

    private void recordResult(String permission) {
        // Permission history is diagnostic; storage/OEM failures must never
        // crash a WebView callback or hold the shared Android result slot.
        try { AndroidPermissionState.recordResult(localBridge.getActivity(), permission); }
        catch (RuntimeException unavailable) { }
    }

    private static void deny(PermissionRequest request) {
        try { request.deny(); } catch (RuntimeException staleRequest) { }
    }

    private static void deliver(ValueCallback<Uri[]> callback, Uri[] value) {
        try { callback.onReceiveValue(value); } catch (RuntimeException staleRequest) { }
    }

    @Override public void onPermissionRequest(PermissionRequest request) {
        // Capacitor owns a single runtime callback; do not replace it while a system prompt is open.
        if (pending != null || fileChooser != null || !trustedPage(true) || !trusted(request)) { deny(request); return; }
        GuardedRequest guarded = new GuardedRequest(request);
        pending = guarded;
        try {
            for (String resource : request.getResources()) {
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource) && markRequested(Manifest.permission.RECORD_AUDIO)) guarded.requested.add(Manifest.permission.RECORD_AUDIO);
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource) && markRequested(Manifest.permission.CAMERA)) guarded.requested.add(Manifest.permission.CAMERA);
            }
            super.onPermissionRequest(guarded);
        } catch (RuntimeException unavailable) { guarded.abort(); }
    }

    @Override public void onPermissionRequestCanceled(PermissionRequest request) {
        if (pending != null && pending.original == request) {
            pending.cancelled = true;
            if (pending.resultReady) pending.flushGrant();
        }
        super.onPermissionRequestCanceled(request);
    }

    @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
        // Location is not an app permission. Inherited geolocation would overwrite
        // the same Capacitor runtime callback used by microphone and attachments.
        callback.invoke(origin, false, false);
    }

    @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams parameters) {
        // Capacitor also shares its one Activity-result callback among attachments.
        // Retain ownership until the picker/camera finishes, even after a media
        // request is cancelled while its Android permission dialog remains open.
        if (pending != null || fileChooser != null || view != localBridge.getWebView() || !trustedPage(true)) {
            deliver(callback, null); return true;
        }
        GuardedFileChooser guarded = new GuardedFileChooser(callback, view.getUrl());
        fileChooser = guarded;
        try {
            if (parameters.isCaptureEnabled()) for (String type : parameters.getAcceptTypes())
                if ("image/*".equals(type) || "video/*".equals(type)) { guarded.requestedCamera = markRequested(Manifest.permission.CAMERA); break; }
            boolean handled = super.onShowFileChooser(view, guarded, parameters);
            if (!handled) guarded.onReceiveValue(null);
        } catch (RuntimeException unavailable) { guarded.abort(); }
        return true;
    }

    private final class GuardedFileChooser implements ValueCallback<Uri[]> {
        final ValueCallback<Uri[]> original;
        final String page;
        boolean completed, requestedCamera;
        GuardedFileChooser(ValueCallback<Uri[]> original, String page) { this.original = original; this.page = page; }
        @Override public void onReceiveValue(Uri[] value) {
            if (completed) return;
            completed = true;
            try {
                if (requestedCamera) recordResult(Manifest.permission.CAMERA);
                deliver(original, trustedPage(false) && Objects.equals(page, localBridge.getWebView().getUrl()) ? value : null);
            }
            finally { if (fileChooser == this) fileChooser = null; }
        }
        void abort() { requestedCamera = false; onReceiveValue(null); }
    }

    private final class GuardedRequest extends PermissionRequest {
        final PermissionRequest original;
        final List<String> requested = new ArrayList<>();
        boolean cancelled, completed, resultReady;
        String[] grantedResources;
        GuardedRequest(PermissionRequest original) { this.original = original; }
        @Override public Uri getOrigin() { return original.getOrigin(); }
        @Override public String[] getResources() { return original.getResources(); }
        @Override public void grant(String[] resources) {
            if (completed || resultReady) return;
            resultReady = true;
            for (String permission : requested) recordResult(permission);
            grantedResources = resources.clone();
            flushGrant();
        }
        void flushGrant() {
            if (completed || !resultReady) return;
            if (!cancelled && trusted(original) && !trustedPage(true)) return;
            completed = true;
            try { if (!cancelled) { if (trusted(original) && trustedPage(true)) original.grant(grantedResources); else LocalMediaChromeClient.deny(original); } }
            catch (RuntimeException staleRequest) { }
            finally { if (pending == this) pending = null; }
        }
        @Override public void deny() {
            if (completed || resultReady) return;
            completed = true;
            try {
                for (String permission : requested) recordResult(permission);
                if (!cancelled) LocalMediaChromeClient.deny(original);
            }
            finally { if (pending == this) pending = null; }
        }
        void abort() { requested.clear(); resultReady = false; deny(); }
    }
}
