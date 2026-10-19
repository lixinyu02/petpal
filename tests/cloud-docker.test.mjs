import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createCloudDocker, cloudProjectDirectory } from '../server/cloud-docker.mjs';
import { createLocalDocker, validateLocalTransport, CLOUD_DOCKER_ASSET_REVISION } from '../server/cloud-docker-local.mjs';
import { createPlatformDocker } from '../server/cloud-docker-platform.mjs';
import { CodexBridge } from '../server/codex.mjs';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { spawn } from 'node:child_process';

async function fixture(t, options={}) {
  const dataDir=await mkdtemp(path.join(tmpdir(),'petpal-cloud-')), machines=new Map(), effects=[];
  t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const users={alice:{id:'alice',enabled:true,isAdmin:false},bob:{id:'bob',enabled:true,isAdmin:false},admin:{id:'admin',enabled:true,isAdmin:true}};
  let revision=0;
  const local={async status(){return{available:true,imageAvailable:true};},async prepare(){effects.push('prepare');},async inspect(r){if(!machines.has(r.id))throw Error('missing');return{...machines.get(r.id)};},async create(r){effects.push(['create',r.id]);machines.set(r.id,{state:'running',generation:`g${++revision}`,desktop:true});},async action(r,_instance,action){effects.push([action,r.id]);machines.set(r.id,{...machines.get(r.id),state:action==='start'?'running':'stopped',...(action==='start'?{generation:`g${++revision}`}:{})});return machines.get(r.id);},async stage(r,_instance,home,files){effects.push(['stage',r.id,home,files]);},async process(){throw Error('use fake bridge');},async desktop(r){effects.push(['desktop',r.id]);const readable=new PassThrough(),writable=new PassThrough();return{readable,writable,generation:machines.get(r.id).generation,close(){readable.end();writable.end();effects.push(['desktop.close',r.id]);}};}};
  const platform={...local,credential:async()=>({clientId:randomUUID()}),identity(){},catalog:async()=>({available:false,nodes:[]})};
  let revoked=false;
  const settings={dataDir,authorizeUser:id=>users[id],authorizeEntry(){if(revoked)throw Object.assign(Error('revoked'),{status:403});},getConfig:()=>({mode:'api',model:'gpt-6-luna',baseUrl:'https://upstream.invalid/v1',apiKey:'upstream-private-fixture',revision:'87c326d2-506f-42cb-95d4-b239a344e9ea'}),publicOrigin:()=> 'https://petpal.example.test',localDriver:local,platformDriver:platform,refreshMs:0,...options};
  const cloud=await createCloudDocker(settings);t.after(()=>cloud.close());
  const create=(user='alice',value={})=>cloud.create(user,{name:'测试环境',source:'local',...value});
  const entry=hostId=>({id:randomUUID(),auth:{userId:'alice'},hostId,permissions:{access:'full',approval:'on-request'},projectAccess:'workspace',model:'gpt-6-luna',attachmentIds:[]});
  return{cloud,dataDir,settings,users,local,platform,machines,effects,create,entry,revoke:()=>{revoked=true;}};
}

