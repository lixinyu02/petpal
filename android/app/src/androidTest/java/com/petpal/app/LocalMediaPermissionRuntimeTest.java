package com.petpal.app;

import static org.junit.Assert.*;
import android.app.Activity;
import android.app.Application;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContract;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.app.ActivityOptionsCompat;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayInputStream;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Opt-in owned-emulator regression. The real installed WebChromeClient is used,
 * but Android launchers are replaced with controlled callbacks: no permission is
 * granted, no camera/mic is opened, no external picker or network request runs.
 */
@RunWith(AndroidJUnit4.class)
public class LocalMediaPermissionRuntimeTest {
    private static final Instrumentation TEST = InstrumentationRegistry.getInstrumentation();
    private static final AtomicBoolean GATED = new AtomicBoolean();
    @CapacitorPlugin(name = "MediaPermissionStartupGate")
    public static final class StartupGate extends Plugin {
        @Override public void load() {
            getBridge().getWebView().getSettings().setJavaScriptEnabled(false);
            getBridge().getWebView().getSettings().setBlockNetworkLoads(true);
            GATED.set(true);
        }
    }
    private static <T> T main(Callable<T> work) throws Exception {
        AtomicReference<T> result = new AtomicReference<>(); AtomicReference<Throwable> error = new AtomicReference<>();
        TEST.runOnMainSync(() -> { try { result.set(work.call()); } catch (Throwable failure) { error.set(failure); } });
        if (error.get() != null) throw new AssertionError("Media permission main-thread probe failed", error.get());
        return result.get();
    }
    private static Field field(String name) throws Exception {
        Field field = BridgeWebChromeClient.class.getDeclaredField(name); field.setAccessible(true); return field;
    }
    private static void permissionResult(Object listener, boolean granted) throws Exception {
        Method method = listener.getClass().getDeclaredMethod("onPermissionSelect", Boolean.class); method.setAccessible(true);
        try { method.invoke(listener, granted); }
        catch (InvocationTargetException failure) { throw new IllegalStateException("Controlled permission callback failed", failure.getCause()); }
    }
    private static void activityResult(Object listener, ActivityResult result) throws Exception {
        Method method = listener.getClass().getDeclaredMethod("onActivityResult", ActivityResult.class); method.setAccessible(true); method.invoke(listener, result);
    }
    private static final class Launcher<I> extends ActivityResultLauncher<I> {
        final ActivityResultContract<I, ?> contract;
        int launches; boolean fail; I last;
        Launcher(ActivityResultContract<I, ?> contract) { this.contract = contract; }
        @Override public void launch(I value, ActivityOptionsCompat options) {
            launches++; last = value; if (fail) throw new IllegalStateException("Controlled launch failure");
        }
        @Override public void unregister() { }
        @Override public ActivityResultContract<I, ?> getContract() { return contract; }
    }
    private static final class Request extends PermissionRequest {
        final Uri origin;
        final String[] resources;
        int grants, denials;
        boolean failDeny;
        Request(Uri origin, String... resources) { this.origin = origin; this.resources = resources; }
        @Override public Uri getOrigin() { return origin; }
        @Override public String[] getResources() { return resources; }
        @Override public void grant(String[] value) { grants++; }
        @Override public void deny() { denials++; if (failDeny) throw new IllegalStateException("Controlled browser callback failure"); }
    }
    private static final class FileResult implements ValueCallback<Uri[]> {
        int calls; Uri[] value;
        @Override public void onReceiveValue(Uri[] value) { calls++; this.value = value; }
    }
    private static final class Call extends PluginCall {
        int resolves, rejects; JSObject value; String error;
        Call(String method) { super(null, "PetOverlay", UUID.randomUUID().toString(), method, new JSObject()); }
        @Override public void resolve(JSObject value) { resolves++; this.value = value; }
        @Override public void reject(String error) { rejects++; this.error = error; }
    }
    private static Field overlayField(String name) throws Exception {
        Field field = PetOverlayPlugin.class.getDeclaredField(name); field.setAccessible(true); return field;
    }
    private static void overlayCallback(PetOverlayPlugin plugin, Call call) throws Exception {
        Method method = PetOverlayPlugin.class.getDeclaredMethod("notificationsResult", PluginCall.class); method.setAccessible(true); method.invoke(plugin, call);
    }
    private static WebChromeClient.FileChooserParams files(boolean capture) {
        return new WebChromeClient.FileChooserParams() {
            @Override public int getMode() { return MODE_OPEN; }
            @Override public String[] getAcceptTypes() { return new String[]{"image/*"}; }
            @Override public boolean isCaptureEnabled() { return capture; }
            @Override public CharSequence getTitle() { return "Media regression fixture"; }
            @Override public String getFilenameHint() { return ""; }
            @Override public Intent createIntent() { return new Intent(Intent.ACTION_GET_CONTENT).setType("image/*"); }
        };
    }
    private static final class Session implements AutoCloseable {
        final Context context = TEST.getTargetContext();
        final Application application = (Application) context.getApplicationContext();
        final Launcher<String[]> permissions = new Launcher<>(new ActivityResultContracts.RequestMultiplePermissions());
        final Launcher<Intent> activities = new Launcher<>(new ActivityResultContracts.StartActivityForResult());
        MainActivity activity; LocalMediaChromeClient client; Object originalPermissions, originalActivities;
        Map<String, ?> savedHistory; boolean registered;
        final Application.ActivityLifecycleCallbacks lifecycle = new Application.ActivityLifecycleCallbacks() {
            @Override public void onActivityPreCreated(Activity activity, Bundle state) { if (activity instanceof MainActivity) ((MainActivity) activity).registerPlugin(StartupGate.class); }
            @Override public void onActivityCreated(Activity activity, Bundle state) { }
            @Override public void onActivityStarted(Activity activity) { }
            @Override public void onActivityResumed(Activity activity) { }
            @Override public void onActivityPaused(Activity activity) { }
            @Override public void onActivityStopped(Activity activity) { }
            @Override public void onActivitySaveInstanceState(Activity activity, Bundle state) { }
            @Override public void onActivityDestroyed(Activity activity) { }
        };
        Session() throws Exception {
            Assume.assumeTrue("Explicit emulator media permission acceptance only", "true".equals(InstrumentationRegistry.getArguments().getString("petpalPermissionRuntime")));
            Assume.assumeTrue("Owned emulator only", Build.HARDWARE.contains("ranchu") || Build.HARDWARE.contains("goldfish"));
            Assume.assumeTrue("Modern emulator fixture requires API33+", Build.VERSION.SDK_INT >= 33);
            try {
                savedHistory = context.getSharedPreferences("petpal_permission_history_v1", Context.MODE_PRIVATE).getAll();
                main(() -> { GATED.set(false); application.registerActivityLifecycleCallbacks(lifecycle); registered = true; return null; });
                activity = (MainActivity) TEST.startActivitySync(new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
                String url = main(() -> activity.getBridge().getLocalUrl().replaceAll("/+$", "") + "/?mediaPermissionFixture=" + UUID.randomUUID());
                main(() -> {
                    assertTrue("Application scripts were disabled before first page load", GATED.get());
                    WebView view = activity.getBridge().getWebView(); view.stopLoading();
                    view.getSettings().setJavaScriptEnabled(false);
                    // Old WebView versions can expose a loadDataWithBaseURL page
                    // as data:. Use a real intercepted local navigation instead;
                    // no JS/native bridge is needed by these direct Java probes.
                    view.setWebViewClient(new BridgeWebViewClient(activity.getBridge()) {
                        private WebResourceResponse response(boolean fixture) {
                            String html = fixture ? "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><p>Local media permission fixture</p>" : "";
                            return new WebResourceResponse("text/html", "UTF-8", fixture ? 200 : 403, fixture ? "OK" : "Forbidden",
                                Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
                        }
                        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                            return response(request.isForMainFrame() && "GET".equals(request.getMethod()) && url.equals(request.getUrl().toString()));
                        }
                        @Override public WebResourceResponse shouldInterceptRequest(WebView view, String request) {
                            return response(url.equals(request));
                        }
                    });
                    // The interceptor rejects every other URL. Disabling the
                    // network flag avoids older WebView's data: error fallback.
                    view.getSettings().setBlockNetworkLoads(false);
                    view.loadUrl(url);
                    assertTrue(view.getWebChromeClient() instanceof LocalMediaChromeClient); client = (LocalMediaChromeClient) view.getWebChromeClient();
                    originalPermissions = field("permissionLauncher").get(client); originalActivities = field("activityLauncher").get(client);
                    field("permissionLauncher").set(client, permissions); field("activityLauncher").set(client, activities); return null;
                });
                long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
                while (System.nanoTime() < until && !main(() -> activity.isUpdaterForeground() && activity.getBridge().getWebView().isShown() && url.equals(activity.getBridge().getWebView().getUrl()))) Thread.sleep(50);
                assertTrue("Visible trusted fixture loaded", main(() -> activity.isUpdaterForeground() && url.equals(activity.getBridge().getWebView().getUrl())));
            } catch (Throwable failure) { close(); throw failure; }
        }
        Request audio() { return new Request(Uri.parse(activity.getBridge().getLocalUrl()), PermissionRequest.RESOURCE_AUDIO_CAPTURE); }
        Object listener() throws Exception { return field("permissionListener").get(client); }
        void choose(FileResult result, boolean capture) { assertTrue(client.onShowFileChooser(activity.getBridge().getWebView(), result, files(capture))); }
        @Override public void close() throws Exception {
            MainActivity closing = activity;
            try {
                main(() -> {
                    if (client != null) {
                        field("permissionLauncher").set(client, originalPermissions); field("activityLauncher").set(client, originalActivities);
                        closing.getBridge().getWebView().stopLoading(); closing.getBridge().getWebView().getSettings().setJavaScriptEnabled(false);
                        closing.getBridge().getWebView().getSettings().setBlockNetworkLoads(true);
                    }
                    if (closing != null && !closing.isDestroyed()) closing.finishAndRemoveTask();
                    return null;
                });
                if (closing != null) {
                    long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
                    while (System.nanoTime() < until && !main(closing::isDestroyed)) Thread.sleep(50);
                    assertTrue("Fixture Activity fully destroyed before the next singleTask launch", main(closing::isDestroyed));
                }
            } finally {
                main(() -> { if (registered) { application.unregisterActivityLifecycleCallbacks(lifecycle); registered = false; } return null; });
            }
            if (savedHistory != null) {
                SharedPreferences.Editor editor = context.getSharedPreferences("petpal_permission_history_v1", Context.MODE_PRIVATE).edit().clear();
                for (Map.Entry<String, ?> item : savedHistory.entrySet()) {
                    if (item.getValue() instanceof Boolean) editor.putBoolean(item.getKey(), (Boolean) item.getValue());
                    else if (item.getValue() instanceof String) editor.putString(item.getKey(), (String) item.getValue());
                }
                assertTrue("Permission history fixture restored", editor.commit());
            }
        }
    }

