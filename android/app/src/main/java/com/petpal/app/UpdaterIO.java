package com.petpal.app;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** Bounded, cancellable streaming verification; never retains an APK in memory. */
public final class UpdaterIO {
    public interface Checkpoint { void check() throws IOException; }
    public interface Progress { void received(long count); }
    private UpdaterIO() { }
    public static String hex(byte[] bytes) { StringBuilder out = new StringBuilder(); for (byte value : bytes) out.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff)); return out.toString(); }
    public static MessageDigest sha256() { try { return MessageDigest.getInstance("SHA-256"); } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); } }
    public static long copyVerified(InputStream source, OutputStream destination, long expectedBytes, String expectedSha, Checkpoint checkpoint, Progress progress) throws IOException {
        if (expectedBytes < 1 || expectedBytes > UpdaterPolicy.MAX_BYTES || expectedSha == null || !expectedSha.matches("[0-9a-fA-F]{64}")) throw new IOException("更新校验信息无效。");
        MessageDigest hash = sha256(); byte[] buffer = new byte[64 * 1024]; long count = 0;
        while (true) {
            checkpoint.check(); int read = source.read(buffer); checkpoint.check();
            if (read == -1) break;
            if (read == 0) continue;
            count += read;
            if (count > expectedBytes || count > UpdaterPolicy.MAX_BYTES) throw new IOException("更新文件超过声明大小。");
            hash.update(buffer, 0, read); destination.write(buffer, 0, read); progress.received(count);
        }
        if (count != expectedBytes || !hex(hash.digest()).equalsIgnoreCase(expectedSha)) throw new IOException("更新文件大小或 SHA-256 校验失败。");
        checkpoint.check(); return count;
    }
}