test('accounts see only owned Docker hosts; administrators list all without reassigning ownership',async t=>{
  const f=await fixture(t), a=await f.create(), b=await f.create('bob');
  assert.equal(a.kind,'docker');assert.equal(a.platform,'linux');assert.equal(a.online,true);
  assert.equal(a.isOwn,true);assert.equal(f.cloud.hostFor('admin',a.id).isOwn,false);assert.match(a.requestId,/^[a-f0-9-]{36}$/);assert.equal(a.codex.approvalReview.available,true);
  assert.equal(f.cloud.has(a.id),true);assert.equal(f.cloud.list('alice').length,1);assert.equal(f.cloud.list('admin').length,2);
  assert.throws(()=>f.cloud.hostFor('alice',b.id),{status:404});assert.equal(f.cloud.hostFor('admin',b.id).userId,'bob');
  const state=await readFile(path.join(f.dataDir,'cloud-docker','state.json'),'utf8');assert(!state.includes('upstream-private-fixture'));
});
test('durable create request is idempotent and mismatching payload cannot claim an existing operation',async t=>{
  const f=await fixture(t), requestId=randomUUID(), first=await f.create('alice',{requestId});
  assert.equal((await f.create('alice',{requestId})).id,first.id);assert.equal(f.effects.filter(e=>e[0]==='create').length,1);
  await assert.rejects(f.create('alice',{requestId,name:'不同名字'}),{status:409});
});
test('failed create survives refresh and restart, then the same request completes one logical host',async t=>{
  const f=await fixture(t),requestId=randomUUID(),original=f.local.create;let count=0;
  f.local.create=async(...args)=>{count++;if(count===1)throw Object.assign(Error('transient engine failure'),{code:'cloud_docker_unavailable'});return original(...args);};
  await assert.rejects(f.create('alice',{requestId}));const failed=f.cloud.list('alice')[0];assert.equal(failed.docker.creationPending,true);await f.cloud.refresh('alice');assert.equal(f.cloud.hostFor('alice',failed.id).docker.state,'offline');
  await f.cloud.close();const next=await createCloudDocker(f.settings);t.after(()=>next.close());const recovered=await next.create('alice',{name:'测试环境',source:'local',requestId});assert.equal(recovered.id,failed.id);assert.equal(recovered.online,true);assert.equal(recovered.docker.creationPending,false);assert.equal(count,2);assert.equal(next.list('alice').length,1);
  await next.action('alice',recovered.id,'stop');const stopped=await next.create('alice',{name:'测试环境',source:'local',requestId});assert.equal(stopped.online,false);assert.equal(stopped.docker.state,'stopped');assert.equal(count,2);
});
test('explicit start recovers an unfinished creation after observation overwrites its phase',async t=>{
  const f=await fixture(t),original=f.local.create;let count=0;f.local.create=async(...args)=>{if(++count===1)throw Error('failed');return original(...args);};await assert.rejects(f.create());const failed=f.cloud.list('alice')[0];await f.cloud.refresh('alice');const host=await f.cloud.action('alice',failed.id,'start');assert.equal(host.online,true);assert.equal(host.docker.creationPending,false);
});
test('old never-started Docker receipts migrate without treating a successfully stopped host as pending',async t=>{
  const f=await fixture(t),a=await f.create(),b=await f.create();await f.cloud.action('alice',b.id,'stop');await f.cloud.close();
  const file=path.join(f.dataDir,'cloud-docker','state.json'),state=JSON.parse(await readFile(file,'utf8')),old=state.records.find(r=>r.id===a.id);delete old.creationPending;old.state='offline';old.generation='container:0001-01-01T00:00:00Z';f.machines.delete(a.id);await writeFile(file,JSON.stringify(state));
  const next=await createCloudDocker(f.settings);t.after(()=>next.close());assert.equal(next.hostFor('alice',a.id).docker.creationPending,true);assert.equal(next.hostFor('alice',b.id).docker.creationPending,false);assert.equal((await next.action('alice',a.id,'start')).online,true);
});
test('simultaneous first requests cannot allocate twice during platform credential await',async t=>{
  const f=await fixture(t),requestId=randomUUID(),clientId=randomUUID();let release,creates=0;f.platform.credential=()=>new Promise(resolve=>release=()=>resolve({clientId}));f.platform.create=async r=>{creates++;f.machines.set(r.id,{state:'running',generation:'platform1',desktop:true});return{nodeId:randomUUID()};};
  const first=f.create('alice',{requestId,source:'platform'});await new Promise(resolve=>setImmediate(resolve));await assert.rejects(f.create('alice',{requestId,source:'platform'}),{code:'executor_busy'});release();await first;assert.equal(creates,1);assert.equal(f.cloud.list('alice').length,1);
});
test('restart never trusts saved online state; refresh adopts only the recorded container',async t=>{
  const f=await fixture(t), a=await f.create();await f.cloud.close();
  const next=await createCloudDocker(f.settings);t.after(()=>next.close());
  assert.equal(next.hostFor('alice',a.id).online,false);assert.throws(()=>next.target('alice',a.id),{code:'executor_offline'});
  await next.refresh('alice');assert.equal(next.hostFor('alice',a.id).online,true);assert.equal(f.effects.filter(e=>e[0]==='create').length,1);
});
test('stop/start remain explicit and a stopped target cannot silently execute on central or another host',async t=>{
  const f=await fixture(t), a=await f.create();await f.cloud.action('alice',a.id,'stop');
  assert.throws(()=>f.cloud.bind(f.entry(a.id)),{code:'executor_offline'});
  await f.cloud.action('alice',a.id,'start');assert.equal(f.cloud.target('alice',a.id).hostId,a.id);
  await assert.rejects(f.cloud.action('bob',a.id,'stop'),{status:404});
});
test('Linux project paths stay within the Docker workspace even with full access',()=>{
  assert.equal(cloudProjectDirectory(),'/workspaces/project');assert.equal(cloudProjectDirectory('/workspaces/project/a/./b'),'/workspaces/project/a/b');
  for(const value of ['/etc','C:\\Projects','/workspaces/project/../secrets','/workspaces/project\\bad'])assert.throws(()=>cloudProjectDirectory(value),{code:'project_directory_invalid'});
});
test('images and independent review are explicitly unsupported rather than discarded',async t=>{
  const f=await fixture(t), a=await f.create(), entry=f.entry(a.id);entry.attachmentIds=[randomUUID()];assert.throws(()=>f.cloud.bind(entry),{code:'executor_images_unsupported'});
  assert.throws(()=>f.cloud.target('alice',a.id,'',{approval:'review',reviewProviderId:'other'}),{code:'executor_review_model_unsupported'});
  assert.equal(a.capabilities.images,false);assert.equal(a.capabilities.independentReviewModel,false);
});
test('bridge binds generation, rejects concurrent work, and revalidates account and entry permissions',async t=>{
  let release, captured, calls=0;
  const f=await fixture(t,{bridgeFactory:options=>{captured=options;return{run:()=>new Promise(resolve=>{calls++;release=resolve;}),steer:async()=>({turnId:'turn'}),close:async()=>{}};}}),a=await f.create(),bridge=f.cloud.bind(f.entry(a.id));
  const run=bridge.run({prompt:'test'});await new Promise(resolve=>setImmediate(resolve));assert.equal(f.cloud.isBusy('alice',a.id),true);
  await assert.rejects(f.cloud.action('alice',a.id,'stop'),{code:'executor_busy'});await assert.rejects(f.cloud.bind(f.entry(a.id)).run({prompt:'other'}),{code:'executor_busy'});
  assert.equal(await captured.resolveDirectory('/workspaces/project/src'),'/workspaces/project/src');
  f.revoke();await assert.rejects(bridge.steer({}),{status:403});release({text:'done'});await run;assert.equal(calls,1);
});
test('staging contains only temporary model proxy credentials and current verified catalog',async t=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
  const f=await fixture(t,{bridgeFactory:options=>({async run(){await options.processFactory({args:['app-server'],transport:{baseUrl:'http://127.0.0.1:12345',apiKey:'private-loopback'}});return{text:'ok'};},async close(){}})}),a=await f.create();
  f.local.process=async()=>child;const bridge=f.cloud.bind(f.entry(a.id));await bridge.run({prompt:'hello'});
  const staged=f.effects.find(e=>e[0]==='stage'),serialized=JSON.stringify(staged);
  assert(serialized.includes('https://petpal.example.test/api/cloud-docker/model/v1'));assert(serialized.includes('CODEX_REMOTE_MODEL_PROVIDER_KEY'));
  assert(!serialized.includes('upstream-private-fixture'));assert(!serialized.includes('private-loopback'));assert(!serialized.includes('127.0.0.1:12345'));
});
test('model proxy rejects arbitrary paths, expired task tokens, and account revocation',async t=>{
  let options,release,token,fetches=0;
  const f=await fixture(t,{bridgeFactory:o=>{options=o;return{async run(){await o.processFactory({args:['app-server'],transport:{baseUrl:'http://127.0.0.1:12345',apiKey:'private-loopback'}});return new Promise(resolve=>release=resolve);},async close(){}};},fetchImpl:async(_url,init)=>{fetches++;assert.equal(init.headers.authorization,'Bearer private-loopback');assert.equal(init.headers['x-codex-turn-metadata'],'metadata');return new Response('ok');}}),a=await f.create();
  f.local.process=async(_r,_i,value)=>{token=value.token;return {executionWorkspaceRoot:'/workspaces/project'};};
  const bridge=f.cloud.bind(f.entry(a.id)),run=bridge.run({prompt:'hello'});while(!token)await new Promise(resolve=>setImmediate(resolve));
  const request={authorization:`Bearer ${token}`,path:'/responses',headers:{'x-codex-turn-metadata':'metadata',cookie:'private'},body:Buffer.from('{}')};
  assert.equal(await (await f.cloud.modelRequest(request)).text(),'ok');assert.equal(fetches,1);
  await assert.rejects(f.cloud.modelRequest({...request,path:'/models'}),{status:401});f.revoke();await assert.rejects(f.cloud.modelRequest(request),{status:403});
  release({text:'done'});await run;await assert.rejects(f.cloud.modelRequest(request),{status:401});
});
test('desktop ownership, connection limit, and explicit close are enforced',async t=>{
  const f=await fixture(t),a=await f.create();await assert.rejects(f.cloud.openDesktop('bob',a.id),{status:404});
  const d=await f.cloud.openDesktop('alice',a.id),d2=await f.cloud.openDesktop('alice',a.id);await assert.rejects(f.cloud.openDesktop('alice',a.id),{status:429});
  d.assertAuthorized();await d.close();await d.close();assert.throws(()=>d.assertAuthorized());await d2.close();
});
test('changing Docker generation closes the old viewer and task binding',async t=>{
  const f=await fixture(t),a=await f.create(),d=await f.cloud.openDesktop('alice',a.id),bridge=f.cloud.bind(f.entry(a.id));
  f.machines.get(a.id).generation='external-restart';await f.cloud.refresh('alice');assert.throws(()=>d.assertAuthorized());await assert.rejects(bridge.run({prompt:'must not run'}),{code:'execution_unknown'});
});
test('unconfirmed process cleanup durably pauses admission until the environment is stopped',async t=>{
  const child={cloudStop:async()=>{throw Error('no cleanup confirmation');}};
  const f=await fixture(t,{bridgeFactory:options=>({run:async()=>({text:'done'}),close:async()=>{await options.terminateProcess(child).catch(()=>{});}})}),a=await f.create(),bridge=f.cloud.bind(f.entry(a.id));
  await bridge.run({prompt:'test'});await bridge.close();assert.throws(()=>f.cloud.target('alice',a.id),{code:'executor_offline'});
  await f.cloud.refresh('alice');assert.equal(f.cloud.hostFor('alice',a.id).docker.state,'unknown');await assert.rejects(f.cloud.action('alice',a.id,'start'),{code:'execution_unknown'});
  await f.cloud.close();const next=await createCloudDocker(f.settings);t.after(()=>next.close());await next.refresh('alice');assert.equal(next.hostFor('alice',a.id).online,false);
  await next.action('alice',a.id,'stop');await next.action('alice',a.id,'start');assert.equal(next.hostFor('alice',a.id).online,true);
});
test('closing a bridge remains busy until the exact same cleanup promise settles',async t=>{
  let release;const f=await fixture(t,{bridgeFactory:()=>({run:async()=>({text:'done'}),close:()=>new Promise(resolve=>release=resolve)})}),a=await f.create(),bridge=f.cloud.bind(f.entry(a.id));
  await bridge.run({prompt:'test'});const first=bridge.close(),second=bridge.close();assert.equal(first,second);assert.equal(f.cloud.isBusy('alice',a.id),true);await assert.rejects(f.cloud.action('alice',a.id,'stop'),{code:'executor_busy'});release();await first;assert.equal(f.cloud.isBusy('alice',a.id),false);
});
test('private state rejects hardlinked or symlinked ownership journals',async t=>{
  const f=await fixture(t);await f.cloud.close();const file=path.join(f.dataDir,'cloud-docker','state.json');await writeFile(file,'{"schema":"foreign"}');
  await assert.rejects(createCloudDocker(f.settings),{code:'cloud_docker_storage_invalid'});
});
test('local transport accepts fixed WSL argv and Unix socket, rejecting remote sockets and shell text',()=>{
  assert.deepEqual(validateLocalTransport({wslDistro:'QwenMM-Ubuntu-24.04',dockerHost:'unix:///run/docker.sock'}),{wslDistro:'QwenMM-Ubuntu-24.04',dockerHost:'unix:///run/docker.sock'});
  for(const value of [{wslDistro:'Ubuntu; rm'},{dockerHost:'tcp://example:2375'},{dockerHost:'unix:///run/../x'},{command:'bash'}])assert.throws(()=>validateLocalTransport(value));
});
test('local Docker launcher uses argv without a shell and never writes global Docker settings',async()=>{
  let invocation;
  const driver=createLocalDocker({transport:{wslDistro:'QwenMM-Ubuntu-24.04',dockerHost:'unix:///run/docker.sock'},spawnImpl:(file,args,options)=>{invocation={file,args,options};const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();setImmediate(()=>{child.stdout.end('{"Version":"29.1.3","Os":"linux","Arch":"amd64"}');child.emit('close',0);});return child;}});
  await driver.run(['version','--format','{{json .Server}}']);assert.equal(invocation.file,'wsl.exe');assert.equal(invocation.options.shell,false);assert.deepEqual(invocation.args.slice(0,9),['-d','QwenMM-Ubuntu-24.04','-u','root','--exec','docker','-H','unix:///run/docker.sock','version']);
});
test('real WSL adapter preserves script syntax and literal shell metacharacters', {skip:process.platform!=='win32'||!process.env.PETPAL_TEST_WSL_DISTRO}, async()=>{
  const driver=createLocalDocker({transport:{wslDistro:process.env.PETPAL_TEST_WSL_DISTRO},spawnImpl:(file,args,options)=>{const actual=[...args];assert.equal(actual[5],'docker');actual[5]='/usr/bin/node';return spawn(file,actual,options);}});
  const input=['x y','alpha;printf harmless_probe','(literal)','quote"value'];
  const output=await driver.run(['-e','process.stdout.write(JSON.stringify(process.argv.slice(1)))','--',...input]);
  assert.deepEqual(JSON.parse(output),input);
});
test('image preparation verifies packaged assets into a private context and keeps mirrors explicit',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'cloud-image-context-')),calls=[];t.after(()=>rm(root,{recursive:true,force:true}));
  const driver=createLocalDocker({contextRoot:root,transport:{nodeImage:'docker.m.daocloud.io/library/node:24.19.0-bookworm-slim',debianMirror:'https://mirrors.ustc.edu.cn/debian',debianSecurityMirror:'https://mirrors.ustc.edu.cn/debian-security'},spawnImpl:(file,args,options)=>{
    calls.push({file,args,options});const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();setImmediate(()=>{child.stdout.end(args[0]==='version'?JSON.stringify({Version:'29.1.3',Os:'linux',Arch:'amd64'}):args[0]==='image'?JSON.stringify([{Config:{Labels:{'top.magicdatou.petpal.agent-protocol':'1','top.magicdatou.petpal.asset-revision':CLOUD_DOCKER_ASSET_REVISION}}}]):'built');child.emit('close',0);});return child;
  }});
  assert.equal((await driver.prepare()).imageAvailable,true);const build=calls.find(c=>c.args[0]==='build'),context=build.args.at(-1);
  assert(context.startsWith(root+path.sep));assert(build.args.includes('DEBIAN_MIRROR=https://mirrors.ustc.edu.cn/debian'));assert.equal(build.options.shell,false);
  const dockerfile=await readFile(path.join(context,'Dockerfile'),'utf8');assert(dockerfile.includes('ARG DEBIAN_MIRROR=https://deb.debian.org/debian'));assert(!dockerfile.includes('mirrors.ustc.edu.cn'));
  const ignore=await readFile(path.join(context,'.dockerignore'),'utf8');assert(ignore.startsWith('**\n'));assert(ignore.includes('!exec.mjs'));
  for(const value of [{debianMirror:'http://mirror/debian'},{debianMirror:'https://user:secret@mirror/debian'},{debianMirror:'https://mirror/debian?token=x'},{nodeImage:'node:latest'}])assert.throws(()=>validateLocalTransport(value));
});
test('platform pairing generation prevents calls against a newly paired identity',async()=>{
  const clientId=randomUUID(),record={clientId,projectId:randomUUID(),nodeId:randomUUID(),userId:'alice',bundle:'desktop'};let id=clientId,calls=0;
  const platform=createPlatformDocker({credential:async()=>({baseUrl:'https://platform.example',credential:'private',clientId:id}),request:async()=>{calls++;return {id:record.projectId,hostId:record.nodeId,revision:1,bundle:'desktop',phase:'running'};}});
  assert.equal((await platform.inspect(record)).state,'running');id=randomUUID();await assert.rejects(platform.inspect(record),{code:'cloud_docker_identity_changed'});assert.equal(calls,1);
});
test('platform exec opens a fixed backend and cleans an unconnected session',async()=>{
  const clientId=randomUUID(),record={clientId,projectId:randomUUID(),nodeId:randomUUID(),userId:'alice',bundle:'desktop'},calls=[];
  const platform=createPlatformDocker({credential:async()=>({baseUrl:'https://platform.example',credential:'private',clientId}),request:async(_kind,_path,options)=>{calls.push(options.body);return options.body.operation==='project.inspect'?{id:record.projectId,hostId:record.nodeId,revision:1,bundle:'desktop',phase:'running'}:{sessionId:'a'.repeat(32)};}},{socketFactory(){throw Error('offline');}});
  await assert.rejects(platform.process(record,{args:['app-server'],home:'/runtime/test',token:'temporary'}));
  assert.deepEqual(calls.map(c=>c.operation),['project.inspect','exec.open','exec.stop']);assert.equal(calls[1].payload.backend,'openai-codex');assert.equal(calls[1].payload.environment.CODEX_REMOTE_MODEL_PROVIDER_KEY,'temporary');
});
test('platform automatic placement retries the original null host request after assignment',async()=>{
  const clientId=randomUUID(),nodeId=randomUUID(),record={clientId,projectId:randomUUID(),nodeId,requestedNodeId:null,userId:'alice',name:'test',bundle:'agent',requestId:randomUUID()},calls=[];
  const platform=createPlatformDocker({credential:async()=>({clientId}),request:async(_kind,_path,options)=>{calls.push(options);return{id:record.projectId,hostId:nodeId};}});
  await platform.create(record);await platform.create(record);assert.equal(calls[0].body.hostId,null);assert.equal(calls[1].body.hostId,null);assert.equal(calls[0].body.bundle,'full');assert.equal(calls[0].expectedClientId,clientId);assert.equal(calls[0].body.requestId,calls[1].body.requestId);
});

