package com.petpal.app;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
import static org.junit.Assert.*;

public class UpdaterIOTest {
    private final byte[] payload = "verified test apk fixture".getBytes(java.nio.charset.StandardCharsets.UTF_8);
    private String hash(byte[] value) { return UpdaterIO.hex(UpdaterIO.sha256().digest(value)); }
    @Test public void writesOnlyMatchingBytesAndReportsActualProgress() throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream(); final long[] seen = {0};
        assertEquals(payload.length, UpdaterIO.copyVerified(new ByteArrayInputStream(payload), output, payload.length, hash(payload), () -> {}, count -> seen[0] = count));
        assertArrayEquals(payload, output.toByteArray()); assertEquals(payload.length, seen[0]);
    }
    @Test public void rejectsWrongDigestAndTruncatedData() {
        assertThrows(IOException.class, () -> UpdaterIO.copyVerified(new ByteArrayInputStream(payload), new ByteArrayOutputStream(), payload.length, hash(new byte[]{1}), () -> {}, count -> {}));
        assertThrows(IOException.class, () -> UpdaterIO.copyVerified(new ByteArrayInputStream(payload), new ByteArrayOutputStream(), payload.length + 1, hash(payload), () -> {}, count -> {}));
    }
    @Test public void rejectsOversizedStreamBeforeWritingExcess() {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        assertThrows(IOException.class, () -> UpdaterIO.copyVerified(new ByteArrayInputStream(payload), output, 1, hash(payload), () -> {}, count -> {}));
        assertEquals(0, output.size());
        assertThrows(IOException.class, () -> UpdaterIO.copyVerified(new ByteArrayInputStream(payload), output, UpdaterPolicy.MAX_BYTES + 1, hash(payload), () -> {}, count -> {}));
    }
    @Test public void cancellationBeforeAndDuringReadPreventsWriting() {
        ByteArrayOutputStream output = new ByteArrayOutputStream(); AtomicInteger checkpoints = new AtomicInteger();
        assertThrows(IOException.class, () -> UpdaterIO.copyVerified(new ByteArrayInputStream(payload), output, payload.length, hash(payload), () -> { throw new IOException("cancelled"); }, count -> {}));
        assertEquals(0, output.size());
        assertThrows(IOException.class, () -> UpdaterIO.copyVerified(new ByteArrayInputStream(payload), output, payload.length, hash(payload), () -> { if (checkpoints.incrementAndGet() == 2) throw new IOException("cancelled"); }, count -> {}));
        assertEquals(0, output.size());
    }
    @Test public void finalCheckpointPreventsPublishAfterCancellation() {
        AtomicInteger checkpoints = new AtomicInteger();
        assertThrows(IOException.class, () -> UpdaterIO.copyVerified(new ByteArrayInputStream(payload), new ByteArrayOutputStream(), payload.length, hash(payload), () -> { if (checkpoints.incrementAndGet() == 5) throw new IOException("cancelled"); }, count -> {}));
        assertEquals(5, checkpoints.get());
    }
}
