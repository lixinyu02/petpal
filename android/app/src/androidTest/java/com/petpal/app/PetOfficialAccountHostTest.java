package com.petpal.app;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.ContextWrapper;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Host attachment lifetime only. Does not load credentials or perform official login. */
@RunWith(AndroidJUnit4.class)
public class PetOfficialAccountHostTest {
    @Test public void applicationRuntimeSurvivesUiReplacementAndOldDetachCannotRemoveNewOpener() {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        PetOfficialAccountHost host = PetOfficialAccountHost.get(app);
        PetOfficialAccountRuntime runtime = host.runtime();
        PetOfficialAccountHost.Binding first = host.attach(url -> {}, () -> {});
        assertTrue(first.isCurrentBrowser());
        PetOfficialAccountHost.Binding replacement = host.attach(url -> {}, () -> {});
        try {
            assertFalse(first.isCurrentBrowser()); assertTrue(replacement.isCurrentBrowser());
            first.detach(); first.detach();
            assertTrue(replacement.isCurrentBrowser());
            assertSame(host, PetOfficialAccountHost.get(new ContextWrapper(app)));
            assertSame(runtime, host.runtime()); assertSame(host, PetOfficialAccountHost.existing());
        } finally { first.detach(); replacement.detach(); }
        assertFalse(replacement.isCurrentBrowser());
        assertSame(runtime, PetOfficialAccountHost.get(app).runtime());
    }
}
