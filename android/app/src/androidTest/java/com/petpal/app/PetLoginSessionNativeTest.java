package com.petpal.app;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.ContextWrapper;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Real Keystore + AtomicFile; synthetic tokens and an isolated no-backup directory. */
@RunWith(AndroidJUnit4.class)
public class PetLoginSessionNativeTest {
    private static final class Fixture implements AutoCloseable {
        final File directory;
        final Context context;
        Fixture() throws Exception {
            Context app = InstrumentationRegistry.getInstrumentation().getTargetContext(); directory = new File(app.getCacheDir(), "login-fixture-" + UUID.randomUUID()); assertTrue(directory.mkdir());
            context = new ContextWrapper(app) { @Override public Context getApplicationContext() { return this; } @Override public File getNoBackupFilesDir() { return directory; } };
        }
        JSONObject login(String token) throws Exception { return new JSONObject().put("url", "https://fixture.invalid").put("token", token).put("credentialKind", "session").put("target", "remote").put("password", "must-not-be-saved"); }
        File saved() { return new File(directory, "login-session-v1.enc"); }
        @Override public void close() throws Exception { for (File file : directory.listFiles()) assertTrue(file.delete()); assertTrue(directory.delete()); }
    }
    @Test public void encryptedSessionSurvivesRuntimeReconstructionWithoutSavingPassword() throws Exception {
        try (Fixture fixture = new Fixture()) {
            PetLoginSessionState first = new PetLoginSessionState(fixture.context); assertTrue(first.read().isNull("connection"));
            first.write(fixture.login("synthetic-native-login-token"), first.reserve());
            String disk = new String(Files.readAllBytes(fixture.saved().toPath()), StandardCharsets.UTF_8);
            assertFalse(disk.contains("synthetic-native-login-token")); assertFalse(disk.contains("fixture.invalid")); assertFalse(disk.contains("must-not-be-saved"));
            JSONObject restored = new PetLoginSessionState(fixture.context).read().getJSONObject("connection");
            assertEquals("synthetic-native-login-token", restored.getString("token")); assertEquals("https://fixture.invalid", restored.getString("url")); assertEquals(4, restored.length()); assertFalse(restored.has("password"));
        }
    }
    @Test public void logoutAndNewerWritesRejectQueuedOldAccountSaves() throws Exception {
        try (Fixture fixture = new Fixture()) {
            PetLoginSessionState first = new PetLoginSessionState(fixture.context), other = new PetLoginSessionState(fixture.context);
            first.write(fixture.login("synthetic-first-token"), first.reserve()); long old = first.reserve();
            other.clear(other.reserve());
            assertThrows(java.io.IOException.class, () -> first.write(fixture.login("synthetic-late-token"), old)); assertTrue(other.read().isNull("connection"));
            long previous = first.reserve(); other.write(fixture.login("synthetic-new-token"), other.reserve());
            assertThrows(java.io.IOException.class, () -> first.write(fixture.login("synthetic-old-token"), previous)); assertEquals("synthetic-new-token", other.read().getJSONObject("connection").getString("token"));
        }
    }
    @Test public void corruptCiphertextIsPreservedAndExplicitReloginCanReplaceIt() throws Exception {
        try (Fixture fixture = new Fixture()) {
            PetLoginSessionState state = new PetLoginSessionState(fixture.context); state.write(fixture.login("synthetic-before-corrupt"), state.reserve());
            byte[] broken = "not-a-valid-encrypted-vault".getBytes(StandardCharsets.UTF_8); Files.write(fixture.saved().toPath(), broken);
            assertThrows(java.io.IOException.class, state::read); assertArrayEquals(broken, Files.readAllBytes(fixture.saved().toPath()));
            state.write(fixture.login("synthetic-new-login"), state.reserve()); assertEquals("synthetic-new-login", state.read().getJSONObject("connection").getString("token"));
            state.clear(state.reserve()); assertFalse(fixture.saved().exists()); assertTrue(new PetLoginSessionState(fixture.context).read().isNull("connection"));
        }
    }
}
