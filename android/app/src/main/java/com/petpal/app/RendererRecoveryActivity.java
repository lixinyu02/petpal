package com.petpal.app;

import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

/** Internal native fallback: it must remain usable without any WebView. */
public final class RendererRecoveryActivity extends AppCompatActivity {
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    @Override public void onCreate(Bundle savedInstanceState) {
        ScreenInsetsController.prepareAppearance(this);
        super.onCreate(savedInstanceState);
        boolean night = "night".equals(ScreenInsetsController.currentTheme(ScreenInsetsController.savedPreference(this)));
        int background = Color.parseColor(night ? "#282828" : "#fafbf8");
        int foreground = Color.parseColor(night ? "#f0eeeb" : "#32312e");
        getWindow().setBackgroundDrawable(new ColorDrawable(background));
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.setBackgroundColor(background);
        LinearLayout content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL); content.setGravity(Gravity.CENTER_VERTICAL);
        scroll.addView(content, new ScrollView.LayoutParams(-1, -1));
        ViewCompat.setOnApplyWindowInsetsListener(scroll, (view, insets) -> {
            Insets safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            content.setPadding(dp(28) + safe.left, dp(28) + safe.top, dp(28) + safe.right, dp(28) + safe.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        TextView title = new TextView(this); title.setText("界面暂时无法显示"); title.setTextSize(24); title.setTextColor(foreground); title.setTypeface(null, Typeface.BOLD);
        content.addView(title);
        TextView description = new TextView(this); description.setText("可以重新打开小伴。已保存的登录和聊天不会被清除。"); description.setTextSize(16); description.setTextColor(foreground); description.setPadding(0, dp(18), 0, dp(22));
        content.addView(description);
        Button retry = new Button(this); retry.setText("重新打开小伴"); retry.setContentDescription("重新打开小伴"); retry.setMinHeight(dp(48));
        retry.setOnClickListener(view -> { MainActivity.retryRendererByUser(); startActivity(new Intent(this, MainActivity.class)); finish(); });
        content.addView(retry, new LinearLayout.LayoutParams(-1, -2));
        Button close = new Button(this); close.setText("关闭页面"); close.setMinHeight(dp(48)); close.setOnClickListener(view -> finish());
        content.addView(close, new LinearLayout.LayoutParams(-1, -2));
        setContentView(scroll); ViewCompat.requestApplyInsets(scroll);
    }
}
