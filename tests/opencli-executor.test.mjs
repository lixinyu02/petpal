import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { DesktopExecutor, createOpenCliHandlers } from '../desktop/executor.mjs';
import { OpenCliManager } from '../server/opencli-manager.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const identity = extra => ({ instanceId:'instance-one', user:{id:'user-one',canUseCodex:true,agentAccess:'full',...extra} });
const connection = extra => ({url:'https://central.example',token:'synthetic-opencli-session',instanceId:'instance-one',userId:'user-one',...extra});
const config = () => ({revision:randomUUID(),enabled:true});
class ExecutorFixture extends DesktopExecutor {
  async _register(ctx) { ctx.hostId='owned-pc';ctx.connectionId='owned-connection'; }
  _start() {}
  async _unregister() {}
}
async function executor(t,options={}) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'petpal-opencli-executor-'));
  const manager=new ExecutorFixture({dataDir:directory,fetchImpl:async()=>Response.json(identity()),resolveCommand:async()=>({file:'synthetic-codex'}),...options});
  t.after(async()=>{await manager.close();assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('petpal-opencli-executor-'));await rm(directory,{recursive:true,force:true});});
  return manager;
}

test('native OpenCLI exposes fixed trusted-main IPC, passive inventory, and stable account-scoped settings',async t=>{
  const calls=[],options=[],initial=config();
  const opencliManager={config:async()=>initial,status:async()=>({config:initial,ready:false}),sites:async args=>({sites:[],...args}),executeBrowser:async(args,{signal})=>{assert.equal(signal.aborted,false);calls.push(args);return{action:args.action,ready:false};}};
  const manager=await executor(t,{toolsFactory:value=>{options.push(value);return{opencliManager,close:async()=>{}};}});
  await assert.rejects(manager.manageOpenCli('status'),/登录/);await manager.connect(connection());
  const trusted={},handlers=createOpenCliHandlers(manager,event=>event===trusted);
  assert.deepEqual(Object.keys(handlers),['config','status','configure','action','sites','cancel'].map(action=>`petpal:opencli:${action}`));
  for(const handler of Object.values(handlers))assert.throws(()=>handler({},{}),/可信主窗口/);
  assert.deepEqual(await handlers['petpal:opencli:config'](trusted),initial);
  assert.deepEqual(await handlers['petpal:opencli:sites'](trusted,{site:'hackernews',command:'top'}),{sites:[],site:'hackernews',command:'top'});
  assert.equal((await handlers['petpal:opencli:action'](trusted,{action:'connect'})).ready,false);
  assert.deepEqual(calls,[{action:'connect'}]);
  assert.equal(options.length,1);assert.equal(options[0].musicMcpScope,'instance-one:user-one');
  assert.equal(options[0].opencliDataDir,manager.musicMcpDataDir);assert.ok(options[0].dataDir.startsWith(manager.current.directory));
  await manager.disconnect();await manager.connect(connection());await manager.manageOpenCli('config');
  assert.equal(options[1].opencliDataDir,options[0].opencliDataDir);assert.equal(options[1].musicMcpScope,options[0].musicMcpScope);
});

test('native OpenCLI rejects query, arbitrary commands, malformed config and injected browser/site arguments before runtime',async t=>{
  let created=0;
  const manager=await executor(t,{toolsFactory:()=>{created++;throw Error('must not create runtime');}});await manager.connect(connection());
  for(const action of ['query','exec','run','prepare','connect'])await assert.rejects(manager.manageOpenCli(action,{}));
  for(const body of [null,[],{enabled:true},{revision:randomUUID(),enabled:true,command:'npx'},{revision:randomUUID(),enabled:'yes'},
    {revision:randomUUID(),enabled:true,siteOrigins:{},command:'npx'},
    {revision:randomUUID(),enabled:true,siteOrigins:{bilibili:['https://www.bilibili.com']}},
    {revision:randomUUID(),enabled:true,siteOrigins:{wlgo:['http://untrusted.example.com']}},
    {revision:randomUUID(),enabled:true,siteOrigins:{wlgo:['https://forum.example.com/path']}},
    {revision:randomUUID(),enabled:true,siteOrigins:{wlgo:['https://forum.example.com'],unknown:[]}},
    {revision:randomUUID(),enabled:true,siteOrigins:[]},
  ])await assert.rejects(manager.manageOpenCli('configure',body),error=>error.code==='executor_protocol_invalid');
  for(const body of [{url:'https://example.com'},{site:'../../private'},{site:'x',command:'--help'},{site:'x',args:['top']},null])await assert.rejects(manager.manageOpenCli('sites',body));
  for(const body of [{action:'eval',code:'1+1'},{action:'open',url:'file:///tmp/code.html'},{action:'tabs',command:'shell'},{action:'click',tabId:'owned',target:'selector'}])await assert.rejects(manager.manageOpenCli('action',body));
  await assert.rejects(manager.manageOpenCli('status',{token:'untrusted'}));assert.equal(created,0);
});

