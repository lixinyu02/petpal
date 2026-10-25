import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createMemoryService,memobaseUserId} from '../server/memory-service.mjs';
const ok=data=>Response.json({errno:0,data});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const entry=(content,topic='偏好')=>({id:randomUUID(),content,attributes:{topic,sub_topic:'生活'},created_at:'2025-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'});
async function fixture(t,{fetchExtra,instance='entries-central',autoStart=false}={}){
 const directory=await mkdtemp(path.join(tmpdir(),'petpal-entry-delete-')),profiles=new Map(),calls=[],gate={busy:false,offline:false,context:null};
 const fetchImpl=async(url,options={})=>{
  if(!url.startsWith('http://entry-memory.test/'))return fetchExtra(url,options);
  const u=new URL(url),p=u.pathname.replace('/api/v1','');calls.push({path:p,method:options.method||'GET'});
  if(gate.offline)throw Error('private-model-key');
  let m=p.match(/^\/users\/profile\/([a-f0-9-]+)(?:\/([a-f0-9-]+))?$/);
  if(m){const rows=profiles.get(m[1])||[];if(options.method==='DELETE'){profiles.set(m[1],rows.filter(e=>e.id!==m[2]));return ok(null);}return ok({profiles:rows});}
  m=p.match(/^\/users\/buffer\/capacity\/([a-f0-9-]+)\/chat$/);if(m)return ok({ids:u.searchParams.get('status')==='processing'&&gate.busy?[randomUUID()]:[]});
  if(/^\/users\/buffer\//.test(p))return ok(null);
  if(/^\/users\/context\//.test(p)){if(gate.context)await gate.context.promise;return ok({context:'旧摘要里有喜欢咖啡和喜欢绿茶，旧事件里也有喜欢咖啡。'});}
  if(/^\/users\/[a-f0-9-]+$/.test(p))return ok({});
  throw Error('Unexpected fixture route '+p);
 };
 const runtime={connection:()=>({baseUrl:'http://entry-memory.test',apiKey:'synthetic-only-key'}),status:async()=>({running:true,autoStart:true}),start:async()=>{}};
 const service=await createMemoryService({dataDir:directory,instanceId:instance,fetchImpl,runtime,autoPoll:false,autoStart});
 const add=(user,...rows)=>{profiles.set(memobaseUserId(instance,user),rows);return rows;};
 t.after(async()=>{await service.close();assert.ok(path.resolve(directory).startsWith(path.join(tmpdir(),'petpal-entry-delete-')));await rm(directory,{recursive:true,force:true});});
 return{directory,service,profiles,calls,gate,add,fetchImpl,runtime,instance};
}
const select=e=>({id:e.id,fingerprint:e.fingerprint});

test('profile management is account scoped, searchable and paginated, with strict snapshot IDs',async t=>{
 const f=await fixture(t);f.add('one',entry('喜欢咖啡'),entry('喜欢绿茶'));f.add('two',entry('另一账号的私有内容'));
 const list=await f.service.entries('one',{q:'喜欢',limit:1});assert.equal(list.total,2);assert.equal(list.entries.length,1);assert.equal(list.nextCursor,1);assert.match(list.entries[0].fingerprint,/^[a-f0-9]{64}$/);
 assert.notEqual(list.entries[0].id,(await f.service.entries('one',{cursor:1,limit:1})).entries[0].id);
 assert.equal((await f.service.entries('one',{q:'另一账号'})).total,0);
 await assert.rejects(f.service.entries('one',{cursor:-1}),{code:'MEMORY_INVALID_CURSOR'});
 const before=f.calls.length;await assert.rejects(f.service.forgetEntries('one',{epoch:2,entries:[select(list.entries[0])]}),{code:'MEMORY_EPOCH_CONFLICT'});assert.equal(f.calls.length,before);
 const other=(await f.service.entries('two')).entries[0];await assert.rejects(f.service.forgetEntries('one',{epoch:1,entries:[select(other)]}),{code:'MEMORY_ENTRY_NOT_FOUND'});
 assert.equal(f.calls.some(c=>c.method==='DELETE'),false);
});

test('stale content and mixed-owner batches reject before any deletion intent or mutation',async t=>{
 const f=await fixture(t),[coffee]=f.add('one',entry('喜欢咖啡'));f.add('two',entry('喜欢红茶'));
 const old=(await f.service.entries('one')).entries[0];coffee.content='现在只喝白水';
 await assert.rejects(f.service.forgetEntries('one',{epoch:1,entries:[select(old)]}),{code:'MEMORY_ENTRY_CHANGED'});
 const fresh=(await f.service.entries('one')).entries[0],other=(await f.service.entries('two')).entries[0];
 await assert.rejects(f.service.forgetEntries('one',{epoch:1,entries:[select(fresh),select(other)]}),{code:'MEMORY_ENTRY_NOT_FOUND'});
 assert.equal((await f.service.status('one')).pendingEntryDeletions,0);assert.equal((await f.service.entries('one')).total,1);
});

test('busy extraction queues durable targeted forgetting; cache and old summaries cannot restore it; other entries survive',async t=>{
 const f=await fixture(t),rows=f.add('one',entry('喜欢咖啡'),entry('喜欢绿茶'));
 const before=await f.service.entries('one'),coffee=before.entries.find(e=>e.content==='喜欢咖啡');
 f.gate.busy=true;await f.service.getContext('one');
 await f.service.forgetEntries('one',{epoch:1,entries:[select(coffee)]});await f.service.sync('one');
 assert.equal(f.calls.some(c=>c.method==='DELETE'),false);assert.equal((await f.service.entries('one')).total,1);
 const context=await f.service.getContext('one');assert.doesNotMatch(context,/咖啡|旧事件/);assert.match(context,/绿茶/);
 assert.equal((await f.service.contextScope('one')).forgetRevision,1);
 const journal=JSON.parse(await readFile(path.join(f.directory,'memory',(await readdir(path.join(f.directory,'memory'))).find(n=>n.endsWith('.json')&&n!=='config.json')),'utf8'));
 assert.equal(journal.forgotten.length,1);assert.equal(JSON.stringify(journal.forgotten).includes('咖啡'),false);assert.equal(journal.epoch,1);
 await f.service.close();
 const reopened=await createMemoryService({dataDir:f.directory,instanceId:f.instance,fetchImpl:f.fetchImpl,runtime:f.runtime,autoPoll:false,autoStart:false});t.after(()=>reopened.close());
 assert.doesNotMatch(await reopened.getContext('one'),/咖啡/);
 f.gate.busy=false;await reopened.sync('one');
 assert.deepEqual(f.profiles.get(memobaseUserId(f.instance,'one')).map(e=>e.id),[rows[1].id]);
 assert.equal((await reopened.status('one')).pendingEntryDeletions,0);
 await reopened.forgetEntries('one',{epoch:1,entries:[select(coffee)]});await reopened.sync('one');
 assert.equal(f.calls.filter(c=>c.method==='DELETE').length,1,'same confirmed snapshot never deletes another profile');
});

test('a delayed pre-delete context response cannot commit or return the forgotten text',async t=>{
 const f=await fixture(t);f.add('one',entry('喜欢咖啡'),entry('喜欢绿茶'));
 const coffee=(await f.service.entries('one')).entries.find(e=>e.content==='喜欢咖啡');
 const gate=deferred();f.gate.context=gate;const old=f.service.getContext('one');
 for(let i=0;i<50&&!f.calls.some(c=>c.path.includes('/users/context/'));i++)await new Promise(r=>setImmediate(r));
 f.gate.busy=true;await f.service.forgetEntries('one',{epoch:1,entries:[select(coffee)]});gate.resolve();
 assert.doesNotMatch(await old,/咖啡/);assert.doesNotMatch(await f.service.getContext('one'),/咖啡/);
});

test('queued cleanup preserves a profile whose content changed while extraction was running',async t=>{
 const f=await fixture(t),[row]=f.add('one',entry('喜欢咖啡'));const item=(await f.service.entries('one')).entries[0];
 f.gate.busy=true;await f.service.forgetEntries('one',{epoch:1,entries:[select(item)]});await f.service.sync('one');
 row.content='本次提炼产生的新资料';row.updated_at='2026-01-02T00:00:00Z';f.gate.busy=false;await f.service.sync('one');
 assert.equal(f.calls.some(c=>c.method==='DELETE'),false);const list=await f.service.entries('one');assert.equal(list.changed,1);assert.equal(list.entries[0].content,row.content);
});

test('management works while learning is paused, but revoked authorization cannot persist deletion',async t=>{
 const f=await fixture(t);f.add('one',entry('喜欢咖啡'),entry('喜欢绿茶'));
 const selected=(await f.service.entries('one')).entries.find(e=>e.content==='喜欢咖啡');
 await assert.rejects(f.service.forgetEntries('one',{epoch:1,entries:[select(selected)]},{authorize:()=>false}),{code:'MEMORY_REVOKED'});
 assert.equal((await f.service.contextScope('one')).forgetRevision,0);
 await f.service.setEnabled('one',false);await f.service.forgetEntries('one',{epoch:1,entries:[select(selected)]});await f.service.sync('one');
 assert.equal((await f.service.entries('one')).total,1);assert.equal((await f.service.status('one')).pendingEntryDeletions,0);
 await f.service.clear('one');assert.equal((await f.service.contextScope('one')).forgetRevision,0);
});

test('central deletion markers reach a PC and filter identical content with different fallback profile IDs',async t=>{
 const central=await fixture(t),[coffee]=central.add('one',entry('喜欢咖啡'),entry('喜欢绿茶'));
 let centralOffline=false;
 const pc=await fixture(t,{instance:'entries-pc',autoStart:true,fetchExtra:async(url,options)=>{
  if(centralOffline)throw Error('central unavailable');const u=new URL(url);
  if(u.pathname==='/api/auth/me')return Response.json({instanceId:central.instance,user:{id:'one'}});
  if(u.pathname==='/api/memory/sync')return Response.json(await central.service.exportSync('one',{epoch:Number(u.searchParams.get('epoch')),cursor:Number(u.searchParams.get('cursor')),limit:Number(u.searchParams.get('limit'))}));
  if(u.pathname==='/api/memory/entries')return Response.json(await central.service.entries('one'));
  if(u.pathname==='/api/memory/entries/delete')return Response.json(await central.service.forgetEntries('one',JSON.parse(options.body)));
  throw Error('Unexpected remote fixture '+u.pathname);
 }});
 pc.profiles.set(memobaseUserId(central.instance,'one'),[entry('喜欢咖啡'),entry('喜欢绿茶')]);
 await pc.service.bindRemote({url:'http://entry-central.test',token:'synthetic-user-token',instanceId:central.instance,userId:'one',localUserId:'local'});
 await pc.service.sync('local');await pc.service.setEnabled('local',false);const list=await pc.service.entries('local'),selected=list.entries.find(e=>e.id===coffee.id);
 central.gate.busy=true;await pc.service.forgetEntries('local',{epoch:1,entries:[select(selected)]});await pc.service.setEnabled('local',true);await pc.service.sync('local');
 assert.equal((await pc.service.contextScope('local')).forgetRevision,1);
 centralOffline=true;await pc.service.sync('local');
 const result=await pc.service.getContext('local');assert.doesNotMatch(result,/咖啡/);assert.match(result,/绿茶/);
 await assert.rejects(pc.service.entries('local'),{code:'MEMORY_UNAVAILABLE'});
});