    @Test public void cancelledMediaKeepsPermissionOwnershipUntilRealResult() throws Exception {
        try (Session session = new Session()) {
            main(() -> {
                Request first = session.audio(); session.client.onPermissionRequest(first); assertEquals(1, session.permissions.launches);
                Object originalListener = session.listener();
                session.client.onPermissionRequestCanceled(first);
                Request second = session.audio(); session.client.onPermissionRequest(second); assertEquals(1, second.denials); assertEquals(1, session.permissions.launches);
                FileResult capture = new FileResult(); session.choose(capture, true); assertEquals(1, capture.calls); assertNull(capture.value); assertEquals(0, session.activities.launches);
                AtomicBoolean locationDenied = new AtomicBoolean();
                session.client.onGeolocationPermissionsShowPrompt("https://not-an-app.invalid", (origin, allow, retain) -> locationDenied.set(!allow && !retain));
                assertTrue(locationDenied.get()); assertSame("Location cannot replace media runtime callback", originalListener, session.listener());
                permissionResult(originalListener, true); assertEquals(0, first.grants); assertEquals(0, first.denials);
                Request third = session.audio(); session.client.onPermissionRequest(third); assertEquals(2, session.permissions.launches);
                permissionResult(originalListener, false); assertEquals("Late duplicate callback cannot release next request", 0, third.denials);
                Request fourth = session.audio(); session.client.onPermissionRequest(fourth); assertEquals(1, fourth.denials); assertEquals(2, session.permissions.launches);
                permissionResult(session.listener(), false); assertEquals(1, third.denials); return null;
            });
        }
    }

