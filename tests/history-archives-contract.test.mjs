import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdtemp,mkdir,copyFile,rm} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {createHistoryArchives,validateHistoryBundle,buildHistoryMemoryEvents} from '../server/history-archives.mjs';
import {makeHistoryBundle} from './helpers/history-bundle.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
async function until(read){for(let i=0;i<500;i++){const value=await read();if(value)return value;await delay(5);}assert.fail('Synthetic archive contract did not settle');}
function memoryFixture(){
  const users=new Map(),writes=new Map(),calls=[];
  const state=id=>{if(!users.has(id))users.set(id,{events:new Map(),acked:new Set()});return users.get(id);};
  return{users,writes,calls,syncGate:null,
    async status(user){calls.push(['status',user]);return{epoch:1,enabled:true,configured:true,pendingReset:false};},
    async preflightImport(user,{epoch,events}){calls.push(['preflight',user]);assert.equal(epoch,1);assert.ok(events.every(event=>event.userText.length<=3800));return{accepted:events.filter(event=>!state(user).events.has(event.id)).length};},
    async importSync(user,{events}){calls.push(['import',user]);for(const event of events){writes.set(event.id,(writes.get(event.id)||0)+1);state(user).events.set(event.id,event);}},
    async sync(user){calls.push(['sync',user]);if(this.syncGate)await this.syncGate();for(const id of state(user).events.keys())state(user).acked.add(id);},
    async inspectImport(user,{epoch,eventIds}){calls.push(['inspect',user]);const current=state(user),found=eventIds.filter(id=>current.events.has(id));return{epoch,total:found.length,acked:found.filter(id=>current.acked.has(id)).length,unknown:0,pending:found.filter(id=>!current.acked.has(id)).length,failed:0,needsFlush:false};},
  };
}
async function fixture(t){
  const directory=await mkdtemp(path.join(tmpdir(),'petpal-history-contract-')),account=randomUUID(),other=randomUUID(),store={state:{users:[{id:account},{id:other}]}},memory=memoryFixture();
  let archives=await createHistoryArchives({dataDir:directory,store,memory});
  t.after(async()=>{await archives.close();assert.equal(path.dirname(directory),tmpdir());assert.ok(path.basename(directory).startsWith('petpal-history-contract-'));await rm(directory,{recursive:true,force:true});});
  return{directory,account,other,memory,store,get archives(){return archives;},async reopen(){await archives.close();archives=await createHistoryArchives({dataDir:directory,store,memory});}};
}
async function stage(f,bundle){
  const result=await f.archives.createStaging(f.account,{datasetId:bundle.datasetId,personName:bundle.personName,epoch:1,manifestSha256:bundle.manifestSha256});
  for(const name of result.staging.files){const target=path.join(f.directory,result.staging.relativePath,name);await mkdir(path.dirname(target),{recursive:true});await copyFile(path.join(bundle.directory,name),target);}
  return result.job;
}
const finished=(f,id)=>until(async()=>{const job=(await f.archives.job(f.account,id)).job;return job.state==='complete'&&job;});
function writerInput(f,bundle,job){
  const archiveId=randomUUID(),events=[{id:'history.wechat:worker-contract',epoch:1,source:'chat',conversationId:archiveId,userText:'合成本人候选',assistantText:'',createdAt:new Date(bundle.records.at(-1).occurred_at).toISOString(),messageIds:bundle.records.filter(row=>row.speaker==='subject').map(row=>row.msg_id)}];
  return{workerData:{dbFile:path.join(f.directory,'history-archives','archives.sqlite3'),job:{id:job.id,account_id:f.account,dataset_id:bundle.datasetId,manifest_sha:bundle.manifestSha256,person_name:bundle.personName,epoch:1},archiveId,sourceStart:bundle.records[0].occurred_at,sourceEnd:bundle.records.at(-1).occurred_at,messageCount:bundle.records.length},rows:bundle.records.map(row=>({row,payload:'a'.repeat(64),json:JSON.stringify(row)})),events};
}
function assertRolledBack(f,job){
  const db=new DatabaseSync(path.join(f.directory,'history-archives','archives.sqlite3'));try{for(const table of ['archives','messages','archive_messages','memory_message_map'])assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0,`${table} must be rolled back`);assert.equal(db.prepare('SELECT state FROM jobs WHERE id=?').get(job.id).state,'staging');}finally{db.close();}
}