test('real OpenCLI default config revision passes native configure and saved disable survives reconnection',async t=>{
  let constructed=0;
  const manager=await executor(t,{toolsFactory:options=>{
    constructed++;
    const opencliManager=new OpenCliManager({dataDir:options.opencliDataDir,scope:options.musicMcpScope,
      browser:{close:async()=>{},status:async()=>({available:true,ready:false})}});
    return{opencliManager,close:()=>opencliManager.close()};
  }});
  await manager.connect(connection());
  const initial=await manager.manageOpenCli('config');assert.equal(initial.enabled,true);
  assert.match(initial.revision,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const changed=await manager.manageOpenCli('configure',{...initial,enabled:false});assert.equal(changed.enabled,false);assert.notEqual(changed.revision,initial.revision);
  await manager.disconnect();await manager.connect(connection());assert.deepEqual(await manager.manageOpenCli('config'),changed);assert.equal(constructed,2);
});

test('native OpenCLI saves scoped siteOrigins through existing CAS and old two-field updates preserve them',async t=>{
  const manager=await executor(t,{toolsFactory:options=>{
    const opencliManager=new OpenCliManager({dataDir:options.opencliDataDir,scope:options.musicMcpScope,
      browser:{close:async()=>{},status:async()=>({available:true,ready:false})}});
    return{opencliManager,close:()=>opencliManager.close()};
  }});
  await manager.connect(connection());
  const initial=await manager.manageOpenCli('config');
  const configured=await manager.manageOpenCli('configure',{...initial,siteOrigins:{wlgo:['https://FORUM.example.com/'],dyyj:['https://film.example.com']}});
  assert.deepEqual(configured.siteOrigins,{dyyj:['https://film.example.com'],wlgo:['https://forum.example.com']});
  assert.notEqual(configured.revision,initial.revision);
  await assert.rejects(manager.manageOpenCli('configure',{...initial,siteOrigins:{wlgo:['https://stale.example.com']}}),error=>error.code==='config_changed');
  assert.deepEqual(await manager.manageOpenCli('config'),configured);
  const disabled=await manager.manageOpenCli('configure',{revision:configured.revision,enabled:false});
  assert.deepEqual(disabled.siteOrigins,configured.siteOrigins);
  await manager.disconnect();await manager.connect(connection());
  assert.deepEqual(await manager.manageOpenCli('config'),disabled);
  const reset=await manager.manageOpenCli('configure',{revision:disabled.revision,enabled:true,siteOrigins:{}});
  assert.equal(reset.siteOrigins,undefined);
  assert.deepEqual((await manager.manageOpenCli('sites',{site:'wlgo'})).sites[0].domains,['www.wlgooo.com','wlgooo.com']);
});

test('native OpenCLI rechecks exact account and full Agent permission before touching scoped runtime',async t=>{
  let verified=identity(),created=0;
  const manager=await executor(t,{fetchImpl:async()=>Response.json(verified),toolsFactory:()=>{created++;throw Error('must not create runtime');}});await manager.connect(connection());
  for(const change of [{agentAccess:'workspace'},{id:'other-user'},{canUseCodex:false}]){verified=identity(change);await assert.rejects(manager.manageOpenCli('sites',{}));assert.equal(created,0);}
  verified={...identity(),instanceId:'another-instance'};await assert.rejects(manager.manageOpenCli('config'));assert.equal(created,0);
});

test('native browser actions and configuration cannot race an active Agent; inventory remains passive',async t=>{
  let actions=0,changes=0;
  const manager=await executor(t,{toolsFactory:()=>({opencliManager:{config:async()=>config(),status:async()=>({ready:false}),sites:async()=>({sites:[]}),executeBrowser:async()=>{actions++;},configure:async()=>{changes++;}},close:async()=>{}})});
  await manager.connect(connection());manager.current.run={};
  try {
    await assert.rejects(manager.manageOpenCli('action',{action:'connect'}),/当前 Agent/);
    await assert.rejects(manager.manageOpenCli('configure',config()),/当前 Agent/);
    assert.deepEqual(await manager.manageOpenCli('sites',{}),{sites:[]});assert.equal(actions,0);assert.equal(changes,0);
  } finally {manager.current.run=null;}
});

test('incoming Agent waits for browser management cleanup before starting on the same execution computer',async t=>{
  const started=deferred(),release=deferred(),runStarted=deferred();let running=false;
  const manager=await executor(t,{toolsFactory:()=>({opencliManager:{executeBrowser:async()=>{started.resolve();await release.promise;return{ready:false};}},close:async()=>{}})});
  await manager.connect(connection());manager._run=async(ctx)=>{running=true;ctx.run=null;runStarted.resolve();};
  const action=manager.manageOpenCli('action',{action:'connect'});await started.promise;
  const command={id:'owned-command',type:'run',runId:'owned-run',conversationId:'owned-conversation',prompt:'read-only acceptance',permissions:{access:'read-only',approval:'auto'},model:'gpt-6-luna',effort:'low',codexRevision:randomUUID(),relayToken:'synthetic-relay',attachments:[]};
  const sending=manager._command(manager.current,command);
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(running,false);
  release.resolve();await action;await sending;await runStarted.promise;assert.equal(running,true);
});

test('native cancel aborts only OpenCLI settings work and waits for its cleanup while staying online',async t=>{
  const started=deferred(),release=deferred(),aborted=deferred();let signal,statusCalls=0;
  const manager=await executor(t,{toolsFactory:()=>({opencliManager:{executeBrowser:async(_args,options)=>{signal=options.signal;started.resolve();signal.addEventListener('abort',()=>aborted.resolve(),{once:true});await release.promise;return{ready:true};},status:async()=>{statusCalls++;return{ready:false};}},close:async()=>{}})});
  await manager.connect(connection());const action=manager.manageOpenCli('action',{action:'connect'}),rejected=assert.rejects(action);await started.promise;
  const stopping=manager.manageOpenCli('cancel');await aborted.promise;
  assert.equal(signal.aborted,true);assert.equal(statusCalls,0);await assert.rejects(manager.manageOpenCli('sites',{}),/正在处理/);
  release.resolve();assert.equal((await stopping).ready,false);await rejected;assert.equal(manager.status().state,'online');assert.equal(statusCalls,1);
});

test('native logout aborts browser operation and waits for owned runtime closure',async t=>{
  const started=deferred(),closing=deferred(),closed=deferred();let signal;
  const manager=await executor(t,{toolsFactory:()=>({opencliManager:{executeBrowser:async(_args,options)=>{signal=options.signal;started.resolve();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}},close:()=>{closing.resolve();return closed.promise;}})});
  await manager.connect(connection());const action=manager.manageOpenCli('action',{action:'connect'}),rejected=assert.rejects(action);await started.promise;
  let retired=false;const retiring=manager.disconnect().then(()=>{retired=true;});await closing.promise;
  assert.equal(signal.aborted,true);assert.equal(retired,false);closed.resolve();await retiring;await rejected;assert.equal(retired,true);
});

test('native asynchronous reads and cancellation cannot publish a result after account privilege revocation',async t=>{
  for(const action of ['status','cancel']){
    const started=deferred(),release=deferred();let verified=identity();
    const manager=await executor(t,{fetchImpl:async()=>Response.json(verified),toolsFactory:()=>({opencliManager:{status:async()=>{started.resolve();await release.promise;return{privateMarker:'late-result'};}},close:async()=>{}})});
    await manager.connect(connection());const reading=manager.manageOpenCli(action),rejected=assert.rejects(reading,/完整 Agent 权限/);await started.promise;
    verified=identity({agentAccess:'workspace'});release.resolve();await rejected;
  }
});

test('OpenCLI preload is frozen and exposes browser management rather than arbitrary CLI or Agent query calls',async()=>{
  const calls=[];let bridge;
  vm.runInNewContext(await readFile(new URL('../desktop/preload.cjs',import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>{bridge=value;}},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve();},on(){}}}),addEventListener(){}});
  assert.equal(Object.isFrozen(bridge.opencli),true);assert.deepEqual(Object.keys(bridge.opencli),['config','status','configure','action','sites','cancel']);
  await bridge.opencli.sites({site:'hackernews'});await bridge.opencli.action({action:'connect'});await bridge.opencli.cancel();
  assert.deepEqual(calls,[['petpal:opencli:sites',{site:'hackernews'}],['petpal:opencli:action',{action:'connect'}],['petpal:opencli:cancel']]);assert.equal(bridge.opencli.query,undefined);
});

