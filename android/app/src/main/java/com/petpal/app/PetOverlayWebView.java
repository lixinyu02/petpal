package com.petpal.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;
import java.util.Map;
import java.util.HashMap;
import java.util.Collections;

/** A local-only WebGL surface. Deliberately has no Capacitor or JavaScript/native bridge. */
public final class PetOverlayWebView extends WebView {
    private static final Map<String, String> HEADERS = responseHeaders();
    private final WebViewAssetLoader assets;

    private static Map<String, String> responseHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'");
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Cache-Control", "no-store");
        return Collections.unmodifiableMap(headers);
    }

    @SuppressLint("SetJavaScriptEnabled")
    public PetOverlayWebView(Context context, Runnable onRendererGone) {
        super(context);
        setBackgroundColor(Color.TRANSPARENT);
        setOverScrollMode(OVER_SCROLL_NEVER);
        setVerticalScrollBarEnabled(false);
        setHorizontalScrollBarEnabled(false);
        setContentDescription("可以轻点互动的三维小猫");
        WebSettings settings = getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setBlockNetworkLoads(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setGeolocationEnabled(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        if (Build.VERSION.SDK_INT >= 26) setRendererPriorityPolicy(RENDERER_PRIORITY_BOUND, true);
        assets = new WebViewAssetLoader.Builder().setDomain(OverlayAssetPolicy.HOST)
            .addPathHandler("/", this::readPublicAsset).build();
        setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return intercept(request.getUrl(), request.getMethod());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return intercept(Uri.parse(url), "GET");
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !request.isForMainFrame() || !OverlayAssetPolicy.canNavigate(request.getUrl().toString());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !OverlayAssetPolicy.canNavigate(url);
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                post(onRendererGone);
                return true;
            }
        });
        setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean gesture, android.os.Message result) { return false; }
            @Override public boolean onShowFileChooser(WebView view, android.webkit.ValueCallback<Uri[]> callback, FileChooserParams parameters) {
                callback.onReceiveValue(null);
                return true;
            }
        });
        setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> { });
        setOnLongClickListener(view -> true);
    }

    public void startCompanion(String kind) {
        setContentDescription("cat".equals(OverlayAssetPolicy.normalizeCompanionKind(kind)) ? "可以轻点互动的三维小猫" : "可以轻点互动的二次元伙伴");
        loadUrl(OverlayAssetPolicy.entryUrl(kind));
    }

    private WebResourceResponse intercept(Uri uri, String method) {
        if (OverlayAssetPolicy.assetPath(uri.toString(), method) == null) return denied(403, "Forbidden");
        WebResourceResponse response = assets.shouldInterceptRequest(uri);
        return response == null ? denied(404, "Not Found") : response;
    }

    private WebResourceResponse readPublicAsset(String relativePath) {
        String path = OverlayAssetPolicy.resourcePath(relativePath);
        if (path == null) return denied(403, "Forbidden");
        try {
            InputStream stream = getContext().getAssets().open(path);
            return new WebResourceResponse(mime(path), "UTF-8", 200, "OK", HEADERS, stream);
        } catch (IOException ignored) { return denied(404, "Not Found"); }
    }

    private static WebResourceResponse denied(int status, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason, HEADERS, new ByteArrayInputStream(new byte[0]));
    }

    private static String mime(String path) {
        String extension = path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        return switch (extension) {
            case "html" -> "text/html";
            case "js", "mjs" -> "application/javascript";
            case "css" -> "text/css";
            case "json" -> "application/json";
            case "svg" -> "image/svg+xml";
            case "png" -> "image/png";
            case "jpg", "jpeg" -> "image/jpeg";
            case "webp" -> "image/webp";
            case "gif" -> "image/gif";
            case "woff" -> "font/woff";
            case "woff2" -> "font/woff2";
            case "glb" -> "model/gltf-binary";
            case "gltf" -> "model/gltf+json";
            case "wasm" -> "application/wasm";
            default -> "application/octet-stream";
        };
    }

    public void releaseCompanion() {
        stopLoading();
        onPause();
        removeAllViews();
        destroy();
    }
}