test('a checkpointed sample survives a working-state restart and resumes the frozen plan without omissions or duplicate learning',{timeout:10000},async t=>{
  const f=await fixture(t),source=await makeHistoryBundle(path.join(f.directory,'source'),{selfCount:59,longOther:false}),records=structuredClone(source.records);
  for(const row of records)if(row.speaker==='subject'){row.clean_text+='补充合成资料。'.repeat(60);row.original_text=row.clean_text;}
  const bundle=await makeHistoryBundle(path.join(f.directory,'bundle'),{records,personId:source.personId,ownerId:source.ownerId}),validated=await validateHistoryBundle(bundle.directory),plan=buildHistoryMemoryEvents(validated,{accountId:f.account,archiveId:randomUUID(),epoch:1}),job=await stage(f,bundle);
  assert.ok(plan.length>8);await f.archives.start(f.account,job.id,{memoryLimit:2});
  const sample=await until(async()=>{const current=(await f.archives.job(f.account,job.id)).job;return current.pauseReason==='sample-limit'&&current;});assert.equal(sample.memory.acked,2);
  await f.archives.close();
  // Model a process that exited after persisting working, before its next checkpoint.
  const db=new DatabaseSync(path.join(f.directory,'history-archives','archives.sqlite3'));db.prepare("UPDATE jobs SET state='working',pause_reason=NULL WHERE id=?").run(job.id);db.close();await f.reopen();
  const interrupted=(await f.archives.job(f.account,job.id)).job;assert.equal(interrupted.state,'paused');assert.equal(interrupted.errorCode,'HISTORY_IMPORT_INTERRUPTED');assert.equal(interrupted.memory.acked,2);
  await f.archives.start(f.account,job.id,{});const complete=await finished(f,job.id);assert.equal(complete.memory.acked,plan.length);assert.deepEqual([...f.memory.users.get(f.account).events.keys()],plan.map(event=>event.id));assert.ok([...f.memory.writes.values()].every(count=>count===1));
  assert.deepEqual(await f.archives.list(f.other),{archives:[]});assert.equal(await f.archives.getContext(f.other,{query:'合成资料',epoch:1}),'');
});

test('the same immutable messages in another export ignore serial ordering metadata while preserving content conflict detection',{timeout:10000},async t=>{
  const f=await fixture(t),first=await makeHistoryBundle(path.join(f.directory,'one'),{selfCount:2,longOther:false}),one=await stage(f,first);await f.archives.start(f.account,one.id,{});await finished(f,one.id);
  const count=f.memory.users.get(f.account).events.size,records=structuredClone(first.records);for(const row of records){row.source.serial+=100;row.source.sort_seq+=200;}
  const repeated=await makeHistoryBundle(path.join(f.directory,'two'),{records,personId:first.personId,ownerId:first.ownerId}),two=await stage(f,repeated);await f.archives.start(f.account,two.id,{});await finished(f,two.id);assert.equal(f.memory.users.get(f.account).events.size,count);assert.equal((await f.archives.list(f.account)).archives.length,2);
  const conflict=structuredClone(records);conflict[1].original_text+='合成正文冲突';const bad=await makeHistoryBundle(path.join(f.directory,'three'),{records:conflict,personId:first.personId,ownerId:first.ownerId}),three=await stage(f,bad);await assert.rejects(f.archives.start(f.account,three.id,{}),{code:'HISTORY_MESSAGE_CONFLICT'});assert.equal((await f.archives.list(f.account)).archives.length,2);
});

test('a place-specific query retains its exact older evidence instead of ten newer generic weather matches',{timeout:10000},async t=>{
  const f=await fixture(t),source=await makeHistoryBundle(path.join(f.directory,'source'),{selfCount:14,longOther:false}),records=structuredClone(source.records);
  for(let index=1;index<records.length;index++){const value=index===1?'我住在北蔡镇，平时关注北蔡镇天气。':`合成自述${index}：今天聊苏州天气。`;records[index].clean_text=value;records[index].original_text=value;}
  const bundle=await makeHistoryBundle(path.join(f.directory,'bundle'),{records,personId:source.personId,ownerId:source.ownerId}),job=await stage(f,bundle);await f.archives.start(f.account,job.id,{});await finished(f,job.id);
  const context=await f.archives.getContext(f.account,{query:'北蔡镇天气',epoch:1});assert.match(context,/北蔡镇/);assert.match(context,new RegExp(records[1].msg_id));assert.ok(context.length<=3300);assert.equal(await f.archives.getContext(f.other,{query:'北蔡镇天气',epoch:1}),'');
});

