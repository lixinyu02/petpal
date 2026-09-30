package com.petpal.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkRequest;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONObject;

/** Explicitly enabled, visible and stoppable listener; never a desktop executor. */
public class PetTaskNotificationService extends Service {
    static final String RESULT_CHANNEL = "petpal_agent_results", WATCH_CHANNEL = "petpal_agent_listener";
    static final String STOP = "com.petpal.app.STOP_TASK_NOTIFICATIONS", OPEN = "com.petpal.app.OPEN_AGENT_NOTIFICATION";
    static final String TAG_EXTRA = "petpal_notification_tag", EPOCH_EXTRA = "petpal_notification_epoch";
    private static final int WATCH_ID = 52061;
    static volatile boolean running;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Object networkSignal = new Object();
    private Future<?> worker;
    private volatile String activeEpoch;
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkCallback;
    @Override public IBinder onBind(Intent intent) { return null; }
    static void channels(android.content.Context context) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            manager.createNotificationChannel(new NotificationChannel(WATCH_CHANNEL, "后台任务监听", NotificationManager.IMPORTANCE_LOW));
            manager.createNotificationChannel(new NotificationChannel(RESULT_CHANNEL, "Agent 任务结果", NotificationManager.IMPORTANCE_DEFAULT));
        }
    }
    private Notification ongoing() {
        Intent open = new Intent(this, MainActivity.class).putExtra(MainActivity.OPEN_CHAT, true).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent show = PendingIntent.getActivity(this, WATCH_ID, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, WATCH_ID + 1, new Intent(this, PetTaskNotificationService.class).setAction(STOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, WATCH_CHANNEL).setSmallIcon(R.drawable.ic_pet_notification).setContentTitle("小伴正在监听任务结果")
            .setContentText("Agent 完成或失败时提醒。可随时停止后台监听。").setContentIntent(show).setOngoing(true).setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).addAction(R.drawable.ic_pet_notification, "停止提醒", stop).build();
    }
    @Override public void onCreate() {
        super.onCreate(); TaskNotificationState.init(this); channels(this);
        connectivity = getSystemService(ConnectivityManager.class);
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network network) { TaskNotificationState.reconnect(); synchronized (networkSignal) { networkSignal.notifyAll(); } }
        };
        try { connectivity.registerNetworkCallback(new NetworkRequest.Builder().addCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET).build(), networkCallback); }
        catch (Exception ignored) { networkCallback = null; }
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && STOP.equals(intent.getAction())) { disable("disabled", ""); return START_NOT_STICKY; }
        try {
            TaskNotificationState.Snapshot config = TaskNotificationState.snapshot(this);
            if (config == null) { stopSelf(); return START_NOT_STICKY; }
            if (!TaskNotificationState.permission(this)) { disable("permission-denied", "系统通知已关闭，请允许通知后重新开启。"); return START_NOT_STICKY; }
            if (config.expiry <= System.currentTimeMillis()) { disable("expired", "任务提醒凭据已过期，请重新开启。"); return START_NOT_STICKY; }
            if (Build.VERSION.SDK_INT >= 34) startForeground(WATCH_ID, ongoing(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else startForeground(WATCH_ID, ongoing());
            running = true;
            if (!config.epoch.equals(activeEpoch) || worker == null || worker.isDone()) {
                if (worker != null) worker.cancel(true); activeEpoch = config.epoch;
                worker = executor.submit(() -> watch(config.epoch));
            }
            TaskNotificationState.note(config.epoch, "connecting", "");
            return START_STICKY; // System recreation only; no boot receiver or force-stop wakeup.
        } catch (Exception failure) { disable("error", "无法开启后台任务提醒，请返回应用重新开启。"); return START_NOT_STICKY; }
    }
    private void disable(String connection, String message) {
        TaskNotificationState.Snapshot previous = null; try { previous = TaskNotificationState.snapshot(this); } catch (Exception ignored) { }
        TaskNotificationState.clear(connection, message); revoke(previous); stopSelf();
    }
    static void revoke(TaskNotificationState.Snapshot config) {
        if (config == null) return;
        Thread thread = new Thread(() -> {
            HttpsURLConnection connection = null;
            try {
                connection = (HttpsURLConnection) new URL(config.url + "/api/notifications/device").openConnection(); connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(5000); connection.setReadTimeout(5000); connection.setRequestMethod("DELETE"); connection.setRequestProperty("Authorization", "Bearer " + config.token); connection.getResponseCode();
            } catch (Exception ignored) { } finally { if (connection != null) connection.disconnect(); }
        }, "PetPal-notification-revoke"); thread.setDaemon(true); thread.start();
    }
    private static long integer(JSONObject object, String field) throws Exception {
        return TaskNotificationPolicy.parseCursor(object.get(field));
    }
    private JSONObject request(TaskNotificationState.Snapshot config, String path, JSONObject body) throws Exception {
        HttpsURLConnection connection = (HttpsURLConnection) new URL(config.url + path).openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(10000); connection.setReadTimeout(33000);
        connection.setRequestProperty("Authorization", "Bearer " + config.token); connection.setRequestProperty("Accept", "application/json");
        if (!TaskNotificationState.connection(config.epoch, connection)) throw new InterruptedException();
        try {
            if (body != null) {
                connection.setRequestMethod("POST"); connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json");
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8); connection.setFixedLengthStreamingMode(bytes.length);
                try (java.io.OutputStream output = connection.getOutputStream()) { output.write(bytes); }
            }
            int code = connection.getResponseCode();
            if (code == 401 || code == 403) throw new CredentialExpired();
            if (code >= 300 && code < 400) throw new InvalidFeed();
            if (code < 200 || code >= 300) throw new java.io.IOException();
            if (connection.getContentLength() > TaskNotificationPolicy.MAX_RESPONSE_BYTES) throw new InvalidFeed();
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[4096]; int count;
                while ((count = input.read(buffer)) != -1) {
                    if (!TaskNotificationState.matches(config.epoch) || Thread.currentThread().isInterrupted()) throw new InterruptedException();
                    if (bytes.size() + count > TaskNotificationPolicy.MAX_RESPONSE_BYTES) throw new InvalidFeed(); bytes.write(buffer, 0, count);
                }
            }
            try { return new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8)); } catch (Exception malformed) { throw new InvalidFeed(); }
        } finally { TaskNotificationState.disconnect(connection); }
    }
    private void result(String tag, JSONObject route) throws Exception {
        Intent open = new Intent(this, MainActivity.class).setAction(OPEN).setData(Uri.parse("petpal-internal://notification/" + tag))
            .putExtra(TAG_EXTRA, tag).putExtra(EPOCH_EXTRA, route.getString("epoch")).putExtra(MainActivity.OPEN_CHAT, true)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent show = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String title = "completed".equals(route.getString("status")) ? "Agent 任务已完成" : "Agent 任务失败";
        Notification notification = new NotificationCompat.Builder(this, RESULT_CHANNEL).setSmallIcon(R.drawable.ic_pet_notification).setContentTitle(title).setContentText("点击查看任务结果")
            .setContentIntent(show).setAutoCancel(true).setOnlyAlertOnce(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(new NotificationCompat.Builder(this, RESULT_CHANNEL).setSmallIcon(R.drawable.ic_pet_notification).setContentTitle("小伴有新的任务结果").build()).build();
        getSystemService(NotificationManager.class).notify(tag, 0, notification);
    }
    private void watch(String epoch) {
        long delay = 1000, acknowledgedCursor = -1;
        while (TaskNotificationState.matches(epoch) && !Thread.currentThread().isInterrupted()) {
            try {
                TaskNotificationState.Snapshot config = TaskNotificationState.snapshot(this); if (config == null || !config.epoch.equals(epoch)) break;
                if (config.expiry <= System.currentTimeMillis()) throw new CredentialExpired();
                if (!TaskNotificationState.permission(this)) { TaskNotificationState.clearIf(epoch, "permission-denied", "系统通知已关闭，请重新开启提醒。"); revoke(config); break; }
                JSONObject feed = request(config, "/api/notifications/device/feed?after=" + config.cursor + "&wait=25&limit=50", null);
                if (!TaskNotificationState.matches(epoch)) break;
                if (!config.deviceId.equals(feed.getString("deviceId")) || !config.instanceId.equals(feed.getString("instanceId")) || !config.userId.equals(feed.getString("userId"))) throw new InvalidFeed();
                if (!(feed.get("resetRequired") instanceof Boolean)) throw new InvalidFeed();
                long next = integer(feed, "nextCursor"), high = integer(feed, "highWater"), minimum = integer(feed, "minCursor"); boolean reset = feed.getBoolean("resetRequired");
                TaskNotificationPolicy.feedRange(config.cursor, next, high, minimum, reset);
                if (TaskNotificationPolicy.expires(feed.getString("expiresAt")) <= System.currentTimeMillis()) throw new CredentialExpired();
                JSONArray events = feed.getJSONArray("events"); if (events.length() > 50) throw new InvalidFeed();
                if (reset) { TaskNotificationState.clearIf(epoch, "reset-required", "离线过久，有部分提醒已过期，请重新开启建立新基线。"); revoke(config); break; }
                long previous = config.cursor;
                // Validate the complete batch before posting any event.
                for (int index = 0; index < events.length(); index++) {
                    JSONObject event = events.getJSONObject(index); long seq = integer(event, "seq"); TaskNotificationPolicy.eventSequence(previous, seq, next); previous = seq;
                    for (String field : new String[] { "id", "conversationId", "agentConversationId", "runId" }) TaskNotificationPolicy.id(event.getString(field));
                    TaskNotificationPolicy.outcome(event.getString("status")); TaskNotificationPolicy.source(event.getString("source")); TaskNotificationPolicy.expires(event.getString("createdAt"));
                }
                TaskNotificationPolicy.feedEnd(previous, next);
                for (int index = 0; index < events.length(); index++) TaskNotificationState.deliver(epoch, events.getJSONObject(index), this::result);
                TaskNotificationState.advance(epoch, next);
                if (!TaskNotificationState.matches(epoch)) break;
                if (next > acknowledgedCursor) { request(config, "/api/notifications/device/ack", new JSONObject().put("cursor", next)); acknowledgedCursor = next; }
                TaskNotificationState.note(epoch, "connected", ""); delay = 1000;
            } catch (CredentialExpired expired) { TaskNotificationState.clearIf(epoch, "expired", "任务提醒登录已失效，请重新开启。"); break; }
            catch (InterruptedException stopped) { Thread.currentThread().interrupt(); break; }
            catch (IllegalArgumentException | org.json.JSONException | InvalidFeed invalid) { TaskNotificationState.clearIf(epoch, "error", "任务提醒接口返回无效数据，请检查服务后重新开启。"); break; }
            catch (Exception unavailable) {
                if (!TaskNotificationState.matches(epoch) || Thread.currentThread().isInterrupted()) break;
                TaskNotificationState.note(epoch, "reconnecting", "网络暂时不可用，正在重连。");
                try { synchronized (networkSignal) { networkSignal.wait(delay); } } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); break; }
                delay = Math.min(60000, delay * 2);
            }
        }
        if (epoch.equals(activeEpoch)) stopSelf();
    }
    private static final class CredentialExpired extends Exception { }
    private static final class InvalidFeed extends Exception { }
    @Override public void onDestroy() {
        activeEpoch = null; if (worker != null) worker.cancel(true); TaskNotificationState.reconnect(); executor.shutdownNow(); running = false;
        if (networkCallback != null) try { connectivity.unregisterNetworkCallback(networkCallback); } catch (Exception ignored) { }
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true); super.onDestroy();
    }
}
