// Build-time only: fixed upstream Android payloads, never downloaded by the app.
import {readFile,writeFile,mkdir,copyFile,lstat,readdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import {downloadMihomoArtifact} from './mihomo-package.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version='1.19.32',commit='88dcbf7f1614a67c3b36b848ee3592dfa92ada36';
const upstream='https://github.com/MetaCubeX/mihomo/releases/download/v'+version+'/';
export const androidMihomoTargets={
  'arm64-v8a':{name:`mihomo-android-arm64-v8-v${version}.gz`,bytes:21866463,sha256:'42b1f2be8702484d3ae6238daab392622f54bd0d264966700f1f28f52596e326',machine:183,elfClass:2},
  'armeabi-v7a':{name:`mihomo-android-armv7-v${version}.gz`,bytes:22190735,sha256:'cbac13a26ab77ce80871a064783a02246a856a20ab7435fe301fa1665e99acf4',machine:40,elfClass:1},
  'x86_64':{name:`mihomo-android-amd64-v${version}.gz`,bytes:23471244,sha256:'91c159015e7d8aaff22153b9fd18749a0c7258d6f252ea344ecace975ce17413',machine:62,elfClass:2},
};
const digest=value=>createHash('sha256').update(value).digest('hex');
const sourceAssetName=name=>name.replace(/\.gz$/,'.gzip');
export function inspectAndroidMihomo(bytes,expected){
  if(bytes.length<64||bytes.subarray(0,4).toString('hex')!=='7f454c46'||bytes[4]!==expected.elfClass||bytes[5]!==1||bytes.readUInt16LE(16)!==3||bytes.readUInt16LE(18)!==expected.machine)throw Error('Android Mihomo ELF target mismatch');
  const wide=bytes[4]===2,offset=wide?Number(bytes.readBigUInt64LE(32)):bytes.readUInt32LE(28),size=bytes.readUInt16LE(wide?54:42),count=bytes.readUInt16LE(wide?56:44);
  if(size!==(wide?56:32)||count<1||count>100||offset+size*count>bytes.length)throw Error('Android Mihomo ELF header invalid');
  let loads=0,interpreter='',androidApi=null;const alignments=[];
  for(let i=0;i<count;i++){
    const p=offset+i*size,type=bytes.readUInt32LE(p),fileOffset=wide?Number(bytes.readBigUInt64LE(p+8)):bytes.readUInt32LE(p+4),fileBytes=wide?Number(bytes.readBigUInt64LE(p+32)):bytes.readUInt32LE(p+16);
    if(fileOffset+fileBytes>bytes.length)throw Error('Android Mihomo ELF segment overflow');
    if(type===1){loads++;const alignment=wide?Number(bytes.readBigUInt64LE(p+48)):bytes.readUInt32LE(p+28);alignments.push(alignment);if(expected.elfClass===2&&alignment<16384)throw Error('Android Mihomo lacks 16 KB PT_LOAD alignment');}
    if(type===3)interpreter=bytes.subarray(fileOffset,fileOffset+fileBytes).toString('utf8').replace(/\0+$/,'');
    if(type===4){
      let at=fileOffset;while(at+12<=fileOffset+fileBytes){const names=bytes.readUInt32LE(at),descriptions=bytes.readUInt32LE(at+4),kind=bytes.readUInt32LE(at+8),name=at+12,description=name+Math.ceil(names/4)*4,end=description+Math.ceil(descriptions/4)*4;if(end>fileOffset+fileBytes)throw Error('Invalid Android ELF note');if(bytes.subarray(name,name+names).toString('utf8').replace(/\0+$/,'')==='Android'&&kind===1&&descriptions>=4)androidApi=bytes.readUInt32LE(description);at=end;}
    }
  }
  if(!loads||interpreter!==(wide?'/system/bin/linker64':'/system/bin/linker'))throw Error('Android Mihomo is not an Android PIE executable');
  return{format:'ELF',machine:expected.machine,elfClass:expected.elfClass,interpreter,androidApi,loadAlignments:alignments,page16k:expected.elfClass===2?true:null,bytes:bytes.length,sha256:digest(bytes)};
}
async function fetchPinned(url,expected,file){
  return downloadMihomoArtifact(file,{name:expected.name,bytes:expected.bytes,sha256:expected.sha256,url});
}
export async function prepareAndroidMihomo({directory=root,abis=Object.keys(androidMihomoTargets)}={}){
  const cache=path.join(directory,'.tools/mihomo/android-v'+version),asset=path.join(directory,'android/app/src/main/assets/mihomo');await mkdir(cache,{recursive:true});await mkdir(asset,{recursive:true});
  const manifest={schemaVersion:1,version,repository:'https://github.com/MetaCubeX/mihomo',sourceCommit:commit,
    // Official binaries are built against NDK API 34. Lower APIs remain disabled
    // until a reproducible lower-API build and native-device acceptance exist.
    minimumApi:34,minimumApiBasis:'upstream NDK API 34 build; conservative feature gate, no lower-API runtime claim',targets:{},sources:[]};
  for(const abi of abis){
    const target=androidMihomoTargets[abi];if(!target)throw Error('Unsupported Android Mihomo ABI');
    const compressed=await fetchPinned(upstream+target.name,target,path.join(cache,target.name));
    const executable=gunzipSync(compressed,{maxOutputLength:100*1024*1024}),audit=inspectAndroidMihomo(executable,target);
    if(audit.androidApi!==34)throw Error('Android Mihomo NDK API note differs from the reviewed API 34 build');
    const destination=path.join(directory,'android/app/src/main/jniLibs',abi);await mkdir(destination,{recursive:true});await writeFile(path.join(destination,'libpetpal_mihomo.so'),executable);
    manifest.targets[abi]={archive:{...target,url:upstream+target.name},executable:{name:'libpetpal_mihomo.so',...audit}};
  }
  const desktop=JSON.parse(await readFile(path.join(directory,'desktop/native/mihomo/manifest.json'),'utf8'));
  for(const source of desktop.sources){
    const cached=path.join(directory,'.tools/mihomo/v'+version+'/source',source.name);let bytes;
    try{bytes=await readFile(cached);if(bytes.length!==source.bytes||digest(bytes)!==source.sha256)throw Error();}catch{bytes=await fetchPinned(source.url,source,path.join(cache,source.name));}
    // AAPT transparently expands assets ending in .gz and removes that suffix.
    // Keep the exact upstream gzip bytes under an inert .gzip asset name.
    const assetName=sourceAssetName(source.name);await writeFile(path.join(asset,assetName),bytes);manifest.sources.push({...source,assetName});
    const legacy=path.join(asset,source.name);let legacyBytes;
    try{const info=await lstat(legacy);if(!info.isFile()||info.isSymbolicLink())throw Error('Legacy Android source asset is not a regular generated file');legacyBytes=await readFile(legacy);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(legacyBytes){if(legacyBytes.length!==source.bytes||digest(legacyBytes)!==source.sha256)throw Error('Legacy Android source asset differs; preserve and inspect it before rebuilding');await unlink(legacy);}
  }
  await copyFile(path.join(directory,'desktop/native/mihomo/LICENSE'),path.join(asset,'LICENSE'));
  await copyFile(path.join(directory,'android/mihomo/SOURCE-NOTICE.txt'),path.join(asset,'SOURCE-NOTICE.txt'));
  const serialized=JSON.stringify(manifest,null,2)+'\n';await writeFile(path.join(asset,'manifest.json'),serialized);
  await writeFile(path.join(directory,'android/mihomo/manifest.json'),serialized);
  return manifest;
}
export async function verifyAndroidMihomo({directory=root}={}){
  const pinned=JSON.parse(await readFile(path.join(directory,'android/mihomo/manifest.json'),'utf8'));
  if(pinned.version!==version||pinned.sourceCommit!==commit||pinned.minimumApi!==34||Object.keys(pinned.targets).sort().join(',')!==Object.keys(androidMihomoTargets).sort().join(','))throw Error('Android Mihomo manifest does not cover the required pinned targets');
  const asset=path.join(directory,'android/app/src/main/assets/mihomo'),generated=JSON.parse(await readFile(path.join(asset,'manifest.json'),'utf8'));
  if(JSON.stringify(generated)!==JSON.stringify(pinned))throw Error('Android Mihomo generated manifest changed; run node scripts/android-mihomo-package.mjs');
  for(const [abi,target] of Object.entries(pinned.targets)){
    const file=path.join(directory,'android/app/src/main/jniLibs',abi,'libpetpal_mihomo.so'),info=await lstat(file);if(!info.isFile()||info.isSymbolicLink())throw Error('Android Mihomo must be a regular packaged file');
    const bytes=await readFile(file),actual=inspectAndroidMihomo(bytes,androidMihomoTargets[abi]);if(JSON.stringify({name:'libpetpal_mihomo.so',...actual})!==JSON.stringify(target.executable))throw Error('Android Mihomo binary integrity changed');
  }
  for(const source of pinned.sources){if(source.assetName!==sourceAssetName(source.name))throw Error('Android source asset name is not AAPT-safe');const bytes=await readFile(path.join(asset,source.assetName));if(bytes.length!==source.bytes||digest(bytes)!==source.sha256)throw Error('Android Mihomo corresponding source integrity changed');}
  for(const file of ['LICENSE','SOURCE-NOTICE.txt']){const source=file==='LICENSE'?path.join(directory,'desktop/native/mihomo/LICENSE'):path.join(directory,'android/mihomo',file);if(!(await readFile(source)).equals(await readFile(path.join(asset,file))))throw Error('Android Mihomo license notice missing or changed');}
  const allowed=new Set(['.gitignore','manifest.json','LICENSE','SOURCE-NOTICE.txt',...pinned.sources.map(source=>source.assetName)]);
  if((await readdir(asset)).some(name=>!allowed.has(name)))throw Error('Unexpected Android Mihomo source asset');
  return{version,minimumApi:pinned.minimumApi,abis:Object.keys(pinned.targets)};
}
/** Audit actual APK bytes, not the staging directory. Only exact pinned source
 * assets are permitted; neither arbitrary archives nor extra native code get
 * a general exception from the APK's desktop-runtime exclusion. */
export function verifyAndroidMihomoApk(files,{manifest,licenseBytes,noticeBytes}={}){
  const fail=message=>{throw Error('Android Mihomo APK '+message);};
  if(!(files instanceof Map)||!manifest||manifest.schemaVersion!==1||manifest.version!==version||manifest.sourceCommit!==commit||manifest.minimumApi!==34||!manifest.targets||Object.keys(manifest.targets).sort().join(',')!==Object.keys(androidMihomoTargets).sort().join(','))fail('manifest is incomplete or changed');
  if(!Buffer.isBuffer(licenseBytes)||!licenseBytes.length||!Buffer.isBuffer(noticeBytes)||!noticeBytes.length)fail('trusted license and notice inputs are missing');
  const prefix='assets/mihomo/',paths=new Set([prefix+'manifest.json',prefix+'LICENSE',prefix+'SOURCE-NOTICE.txt']),cores=[],sources=[];
  let packagedManifest;try{packagedManifest=JSON.parse(files.get(prefix+'manifest.json').toString('utf8'));}catch{fail('manifest asset is missing or invalid');}
  if(!isDeepStrictEqual(packagedManifest,manifest))fail('manifest asset differs from the pinned source manifest');
  if(!files.get(prefix+'LICENSE')?.equals(licenseBytes)||!files.get(prefix+'SOURCE-NOTICE.txt')?.equals(noticeBytes))fail('license or source notice is missing or changed');
  for(const [abi,expected] of Object.entries(manifest.targets)){
    const target=androidMihomoTargets[abi],file=`lib/${abi}/libpetpal_mihomo.so`,bytes=files.get(file);paths.add(file);
    if(!bytes)fail('core is missing for '+abi);
    const actual={name:'libpetpal_mihomo.so',...inspectAndroidMihomo(bytes,target)};
    if(actual.androidApi!==manifest.minimumApi||!isDeepStrictEqual(actual,expected.executable))fail('core integrity or ELF metadata changed for '+abi);
    cores.push({file,...actual});
  }
  const expectedSourceNames=[`mihomo-${commit}.tar.gz`,'vendor.tar.gz'];
  if(!Array.isArray(manifest.sources)||manifest.sources.length!==2||manifest.sources.map(source=>source.name).sort().join(',')!==expectedSourceNames.sort().join(','))fail('corresponding source inventory changed');
  for(const source of manifest.sources){
    if(source.assetName!==sourceAssetName(source.name))fail('source asset has an unsafe or AAPT-transformed name');
    const file=prefix+source.assetName,bytes=files.get(file);paths.add(file);
    if(!bytes||bytes.length!==source.bytes||digest(bytes)!==source.sha256||bytes[0]!==0x1f||bytes[1]!==0x8b)fail('corresponding source is missing or changed');
    sources.push({file,upstreamName:source.name,bytes:bytes.length,sha256:source.sha256});
  }
  for(const file of files.keys())if((file.startsWith(prefix)||file.startsWith('lib/'))&&!paths.has(file))fail('contains an unexpected source asset or native library');
  return{version,minimumApi:manifest.minimumApi,cores,sources,licenseSha256:digest(licenseBytes),noticeSha256:digest(noticeBytes),verifiedPaths:[...paths].sort()};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.includes('--verify'))process.stdout.write(JSON.stringify(await verifyAndroidMihomo())+'\n');
  else {const manifest=await prepareAndroidMihomo();process.stdout.write(JSON.stringify({version:manifest.version,minimumApi:manifest.minimumApi,targets:manifest.targets},null,2)+'\n');}
}
