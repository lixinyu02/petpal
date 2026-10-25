import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCompanionRoutineService} from '../server/companion-routines.mjs';
import {routineDefaults,normalizeRoutineSettings} from '../server/companion-routine-schema.mjs';
import {createCompanionPersonalizer} from '../server/companion-personalization.mjs';

const base={title:'早上好',content:'基础问候\n\n今日天气：16–22℃。来源：中国天气网。',warnings:[],body:'早上好，今日天气16–22℃。'};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(t,opts={}){
 const directory=await mkdtemp(path.join(tmpdir(),'petpal-companion-')),instanceId=randomUUID(),users=[{id:randomUUID(),displayName:'A',disabled:false},{id:randomUUID(),displayName:'B',disabled:false}];
 let time=Date.parse('2026-10-20T23:59:00Z'),calls=0;
 const service=await createCompanionRoutineService({directory,instanceId,users:()=>users,clock:()=>time,autoStart:false,buildContent:async(settings,ctx)=>{calls++;return opts.buildContent?opts.buildContent(settings,ctx):structuredClone(base);},searchLocations:async()=>[],...opts});
 t.after(async()=>{await service.close();await rm(directory,{recursive:true,force:true});});
 return {directory,instanceId,users,service,get calls(){return calls;},advance:ms=>time+=ms,clock:()=>time,save:(settings={},userId=users[0].id,revision=null)=>service.configure(userId,{...routineDefaults(),...settings,revision})};
}

