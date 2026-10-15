import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {androidMihomoTargets,inspectAndroidMihomo,verifyAndroidMihomoApk} from '../scripts/android-mihomo-package.mjs';

function binary(abi){
  const expected=androidMihomoTargets[abi],wide=expected.elfClass===2,bytes=Buffer.alloc(512);
  bytes.set([0x7f,0x45,0x4c,0x46,expected.elfClass,1,1]);bytes.writeUInt16LE(3,16);bytes.writeUInt16LE(expected.machine,18);
  if(wide){bytes.writeBigUInt64LE(64n,32);bytes.writeUInt16LE(56,54);bytes.writeUInt16LE(3,56);bytes.writeUInt32LE(1,64);bytes.writeBigUInt64LE(16384n,64+48);bytes.writeUInt32LE(3,120);bytes.writeBigUInt64LE(256n,128);bytes.writeBigUInt64LE(21n,152);bytes.write('/system/bin/linker64\0',256);bytes.writeUInt32LE(4,176);bytes.writeBigUInt64LE(320n,184);bytes.writeBigUInt64LE(24n,208);}
  else{bytes.writeUInt32LE(52,28);bytes.writeUInt16LE(32,42);bytes.writeUInt16LE(3,44);bytes.writeUInt32LE(1,52);bytes.writeUInt32LE(4096,80);bytes.writeUInt32LE(3,84);bytes.writeUInt32LE(256,88);bytes.writeUInt32LE(19,100);bytes.write('/system/bin/linker\0',256);bytes.writeUInt32LE(4,116);bytes.writeUInt32LE(320,120);bytes.writeUInt32LE(24,132);}
  bytes.writeUInt32LE(8,320);bytes.writeUInt32LE(4,324);bytes.writeUInt32LE(1,328);bytes.write('Android\0',332);bytes.writeUInt32LE(34,340);
  return bytes;
}
test('Android package inventory pins three genuine Android ABIs and fixed upstream digests',()=>{
  assert.deepEqual(Object.keys(androidMihomoTargets).sort(),['arm64-v8a','armeabi-v7a','x86_64']);
  for(const [abi,target] of Object.entries(androidMihomoTargets)){assert.match(target.name,/^mihomo-android-/);assert.match(target.sha256,/^[a-f0-9]{64}$/);const result=inspectAndroidMihomo(binary(abi),target);assert.equal(result.machine,target.machine);assert.match(result.interpreter,/^\/system\/bin\/linker/);}
});
export function apkFixture(){
  const commit='88dcbf7f1614a67c3b36b848ee3592dfa92ada36',hash=value=>createHash('sha256').update(value).digest('hex');
  const files=new Map(),licenseBytes=Buffer.from('GPL license fixture'),noticeBytes=Buffer.from('source notice fixture');
  const manifest={schemaVersion:1,version:'1.19.32',sourceCommit:commit,minimumApi:34,targets:{},sources:[]};
  for(const [abi,target] of Object.entries(androidMihomoTargets)){const bytes=binary(abi);manifest.targets[abi]={archive:target,executable:{name:'libpetpal_mihomo.so',...inspectAndroidMihomo(bytes,target)}};files.set(`lib/${abi}/libpetpal_mihomo.so`,bytes);}
  for(const name of [`mihomo-${commit}.tar.gz`,'vendor.tar.gz']){const bytes=gzipSync(Buffer.from('corresponding source fixture '+name)),assetName=name.replace(/\.gz$/,'.gzip');manifest.sources.push({name,assetName,bytes:bytes.length,sha256:hash(bytes)});files.set('assets/mihomo/'+assetName,bytes);}
  files.set('assets/mihomo/manifest.json',Buffer.from(JSON.stringify(manifest)));files.set('assets/mihomo/LICENSE',licenseBytes);files.set('assets/mihomo/SOURCE-NOTICE.txt',noticeBytes);
  return{files,options:{manifest,licenseBytes,noticeBytes}};
}
test('actual APK Mihomo closure verifies exact three ELF files inert gzip source bytes and notices',()=>{
  const {files,options}=apkFixture(),result=verifyAndroidMihomoApk(files,options);
  assert.equal(result.cores.length,3);assert.equal(result.sources.length,2);assert.equal(result.verifiedPaths.length,8);
  for(const source of result.sources){assert.match(source.file,/\.tar\.gzip$/);assert.match(source.upstreamName,/\.tar\.gz$/);}
});
test('APK Mihomo closure rejects missing changed transformed or additional source assets',()=>{
  for(const mutate of [
    files=>files.delete('lib/arm64-v8a/libpetpal_mihomo.so'),
    files=>files.set('lib/x86_64/libpetpal_mihomo.so',Buffer.alloc(512)),
    files=>files.delete('assets/mihomo/vendor.tar.gzip'),
    files=>files.set('assets/mihomo/vendor.tar.gzip',Buffer.from('changed')),
    files=>{files.set('assets/mihomo/vendor.tar',Buffer.from('aapt-expanded'));files.delete('assets/mihomo/vendor.tar.gzip');},
    files=>files.set('assets/mihomo/extra.tar.gzip',gzipSync(Buffer.from('unexpected'))),
    files=>files.set('assets/mihomo/extra.txt',Buffer.from('unexpected')),
    files=>files.set('lib/arm64-v8a/unexpected.so',Buffer.from('unexpected')),
    files=>files.set('assets/mihomo/LICENSE',Buffer.from('changed')),
    files=>files.delete('assets/mihomo/SOURCE-NOTICE.txt'),
    files=>files.set('assets/mihomo/manifest.json',Buffer.from('{}')),
  ]){const {files,options}=apkFixture();mutate(files);assert.throws(()=>verifyAndroidMihomoApk(files,options));}
});
test('ELF review rejects Linux interpreters wrong architecture corrupt segments and inadequate 16 KB alignment',()=>{
  const target=androidMihomoTargets['arm64-v8a'];
  let bytes=binary('arm64-v8a');bytes.writeUInt16LE(62,18);assert.throws(()=>inspectAndroidMihomo(bytes,target),/target mismatch/);
  bytes=binary('arm64-v8a');bytes.writeBigUInt64LE(4096n,112);assert.throws(()=>inspectAndroidMihomo(bytes,target),/16 KB/);
  bytes=binary('arm64-v8a');bytes.fill(0,256,280);bytes.write('/lib/ld-linux.so\0',256);assert.throws(()=>inspectAndroidMihomo(bytes,target),/Android PIE/);
  bytes=binary('arm64-v8a');bytes.writeBigUInt64LE(1024n,128);assert.throws(()=>inspectAndroidMihomo(bytes,target),/overflow/);
});
test('APK assembly refuses a missing core while normal native policy tests can compile independently',async()=>{
  const gradle=await readFile(new URL('../android/app/build.gradle',import.meta.url),'utf8');assert.match(gradle,/useLegacyPackaging true/);assert.match(gradle,/endsWith\('NativeLibs'\)/);assert.match(gradle,/android-mihomo-package\.mjs', '--verify'/);
  for(const name of ['build-android.ps1','build-android.sh'])assert.match(await readFile(new URL('../scripts/'+name,import.meta.url),'utf8'),/node scripts\/android-mihomo-package\.mjs/);
});
