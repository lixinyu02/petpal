package com.petpal.app;

import java.io.IOException;
import java.util.concurrent.atomic.AtomicReference;

/** Non-blocking lifecycle/revision cancellation; never covers disk or Keystore. */
final class LoginVaultGate {
    private static final class Stamp {
        final long revision, owner; final boolean clear, committed;
        Stamp(long revision, long owner, boolean clear, boolean committed) { this.revision=revision; this.owner=owner; this.clear=clear; this.committed=committed; }
    }
    private final AtomicReference<Stamp> value = new AtomicReference<>(new Stamp(0,0,false,true));
    long claimOwner() { for (;;) { Stamp before=value.get(), next=new Stamp(before.revision,before.owner+1,before.clear,before.committed); if(value.compareAndSet(before,next))return next.owner; } }
    long reserve(boolean clear) { for (;;) { Stamp before=value.get(), next=new Stamp(before.revision+1,before.owner,clear,false);if(value.compareAndSet(before,next))return next.revision; } }
    long revision() { return value.get().revision; }
    boolean clearing() { Stamp current=value.get();return current.clear&&!current.committed; }
    void check(long revision,long owner) throws IOException { Stamp current=value.get();if(current.revision!=revision||(owner!=0&&current.owner!=owner))throw stale(); }
    void committed(long revision,long owner) throws IOException {
        for (;;) { Stamp before=value.get();if(before.revision!=revision||(owner!=0&&before.owner!=owner))throw stale();
            if(value.compareAndSet(before,new Stamp(revision,before.owner,before.clear,true)))return; }
    }
    void cancelWrite(long revision,long owner) {
        for (;;) { Stamp before=value.get();if(before.revision!=revision||before.clear||before.committed||(owner!=0&&before.owner!=owner))return;
            if(value.compareAndSet(before,new Stamp(revision+1,before.owner,false,true)))return; }
    }
    private static IOException stale(){return new IOException("登录已变化，旧设备登录操作已取消。");}
}