test('configuration rejects executable/foreign fields, invalid birthday/time and unconfirmed weather',()=>{
 for(const change of [{hostId:'central'},{time:'25:00'},{timezone:'Mars/City'},{birthday:'02-30'},{includeWeather:true}])assert.throws(()=>normalizeRoutineSettings({...routineDefaults(),...change}));
 assert.equal(normalizeRoutineSettings({...routineDefaults(),birthday:'02-29'}).birthday,'02-29');
});
test('daily scheduling is durable, timezone based, exactly one claim per local day and independent from Agent',async t=>{
 const f=await fixture(t),userId=f.users[0].id;
 assert.equal(f.service.catalog(userId).routine.enabled,false);
 const saved=await f.save({enabled:true});assert.equal(saved.routine.nextRunAt,'2026-10-21T00:00:00.000Z');
 f.advance(60000);await Promise.all([f.service.tick(),f.service.tick()]);await f.service.settle();
 const runs=f.service.catalog(userId).runs;assert.equal(runs.length,1);assert.equal(runs[0].status,'completed');assert.equal(runs[0].localDate,'2026-10-21');assert.equal(f.calls,1);
 assert.equal(f.service.feed(userId,{}).events.length,0,'new installations establish a baseline, not replay');
 const feed=f.service.feed(userId,{after:'0'});assert.equal(feed.events.length,1);assert.equal(feed.events[0].body,'你的每日问候已准备好，点击查看。');
 assert.ok(!JSON.stringify(feed).includes('16–22'));assert.equal(f.service.catalog(f.users[1].id).runs.length,0);assert.throws(()=>f.service.runView(f.users[1].id,runs[0].id),e=>e.status===404);
 await f.service.tick();assert.equal(f.calls,1);
 const disk=JSON.parse(await readFile(path.join(f.directory,'companion-routines.json'),'utf8'));assert.equal(disk.accounts[0].highWater,1);
});
test('manual requestId is idempotent under concurrency and CAS protects simultaneous saves',async t=>{
 const gate=deferred(),f=await fixture(t,{buildContent:async()=>{await gate.promise;return structuredClone(base);}}),userId=f.users[0].id;
 const saved=await f.save();const requestId=randomUUID();
 const [a,b]=await Promise.all([f.service.run(userId,{requestId}),f.service.run(userId,{requestId})]);assert.equal(a.run.id,b.run.id);
 const result=await Promise.allSettled([f.save({time:'09:00'},userId,saved.routine.revision),f.save({time:'10:00'},userId,saved.routine.revision)]);
 assert.equal(result.filter(v=>v.status==='fulfilled').length,1);assert.equal(result.find(v=>v.status==='rejected').reason.status,409);
 gate.resolve();await f.service.settle();assert.equal(f.service.runView(userId,a.run.id).run.status,'cancelled');assert.equal(f.service.feed(userId,{after:'0'}).events.length,0);
});
test('account disable wins over a late content response and missed schedules do not send stale weather',async t=>{
 const gate=deferred(),f=await fixture(t,{buildContent:async()=>{await gate.promise;return structuredClone(base);}}),userId=f.users[0].id;
 await f.save({enabled:true});f.advance(60000);await f.service.tick();f.users[0].disabled=true;gate.resolve();await f.service.settle();
 assert.throws(()=>f.service.catalog(userId),e=>e.status===401);f.users[0].disabled=false;assert.equal(f.service.catalog(userId).runs[0].status,'cancelled');
 f.advance(24*3600000+3600000);await f.service.tick();assert.equal(f.service.catalog(userId).runs[0].status,'skipped');assert.equal(f.service.feed(userId,{after:'0'}).events.length,0);
});
test('restarting restores finished results without replay and cancels interrupted claims',async t=>{
 const f=await fixture(t),userId=f.users[0].id;await f.save();const result=await f.service.run(userId,{requestId:randomUUID()});await f.service.settle();
 const file=path.join(f.directory,'companion-routines.json'),disk=JSON.parse(await readFile(file,'utf8'));
 await f.service.close();disk.accounts[0].runs.push({...disk.accounts[0].runs[0],id:randomUUID(),requestId:randomUUID(),status:'claiming'});
 const pending=disk.accounts[0].runs.at(-1);for(const key of ['seq','validUntil','finishedAt','title','content','body'])delete pending[key];await writeFile(file,JSON.stringify(disk));
 const restored=await createCompanionRoutineService({directory:f.directory,instanceId:f.instanceId,users:()=>f.users,autoStart:false});t.after(()=>restored.close());
 assert.equal(restored.runView(userId,result.run.id).run.status,'completed');assert.equal(restored.runView(userId,pending.id).run.status,'cancelled');assert.equal(restored.feed(userId,{}).events.length,0);
});
test('preview neither persists nor notifies; corrupt data is preserved, not reset',async t=>{
 const f=await fixture(t),userId=f.users[0].id;const preview=await f.service.preview(userId,routineDefaults());assert.equal(preview.content,base.content);assert.equal(f.service.catalog(userId).runs.length,0);
 await f.service.close();const file=path.join(f.directory,'companion-routines.json');await writeFile(file,'{"version":999}');
 await assert.rejects(createCompanionRoutineService({directory:f.directory,instanceId:f.instanceId,users:()=>f.users,autoStart:false}));assert.equal(await readFile(file,'utf8'),'{"version":999}');
});
test('session guard revocation prevents a queued configuration from becoming durable',async t=>{
 const f=await fixture(t),userId=f.users[0].id;let permitted=false;
 await assert.rejects(f.service.configure(userId,{...routineDefaults(),enabled:true,revision:null},{guard:()=>{if(!permitted)throw Object.assign(Error('revoked'),{status:401});}}),e=>e.status===401);
 assert.equal(f.service.catalog(userId).routine.revision,null);
});
test('personalization recalls the exact user, has no tools, keeps weather and never leaks memory in notification preview',async()=>{
 const userId=randomUUID(),provider={id:randomUUID(),protocol:'responses',model:'fixture'},seen=[];
 const build=createCompanionPersonalizer({buildContent:async()=>structuredClone(base),recall:async(id,query)=>{seen.push(id);return '喜欢阅读；昨日想整理书架。';},getProvider:()=>provider,generate:async request=>{assert.equal(request.onToolCall,undefined);assert.ok(request.persona.includes('不可信'));assert.match(request.messages[0].content,/整理书架/);return {text:'{"greeting":"早上好，愿今天也能留一点时间读喜欢的书。"}'};}});
 const result=await build(routineDefaults(),{userId,now:new Date('2026-10-21T00:00:00Z')});assert.deepEqual(seen,[userId]);assert.ok(result.content.startsWith(base.content));assert.match(result.content,/读喜欢的书/);assert.equal(result.body,base.body);assert.ok(!result.body.includes('书'));
});
test('memory/model failures degrade without raw memory and model authorization changes discard a late answer',async()=>{
 const ctx={userId:randomUUID(),now:new Date()},settings=routineDefaults();let provider={id:'first'};
 const failed=createCompanionPersonalizer({buildContent:async()=>structuredClone(base),recall:async()=>{throw Error('PRIVATE_MEMORY');},getProvider:()=>provider});assert.ok(!(await failed(settings,ctx)).content.includes('PRIVATE_MEMORY'));
 const build=createCompanionPersonalizer({buildContent:async()=>structuredClone(base),recall:async()=> 'PRIVATE_MEMORY',getProvider:()=>provider,generate:async()=>{provider={id:'changed'};return {text:'{"greeting":"PRIVATE_MEMORY"}'};}});
 const result=await build(settings,ctx);assert.equal(result.content,base.content);assert.ok(result.warnings.length>0);
 const unavailable=createCompanionPersonalizer({buildContent:async()=>structuredClone(base),recall:async()=> 'PRIVATE_MEMORY',getProvider:()=>{throw Error('PRIVATE_PROVIDER');}});
 const fallback=await unavailable(settings,ctx);assert.equal(fallback.content,base.content);assert.ok(fallback.warnings.length>0);assert.ok(!JSON.stringify(fallback).includes('PRIVATE_'));
});

test('personalization preserves the server-only model authorizer across its structured snapshot',async()=>{
 const provider={id:'runtime-harbor',protocol:'responses',model:'fixture'},authorize=()=>{throw new Error('revoked runtime link');};Object.defineProperty(provider,'authorize',{value:authorize});let inspected=false;
 const build=createCompanionPersonalizer({buildContent:async()=>structuredClone(base),recall:async()=> '喜欢阅读',getProvider:()=>provider,generate:async request=>{inspected=true;assert.equal(request.provider.authorize,authorize);assert.equal(Object.keys(request.provider).includes('authorize'),false);request.provider.authorize();}});
 const result=await build(routineDefaults(),{userId:randomUUID(),now:new Date()});assert.equal(inspected,true);assert.equal(result.content,base.content);assert.ok(result.warnings.length>0);assert.equal(JSON.stringify(result).includes('revoked runtime link'),false);
});
