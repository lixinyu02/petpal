package com.petpal.app;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.ContextWrapper;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.UserNotAuthenticatedException;
import android.util.AtomicFile;
import android.util.Base64;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.ProviderException;
import java.security.UnrecoverableKeyException;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Synthetic accounts only. Every filesystem input is in a unique cache fixture. */
@RunWith(AndroidJUnit4.class)
public class PetLoginSessionFaultTest {
    private static final class TestKeys implements PetLoginSessionState.Keys {
        final Map<String,SecretKey> values=new ConcurrentHashMap<>();final AtomicInteger creates=new AtomicInteger(),loads=new AtomicInteger();
        final AtomicBoolean blockLoad=new AtomicBoolean(),blockCreate=new AtomicBoolean();
        final CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
        volatile String failingAlias;volatile Exception failure;volatile boolean rejectCreate;
        private void pause(AtomicBoolean flag)throws Exception{if(flag.compareAndSet(true,false)){entered.countDown();if(!release.await(10,TimeUnit.SECONDS))throw new IOException("Synthetic latch timeout");}}
        @Override public SecretKey load(String alias)throws Exception{loads.incrementAndGet();pause(blockLoad);if(alias.equals(failingAlias)&&failure!=null)throw failure;SecretKey value=values.get(alias);if(value==null)throw new PetLoginSessionState.MissingAliasException();return value;}
        @Override public SecretKey create(String alias)throws Exception{pause(blockCreate);if(rejectCreate)throw new IOException("Synthetic key creation failure");KeyGenerator generator=KeyGenerator.getInstance("AES");generator.init(256);SecretKey value=generator.generateKey();assertNull("Never overwrite an existing key",values.putIfAbsent(alias,value));creates.incrementAndGet();return value;}
    }
    private static final class Fixture implements AutoCloseable {
        final File directory,base;final Context context;final TestKeys keys=new TestKeys();final String legacy="isolated.login."+UUID.randomUUID();
        Fixture()throws Exception{Context app=InstrumentationRegistry.getInstrumentation().getTargetContext();directory=new File(app.getCacheDir(),"vault-fault-"+UUID.randomUUID());assertTrue(directory.mkdir());base=new File(directory,"login-session-v1.enc");context=new ContextWrapper(app){@Override public Context getApplicationContext(){return this;}@Override public File getNoBackupFilesDir(){return directory;}};}
        PetLoginSessionState state(){return new PetLoginSessionState(context,keys,null,legacy);}
        PetLoginSessionState state(PetLoginSessionState.Disk disk){return new PetLoginSessionState(context,keys,disk,legacy);}
        JSONObject login(String token)throws Exception{return new JSONObject().put("url","https://fixture.invalid").put("token",token).put("credentialKind","session").put("target","remote");}
        byte[] bytes()throws Exception{return Files.readAllBytes(base.toPath());}
        void seedV1()throws Exception{SecretKey key=keys.create(legacy);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key);cipher.updateAAD("PetPal Login Session v1".getBytes(StandardCharsets.UTF_8));JSONObject envelope=new JSONObject().put("version",1).put("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)).put("data",Base64.encodeToString(cipher.doFinal(login("synthetic-old").put("version",1).toString().getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP));Files.write(base.toPath(),envelope.toString().getBytes(StandardCharsets.UTF_8));}
        @Override public void close()throws Exception{keys.release.countDown();for(File file:directory.listFiles())assertTrue(file.delete());assertTrue(directory.delete());}
    }
    private static void rejected(Future<?> future)throws Exception{assertThrows(ExecutionException.class,()->future.get(3,TimeUnit.SECONDS));}
    private static void finish(ExecutorService workers,TestKeys keys)throws Exception{keys.release.countDown();workers.shutdownNow();assertTrue(workers.awaitTermination(3,TimeUnit.SECONDS));}
    private static void ui(Runnable action){InstrumentationRegistry.getInstrumentation().runOnMainSync(action);}