test('closing an archive during memory synchronization never checkpoints or accesses its closed database after late completion',{timeout:10000},async t=>{
  const f=await fixture(t),started=deferred(),release=deferred();f.memory.syncGate=async()=>{started.resolve();await release.promise;};
  t.after(()=>release.resolve());const bundle=await makeHistoryBundle(path.join(f.directory,'bundle'),{selfCount:2,longOther:false}),job=await stage(f,bundle);await f.archives.start(f.account,job.id,{});await started.promise;
  await f.archives.close();const callsAtClose=f.memory.calls.length;release.resolve();await delay(30);assert.equal(f.memory.calls.length,callsAtClose,'A closed worker must not call inspect/status after its pending sync finishes');
  const db=new DatabaseSync(path.join(f.directory,'history-archives','archives.sqlite3'));try{assert.equal(db.prepare('SELECT memory_acked FROM jobs WHERE id=?').get(job.id).memory_acked,0);}finally{db.close();}
});

test('writer abort and thread termination at commit-ready roll back every archive table and its prepared job state',{timeout:10000},async t=>{
  const f=await fixture(t),bundle=await makeHistoryBundle(path.join(f.directory,'bundle'),{selfCount:2,longOther:false}),job=await stage(f,bundle),input=writerInput(f,bundle,job);
  for(const mode of ['abort','terminate']){
    const writer=new Worker(new URL('../server/history-archive-writer.mjs',import.meta.url),{workerData:input.workerData}),ready=deferred();let sent=false,aborted=false;
    const exit=new Promise((resolve,reject)=>{writer.once('error',reject);writer.once('exit',resolve);});
    writer.on('message',message=>{if(message.type==='next'){writer.postMessage(sent?{type:'finish',events:input.events}:{type:'batch',rows:input.rows});sent=true;}else if(message.type==='commit-ready')ready.resolve();else if(message.type==='error'){assert.equal(message.code,'HISTORY_CLOSED');aborted=true;}});
    t.after(()=>writer.terminate());await ready.promise;
    if(mode==='abort'){writer.postMessage({type:'abort',code:'HISTORY_CLOSED'});assert.equal(await exit,0);assert.equal(aborted,true);}else{await writer.terminate();await exit;}
    assertRolledBack(f,job);
  }
});

test('a parent process exiting before the commit authorization leaves no partially published archive or prepared plan',{timeout:10000},async t=>{
  const f=await fixture(t),bundle=await makeHistoryBundle(path.join(f.directory,'bundle'),{selfCount:2,longOther:false}),job=await stage(f,bundle),input=writerInput(f,bundle,job);
  const source=`import {Worker} from 'node:worker_threads';let raw='';for await(const part of process.stdin)raw+=part;const input=JSON.parse(raw);const writer=new Worker(input.writer,{workerData:input.workerData,execArgv:[]});let sent=false;writer.on('error',()=>process.exit(2));writer.on('message',message=>{if(message.type==='next'){writer.postMessage(sent?{type:'finish',events:input.events}:{type:'batch',rows:input.rows});sent=true;}else if(message.type==='commit-ready'){process.stdout.write('commit-ready\\n',()=>process.exit(0));}else if(message.type==='error')process.exit(3);});`;
  const child=spawn(process.execPath,['--input-type=module','-e',source],{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',errors='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{errors+=chunk;});t.after(()=>{if(child.exitCode===null)child.kill();});
  const result=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});child.stdin.end(JSON.stringify({...input,writer:fileURLToPath(new URL('../server/history-archive-writer.mjs',import.meta.url))}));
  assert.deepEqual(await result,{code:0,signal:null},errors);assert.equal(output,'commit-ready\n');assertRolledBack(f,job);
});
