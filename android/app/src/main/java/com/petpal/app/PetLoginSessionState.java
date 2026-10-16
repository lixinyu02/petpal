package com.petpal.app;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.concurrent.ConcurrentHashMap;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Only the PetPal session, never a password or official-account OAuth token. */
final class PetLoginSessionState {
    private static final String KEY = "petpal.login-session.v1";
    private static final byte[] AAD = "PetPal Login Session v1".getBytes(StandardCharsets.UTF_8);
    private static final int MAXIMUM = 32768;
    private static final class Gate { long revision; }
    private static final ConcurrentHashMap<String, Gate> GATES = new ConcurrentHashMap<>();
    private final AtomicFile file;
    private final Gate gate;
    PetLoginSessionState(Context context) {
        File path = new File(context.getApplicationContext().getNoBackupFilesDir(), "login-session-v1.enc");
        file = new AtomicFile(path);
        synchronized (GATES) { Gate existing = GATES.get(path.getAbsolutePath()); if (existing == null) { existing = new Gate(); GATES.put(path.getAbsolutePath(), existing); } gate = existing; }
    }
    long reserve() { synchronized (gate) { return ++gate.revision; } }
    private void current(long revision) throws IOException { if (revision != gate.revision) throw new IOException("登录已变化，旧保存已取消。"); }
    private SecretKey key(boolean create) throws Exception {
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore"); keys.load(null);
        if (keys.containsAlias(KEY)) return (SecretKey) keys.getKey(KEY, null);
        if (!create) throw new IOException("设备登录密钥不可用。");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
    private static byte[] readBytes(InputStream input) throws Exception {
        try (InputStream stream = input; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] bytes = new byte[4096]; int count;
            while ((count = stream.read(bytes)) != -1) { if (out.size() + count > MAXIMUM) throw new IOException(); out.write(bytes, 0, count); }
            return out.toByteArray();
        }
    }
    private static JSONObject connection(JSONObject input) throws Exception {
        return new JSONObject().put("url", PetLoginSessionPolicy.url(input.getString("url")))
            .put("token", PetLoginSessionPolicy.token(input.getString("token")))
            .put("credentialKind", PetLoginSessionPolicy.kind(input.getString("credentialKind")))
            .put("target", PetLoginSessionPolicy.target(input.getString("target")));
    }
    JSONObject read() throws Exception {
        synchronized (gate) {
            if (!file.getBaseFile().exists() && !new File(file.getBaseFile().getPath() + ".bak").exists()) return new JSONObject().put("connection", JSONObject.NULL);
            try {
                JSONObject envelope = new JSONObject(new String(readBytes(file.openRead()), StandardCharsets.UTF_8));
                if (envelope.getInt("version") != 1) throw new IOException();
                byte[] iv = Base64.decode(envelope.getString("iv"), Base64.NO_WRAP);
                if (iv.length != 12) throw new IOException();
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, iv)); cipher.updateAAD(AAD);
                JSONObject saved = new JSONObject(new String(cipher.doFinal(Base64.decode(envelope.getString("data"), Base64.NO_WRAP)), StandardCharsets.UTF_8));
                if (saved.getInt("version") != 1) throw new IOException();
                return new JSONObject().put("connection", connection(saved));
            } catch (Exception failure) { throw new IOException("无法读取设备登录，原私有文件已保留，请重新登录。"); }
        }
    }
    void write(JSONObject input, long revision) throws Exception {
        JSONObject next = connection(input).put("version", 1);
        synchronized (gate) {
            current(revision);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key(true)); cipher.updateAAD(AAD);
            JSONObject envelope = new JSONObject().put("version", 1).put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .put("data", Base64.encodeToString(cipher.doFinal(next.toString().getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP));
            byte[] bytes = envelope.toString().getBytes(StandardCharsets.UTF_8); if (bytes.length > MAXIMUM) throw new IOException();
            FileOutputStream stream = null;
            try { stream = file.startWrite(); stream.write(bytes); current(revision); file.finishWrite(stream); }
            catch (Exception failure) { if (stream != null) file.failWrite(stream); throw new IOException("无法安全保存登录，请重试。"); }
        }
    }
    void clear(long revision) throws Exception {
        synchronized (gate) {
            current(revision); file.delete();
            if (file.getBaseFile().exists() || new File(file.getBaseFile().getPath() + ".bak").exists()) throw new IOException("无法清除设备登录，请重试。");
        }
    }
}