    @Test public void attachmentPermissionAndPickerCannotBeReplacedByMedia() throws Exception {
        try (Session session = new Session()) {
            main(() -> {
                FileResult capture = new FileResult(); session.choose(capture, true);
                assertEquals("Capture requests permission or camera Activity", 1, session.permissions.launches + session.activities.launches);
                Object permissionListener = session.listener();
                Request audio = session.audio(); session.client.onPermissionRequest(audio); assertEquals(1, audio.denials);
                FileResult duplicate = new FileResult(); session.choose(duplicate, true); assertEquals(1, duplicate.calls); assertNull(duplicate.value);
                if (session.permissions.launches > 0) permissionResult(permissionListener, false);
                else activityResult(field("activityListener").get(session.client), new ActivityResult(Activity.RESULT_CANCELED, null));
                assertEquals(1, capture.calls); assertNull(capture.value);
                FileResult picker = new FileResult(); session.choose(picker, false); assertEquals(0, picker.calls);
                Request whilePicking = session.audio(); session.client.onPermissionRequest(whilePicking); assertEquals(1, whilePicking.denials);
                activityResult(field("activityListener").get(session.client), new ActivityResult(Activity.RESULT_CANCELED, null));
                assertEquals(1, picker.calls);
                Request afterPicker = session.audio(); int before = session.permissions.launches; session.client.onPermissionRequest(afterPicker); assertEquals(before + 1, session.permissions.launches);
                permissionResult(session.listener(), false); assertEquals(1, afterPicker.denials); return null;
            });
        }
    }