    @Test public void blockedReadDoesNotBlockUiReserveOrLogoutAndCannotRestoreLate()throws Exception{
        try(Fixture f=new Fixture()){f.seedV1();PetLoginSessionState state=f.state();state.claimOwner();f.keys.blockLoad.set(true);ExecutorService workers=Executors.newSingleThreadExecutor();
            try{Future<?> old=workers.submit(()->state.read());assertTrue(f.keys.entered.await(2,TimeUnit.SECONDS));long started=System.nanoTime();ui(()->{try{state.clear(state.reserveClear());}catch(Exception error){throw new AssertionError(error);}});assertTrue("UI clear must not wait for Keystore",System.nanoTime()-started<TimeUnit.SECONDS.toNanos(1));assertFalse(f.base.exists());f.keys.release.countDown();rejected(old);assertTrue(state.read().isNull("connection"));}finally{finish(workers,f.keys);}}
    }
    @Test public void newOwnerCancelsOldCryptoWriteBeforeItCanChangeTheVault()throws Exception{
        try(Fixture f=new Fixture()){f.seedV1();PetLoginSessionState old=f.state();old.claimOwner();long revision=old.reserve();f.keys.blockLoad.set(true);ExecutorService workers=Executors.newSingleThreadExecutor();
            try{Future<?> pending=workers.submit(()->{old.write(f.login("synthetic-old-pending"),revision);return null;});assertTrue(f.keys.entered.await(2,TimeUnit.SECONDS));PetLoginSessionState current=f.state();current.claimOwner();assertEquals("synthetic-old",current.read().getJSONObject("connection").getString("token"));old.cancelWrite(revision);current.write(f.login("synthetic-new-owner"),current.reserve());f.keys.release.countDown();rejected(pending);assertEquals("synthetic-new-owner",current.read().getJSONObject("connection").getString("token"));}finally{finish(workers,f.keys);}}
    }
    @Test public void concurrentFirstKeyCreationUsesIndependentAliases()throws Exception{
        try(Fixture f=new Fixture()){PetLoginSessionState first=f.state();first.claimOwner();long revision=first.reserve();f.keys.blockCreate.set(true);ExecutorService workers=Executors.newSingleThreadExecutor();
            try{Future<?> pending=workers.submit(()->{first.write(f.login("synthetic-late-create"),revision);return null;});assertTrue(f.keys.entered.await(2,TimeUnit.SECONDS));PetLoginSessionState second=f.state();second.claimOwner();second.write(f.login("synthetic-winner"),second.reserve());byte[] committed=f.bytes();f.keys.release.countDown();rejected(pending);assertArrayEquals(committed,f.bytes());assertEquals("synthetic-winner",second.read().getJSONObject("connection").getString("token"));assertEquals(2,f.keys.creates.get());assertFalse(f.keys.values.containsKey(f.legacy));}finally{finish(workers,f.keys);}}
    }
    @Test public void permanentKeyFailureIsRepairedOnlyByExplicitWriteWithRestrictedV2Id()throws Exception{
        try(Fixture f=new Fixture()){f.seedV1();PetLoginSessionState state=f.state();byte[] previous=f.bytes();int count=f.keys.creates.get();f.keys.failingAlias=f.legacy;f.keys.failure=new KeyPermanentlyInvalidatedException();assertThrows(IOException.class,state::read);assertArrayEquals(previous,f.bytes());assertEquals(count,f.keys.creates.get());state.write(f.login("synthetic-recovered"),state.reserve());JSONObject envelope=new JSONObject(new String(f.bytes(),StandardCharsets.UTF_8));assertEquals(2,envelope.getInt("version"));assertTrue(envelope.getString("keyId").matches("[0-9a-f-]{36}"));assertEquals("synthetic-recovered",f.state().read().getJSONObject("connection").getString("token"));assertTrue(f.keys.values.containsKey(f.legacy));int loads=f.keys.loads.get();envelope.put("keyId","../../unrelated");Files.write(f.base.toPath(),envelope.toString().getBytes(StandardCharsets.UTF_8));assertThrows(IOException.class,state::read);assertEquals("Bad ids never reach Keystore",loads,f.keys.loads.get());}
    }
    @Test public void missingReferencedKeyGetsNewIdWithoutRecreatingTheMissingAlias()throws Exception{
        try(Fixture f=new Fixture()){f.seedV1();f.keys.values.remove(f.legacy);PetLoginSessionState state=f.state();assertThrows(IOException.class,state::read);state.write(f.login("synthetic-recovery"),state.reserve());assertFalse(f.keys.values.containsKey(f.legacy));assertEquals(2,new JSONObject(new String(f.bytes(),StandardCharsets.UTF_8)).getInt("version"));assertEquals("synthetic-recovery",state.read().getJSONObject("connection").getString("token"));}
    }
    @Test public void transientOrUnclassifiedKeyErrorsNeverRotateOrDelete()throws Exception{
        Exception wrapped=new UnrecoverableKeyException("Synthetic backend failure");wrapped.initCause(new IOException("Synthetic temporarily locked backend"));
        for(Exception failure:new Exception[]{new UserNotAuthenticatedException(),new UnrecoverableKeyException("Synthetic unknown failure"),wrapped,new ProviderException("Synthetic temporary provider"),new IOException("Synthetic IO")}){
            try(Fixture f=new Fixture()){f.seedV1();PetLoginSessionState state=f.state();byte[] previous=f.bytes();int creates=f.keys.creates.get();f.keys.failingAlias=f.legacy;f.keys.failure=failure;assertThrows(IOException.class,state::read);assertThrows(Exception.class,()->state.write(f.login("synthetic-not-accepted"),state.reserve()));assertArrayEquals(previous,f.bytes());assertEquals(creates,f.keys.creates.get());f.keys.failure=null;assertEquals("synthetic-old",state.read().getJSONObject("connection").getString("token"));}
        }
    }
    @Test public void failedRecoveryKeyCreationPreservesOriginalCiphertextAndKey()throws Exception{
        try(Fixture f=new Fixture()){f.seedV1();byte[] previous=f.bytes();f.keys.failingAlias=f.legacy;f.keys.failure=new KeyPermanentlyInvalidatedException();f.keys.rejectCreate=true;PetLoginSessionState state=f.state();assertThrows(IOException.class,()->state.write(f.login("synthetic-failed"),state.reserve()));assertArrayEquals(previous,f.bytes());f.keys.failure=null;assertEquals("synthetic-old",state.read().getJSONObject("connection").getString("token"));}
    }
    @Test public void silentFinishFailureCannotPublishANewAccount()throws Exception{
        try(Fixture f=new Fixture()){f.seedV1();byte[] previous=f.bytes();AtomicFile silent=new AtomicFile(f.base){@Override public void finishWrite(FileOutputStream output){try{output.close();}catch(IOException ignored){}}};PetLoginSessionState state=f.state(new PetLoginSessionState.CheckedDisk(f.base,silent));assertThrows(IOException.class,()->state.write(f.login("synthetic-uncommitted"),state.reserve()));assertArrayEquals(previous,f.bytes());assertEquals("synthetic-old",f.state().read().getJSONObject("connection").getString("token"));assertFalse(new File(f.base+".rollback").exists());}
    }
    @Test public void fsyncFailureRetainsThePriorVault()throws Exception{
        try(Fixture f=new Fixture()){f.seedV1();byte[] previous=f.bytes();PetLoginSessionState.CheckedDisk disk=new PetLoginSessionState.CheckedDisk(f.base){@Override void sync(FileOutputStream output)throws IOException{throw new IOException("Synthetic fsync failure");}};PetLoginSessionState state=f.state(disk);assertThrows(IOException.class,()->state.write(f.login("synthetic-unsynced"),state.reserve()));assertArrayEquals(previous,f.bytes());assertEquals("synthetic-old",f.state().read().getJSONObject("connection").getString("token"));}
    }
    @Test public void destroyDuringCommitRollsBackButDestroyAfterCommitDoesNotUndo()throws Exception{
        try(Fixture f=new Fixture()){f.seedV1();byte[] previous=f.bytes();CountDownLatch finishing=new CountDownLatch(1),release=new CountDownLatch(1);AtomicFile delayed=new AtomicFile(f.base){@Override public void finishWrite(FileOutputStream output){super.finishWrite(output);finishing.countDown();try{if(!release.await(10,TimeUnit.SECONDS))throw new AssertionError("Synthetic commit latch timeout");}catch(InterruptedException error){throw new AssertionError(error);}}};PetLoginSessionState state=f.state(new PetLoginSessionState.CheckedDisk(f.base,delayed));state.claimOwner();long revision=state.reserve();ExecutorService workers=Executors.newSingleThreadExecutor();
            try{Future<?> pending=workers.submit(()->{state.write(f.login("synthetic-before-destroy"),revision);return null;});assertTrue(finishing.await(2,TimeUnit.SECONDS));long started=System.nanoTime();ui(()->state.cancelWrite(revision));assertTrue(System.nanoTime()-started<TimeUnit.SECONDS.toNanos(1));release.countDown();rejected(pending);assertArrayEquals(previous,f.bytes());PetLoginSessionState current=f.state();current.claimOwner();long accepted=current.reserve();current.write(f.login("synthetic-committed"),accepted);current.cancelWrite(accepted);assertEquals("synthetic-committed",current.read().getJSONObject("connection").getString("token"));}finally{release.countDown();finish(workers,f.keys);}}
    }
    @Test public void rollbackReadIsNonMutatingAndClearRemovesEverySideFile()throws Exception{
        try(Fixture f=new Fixture()){f.seedV1();byte[] original=f.bytes();Files.write(new File(f.base+".rollback").toPath(),original);Files.write(f.base.toPath(),"Synthetic incomplete candidate".getBytes(StandardCharsets.UTF_8));for(String suffix:new String[]{".bak",".new",".rollback.new",".repair"})Files.write(new File(f.base+suffix).toPath(),original);PetLoginSessionState state=f.state();byte[] incomplete=f.bytes();assertEquals("synthetic-old",state.read().getJSONObject("connection").getString("token"));assertArrayEquals(incomplete,f.bytes());assertArrayEquals(original,Files.readAllBytes(new File(f.base+".rollback").toPath()));state.clear(state.reserveClear());assertEquals(0,f.directory.list().length);assertTrue(state.read().isNull("connection"));}
    }
    @Test public void clearRejectsUndeletableNewSidePathInsteadOfReportingSuccess()throws Exception{
        try(Fixture f=new Fixture()){f.seedV1();File blocked=new File(f.base+".new");assertTrue(blocked.mkdir());PetLoginSessionState state=f.state();assertThrows(IOException.class,()->state.clear(state.reserveClear()));assertTrue("Failed clear suppresses stale restoration in this process",state.read().isNull("connection"));assertTrue(blocked.delete());state.clear(state.reserveClear());assertTrue(state.read().isNull("connection"));}
    }
    @SuppressWarnings("unchecked")
    @Test public void boundedWorkersLeaveClearIndependentAndDestroyDoesNotCancelIt()throws Exception{
        Field ioField=PetLoginSessionPlugin.class.getDeclaredField("IO"),clearField=PetLoginSessionPlugin.class.getDeclaredField("CLEAR");ioField.setAccessible(true);clearField.setAccessible(true);ExecutorService io=(ExecutorService)ioField.get(null),clear=(ExecutorService)clearField.get(null);CountDownLatch entered=new CountDownLatch(4),release=new CountDownLatch(1);
        try(Fixture f=new Fixture()){f.seedV1();PetLoginSessionState state=f.state();state.claimOwner();PetLoginSessionPlugin plugin=new PetLoginSessionPlugin();Field stateField=PetLoginSessionPlugin.class.getDeclaredField("state");stateField.setAccessible(true);stateField.set(plugin,state);
            try{for(int i=0;i<4;i++)io.execute(()->{entered.countDown();try{release.await(10,TimeUnit.SECONDS);}catch(InterruptedException error){Thread.currentThread().interrupt();}});assertTrue(entered.await(2,TimeUnit.SECONDS));assertThrows(RejectedExecutionException.class,()->io.execute(()->{}));long revision=state.reserveClear();CountDownLatch clearEntered=new CountDownLatch(1),clearRelease=new CountDownLatch(1);Future<?> pending=clear.submit(()->{clearEntered.countDown();if(!clearRelease.await(10,TimeUnit.SECONDS))throw new IOException("Synthetic clear latch timeout");state.clear(revision);return null;});assertTrue(clearEntered.await(1,TimeUnit.SECONDS));ui(plugin::handleOnDestroy);clearRelease.countDown();pending.get(2,TimeUnit.SECONDS);assertFalse(f.base.exists());assertTrue(state.read().isNull("connection"));}finally{release.countDown();}}
    }
}
