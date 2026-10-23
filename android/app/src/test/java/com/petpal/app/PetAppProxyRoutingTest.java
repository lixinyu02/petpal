package com.petpal.app;

import static org.junit.Assert.*;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import org.junit.Test;

public class PetAppProxyRoutingTest {
    private static final class Fixture {
        final ArrayDeque<Runnable> main = new ArrayDeque<>();
        final List<Integer> ports = new ArrayList<>();
        final List<PetAppProxyRouting.Completion> completions = new ArrayList<>();
        int nativePort;
        final PetAppProxyRouting routing = new PetAppProxyRouting(port -> nativePort = port, main::add,
            (port, complete) -> { ports.add(port); completions.add(complete); });
        void drain() { while (!main.isEmpty()) main.remove().run(); }
        void complete(int index) { completions.get(index).complete(null); drain(); }
    }
    @Test public void oldOwnerAndDuplicateCallbacksCannotClearOrPublishOverTheSuccessor() throws Exception {
        Fixture f = new Fixture(); PetAppProxyRouting.Lease old = f.routing.acquire();
        PetAppProxyRouting.Request first = f.routing.enable(old, 18081); f.drain();
        PetAppProxyRouting.Lease current = f.routing.acquire(); PetAppProxyRouting.Request second = f.routing.enable(current, 18082);
        assertNull(f.routing.release(old)); f.drain(); assertEquals(List.of(18081), f.ports); assertEquals(0, f.nativePort);
        f.complete(0); assertEquals(List.of(18081, 18082), f.ports); assertEquals(0, f.nativePort);
        f.complete(0); assertEquals(0, f.nativePort); // A duplicated old completion must not finish the new request.
        f.complete(1); second.await(); assertEquals(18082, f.nativePort); assertThrows(InterruptedException.class, first::await);
        assertNull(f.routing.release(old)); assertEquals(18082, f.nativePort);
        PetAppProxyRouting.Request clear = f.routing.release(current); f.drain(); assertEquals(List.of(18081, 18082, 0), f.ports);
        f.complete(2); clear.await(); assertEquals(0, f.nativePort);
    }
    @Test public void queuedOldClearIsSupersededBeforeItCanReachWebView() throws Exception {
        Fixture f = new Fixture(); PetAppProxyRouting.Lease old = f.routing.acquire(); f.routing.enable(old, 18081); f.drain(); f.complete(0);
        PetAppProxyRouting.Request clear = f.routing.release(old);
        PetAppProxyRouting.Lease next = f.routing.acquire(); PetAppProxyRouting.Request enabled = f.routing.enable(next, 18082); f.drain();
        assertEquals(List.of(18081, 18082), f.ports); assertThrows(InterruptedException.class, clear::await);
        f.complete(1); enabled.await(); assertEquals(18082, f.nativePort);
    }
    @Test public void missingCallbackFailsClosedAndALateCallbackCanOnlyLeadToClear() throws Exception {
        Fixture f = new Fixture(); PetAppProxyRouting.Lease owner = f.routing.acquire(); PetAppProxyRouting.Request request = f.routing.enable(owner, 18081); f.drain();
        IllegalStateException timeout = assertThrows(IllegalStateException.class, () -> request.await(1, TimeUnit.MILLISECONDS));
        assertEquals(PetAppProxyRouting.RESTART_REQUIRED, timeout.getMessage()); assertEquals(0, f.nativePort); assertFalse(f.routing.owns(owner));
        assertEquals(PetAppProxyRouting.RESTART_REQUIRED, assertThrows(IllegalStateException.class, f.routing::acquire).getMessage());
        assertNull(f.routing.release(owner)); f.complete(0); assertEquals(List.of(18081, 0), f.ports); assertEquals(0, f.nativePort);
        f.complete(0); f.complete(1); assertEquals(0, f.nativePort); assertEquals(PetAppProxyRouting.RESTART_REQUIRED, f.routing.failureMessage());
    }
    @Test public void mainExecutorRejectionIsBoundedAndDoesNotEscapeTheCallingThread() throws Exception {
        int[] port = { 0 }; Executor rejected = task -> { throw new RejectedExecutionException("private provider detail"); };
        PetAppProxyRouting routing = new PetAppProxyRouting(value -> port[0] = value, rejected, (value, done) -> fail("must not run"));
        PetAppProxyRouting.Lease lease = routing.acquire(); PetAppProxyRouting.Request request = routing.enable(lease, 18081);
        assertEquals(PetAppProxyRouting.RESTART_REQUIRED, assertThrows(IllegalStateException.class, request::await).getMessage());
        assertEquals(0, port[0]); assertNull(routing.release(lease));
    }
    @Test public void aConfirmedWebFailureNeverPublishesTheNativeProxy() throws Exception {
        Fixture f = new Fixture(); PetAppProxyRouting.Lease lease = f.routing.acquire(); PetAppProxyRouting.Request request = f.routing.enable(lease, 18081); f.drain();
        f.completions.get(0).complete(new IllegalStateException("synthetic WebView failure")); f.drain();
        assertThrows(IllegalStateException.class, request::await); assertEquals(0, f.nativePort);
        f.routing.release(lease); f.drain(); f.complete(1); assertEquals(0, f.nativePort);
    }
    @Test public void aRetiredWaitTimeoutCannotPoisonAnAlreadyConfirmedSuccessor() throws Exception {
        Fixture f = new Fixture(); PetAppProxyRouting.Lease old = f.routing.acquire(); PetAppProxyRouting.Request first = f.routing.enable(old, 18081); f.drain();
        PetAppProxyRouting.Lease next = f.routing.acquire(); PetAppProxyRouting.Request second = f.routing.enable(next, 18082); f.drain(); f.complete(0); f.complete(1); second.await();
        f.routing.expire(first); assertEquals(18082, f.nativePort); assertEquals("", f.routing.failureMessage()); assertTrue(f.routing.owns(next));
    }
}
