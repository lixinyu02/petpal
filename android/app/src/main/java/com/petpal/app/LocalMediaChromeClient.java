package com.petpal.app;

import android.net.Uri;
import android.webkit.PermissionRequest;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;
import java.util.Objects;

/** Retains Capacitor runtime permission prompts only for local camera/microphone requests. */
public final class LocalMediaChromeClient extends BridgeWebChromeClient {
    private final Bridge localBridge;
    private GuardedRequest pending;

    public LocalMediaChromeClient(Bridge bridge) {
        super(bridge);
        localBridge = bridge;
    }

    private boolean sameOrigin(Uri a, Uri b) {
        return a != null && b != null && a.getHost() != null
            && Objects.equals(a.getScheme(), b.getScheme())
            && Objects.equals(a.getHost(), b.getHost()) && a.getPort() == b.getPort();
    }

    private boolean trusted(PermissionRequest request) {
        String local = localBridge.getLocalUrl(), current = localBridge.getWebView().getUrl();
        if (local == null || current == null || localBridge.getActivity().isFinishing()
            || !localBridge.getWebView().isShown()) return false;
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

    @Override public void onPermissionRequest(PermissionRequest request) {
        // Capacitor owns a single runtime callback; do not replace it while a system prompt is open.
        if (pending != null || !trusted(request)) { request.deny(); return; }
        pending = new GuardedRequest(request);
        super.onPermissionRequest(pending);
    }

    @Override public void onPermissionRequestCanceled(PermissionRequest request) {
        if (pending != null && pending.original == request) pending.cancelled = true;
        super.onPermissionRequestCanceled(request);
    }

    private final class GuardedRequest extends PermissionRequest {
        final PermissionRequest original;
        boolean cancelled;
        GuardedRequest(PermissionRequest original) { this.original = original; }
        @Override public Uri getOrigin() { return original.getOrigin(); }
        @Override public String[] getResources() { return original.getResources(); }
        @Override public void grant(String[] resources) {
            if (!cancelled) {
                if (trusted(original)) original.grant(resources); else original.deny();
            }
            if (pending == this) pending = null;
        }
        @Override public void deny() {
            if (!cancelled) original.deny();
            if (pending == this) pending = null;
        }
    }
}