    @Test public void launchAndBrowserCallbackFailuresReleaseOnlyTheirOwnRequest() throws Exception {
        try (Session session = new Session()) {
            main(() -> {
                session.permissions.fail = true; Request failed = session.audio(); session.client.onPermissionRequest(failed); assertEquals(1, failed.denials);
                session.permissions.fail = false; Request next = session.audio(); session.client.onPermissionRequest(next); assertEquals(2, session.permissions.launches);
                next.failDeny = true;
                permissionResult(session.listener(), false); assertEquals("Stale browser callback is contained", 1, next.denials);
                Request recovered = session.audio(); session.client.onPermissionRequest(recovered); assertEquals(3, session.permissions.launches);
                permissionResult(session.listener(), false); assertEquals(1, recovered.denials);
                session.activities.fail = true; FileResult failedPicker = new FileResult(); session.choose(failedPicker, false); assertEquals(1, failedPicker.calls);
                session.activities.fail = false; FileResult recoveredPicker = new FileResult(); session.choose(recoveredPicker, false); assertEquals(0, recoveredPicker.calls);
                activityResult(field("activityListener").get(session.client), new ActivityResult(Activity.RESULT_CANCELED, null)); assertEquals(1, recoveredPicker.calls);
                return null;
            });
        }
    }

