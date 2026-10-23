package com.petpal.app;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;

/** Process-global ownership and callback ordering; no account data lives here. */
final class PetAppProxyRouting {
    static final String RESTART_REQUIRED = "系统未确认应用代理变更，请彻底退出小伴进程后重新打开。";
    interface NativePort { void set(int port); }
    interface Completion { void complete(Exception failure); }
    interface WebProxy { void apply(int port, Completion completion) throws Exception; }
    interface Timeout { void expire(Request request); }
    static final class Lease { private Lease() { } }
    static final class Request {
        final Lease lease; final int port; final long revision;
        private final CountDownLatch done = new CountDownLatch(1);
        private volatile Exception failure;
        private final Timeout expired;
        Request(Lease lease, int port, long revision, Timeout expired) { this.lease = lease; this.port = port; this.revision = revision; this.expired = expired; }
        synchronized void finish(Exception error) { if (done.getCount() == 0) return; failure = error; done.countDown(); }
        void await() throws Exception {
            await(8, TimeUnit.SECONDS);
        }
        void await(long duration, TimeUnit unit) throws Exception {
            if (!done.await(duration, unit)) { expired.expire(this); if (done.getCount() != 0) throw new IllegalStateException(RESTART_REQUIRED); }
            if (failure != null) throw failure;
        }
    }
    private final NativePort nativePort;
    private final Executor main;
    private final WebProxy web;
    private Lease owner;
    private long revision;
    private boolean failed;
    private Request pending, inFlight;
    PetAppProxyRouting(NativePort nativePort, Executor main, WebProxy web) { this.nativePort = nativePort; this.main = main; this.web = web; }
    synchronized Lease acquire() {
        if (failed) throw new IllegalStateException(RESTART_REQUIRED);
        owner = new Lease(); revision++; nativePort.set(0);
        if (pending != null) { pending.finish(new InterruptedException()); pending = null; }
        return owner;
    }
    synchronized boolean owns(Lease lease) { return lease != null && owner == lease; }
    synchronized String failureMessage() { return failed ? RESTART_REQUIRED : ""; }
    synchronized Request enable(Lease lease, int port) throws InterruptedException {
        if (failed) throw new IllegalStateException(RESTART_REQUIRED);
        if (!owns(lease) || port < 1 || port > 65535) throw new InterruptedException();
        return queue(lease, port);
    }
    synchronized Request release(Lease lease) {
        if (!owns(lease)) return null;
        owner = null; nativePort.set(0); return queue(null, 0);
    }
    private Request queue(Lease lease, int port) {
        if (pending != null) pending.finish(new InterruptedException());
        Request request = new Request(lease, port, ++revision, this::expire); pending = request; post(this::pump); return request;
    }
    synchronized void expire(Request request) {
        // Completion may win just after await's deadline. A retired wait must
        // not poison a successor that already received its own confirmation.
        if ((inFlight == request || pending == request) && request.done.getCount() != 0) failClosed(true);
    }
    private void post(Runnable action) { try { main.execute(action); } catch (RuntimeException unavailable) { failClosed(false); } }
    private void failClosed(boolean clearWhenPossible) {
        synchronized (this) {
            if (failed) return;
            failed = true; owner = null; revision++; nativePort.set(0);
            Exception error = new IllegalStateException(RESTART_REQUIRED);
            if (pending != null) pending.finish(error);
            if (inFlight != null) inFlight.finish(error);
            // Never start another operation until the outstanding provider callback
            // arrives. A late completion may only be followed by a final clear.
            pending = clearWhenPossible ? new Request(null, 0, revision, ignored -> {}) : null;
        }
        if (clearWhenPossible) post(this::pump);
    }
    private synchronized boolean current(Request request) { return request.revision == revision && owner == request.lease; }
    private void pump() {
        final Request next;
        synchronized (this) {
            if (inFlight != null || pending == null) return;
            next = pending; pending = null;
            if (!current(next)) { next.finish(new InterruptedException()); return; }
            inFlight = next;
        }
        try { web.apply(next.port, error -> post(() -> complete(next, error))); }
        catch (Exception error) { complete(next, error); }
    }
    private void complete(Request request, Exception error) {
        synchronized (this) {
            if (inFlight != request) return; // A duplicated provider callback cannot finish a successor.
            inFlight = null;
            boolean valid = current(request);
            if (valid && error == null && !failed) nativePort.set(request.port);
            request.finish(valid ? error : new InterruptedException());
        }
        pump();
    }
}