async function transportFixture({native,api=async()=>({})}={}) {
  let epoch=1;
  class SessionChangedError extends Error {}
  const exports={},source=await readFile(new URL('../src/platform/opencli.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(compiled,{exports,require:()=>({api,getSessionEpoch:()=>epoch,SessionChangedError}),window:{petpal:native?{opencli:native}:undefined},URLSearchParams});
  return{transport:exports.openCliTransport(),changeSession:()=>{epoch++;},SessionChangedError};
}

test('web transport encodes fixed inventory filters and posts only finite browser arguments',async()=>{
  const calls=[],f=await transportFixture({api:async(...args)=>{calls.push(args);return{};}});
  assert.equal(f.transport.native,false);await f.transport.sites({site:'hackernews',command:'top'});await f.transport.action({action:'connect'});const patch=config();await f.transport.configure(patch);
  assert.equal(calls[0][0],'/desktop-tools/opencli/sites?site=hackernews&command=top');
  assert.equal(calls[1][0],'/desktop-tools/opencli/action');assert.equal(calls[1][1].body,'{"action":"connect"}');
  assert.equal(calls[2][0],'/desktop-tools/opencli/config');assert.equal(calls[2][1].method,'PATCH');assert.deepEqual(JSON.parse(calls[2][1].body),patch);
});

test('native transport rejects late results after a session change and aborts the same-session browser request',async()=>{
  const started=deferred(),release=deferred();let cancelCalls=0;
  const f=await transportFixture({native:{status:async()=>{started.resolve();await release.promise;return{privateMarker:'late'};},action:async()=>{await release.promise;return{ready:true};},cancel:async()=>{cancelCalls++;}}});
  const reading=f.transport.status(),rejected=assert.rejects(reading,f.SessionChangedError);await started.promise;f.changeSession();release.resolve();await rejected;
  const held=deferred(),g=await transportFixture({native:{action:async()=>{await held.promise;return{ready:true};},cancel:async()=>{cancelCalls++;}}}),controller=new AbortController();
  const action=g.transport.action({action:'connect'},controller.signal),aborted=assert.rejects(action,{name:'AbortError'});controller.abort();assert.equal(cancelCalls,1);held.resolve();await aborted;
});

test('native action abort and repeated cancel buttons share one cleanup promise and permit later cancellations',async()=>{
  const actionDone=deferred(),cancelDone=deferred();let cancelCalls=0;
  const f=await transportFixture({native:{action:async()=>{await actionDone.promise;return{ready:true};},cancel:()=>{cancelCalls++;return cancelDone.promise;}}}),controller=new AbortController();
  const action=f.transport.action({action:'connect'},controller.signal),rejected=assert.rejects(action,{name:'AbortError'});
  controller.abort();const first=f.transport.cancel(),second=f.transport.cancel();assert.equal(cancelCalls,1);assert.equal(first,second);
  cancelDone.resolve({ready:false});assert.deepEqual(await first,{ready:false});await second;actionDone.resolve();await rejected;
  await f.transport.cancel();assert.equal(cancelCalls,2);
});

test('stale transport cleanup and requests never invoke a newer account executor or API',async()=>{
  let nativeCalls=0,apiCalls=0;
  const f=await transportFixture({native:{cancel:async()=>{nativeCalls++;},config:async()=>{nativeCalls++;return config();}}});
  f.changeSession();await assert.rejects(f.transport.cancel(),f.SessionChangedError);await assert.rejects(f.transport.config(),f.SessionChangedError);assert.equal(nativeCalls,0);
  const g=await transportFixture({api:async()=>{apiCalls++;return{};}});g.changeSession();await assert.rejects(g.transport.action({action:'connect'}),g.SessionChangedError);assert.equal(apiCalls,0);
});
