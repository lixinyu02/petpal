import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';
import {AppProxyManager,parseProxyConfiguration} from '../desktop/app-proxy.mjs';

const valid='proxies: []\nproxy-groups: []\nrules:\n  - MATCH,DIRECT\n';
const origin='https://fixture.invalid/clash.yaml?token=private-source-token';
const PREFIX='# petpal-remote-source: ';
const header=metadata=>PREFIX+Buffer.from(JSON.stringify(metadata)).toString('base64url')+'\n';
const metadata=source=>JSON.parse(Buffer.from(source.slice(PREFIX.length,source.indexOf('\n')),'base64url').toString('utf8'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));

async function fixture(t,options={}){
  const directory=options.directory||await mkdtemp(path.join(tmpdir(),'petpal-proxy-remote-'));
  const children=[],requests=[],routes=[];
  const network={async enable(){routes.push(true);},async disable(){routes.push(false);},async close(){}};
  const spawnImpl=(executable,args)=>{
    const child=new EventEmitter();Object.assign(child,{exitCode:null,kill(){if(child.exitCode===null){child.exitCode=0;queueMicrotask(()=>child.emit('close',0));}return true;}});
    children.push({executable,args,child});
    if(args.includes('-t')&&!options.holdValidation)queueMicrotask(()=>{child.exitCode=options.validationExit||0;child.emit('close',child.exitCode);});
    return child;
  };
  const manager=new AppProxyManager({directory,network,spawnImpl,resolveCore:async()=>({executable:'test-core'}),
    downloadImpl:async(url,{signal})=>{requests.push({url,signal});return{yaml:valid,url};},
    fetchImpl:async url=>new Response(JSON.stringify(url.endsWith('/version')?{version:'v1.19.32'}:{proxies:{}})),...options});
  t.after(async()=>{await manager.close();if(!options.directory){assert.equal(path.dirname(directory),tmpdir());assert.match(path.basename(directory),/^petpal-proxy-remote-/);await rm(directory,{recursive:true,force:true});}});
  await manager.load();return{manager,directory,children,requests,routes,file:path.join(directory,'config.yaml')};
}