    @Test public void grantedPermissionResultWaitsForActualForegroundResume() throws Exception {
        try (Session session = new Session()) {
            Request request = session.audio();
            Object listener = main(() -> { session.client.onPermissionRequest(request); return session.listener(); });
            assertTrue("Fixture moved to background", main(() -> session.activity.moveTaskToBack(true)));
            long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
            while (System.nanoTime() < until && main(session.activity::isUpdaterForeground)) Thread.sleep(50);
            assertFalse("Activity really paused", main(session.activity::isUpdaterForeground));
            main(() -> { permissionResult(listener, true); assertEquals("Background permission cannot grant browser capture", 0, request.grants); return null; });
            main(() -> {
                session.context.startActivity(new Intent(session.context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
                return null;
            });
            until = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
            while (System.nanoTime() < until && !main(() -> session.activity.isUpdaterForeground() && request.grants == 1)) Thread.sleep(50);
            assertTrue("Only returning to the visible fixture resolves capture", main(() -> session.activity.isUpdaterForeground() && request.grants == 1));
            assertEquals(0, request.denials);
        }
    }

    @Test public void foreignOriginsUnknownResourcesAndOverlayDocumentsNeverPrompt() throws Exception {
        try (Session session = new Session()) {
            main(() -> {
                Request foreign = new Request(Uri.parse("https://not-an-app.invalid"), PermissionRequest.RESOURCE_AUDIO_CAPTURE); session.client.onPermissionRequest(foreign); assertEquals(1, foreign.denials);
                Request unknown = new Request(Uri.parse(session.activity.getBridge().getLocalUrl()), "android.webkit.resource.PROTECTED_MEDIA_ID"); session.client.onPermissionRequest(unknown); assertEquals(1, unknown.denials);
                Request empty = new Request(Uri.parse(session.activity.getBridge().getLocalUrl())); session.client.onPermissionRequest(empty); assertEquals(1, empty.denials);
                assertEquals("Denied origins/resources never launch Android UI", 0, session.permissions.launches);
                WebView foreignView = new WebView(session.context);
                try { FileResult file = new FileResult(); assertTrue(session.client.onShowFileChooser(foreignView, file, files(true))); assertEquals(1, file.calls); assertNull(file.value); }
                finally { foreignView.destroy(); }
                return null;
            });
        }
    }

    @Test public void overlayPendingStartIsCancelledAndStalePermissionCallbackCannotRestartIt() throws Exception {
        try (Session session = new Session()) {
            Assume.assumeFalse("Never stop an independently running companion", PetOverlayService.running);
            main(() -> {
                PetOverlayPlugin overlay = (PetOverlayPlugin) session.activity.getBridge().getPlugin("PetOverlay").getInstance();
                Call pending = new Call("start"); overlayField("pendingStart").set(overlay, pending); overlayField("pendingKind").set(overlay, "anime");
                Call duplicate = new Call("start"); overlay.start(duplicate); assertEquals(1, duplicate.rejects); assertEquals(0, duplicate.resolves);
                Call status = new Call("status"); overlay.status(status); assertEquals(1, status.resolves); assertTrue(status.value.getBoolean("starting"));
                assertTrue("Status explains both runtime/application and channel permission", status.value.has("notifications") && status.value.has("notificationChannel"));
                Call stop = new Call("stop"); overlay.stop(stop); assertEquals(1, pending.rejects); assertEquals(1, stop.resolves); assertFalse(stop.value.getBoolean("running"));
                overlayCallback(overlay, pending); assertNull(overlayField("pendingStart").get(overlay)); assertFalse(PetOverlayService.running);
                Call abandoned = new Call("start"); overlayField("pendingStart").set(overlay, abandoned); overlayField("pendingKind").set(overlay, "anime");
                overlay.handleOnDestroy(); assertEquals(1, abandoned.rejects); assertNull(overlayField("pendingStart").get(overlay));
                overlayCallback(overlay, abandoned); assertFalse("Destroyed/stopped plugin cannot launch a service from late grant", PetOverlayService.running);
                return null;
            });
        }
    }

    @Test public void overlayForegroundGateBlocksBackgroundStatusAndDeferredServiceStart() throws Exception {
        try (Session session = new Session()) {
            Assume.assumeFalse("Never stop an independently running companion", PetOverlayService.running);
            PetOverlayPlugin overlay = main(() -> (PetOverlayPlugin) session.activity.getBridge().getPlugin("PetOverlay").getInstance());
            Call pending = new Call("start");
            main(() -> { overlayField("pendingStart").set(overlay, pending); overlayField("pendingKind").set(overlay, "anime"); overlayField("readyToStart").set(overlay, true); return null; });
            assertTrue(main(() -> session.activity.moveTaskToBack(true)));
            long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
            while (System.nanoTime() < until && main(session.activity::isUpdaterForeground)) Thread.sleep(50);
            assertFalse(main(session.activity::isUpdaterForeground));
            main(() -> {
                Method resume = PetOverlayPlugin.class.getDeclaredMethod("resumeStart"); resume.setAccessible(true); resume.invoke(overlay);
                assertSame("Foreground-only startup remains deferred", pending, overlayField("pendingStart").get(overlay));
                assertFalse(PetOverlayService.running);
                Call status = new Call("status"); overlay.status(status); assertEquals("Background UI operation is rejected", 1, status.rejects);
                Call stop = new Call("stop"); overlay.stop(stop); assertEquals("Stopping remains possible from trusted local page during background cleanup", 1, stop.resolves); assertEquals(1, pending.rejects);
                return null;
            });
        }
    }
}
