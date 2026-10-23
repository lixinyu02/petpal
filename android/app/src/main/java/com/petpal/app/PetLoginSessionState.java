package com.petpal.app;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.security.keystore.UserNotAuthenticatedException;
import android.util.AtomicFile;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.UnrecoverableKeyException;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Only PetPal sessions. Package-private dependencies support isolated faults, never JS hooks. */
final class PetLoginSessionState {
    static final String KEY="petpal.login-session.v1", KEY_V2="petpal.login-session.v2.";
    private static final int MAXIMUM=32768;
    private static final class Gate { final LoginVaultGate revisions=new LoginVaultGate(); final Object files=new Object(); }
    private static final ConcurrentHashMap<String,Gate> GATES=new ConcurrentHashMap<>();
    interface Guard { void check() throws Exception; void committed() throws Exception; }
    interface Disk { byte[] read() throws Exception; void commit(byte[] bytes,Guard guard) throws Exception; void clear(Guard guard) throws Exception; }
    interface Keys { SecretKey load(String alias) throws Exception; SecretKey create(String alias) throws Exception; }
    static final class MissingAliasException extends UnrecoverableKeyException { MissingAliasException(){super("设备登录密钥不存在。");} }
    static class AndroidKeys implements Keys {
        private KeyStore store() throws Exception {KeyStore value=KeyStore.getInstance("AndroidKeyStore");value.load(null);return value;}
        @Override public SecretKey load(String alias) throws Exception {
            KeyStore keys=store();if(!keys.containsAlias(alias))throw new MissingAliasException();
            java.security.Key key=keys.getKey(alias,null);
            if(!(key instanceof SecretKey)||!"AES".equals(key.getAlgorithm()))throw new UnrecoverableKeyException("设备登录密钥暂时不可用。");
            return (SecretKey)key;
        }
        @Override public SecretKey create(String alias) throws Exception {
            if(store().containsAlias(alias))throw new IOException("设备登录密钥已存在，请重试。");
            KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());
            return generator.generateKey();
        }
    }
    /** Checked AtomicFile transaction retains a durable encrypted preimage. */
    static class CheckedDisk implements Disk {
        private final File base,backup,fresh,rollback,rollbackNew,repair;
        private final AtomicFile atomic;
        CheckedDisk(File base){this(base,new AtomicFile(base));}
        CheckedDisk(File base,AtomicFile atomic){this.base=base;this.atomic=atomic;backup=new File(base+".bak");fresh=new File(base+".new");rollback=new File(base+".rollback");rollbackNew=new File(base+".rollback.new");repair=new File(base+".repair");}
        private static byte[] bytes(File file) throws Exception {if(!file.isFile())throw new IOException("设备登录文件不可用。");return readBytes(new FileInputStream(file));}
        @Override public byte[] read() throws Exception {
            // AtomicFile.openRead would rename/delete side files even on a failed read.
            for(File file:new File[]{rollback,backup,base})if(file.exists())return bytes(file);
            return null;
        }
        private static void remove(File file) throws IOException {if(file.exists()&&(!file.isFile()||!file.delete()||file.exists()))throw new IOException("无法清除设备登录文件。");}
        private static void replace(File target,File temporary,byte[] value) throws Exception {
            try(FileOutputStream output=new FileOutputStream(temporary)){output.write(value);output.flush();output.getFD().sync();}
            if(!Arrays.equals(value,bytes(temporary)))throw new IOException("设备登录写入校验失败。");
            if(!temporary.renameTo(target)||!Arrays.equals(value,bytes(target)))throw new IOException("设备登录提交校验失败。");
        }
        private void retain(byte[] previous) throws Exception {
            if(previous==null)return;
            if(rollback.exists()){if(!Arrays.equals(previous,bytes(rollback)))throw new IOException("设备登录恢复文件不一致。");}
            else replace(rollback,rollbackNew,previous);
        }
        private void restore(byte[] previous) throws Exception {
            if(previous==null){remove(base);remove(backup);remove(fresh);remove(rollbackNew);remove(repair);return;}
            retain(previous);replace(base,repair,previous);remove(backup);remove(fresh);remove(rollbackNew);remove(rollback);
        }
        void sync(FileOutputStream output) throws IOException { output.getFD().sync(); }
        @Override public void commit(byte[] value,Guard guard) throws Exception {
            byte[] previous=read();FileOutputStream output=null;
            try {
                guard.check();retain(previous);guard.check();output=atomic.startWrite();output.write(value);output.flush();sync(output);guard.check();atomic.finishWrite(output);output=null;
                if(!Arrays.equals(value,bytes(base)))throw new IOException("设备登录提交校验失败。");
                guard.check();remove(backup);remove(fresh);remove(rollbackNew);remove(repair);remove(rollback);guard.committed();
            }catch(Exception failure){
                if(output!=null)try{atomic.failWrite(output);}catch(RuntimeException ignored){}
                try{restore(previous);}catch(Exception recovery){failure.addSuppressed(recovery);}
                throw new IOException("无法安全保存登录，原登录恢复文件已保留。",failure);
            }
        }
        @Override public void clear(Guard guard) throws Exception {
            guard.check();for(File file:new File[]{base,backup,fresh,rollback,rollbackNew,repair})remove(file);
            for(File file:new File[]{base,backup,fresh,rollback,rollbackNew,repair})if(file.exists())throw new IOException("无法清除设备登录文件。");
            guard.committed();
        }
    }
    private final Gate gate;
    private final Keys keys;
    private final Disk disk;
    private final String legacyAlias;
    private long owner;
    PetLoginSessionState(Context context){this(context,new AndroidKeys(),null,KEY);}
    PetLoginSessionState(Context context,Keys keys,Disk disk,String legacyAlias){
        File path=new File(context.getApplicationContext().getNoBackupFilesDir(),"login-session-v1.enc");
        synchronized(GATES){Gate found=GATES.get(path.getAbsolutePath());if(found==null){found=new Gate();GATES.put(path.getAbsolutePath(),found);}gate=found;}
        this.keys=keys;this.disk=disk==null?new CheckedDisk(path):disk;this.legacyAlias=legacyAlias;
    }
    void claimOwner(){owner=gate.revisions.claimOwner();}
    long reserve(){return gate.revisions.reserve(false);}
    long reserveClear(){return gate.revisions.reserve(true);}
    void cancelWrite(long revision){gate.revisions.cancelWrite(revision,owner);}
    private void current(long revision) throws IOException {gate.revisions.check(revision,owner);}
    private Guard guard(long revision,boolean clear){return new Guard(){public void check()throws Exception{gate.revisions.check(revision,clear?0:owner);}public void committed()throws Exception{gate.revisions.committed(revision,clear?0:owner);}};}
    private static byte[] readBytes(InputStream input) throws Exception {
        try(InputStream stream=input;ByteArrayOutputStream output=new ByteArrayOutputStream()){byte[] buffer=new byte[4096];int count;while((count=stream.read(buffer))!=-1){if(output.size()+count>MAXIMUM)throw new IOException();output.write(buffer,0,count);}return output.toByteArray();}
    }
    private static JSONObject connection(JSONObject input)throws Exception{return new JSONObject().put("url",PetLoginSessionPolicy.url(input.getString("url"))).put("token",PetLoginSessionPolicy.token(input.getString("token"))).put("credentialKind",PetLoginSessionPolicy.kind(input.getString("credentialKind"))).put("target",PetLoginSessionPolicy.target(input.getString("target")));}
    private static String keyId(JSONObject envelope)throws Exception{
        String id=envelope.getString("keyId");if(!id.matches("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"))throw new IOException("设备登录密钥标识无效。");return id;
    }
    private static byte[] aad(int version,String id){return (version==1?"PetPal Login Session v1":"PetPal Login Session v2:"+id).getBytes(StandardCharsets.UTF_8);}
    private static boolean permanent(Exception failure){
        boolean known=false;Throwable item=failure;for(int depth=0;item!=null&&depth<16;depth++,item=item.getCause()){
            if(item instanceof UserNotAuthenticatedException)return false;
            if(item instanceof MissingAliasException||item instanceof KeyPermanentlyInvalidatedException)known=true;
        }return known;
    }
    JSONObject read()throws Exception{
        long revision=gate.revisions.revision();byte[] value;
        synchronized(gate.files){current(revision);if(gate.revisions.clearing())return new JSONObject().put("connection",JSONObject.NULL);value=disk.read();}
        if(value==null){current(revision);return new JSONObject().put("connection",JSONObject.NULL);}
        try{
            JSONObject envelope=new JSONObject(new String(value,StandardCharsets.UTF_8));int version=envelope.getInt("version");if(version!=1&&version!=2)throw new IOException();
            String id=version==2?keyId(envelope):null;byte[] iv=Base64.decode(envelope.getString("iv"),Base64.NO_WRAP);if(iv.length!=12)throw new IOException();
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,keys.load(version==1?legacyAlias:KEY_V2+id),new GCMParameterSpec(128,iv));cipher.updateAAD(aad(version,id));
            JSONObject saved=new JSONObject(new String(cipher.doFinal(Base64.decode(envelope.getString("data"),Base64.NO_WRAP)),StandardCharsets.UTF_8));if(saved.getInt("version")!=version)throw new IOException();
            JSONObject result=connection(saved);current(revision);if(gate.revisions.clearing())return new JSONObject().put("connection",JSONObject.NULL);
            return new JSONObject().put("connection",result);
        }catch(Exception failure){throw new IOException("无法读取设备登录，原私有文件已保留，请重新登录或重试。",failure);}
    }
    private JSONObject encrypt(JSONObject input,int version,String id,SecretKey key)throws Exception{
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key);cipher.updateAAD(aad(version,id));
        JSONObject result=new JSONObject().put("version",version).put("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)).put("data",Base64.encodeToString(cipher.doFinal(connection(input).put("version",version).toString().getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP));
        if(version==2)result.put("keyId",id);return result;
    }
    void write(JSONObject input,long revision)throws Exception{
        JSONObject validated=connection(input);current(revision);byte[] previous;
        synchronized(gate.files){current(revision);previous=disk.read();}
        // A fresh vault never mutates the fixed legacy alias. Concurrent first
        // logins each prepare an independent key, so a late create cannot
        // invalidate the newer generation's committed ciphertext.
        int version=previous==null?2:1;String id=previous==null?UUID.randomUUID().toString():null,alias=previous==null?KEY_V2+id:legacyAlias;
        if(previous!=null)try{JSONObject envelope=new JSONObject(new String(previous,StandardCharsets.UTF_8));if(envelope.optInt("version")==2){id=keyId(envelope);alias=KEY_V2+id;version=2;}}catch(Exception malformed){/* Explicit login can replace malformed ciphertext using only our fixed legacy alias. */}
        JSONObject encrypted;
        try{
            SecretKey key=previous==null?keys.create(alias):keys.load(alias);
            encrypted=encrypt(validated,version,id,key);
        }catch(Exception failure){
            current(revision);if(!permanent(failure))throw failure;
            version=2;id=UUID.randomUUID().toString();encrypted=encrypt(validated,version,id,keys.create(KEY_V2+id));
        }
        current(revision);byte[] bytes=encrypted.toString().getBytes(StandardCharsets.UTF_8);if(bytes.length>MAXIMUM)throw new IOException();
        synchronized(gate.files){current(revision);disk.commit(bytes,guard(revision,false));}
    }
    void clear(long revision)throws Exception{synchronized(gate.files){disk.clear(guard(revision,true));}}
}
