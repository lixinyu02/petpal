import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {detectDownloadTarget} from '../src/platform/download-target.mjs';

const hints=(platform,architecture,bitness='64')=>({userAgentData:{platform,async getHighEntropyValues(request){assert.deepEqual(request,['architecture','bitness','platform']);return{platform,architecture,bitness};}}});

test('native installed runtime is exact and takes precedence over browser hints',async()=>{
  for(const [platform,expected]of[['win32','windows'],['linux','ubuntu']])for(const arch of['x64','arm64']){
    const result=await detectDownloadTarget({runtime:{platform,arch},navigator:{userAgentData:{getHighEntropyValues(){throw Error('must not query when native runtime is available');}}}});
    assert.deepEqual(result,{platform:expected,arch,source:'native'});
  }
});

test('Chrome high entropy architecture and bitness identify Windows and Ubuntu ARM64/x64',async()=>{
  for(const[platform,expected]of[['Windows','windows'],['Linux','ubuntu']])for(const[architecture,arch]of[['x86','x64'],['arm','arm64']]){
    assert.deepEqual(await detectDownloadTarget({navigator:hints(platform,architecture)}),{platform:expected,arch,source:'ua-ch'});
  }
});

test('reduced Win64/x64 user agents and absent/denied client hints never guess x64',async()=>{
  const userAgent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0';
  assert.deepEqual(await detectDownloadTarget({navigator:{userAgent,platform:'Win32'}}),{platform:null,arch:null,source:'unknown'});
  assert.deepEqual(await detectDownloadTarget({navigator:{userAgent,userAgentData:{platform:'Windows',getHighEntropyValues:async()=>{throw Error('permission denied');}}}}),{platform:'windows',arch:null,source:'unknown'});
  for(const[architecture,bitness]of[['x86','32'],['arm','32'],['','64'],['mips','64'],['arm',64],['x86',null]]){
    assert.deepEqual(await detectDownloadTarget({navigator:hints('Windows',architecture,bitness)}),{platform:'windows',arch:null,source:'unknown'});
  }
});

test('Android universal APK requires no architecture guess or high entropy query',async()=>{
  const result=await detectDownloadTarget({navigator:{userAgentData:{platform:'Android',getHighEntropyValues(){throw Error('not needed');}}}});
  assert.deepEqual(result,{platform:'android',arch:'universal',source:'ua-ch'});
  assert.deepEqual(await detectDownloadTarget({navigator:{userAgent:'Mozilla/5.0 (Linux; Android 15; arm64)'}}),{platform:'android',arch:'universal',source:'ua-ch'});
});

test('unavailable unknown and timed-out environments stay manual with a bounded wait',async()=>{
  assert.deepEqual(await detectDownloadTarget(),{platform:null,arch:null,source:'unknown'});
  for(const platform of['macOS','Chrome OS','__proto__'])assert.deepEqual(await detectDownloadTarget({navigator:hints(platform,'arm')}),{platform:null,arch:null,source:'unknown'});
  assert.deepEqual(await detectDownloadTarget({runtime:{platform:'__proto__',arch:'x64'}}),{platform:null,arch:null,source:'unknown'});
  assert.deepEqual(await detectDownloadTarget({navigator:{userAgentData:{platform:'Windows',getHighEntropyValues:()=>new Promise(()=>{})}},timeoutMs:5}),{platform:'windows',arch:null,source:'unknown'});
});

test('preload exposes frozen readonly runtime metadata without requiring process in older environments',async()=>{
  const source=await readFile(new URL('../desktop/preload.cjs',import.meta.url),'utf8');
  for(const process of[undefined,{platform:'win32',arch:'arm64'},{platform:'linux',arch:'x64'}]){
    let exposed;const context={require(name){assert.equal(name,'electron');return{ipcRenderer:{invoke(){throw Error('metadata must not request IPC');},on(){},removeListener(){}},contextBridge:{exposeInMainWorld(_name,value){exposed=value;}}};}};
    if(process)context.process=process;vm.runInNewContext(source,context);
    assert.ok(Object.isFrozen(exposed));assert.ok(Object.isFrozen(exposed.runtime));
    assert.deepEqual(JSON.parse(JSON.stringify(exposed.runtime)),process||{platform:'',arch:''});
  }
});
