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
  if(m){const rows=profiles.get(m[1])||[];if(options.method==='DELETE'){profiles.set(m[1],rows.filter(e=>e.id!==m[2]));return ok(null);}const snapshot=structuredClone(rows),hold=gate.nextProfiles;gate.nextProfiles=null;await hold?.promise;return ok({profiles:snapshot});}
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

test('manual corrections survive extraction, restart and stale summaries while keeping dates and account isolation',async t=>{
 const f=await fixture(t),[source,other]=f.add('one',entry('喜欢咖啡'),entry('喜欢绿茶'));f.add('two',entry('其他账号'));
 const original=(await f.service.entries('one')).entries.find(e=>e.id===source.id),gate=deferred();f.gate.context=gate;
 const late=f.service.getContext('one');for(let i=0;i<50&&!f.calls.some(c=>c.path.includes('/users/context/'));i++)await new Promise(r=>setImmediate(r));
 f.gate.busy=true;
 const result=await f.service.editEntry('one',{epoch:1,...select(original),content:'现在只喝白水'});
 gate.resolve();assert.doesNotMatch(await late,/咖啡|旧摘要/);assert.match(await f.service.getContext('one'),/现在只喝白水/);
 const corrected=(await f.service.entries('one')).entries.find(e=>e.id===source.id);assert.equal(corrected.createdAt,original.createdAt);assert.equal(corrected.manualRevision,1);assert.notEqual(corrected.fingerprint,original.fingerprint);
 source.content='提炼重写旧咖啡偏好';source.updated_at='2026-10-25T00:00:00Z';
 assert.equal((await f.service.entries('one')).entries.find(e=>e.id===source.id).content,corrected.content);
 assert.equal((await f.service.entries('one')).entries.find(e=>e.id===other.id).content,other.content);
 assert.equal((await f.service.entries('two')).entries.length,1);assert.equal(result.correctionRevision,1);
 await f.service.close();
 const restored=await createMemoryService({dataDir:f.directory,instanceId:f.instance,fetchImpl:f.fetchImpl,runtime:f.runtime,autoPoll:false,autoStart:false});t.after(()=>restored.close());
 f.gate.offline=true;assert.match(await restored.getContext('one'),/现在只喝白水/);assert.doesNotMatch(await restored.getContext('one'),/提炼重写|咖啡/);
});

test('edit validation, optimistic conflicts, revoked sessions and same-snapshot concurrency never silently overwrite',async t=>{
 const f=await fixture(t),[source]=f.add('one',entry('旧偏好'));f.add('two',entry('他人偏好'));
 const original=(await f.service.entries('one')).entries[0],input={epoch:1,...select(original),content:'新偏好'};
 for(const invalid of [{...input,userId:'two'},{...input,content:'  '},{...input,content:'x'.repeat(6001)}])await assert.rejects(f.service.editEntry('one',invalid),{code:'MEMORY_INVALID_EDIT'});
 await assert.rejects(f.service.editEntry('one',input,{authorize:()=>false}),{code:'MEMORY_REVOKED'});
 await assert.rejects(f.service.editEntry('two',input),{code:'MEMORY_ENTRY_NOT_FOUND'});
 await assert.rejects(f.service.editEntry('one',{...input,epoch:2}),{code:'MEMORY_EPOCH_CONFLICT'});
 source.content='提炼已变';await assert.rejects(f.service.editEntry('one',input),{code:'MEMORY_ENTRY_CHANGED'});
 const latest=(await f.service.entries('one')).entries[0];f.gate.busy=true;
 const writes=await Promise.allSettled(['手改 A','手改 B'].map(content=>f.service.editEntry('one',{epoch:1,...select(latest),content})));
 assert.equal(writes.filter(e=>e.status==='fulfilled').length,1);assert.equal(writes.find(e=>e.status==='rejected').reason.code,'MEMORY_ENTRY_CHANGED');
 assert.equal((await f.service.contextScope('one')).correctionRevision,1);
 await assert.rejects(f.service.forgetEntries('one',{epoch:1,entries:[select(latest)]}),{code:'MEMORY_ENTRY_CHANGED'});
});