test('platform transports bounded binary stdio and waits for confirmed cleanup',async t=>{
  const server=http.createServer(),wss=new WebSocketServer({server}),clientId=randomUUID();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>server.close(resolve));});
  const record={clientId,projectId:randomUUID(),nodeId:randomUUID(),userId:'alice',bundle:'desktop'};let input,auth,pathSeen;
  wss.on('connection',(ws,request)=>{auth=request.headers.authorization;pathSeen=request.url;ws.send(JSON.stringify({type:'started'}));ws.send(Buffer.from('oRFB 003.008\n'));ws.on('message',(bytes,binary)=>{input=Buffer.from(bytes);assert.equal(binary,true);});});
  const platform=createPlatformDocker({credential:async()=>({baseUrl:`http://127.0.0.1:${server.address().port}`,credential:'fixture-machine-key',clientId}),request:async(_kind,_path,{body})=>body.operation==='project.inspect'?{id:record.projectId,hostId:record.nodeId,revision:1,bundle:'desktop',phase:'running'}:body.operation==='exec.stop'?{cleanupConfirmed:true}:{sessionId:'b'.repeat(32)}});
  const desktop=await platform.desktop(record);t.after(()=>desktop.close());let received='';desktop.readable.on('data',bytes=>received+=bytes);desktop.writable.write(Buffer.from('RFB client'));
  while(!input||!received)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(input.toString(),'iRFB client');assert.equal(received,'RFB 003.008\n');assert.equal(auth,'Bearer fixture-machine-key');assert.equal(pathSeen,'/v1/exec/'+'b'.repeat(32));
  await desktop.close();assert.equal(desktop.child.cleanupConfirmed,true);
});

