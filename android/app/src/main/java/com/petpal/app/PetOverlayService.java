package com.petpal.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.core.app.NotificationCompat;

public class PetOverlayService extends Service {
    public static volatile boolean running = false;
    public static volatile String companionKind = "anime";
    public static final String COMPANION_KIND = "com.petpal.app.COMPANION_KIND";
    private static final String CHANNEL = "petpal_companion";
    private static final String STOP = "com.petpal.app.STOP_OVERLAY";
    private WindowManager manager;
    private FrameLayout overlay;
    private PetOverlayWebView companion;
    private WindowManager.LayoutParams layout;
    private BroadcastReceiver screenReceiver;
    private float startX, startY;
    private int originX, originY;

    @Override public IBinder onBind(Intent intent) { return null; }

    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private Intent chatIntent() {
        return new Intent(this, MainActivity.class).putExtra(MainActivity.OPEN_CHAT, true)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if ((intent != null && STOP.equals(intent.getAction())) || !Settings.canDrawOverlays(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        String requestedKind = OverlayAssetPolicy.normalizeCompanionKind(intent == null ? null : intent.getStringExtra(COMPANION_KIND));
        if (overlay != null) {
            if (companion != null && !requestedKind.equals(companionKind)) {
                companionKind = requestedKind;
                companion.startCompanion(companionKind);
            }
            return START_NOT_STICKY;
        }
        companionKind = requestedKind;
        NotificationManager notifications = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) notifications.createNotificationChannel(
            new NotificationChannel(CHANNEL, "小伴桌宠", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 1, chatIntent(),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 2, new Intent(this, PetOverlayService.class).setAction(STOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_pet_notification)
            .setContentTitle("小伴正在陪你")
            .setContentText("轻点伙伴互动，拖动顶部把手移动，点击聊打开聊天。")
            .setContentIntent(open).setOngoing(true)
            .addAction(R.drawable.ic_pet_notification, "停止桌宠", stop)
            .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(11, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(11, notification);
        manager = getSystemService(WindowManager.class);
        int width = dp(184), height = dp(232);
        layout = new WindowManager.LayoutParams(width, height,
            Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT);
        layout.gravity = Gravity.TOP | Gravity.START;
        layout.x = Math.max(0, getResources().getDisplayMetrics().widthPixels - width);
        layout.y = dp(140);
        try {
            overlay = new FrameLayout(this);
            overlay.setBackgroundColor(Color.TRANSPARENT);
            companion = new PetOverlayWebView(this, this::stopSelf);
            FrameLayout.LayoutParams sceneLayout = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, height - dp(28));
            sceneLayout.topMargin = dp(28);
            overlay.addView(companion, sceneLayout);

            TextView handle = button("···", "拖动把手移动小伴");
            FrameLayout.LayoutParams handleLayout = new FrameLayout.LayoutParams(dp(64), dp(28), Gravity.TOP | Gravity.CENTER_HORIZONTAL);
            overlay.addView(handle, handleLayout);
            handle.setOnTouchListener((view, event) -> {
                switch (event.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        startX = event.getRawX(); startY = event.getRawY();
                        originX = layout.x; originY = layout.y;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        layout.x = Math.max(0, Math.min(getResources().getDisplayMetrics().widthPixels - width, originX + Math.round(event.getRawX() - startX)));
                        layout.y = Math.max(0, Math.min(getResources().getDisplayMetrics().heightPixels - height, originY + Math.round(event.getRawY() - startY)));
                        try { manager.updateViewLayout(overlay, layout); } catch (IllegalArgumentException ignored) { }
                        return true;
                    case MotionEvent.ACTION_UP:
                        view.performClick();
                        return true;
                    case MotionEvent.ACTION_CANCEL:
                        return true;
                    default: return false;
                }
            });
            TextView chat = button("聊", "打开小伴聊天");
            FrameLayout.LayoutParams chatLayout = new FrameLayout.LayoutParams(dp(32), dp(28), Gravity.TOP | Gravity.END);
            overlay.addView(chat, chatLayout);
            chat.setOnClickListener(view -> startActivity(chatIntent()));
            manager.addView(overlay, layout);
            companion.startCompanion(companionKind);
            running = true;
            screenReceiver = new BroadcastReceiver() {
                @Override public void onReceive(Context context, Intent event) {
                    if (companion == null) return;
                    boolean screenOff = Intent.ACTION_SCREEN_OFF.equals(event.getAction());
                    companion.setVisibility(screenOff ? View.INVISIBLE : View.VISIBLE);
                    if (screenOff) companion.onPause(); else companion.onResume();
                }
            };
            IntentFilter screenEvents = new IntentFilter(Intent.ACTION_SCREEN_OFF);
            screenEvents.addAction(Intent.ACTION_SCREEN_ON);
            screenEvents.addAction(Intent.ACTION_USER_PRESENT);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(screenReceiver, screenEvents, Context.RECEIVER_NOT_EXPORTED);
            else registerReceiver(screenReceiver, screenEvents);
        } catch (RuntimeException error) { stopSelf(); }
        return START_NOT_STICKY;
    }

    private TextView button(String label, String description) {
        TextView control = new TextView(this);
        control.setText(label);
        control.setTextSize(16);
        control.setTextColor(Color.rgb(35, 79, 69));
        control.setGravity(Gravity.CENTER);
        control.setContentDescription(description);
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.argb(225, 247, 246, 242));
        background.setCornerRadius(dp(14));
        control.setBackground(background);
        return control;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (screenReceiver != null) {
            try { unregisterReceiver(screenReceiver); } catch (IllegalArgumentException ignored) { }
            screenReceiver = null;
        }
        if (overlay != null && manager != null) {
            try { manager.removeView(overlay); } catch (IllegalArgumentException ignored) { }
        }
        if (companion != null) {
            if (overlay != null) overlay.removeView(companion);
            companion.releaseCompanion();
        }
        companion = null;
        overlay = null;
        stopForeground(true);
        super.onDestroy();
    }
}