test('manual entries can be re-edited, deleted and cleared without reviving originals',async t=>{
 const f=await fixture(t);f.add('one',entry('旧偏好'),entry('不变事实'));f.gate.busy=true;
 const original=(await f.service.entries('one')).entries.find(e=>e.content==='旧偏好');
 const first=await f.service.editEntry('one',{epoch:1,...select(original),content:'人工修正一'});
 const second=await f.service.editEntry('one',{epoch:1,...select(first.entry),content:'人工修正二'});
 assert.equal(second.correctionRevision,2);assert.equal(second.forgotten.length,1);assert.doesNotMatch(await f.service.getContext('one'),/人工修正一|旧偏好/);
 assert.match(await f.service.getContext('one'),/人工修正二/);
 await f.service.forgetEntries('one',{epoch:1,entries:[select(second.entry)]});
 assert.equal((await f.service.entries('one')).total,1);assert.doesNotMatch(await f.service.getContext('one'),/人工修正|旧偏好/);
 const snap=await f.service.exportSync('one');assert.equal(snap.corrections.length,0);assert.equal(snap.correctionRevision,3);
 await f.service.clear('one');assert.equal((await f.service.contextScope('one')).correctionRevision,0);
});

test('a long manual fact is fully recalled and credential-like values are sanitized',async t=>{
 const f=await fixture(t);f.add('one',entry('原文'));f.gate.busy=true;
 const row=(await f.service.entries('one')).entries[0],content='事实'.repeat(2900)+'结尾事实';
 await f.service.editEntry('one',{epoch:1,...select(row),content});assert.ok((await f.service.getContext('one')).includes(content));
 const updated=(await f.service.entries('one')).entries[0];
 const result=await f.service.editEntry('one',{epoch:1,...select(updated),content:'喜欢音乐；password=synthetic-password'});
 assert.doesNotMatch(result.entry.content,/synthetic-password/);assert.match(result.entry.content,/已省略凭据/);
});

test('a delayed profile refresh before a second manual edit cannot commit old context',async t=>{
 const f=await fixture(t);f.add('one',entry('原偏好'));f.gate.busy=true;
 const original=(await f.service.entries('one')).entries[0],first=await f.service.editEntry('one',{epoch:1,...select(original),content:'修正一'});await f.service.sync('one');
 const hold=deferred();f.gate.nextProfiles=hold;const pending=f.service.getContext('one');
 for(let i=0;i<50&&f.gate.nextProfiles;i++)await new Promise(r=>setImmediate(r));
 await f.service.editEntry('one',{epoch:1,...select(first.entry),content:'修正二'});hold.resolve();
 assert.match(await pending,/修正二/);assert.doesNotMatch(await pending,/修正一|原偏好/);
});

test('PC correction sync preserves the newest revision through offline fallback and stale central snapshots',async t=>{
 const central=await fixture(t),[source]=central.add('one',entry('旧偏好'),entry('不变事实'));central.gate.busy=true;
 let offline=false,stale=null;
 const pc=await fixture(t,{instance:'edit-pc',autoStart:true,fetchExtra:async(url,options)=>{
  if(offline)throw Error('central unavailable');const u=new URL(url);
  if(u.pathname==='/api/auth/me')return Response.json({instanceId:central.instance,user:{id:'one'}});
  if(u.pathname==='/api/memory/sync')return Response.json(stale??await central.service.exportSync('one',{epoch:Number(u.searchParams.get('epoch')),cursor:Number(u.searchParams.get('cursor')),limit:Number(u.searchParams.get('limit'))}));
  if(u.pathname==='/api/memory/entries')return Response.json(await central.service.entries('one'));
  if(u.pathname==='/api/memory/entries/edit')return Response.json(await central.service.editEntry('one',JSON.parse(options.body)));
  throw Error('Unexpected fixture '+u.pathname);
 }});
 pc.profiles.set(memobaseUserId(central.instance,'one'),[entry('旧偏好'),entry('不变事实')]);
 await pc.service.bindRemote({url:'http://edit-central.test',token:'synthetic-user-token',instanceId:central.instance,userId:'one',localUserId:'local'});await pc.service.sync('local');
 const original=(await pc.service.entries('local')).entries.find(e=>e.id===source.id);
 await pc.service.setEnabled('local',false);
 const first=await pc.service.editEntry('local',{epoch:1,...select(original),content:'修正一'});
 await pc.service.setEnabled('local',true);await pc.service.sync('local');stale=await central.service.exportSync('one');
 await pc.service.editEntry('local',{epoch:1,...select(first.entry),content:'修正二'});await pc.service.sync('local');
 assert.match(await pc.service.getContext('local'),/修正二/);assert.doesNotMatch(await pc.service.getContext('local'),/修正一|旧偏好/);
 offline=true;await pc.service.sync('local');assert.match(await pc.service.getContext('local'),/修正二/);
 assert.equal((await pc.service.contextScope('local')).correctionRevision,2);
 await assert.rejects(pc.service.editEntry('local',{epoch:1,...select(first.entry),content:'离线修改'}),{code:'MEMORY_UNAVAILABLE'});
});
