package com.petpal.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import androidx.core.app.NotificationCompat;

/** Temporary protection for a user-started loopback OAuth wait, never a model relay. */
public final class PetOfficialAccountService extends Service {
    static final String START = "com.petpal.app.START_OFFICIAL_AUTHORIZATION";
    static final String CANCEL = "com.petpal.app.CANCEL_OFFICIAL_AUTHORIZATION";
    static final String OPEN_SETTINGS = "com.petpal.app.OPEN_OFFICIAL_ACCOUNT";
    static final String ATTEMPT_ID = "petpal_official_attempt";
    private static final String CHANNEL = "petpal_official_authorization";
    private static final int NOTICE_ID = 52081;
    // Accessed only on the main thread; cleared before onDestroy finishes.
    private static PetOfficialAccountService current;
    private final Handler main = new Handler(Looper.getMainLooper());
    private String activeAttemptId;
    private int latestStartId;
    private boolean foreground;
    private final Runnable check = this::checkPending;

    static void reconcileCurrent() { if (current != null) current.checkPending(); }
    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onCreate() {
        super.onCreate(); current = this;
        if (Build.VERSION.SDK_INT >= 26) getSystemService(NotificationManager.class).createNotificationChannel(
            new NotificationChannel(CHANNEL, "官方账号授权", NotificationManager.IMPORTANCE_LOW));
    }

    private PetOfficialAccountRuntime existingRuntime() {
        PetOfficialAccountHost host = PetOfficialAccountHost.existing();
        return host == null ? null : host.runtime();
    }

    private Notification ongoing(String id) {
        Intent open = new Intent(this, MainActivity.class).setAction(OPEN_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent show = PendingIntent.getActivity(this, NOTICE_ID, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        // Intent identity includes the random attempt; an old notification cannot cancel a newer login.
        Intent cancel = new Intent(this, PetOfficialAccountService.class).setAction(CANCEL)
            .setData(Uri.parse("petpal-internal://official-cancel/" + Uri.encode(id))).putExtra(ATTEMPT_ID, id);
        PendingIntent stop = PendingIntent.getService(this, 0, cancel, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_pet_notification)
            .setContentTitle("小伴正在等待官方账号授权").setContentText("完成浏览器授权后返回小伴；也可取消本次登录。")
            .setContentIntent(show).setOngoing(true).setOnlyAlertOnce(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .addAction(R.drawable.ic_pet_notification, "取消登录", stop).build();
    }

    private void protect(String id) {
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTICE_ID, ongoing(id), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(NOTICE_ID, ongoing(id));
        foreground = true; activeAttemptId = id;
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        latestStartId = startId;
        PetOfficialAccountRuntime runtime = existingRuntime();
        String requested = intent == null ? null : intent.getStringExtra(ATTEMPT_ID);
        if (runtime == null) { stopSelfResult(startId); return START_NOT_STICKY; }
        if (intent != null && CANCEL.equals(intent.getAction())) {
            if (requested != null) runtime.cancelAttempt(requested, "已取消官方账号登录。");
            checkPending(); return START_NOT_STICKY;
        }
        String pending = runtime.pendingAttemptId();
        if (intent == null || !START.equals(intent.getAction()) || requested == null || !requested.equals(pending)) {
            // A delayed start for a finished attempt may arrive after its successor.
            if (foreground) checkPending(); else stopSelfResult(startId);
            return START_NOT_STICKY;
        }
        try { protect(pending); checkPending(); }
        catch (Exception unavailable) {
            runtime.cancelAttempt(requested, "无法保持官方授权等待，请返回小伴后重新登录。"); stopSelfResult(startId);
        }
        return START_NOT_STICKY;
    }

    private void checkPending() {
        main.removeCallbacks(check);
        PetOfficialAccountRuntime runtime = existingRuntime();
        String pending = runtime == null ? null : runtime.pendingAttemptId();
        if (pending == null) { stopSelfResult(latestStartId); return; }
        if (!foreground) { if (latestStartId > 0) stopSelfResult(latestStartId); return; }
        if (!pending.equals(activeAttemptId)) {
            try { protect(pending); }
            catch (Exception unavailable) {
                runtime.cancelAttempt(pending, "官方授权等待已中断，请返回小伴后重新登录。"); stopSelfResult(latestStartId); return;
            }
        }
        main.postDelayed(check, 1000);
    }

    @Override public void onDestroy() {
        if (current == this) current = null;
        main.removeCallbacks(check);
        PetOfficialAccountRuntime runtime = existingRuntime();
        // Matching cancellation is harmless after normal completion and never closes a newer relay.
        if (runtime != null && activeAttemptId != null) runtime.cancelAttempt(activeAttemptId, "系统已中断官方授权等待，请重新登录。");
        activeAttemptId = null; foreground = false;
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        super.onDestroy();
    }
}
