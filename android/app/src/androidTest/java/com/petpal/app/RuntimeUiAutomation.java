package com.petpal.app;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.UiAutomation;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import static org.junit.Assert.*;

/** Test-only window observer. It never reads text, grants permissions or changes product guards. */
final class RuntimeUiAutomation implements AutoCloseable {
    private final UiAutomation automation;
    private final int originalFlags;
    RuntimeUiAutomation() {
        // Connect before opening a system window, so its first accessibility
        // event cannot precede the test service's registration on API35.
        automation = InstrumentationRegistry.getInstrumentation().getUiAutomation();
        AccessibilityServiceInfo info = automation.getServiceInfo();
        assertNotNull("Native test automation service is connected", info);
        originalFlags = info.flags;
        info.flags |= AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS | AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
        automation.setServiceInfo(info);
        android.util.Log.i("PetPalRuntimeWindows", "beforeFlags=" + originalFlags + ", testFlags=" + info.flags);
    }
    static String describe() {
        try {
            UiAutomation automation = InstrumentationRegistry.getInstrumentation().getUiAutomation();
            JSONObject result = new JSONObject().put("flags", automation.getServiceInfo().flags);
            AccessibilityNodeInfo active = automation.getRootInActiveWindow();
            if (active == null) result.put("activeRoot", JSONObject.NULL);
            else try { result.put("activeRoot", node(active)); } finally { active.recycle(); }
            JSONArray windows = new JSONArray();
            for (AccessibilityWindowInfo window : automation.getWindows()) {
                try {
                    JSONObject item = new JSONObject().put("id", window.getId()).put("type", window.getType())
                        .put("active", window.isActive()).put("focused", window.isFocused());
                    AccessibilityNodeInfo root = window.getRoot();
                    if (root != null) try { item.put("root", node(root)); } finally { root.recycle(); }
                    windows.put(item);
                } finally { window.recycle(); }
            }
            return result.put("windows", windows).toString();
        } catch (Exception failure) { return "Window diagnostic unavailable: " + failure.getClass().getSimpleName(); }
    }
    private static JSONObject node(AccessibilityNodeInfo node) throws Exception {
        return new JSONObject().put("package", String.valueOf(node.getPackageName())).put("windowId", node.getWindowId())
            .put("resourceIdPresent", node.getViewIdResourceName() != null).put("children", node.getChildCount());
    }
    @Override public void close() {
        AccessibilityServiceInfo info = automation.getServiceInfo();
        assertNotNull("Native test automation remains connected for cleanup", info);
        info.flags = originalFlags; automation.setServiceInfo(info);
        assertEquals("Test observer restores the previous service flags", originalFlags, automation.getServiceInfo().flags);
        android.util.Log.i("PetPalRuntimeWindows", "restoredFlags=" + originalFlags);
    }
}