test('CodexBridge injected container process reuses native protocol and never resolves a host CLI',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'cloud-codex-process-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let launches=0,stopped=0,threadCwd;
  const bridge=new CodexBridge({workspaceRoot:root,processFactory:async()=>{
    launches++;const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();let pending='';
    child.stdin=new PassThrough();child.stdin.on('data',chunk=>{pending+=chunk;let index;while((index=pending.indexOf('\n'))>=0){const m=JSON.parse(pending.slice(0,index));pending=pending.slice(index+1);const send=value=>setImmediate(()=>child.stdout.write(JSON.stringify(value)+'\n'));if(m.method==='initialize')send({id:m.id,result:{}});else if(m.method==='account/read')send({id:m.id,result:{requiresOpenaiAuth:false}});else if(m.method==='thread/start'){threadCwd=m.params.cwd;send({id:m.id,result:{thread:{id:'container-thread'}}});}else if(m.method==='turn/start'){send({id:m.id,result:{turn:{id:'turn'}}});send({method:'item/agentMessage/delta',params:{threadId:'container-thread',turnId:'turn',delta:'容器完成'}});send({method:'turn/completed',params:{threadId:'container-thread',turn:{id:'turn',status:'completed'}}});}}});child.executionWorkspaceRoot='/workspaces/project';return child;
  },resolveDirectory:async value=>cloudProjectDirectory(value),terminateProcess:async child=>{stopped++;child.emit('close',0);}});
  t.after(()=>bridge.close());const result=await bridge.run({prompt:'test',projectDirectory:'/workspaces/project/demo'});assert.equal(result.text,'容器完成');assert.equal(threadCwd,'/workspaces/project/demo');assert.equal(launches,1);await bridge.close();assert.equal(stopped,1);
});
