package com.petpal.app;

import java.util.ArrayDeque;

/** A process-local recovery budget. Stores no page, account or error payload. */
final class RendererRecoveryPolicy {
    static final long WINDOW_MS = 60_000;
    static final int AUTOMATIC_ATTEMPTS = 2;
    private final ArrayDeque<Long> exits = new ArrayDeque<>();
    synchronized boolean automatic(long elapsed) {
        if (!exits.isEmpty() && elapsed < exits.peekLast()) exits.clear();
        while (!exits.isEmpty() && elapsed - exits.peekFirst() >= WINDOW_MS) exits.removeFirst();
        if (exits.size() >= AUTOMATIC_ATTEMPTS) return false;
        exits.addLast(elapsed);
        return true;
    }
    synchronized void retryByUser() { exits.clear(); }
}