test('remote source and canonical YAML commit atomically without exposing the URL or carrying imported comments into runtime',async t=>{
  const malicious=header({version:1,url:'https://wrong.invalid/private',updatedAt:'2026-01-01T00:00:00.000Z'});
  const f=await fixture(t,{downloadImpl:async()=>({yaml:malicious+valid,url:'https://redirect.invalid/ignored'})});
  const result=await f.manager.importRemoteConfiguration(origin),saved=await readFile(f.file,'utf8');
  assert.equal(result.remoteConfigured,true);assert.match(result.remoteUpdatedAt,/^\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(JSON.stringify(result),/private-source-token|wrong\.invalid|https:|yaml/);
  assert.equal(metadata(saved).url,origin);assert.equal(metadata(saved).updatedAt,result.remoteUpdatedAt);
  assert.equal(saved.split(PREFIX).length,2);assert.doesNotMatch(saved.slice(saved.indexOf('\n')+1),/remote-source|wrong\.invalid/);
  assert.equal(f.children.length,1);assert.equal(f.manager.status().running,false);assert.equal(f.routes.length,0);
  await f.manager.start();const runtime=await readFile(path.join(f.directory,'runtime.yaml'),'utf8');
  assert.doesNotMatch(runtime,/remote-source|private-source-token|wrong\.invalid/);
});

test('saved source reloads privately and update uses its initial URL rather than any redirected URL',async t=>{
  const f=await fixture(t);await f.manager.importRemoteConfiguration(origin);
  const before=await readFile(f.file,'utf8'),reloaded=await fixture(t,{directory:f.directory,downloadImpl:async(url)=>{
    assert.equal(url,origin);return{yaml:valid+'mode: global\n',url:'https://redirect.invalid/ignored'};
  }});
  assert.equal(reloaded.manager.status().remoteConfigured,true);
  assert.equal(reloaded.manager.status().remoteUpdatedAt,metadata(before).updatedAt);
  const updated=await reloaded.manager.updateRemoteConfiguration(),after=await readFile(f.file,'utf8');
  assert.equal(metadata(after).url,origin);assert.match(after,/mode: global/);assert.equal(updated.running,false);
});

test('local text/file import discards a forged source header and clears a previously saved source only after success',async t=>{
  const f=await fixture(t);await f.manager.importRemoteConfiguration(origin);const previous=await readFile(f.file,'utf8');
  await assert.rejects(f.manager.importConfiguration('proxies: [invalid'),/YAML/);
  assert.equal(await readFile(f.file,'utf8'),previous);assert.equal(f.manager.status().remoteConfigured,true);
  await f.manager.importConfiguration(previous);
  const result=f.manager.status();assert.equal(result.remoteConfigured,false);assert.equal(Object.hasOwn(result,'remoteUpdatedAt'),false);
  assert.doesNotMatch(await readFile(f.file,'utf8'),/remote-source|private-source-token/);
  await assert.rejects(f.manager.updateRemoteConfiguration(),/尚未保存/);
});

test('failed download and invalid YAML preserve every previous config byte and source while sanitizing unknown errors',async t=>{
  const f=await fixture(t);await f.manager.importRemoteConfiguration(origin);const before=await readFile(f.file,'utf8'),time=f.manager.status().remoteUpdatedAt;
  f.manager.download=async()=>{throw Object.assign(new Error('private-source-token upstream body'),{code:'PETPAL_PROXY'});};
  await assert.rejects(f.manager.importRemoteConfiguration('https://new.invalid/private'),error=>!error.message.includes('private-source-token')&&/下载失败/.test(error.message));
  assert.equal(await readFile(f.file,'utf8'),before);assert.equal(f.manager.status().remoteUpdatedAt,time);
  f.manager.download=async()=>({yaml:'<html>private-source-token</html>'});
  await assert.rejects(f.manager.updateRemoteConfiguration(),/YAML 对象/);
  assert.equal(await readFile(f.file,'utf8'),before);assert.equal(f.manager.status().remoteUpdatedAt,time);
  assert.doesNotMatch(JSON.stringify(f.manager.status()),/private-source-token|new\.invalid/);
});

test('failed core-validation stage retains the prior remote source and all config bytes',async t=>{
  const f=await fixture(t);await f.manager.importRemoteConfiguration(origin);const before=await readFile(f.file,'utf8');
  const bad=await fixture(t,{directory:f.directory,validationExit:1});
  await assert.rejects(bad.manager.importRemoteConfiguration('https://other.invalid/new'),/校验未通过/);
  assert.equal(await readFile(f.file,'utf8'),before);assert.equal(bad.manager.status().remoteConfigured,true);
  assert.equal(bad.manager.status().remoteUpdatedAt,metadata(before).updatedAt);
});

test('running proxy cannot download, replace or refresh its configuration and keeps the same child and route',async t=>{
  const f=await fixture(t);await f.manager.importRemoteConfiguration(origin);await f.manager.start();
  const child=f.manager.child,before=await readFile(f.file,'utf8'),requests=f.requests.length;
  await assert.rejects(f.manager.importRemoteConfiguration('https://other.invalid/new'),/先关闭/);
  await assert.rejects(f.manager.updateRemoteConfiguration(),/先关闭/);
  assert.equal(f.requests.length,requests);assert.equal(f.manager.child,child);assert.equal(f.manager.status().running,true);
  assert.equal(f.routes.filter(Boolean).length,1);assert.equal(await readFile(f.file,'utf8'),before);
});

for(const stage of [1,2,3,4,5])test(`identity recheck ${stage} prevents unauthorized remote download, validation or atomic replacement`,async t=>{
  const f=await fixture(t);await f.manager.importRemoteConfiguration(origin);const before=await readFile(f.file,'utf8'),initialRequests=f.requests.length,initialChildren=f.children.length;
  let checks=0;
  await assert.rejects(f.manager.importRemoteConfiguration('https://other.invalid/new',{authorize:async()=>{if(++checks===stage)throw new Error('private-identity-detail');}}),/保存失败/);
  assert.equal(checks,stage);assert.equal(await readFile(f.file,'utf8'),before);assert.equal(f.manager.status().remoteConfigured,true);
  assert.equal(f.requests.length,initialRequests+(stage===1?0:1));assert.equal(f.children.length,initialChildren+(stage>=4?1:0));
  assert.doesNotMatch(JSON.stringify(f.manager.status()),/private-identity-detail|other\.invalid/);
  assert.deepEqual((await readdir(f.directory)).filter(name=>name.endsWith('.tmp')||name.startsWith('candidate-')),[]);
});

for(const action of ['stop','close'])test(`${action} aborts an active remote download promptly and prevents persistence`,async t=>{
  let entered;const downloading=new Promise(resolve=>{entered=resolve;});
  const f=await fixture(t,{downloadImpl:async(url,{signal})=>new Promise((resolve,reject)=>{
    entered();signal.addEventListener('abort',()=>reject(new Error('private-network-error')),{once:true});
  })});
  const importing=f.manager.importRemoteConfiguration(origin);await downloading;assert.equal(f.manager.status().state,'checking');
  const stopping=f.manager[action]();await assert.rejects(importing,/取消/);await stopping;
  assert.equal(f.manager.status().state,'stopped');assert.equal(f.children.length,0);assert.equal(f.manager.status().remoteConfigured,false);
  await assert.rejects(readFile(f.file),{code:'ENOENT'});
});

test('stop during the initial authorization wait cannot start a new download after cancellation',async t=>{
  const f=await fixture(t);let enter,release;const entered=new Promise(resolve=>{enter=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const importing=f.manager.importRemoteConfiguration(origin,{authorize:async()=>{enter();await gate;}});await entered;
  const stopping=f.manager.stop();await tick();release();
  await assert.rejects(importing,/取消/);assert.equal((await stopping).state,'stopped');assert.equal(f.requests.length,0);assert.equal(f.children.length,0);
});

test('stop also cancels older queued imports instead of allowing another download before stopping',async t=>{
  let enter,calls=0;const entered=new Promise(resolve=>{enter=resolve;});
  const f=await fixture(t,{downloadImpl:async(url,{signal})=>{
    calls++;return new Promise((resolve,reject)=>{enter();signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});});
  }});
  const first=f.manager.importRemoteConfiguration(origin);await entered;
  const queued=f.manager.importRemoteConfiguration('https://second.invalid/config.yaml');
  const results=Promise.allSettled([first,queued]);const stopping=f.manager.stop();
  const settled=await results;await stopping;
  assert.equal(calls,1);assert.ok(settled.every(result=>result.status==='rejected'&&/取消/.test(result.reason.message)));
  assert.equal(f.manager.status().state,'stopped');assert.equal(f.children.length,0);
  await assert.rejects(readFile(f.file),{code:'ENOENT'});
});

test('stop cancels remote validation and preserves the previous manual configuration',async t=>{
  const f=await fixture(t,{holdValidation:true});await writeFile(f.file,valid);await f.manager.load();
  const importing=f.manager.importRemoteConfiguration(origin);while(!f.children.length)await tick();
  const stopping=f.manager.stop();await assert.rejects(importing,/取消/);await stopping;
  assert.equal(await readFile(f.file,'utf8'),valid);assert.equal(f.manager.status().remoteConfigured,false);
});

test('malformed or unbounded private metadata never becomes a refresh URL or leaks a saved URL in status',async t=>{
  const f=await fixture(t);const stamp='2026-01-01T00:00:00.000Z';
  const invalid=[PREFIX+'not base64\n',PREFIX+'x'.repeat(32768)+'\n',header({version:1,url:'https://user:secret@fixture.invalid/',updatedAt:stamp}),
    header({version:1,url:origin,updatedAt:'not-a-date'}),header({version:1,url:origin,updatedAt:'2026-02-30T00:00:00.000Z'}),
    header({version:2,url:origin,updatedAt:stamp}),header({version:1,url:origin,updatedAt:stamp,extra:true})];
  for(const prefix of invalid){
    await writeFile(f.file,prefix+valid);await f.manager.load();
    const status=f.manager.status();assert.equal(status.configured,false);assert.equal(status.remoteConfigured,false);assert.equal(Object.hasOwn(status,'remoteUpdatedAt'),false);
    await assert.rejects(f.manager.updateRemoteConfiguration(),/尚未保存/);assert.doesNotMatch(JSON.stringify(status),/private-source-token|secret@/);
  }
  assert.equal(f.requests.length,0);
});

test('expanded aliases and canonical indentation cannot bypass the 4 MiB persisted-YAML bound',async t=>{
  const f=await fixture(t);await f.manager.importRemoteConfiguration(origin);const before=await readFile(f.file,'utf8');
  let nested=Array(45000).fill('x');for(let i=0;i<45;i++)nested={x:nested};
  await assert.rejects(f.manager.importConfiguration(JSON.stringify(nested)),/规范化.*4 MB/);
  assert.throws(()=>parseProxyConfiguration(`base: &large ${'x'.repeat(1024*1024)}\ncopy: [*large, *large, *large, *large, *large]\n`),/展开内容过多/);
  assert.equal(await readFile(f.file,'utf8'),before);
});

test('a valid near-limit YAML plus the separate bounded internal source header reloads successfully',async t=>{
  const large=`padding: ${'x'.repeat(4*1024*1024-256)}\n`;
  const f=await fixture(t,{downloadImpl:async()=>({yaml:large,url:origin})});
  await f.manager.importRemoteConfiguration(origin);
  assert.ok(Buffer.byteLength(await readFile(f.file,'utf8'))>Buffer.byteLength(large));
  const reloaded=await fixture(t,{directory:f.directory});assert.equal(reloaded.manager.status().configured,true);assert.equal(reloaded.manager.status().remoteConfigured,true);
  await assert.rejects(f.manager.importConfiguration(large+'#'.repeat(300)),/不超过 4 MB/);
});

test('manager integrates actual loopback HTTP download and strips server-controlled source metadata before saving',async t=>{
  const requests=[];const server=http.createServer((req,res)=>{requests.push({url:req.url,cookie:req.headers.cookie,auth:req.headers.authorization});res.end(header({version:1,url:'https://forged.invalid/',updatedAt:'2026-01-01T00:00:00.000Z'})+valid);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const {downloadProxyConfiguration}=await import('../desktop/app-proxy-download.mjs');
  const f=await fixture(t,{downloadImpl:downloadProxyConfiguration}),url=`http://127.0.0.1:${server.address().port}/config.yaml?token=private-test-token`;
  await f.manager.importRemoteConfiguration(url);
  assert.equal(requests.length,1);assert.equal(requests[0].auth,undefined);assert.equal(requests[0].cookie,undefined);
  const saved=await readFile(f.file,'utf8');assert.equal(metadata(saved).url,url);assert.doesNotMatch(saved.slice(saved.indexOf('\n')+1),/forged\.invalid/);
});
