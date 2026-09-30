package com.petpal.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;
import org.json.JSONObject;

/** Process-wide generation gate and encrypted state shared by Activity and Service. */
final class TaskNotificationState {
    interface Listener { void changed(String event); }
    interface Poster { void post(String tag, JSONObject route) throws Exception; }
    static final class Snapshot {
        final String url, token, deviceId, instanceId, userId, epoch, expiresAt;
        final long cursor, expiry;
        Snapshot(JSONObject value) throws Exception {
            url = TaskNotificationPolicy.baseUrl(value.getString("url")); token = TaskNotificationPolicy.token(value.getString("token"));
            deviceId = TaskNotificationPolicy.deviceId(value.getString("deviceId")); instanceId = TaskNotificationPolicy.id(value.getString("instanceId")); userId = TaskNotificationPolicy.id(value.getString("userId"));
            epoch = TaskNotificationPolicy.deviceId(value.getString("epoch")); cursor = TaskNotificationPolicy.cursor(value.getLong("cursor"));
            expiresAt = value.getString("expiresAt"); expiry = TaskNotificationPolicy.expires(expiresAt);
        }
    }
    private static final String PREFS = "petpal_task_notifications_v1", KEY = "PetPal.TaskNotifications.v1";
    private static final byte[] AAD = "com.petpal.app/task-notifications/v1".getBytes(StandardCharsets.UTF_8);
    private static Context context;
    private static boolean loaded;
    private static JSONObject state;
    private static long generation;
    private static HttpURLConnection activeConnection;
    private static String connection = "disabled", message = "";
    private static WeakReference<Listener> listener = new WeakReference<>(null);
    private TaskNotificationState() { }
    static synchronized void listen(Listener value) { listener = new WeakReference<>(value); }
    private static void emit(String event) { new Handler(Looper.getMainLooper()).post(() -> { Listener target = listener.get(); if (target != null) target.changed(event); }); }
    private static SharedPreferences prefs() { return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    private static SecretKey key(boolean create) throws Exception {
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore"); keys.load(null);
        if (keys.containsAlias(KEY)) return (SecretKey) keys.getKey(KEY, null);
        if (!create) throw new IllegalStateException("通知凭据已清除。");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
    static synchronized void init(Context value) {
        context = value.getApplicationContext(); if (loaded) return; loaded = true;
        try {
            String saved = prefs().getString("vault", null); if (saved == null) return;
            JSONObject envelope = new JSONObject(saved); Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, Base64.decode(envelope.getString("iv"), Base64.NO_WRAP))); cipher.updateAAD(AAD);
            state = new JSONObject(new String(cipher.doFinal(Base64.decode(envelope.getString("data"), Base64.NO_WRAP)), StandardCharsets.UTF_8));
            Snapshot snapshot = new Snapshot(state); if (snapshot.expiry <= System.currentTimeMillis()) { clear("expired", "任务提醒凭据已过期，请重新开启。"); return; }
            connection = "idle";
        } catch (Exception failure) { clear("error", "任务提醒凭据无法恢复，请重新开启。"); }
    }
    private static void persist(JSONObject next) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key(true)); cipher.updateAAD(AAD);
        JSONObject envelope = new JSONObject().put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
            .put("data", Base64.encodeToString(cipher.doFinal(next.toString().getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP));
        if (!prefs().edit().putString("vault", envelope.toString()).commit()) throw new IllegalStateException("无法保存任务提醒状态。");
        state = next;
    }
    static synchronized String installation(Context value) { init(value); String id = prefs().getString("installation", null); if (id == null) { id = UUID.randomUUID().toString(); if (!prefs().edit().putString("installation", id).commit()) throw new IllegalStateException("无法保存通知设备标识。"); } return TaskNotificationPolicy.deviceId(id); }
    static synchronized long generation(Context value) { init(value); return generation; }
    static synchronized Snapshot snapshot(Context value) throws Exception { init(value); return state == null ? null : new Snapshot(state); }
    static synchronized boolean matches(String epoch) { return state != null && epoch.equals(state.optString("epoch")); }
    static synchronized Snapshot activate(Context value, JSONObject input, long expected) throws Exception {
        init(value); if (!TaskNotificationPolicy.generationMatches(generation, expected)) throw new IllegalStateException("登录已变化，请重新开启提醒。");
        JSONObject next = new JSONObject(input.toString()).put("epoch", UUID.randomUUID().toString()).put("routes", new JSONArray());
        Snapshot config = new Snapshot(next);
        if (!installation(value).equals(config.deviceId) || config.expiry <= System.currentTimeMillis()) throw new IllegalStateException("通知凭据已失效，请重新开启提醒。");
        clear("disabled", ""); persist(next); connection = "connecting"; message = ""; emit("status");
        return config;
    }
    static synchronized void clear(String nextConnection, String nextMessage) {
        ++generation; state = null; if (activeConnection != null) activeConnection.disconnect(); activeConnection = null;
        connection = nextConnection; message = nextMessage;
        if (context != null) {
            // Delete the key as well: a failed preference deletion cannot resurrect credentials.
            try { KeyStore keys = KeyStore.getInstance("AndroidKeyStore"); keys.load(null); keys.deleteEntry(KEY); } catch (Exception ignored) { }
            prefs().edit().remove("vault").commit();
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager != null) for (android.service.notification.StatusBarNotification item : manager.getActiveNotifications()) if (item.getTag() != null && item.getTag().startsWith("petpal-agent-")) manager.cancel(item.getTag(), 0);
        }
        emit("status");
    }
    static synchronized void clearIf(String epoch, String nextConnection, String nextMessage) { if (matches(epoch)) clear(nextConnection, nextMessage); }
    static synchronized boolean connection(String epoch, HttpURLConnection value) { if (!matches(epoch)) { value.disconnect(); return false; } activeConnection = value; return true; }
    static synchronized void disconnect(HttpURLConnection value) { if (activeConnection == value) activeConnection = null; value.disconnect(); }
    static synchronized void reconnect() { if (activeConnection != null) activeConnection.disconnect(); }
    static synchronized void note(String epoch, String nextConnection, String nextMessage) { if (matches(epoch)) { connection = nextConnection; message = nextMessage; emit("status"); } }
    static synchronized void permissionAsked(Context value) { init(value); prefs().edit().putBoolean("permission_requested", true).commit(); }
    static boolean permission(Context value) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(value, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        if (!NotificationManagerCompat.from(value).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= 26) { android.app.NotificationChannel channel = value.getSystemService(NotificationManager.class).getNotificationChannel(PetTaskNotificationService.RESULT_CHANNEL); if (channel != null && channel.getImportance() == NotificationManager.IMPORTANCE_NONE) return false; }
        return true;
    }
    static synchronized JSONObject status(Context value) throws Exception {
        Snapshot config = snapshot(value); String permission = permission(value) ? "granted" : Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(value, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED && !prefs().getBoolean("permission_requested", false) ? "prompt" : "denied";
        JSONObject result = new JSONObject().put("enabled", config != null).put("running", PetTaskNotificationService.running).put("permission", permission).put("connection", connection);
        if (!message.isEmpty()) result.put("error", message);
        if (config != null) result.put("url", config.url).put("deviceId", config.deviceId).put("instanceId", config.instanceId).put("userId", config.userId).put("cursor", config.cursor).put("expiresAt", config.expiresAt);
        return result;
    }
    static synchronized void deliver(String epoch, JSONObject event, Poster poster) throws Exception {
        if (!matches(epoch)) return;
        Snapshot config = new Snapshot(state); long sequence = event.getLong("seq"); if (sequence <= config.cursor) return;
        JSONObject next = new JSONObject(state.toString()), route = new JSONObject().put("seq", TaskNotificationPolicy.cursor(sequence))
            .put("id", TaskNotificationPolicy.id(event.getString("id"))).put("conversationId", TaskNotificationPolicy.id(event.getString("conversationId")))
            .put("agentConversationId", TaskNotificationPolicy.id(event.getString("agentConversationId"))).put("runId", TaskNotificationPolicy.id(event.getString("runId")))
            .put("status", TaskNotificationPolicy.outcome(event.getString("status"))).put("source", TaskNotificationPolicy.source(event.getString("source")))
            .put("createdAt", event.getString("createdAt")).put("epoch", epoch).put("instanceId", config.instanceId).put("userId", config.userId);
        TaskNotificationPolicy.expires(route.getString("createdAt"));
        String tag = TaskNotificationPolicy.tag(config.instanceId, config.userId, event.getString("id")); route.put("tag", tag);
        JSONArray routes = next.getJSONArray("routes"); boolean seen = false;
        for (int index = 0; index < routes.length(); index++) if (tag.equals(routes.getJSONObject(index).getString("tag"))) { seen = true; break; }
        final boolean prepared = seen;
        TaskNotificationDelivery.deliver(config.cursor, sequence, () -> {
            if (!prepared) {
                if (routes.length() >= 100) { String oldest = routes.getJSONObject(0).getString("tag"); routes.remove(0); context.getSystemService(NotificationManager.class).cancel(oldest, 0); }
                routes.put(route); persist(next);
            }
        }, () -> poster.post(tag, route), () -> { next.put("cursor", sequence); persist(next); });
    }
    static synchronized void advance(String epoch, long cursor) throws Exception { if (matches(epoch) && cursor > state.getLong("cursor")) persist(new JSONObject(state.toString()).put("cursor", TaskNotificationPolicy.cursor(cursor))); }
    static synchronized void capture(Context value, String tag, String epoch) throws Exception {
        init(value); if (tag == null || epoch == null || !matches(epoch)) return;
        Snapshot config = new Snapshot(state); JSONArray routes = state.getJSONArray("routes");
        for (int index = 0; index < routes.length(); index++) {
            JSONObject route = routes.getJSONObject(index);
            if (tag.equals(route.getString("tag")) && TaskNotificationPolicy.scopeMatches(route.optString("epoch", null), config.epoch,
                route.optString("instanceId", null), config.instanceId, route.optString("userId", null), config.userId)) {
                persist(new JSONObject(state.toString()).put("pending", tag)); emit("navigation"); return;
            }
        }
    }
    static synchronized JSONObject consume(Context value, String instance, String user) throws Exception {
        Snapshot config = snapshot(value); if (config == null || !config.instanceId.equals(instance) || !config.userId.equals(user)) return new JSONObject();
        String pending = state.optString("pending", ""); JSONArray routes = state.getJSONArray("routes");
        for (int index = 0; index < routes.length(); index++) { JSONObject route = routes.getJSONObject(index); if (pending.equals(route.getString("tag"))
            && TaskNotificationPolicy.scopeMatches(route.optString("epoch", null), config.epoch, route.optString("instanceId", null), instance, route.optString("userId", null), user)) {
            JSONObject navigation = new JSONObject().put("conversationId", TaskNotificationPolicy.id(route.getString("conversationId"))).put("agentConversationId", TaskNotificationPolicy.id(route.getString("agentConversationId")))
                .put("runId", TaskNotificationPolicy.id(route.getString("runId"))).put("eventId", TaskNotificationPolicy.id(route.getString("id"))).put("source", TaskNotificationPolicy.source(route.getString("source")));
            JSONObject next = new JSONObject(state.toString()); next.remove("pending"); persist(next); return new JSONObject().put("navigation", navigation);
        } }
        return new JSONObject();
    }
}
