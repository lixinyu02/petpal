import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createPetServer} from '../server/app.mjs';
import {routineDefaults} from '../server/companion-routine-schema.mjs';
import {listenFixture} from './helpers/loopback.mjs';

test('authenticated routines recall only their own memory, use a real Chat stream, publish an independent read-only notification and isolate records',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'petpal-companion-api-')),reads=[],requests=[];
 const upstream=http.createServer(async(req,res)=>{
   let body='';for await(const chunk of req)body+=chunk;requests.push(JSON.parse(body));
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   res.end('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify({greeting:'早上好，愿你今天也能有一点读书的时间。'})},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
 });await listenFixture(upstream);
 const app=await createPetServer({dataDir:directory,token:'companion-api-owner-fixture',automationOptions:{autoStart:false},
   codex:{async status(){return {available:false};},async close(){}},desktopTools:{specs:[],async close(){}},
   memoryOptions:{service:{async getContext(userId,{query}){reads.push({userId,query});return '喜欢读书，最近关心书架整理。';},async close(){}}},
   companionOptions:{searchLocations:async()=>[{id:'101020600001',name:'北蔡镇',fullName:'上海 / 浦东 / 北蔡镇',sourceUrl:'http://www.weather.com.cn/weather/101020600001.shtml'}]},
 });await listenFixture(app.server);
 t.after(async()=>{await app.close();upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));await rm(directory,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.server.address().port}/api`;
 const call=async(route,{token='companion-api-owner-fixture',method='GET',body}={})=>{
   const r=await fetch(base+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json(),cache:r.headers.get('cache-control')};
 };
 assert.equal((await call('/companion-routine',{token:''})).status,401);
 const p=await call('/providers',{method:'POST',body:{name:'Daily fixture',protocol:'chat-completions',baseUrl:`http://127.0.0.1:${upstream.address().port}/v1`,model:'fixture-chat',apiKey:'fixture'}});
 assert.equal(p.status,200);
 const providerId=p.data.id??p.data.provider?.id;
 const member=async username=>{
   const created=await call('/admin/users',{method:'POST',body:{username,password:'SyntheticDaily123a',providerIds:[providerId]}});assert.equal(created.status,201);
   const login=await call('/auth/login',{method:'POST',token:'',body:{username,password:'SyntheticDaily123a'}});assert.equal(login.status,200);return {user:created.data.user,token:login.data.token};
 };
 const a=await member('daily-a'),b=await member('daily-b');
 const device=await call('/notifications/devices',{method:'POST',token:a.token,body:{deviceId:randomUUID()}});assert.equal(device.status,201);
 const deviceToken=device.data.token;assert.ok(deviceToken);
 const initial=await call('/notifications/companion-feed',{token:deviceToken});assert.equal(initial.status,200);assert.equal(initial.data.resetRequired,true);assert.equal(initial.cache,'no-store');
 assert.equal((await call('/companion-routine',{token:deviceToken,method:'PUT',body:{...routineDefaults(),enabled:true,revision:null}})).status,401);
 const saved=await call('/companion-routine',{token:a.token,method:'PUT',body:{...routineDefaults(),revision:null}});assert.equal(saved.status,200);assert.equal(saved.data.routine.enabled,false);
 assert.equal((await call('/companion-routine',{token:b.token})).data.routine.revision,null);
 const requestId=randomUUID(),submitted=await call('/companion-routine/run',{token:a.token,method:'POST',body:{requestId}});assert.equal(submitted.status,202);
 await app.companionRoutines.settle();
 const result=await call('/companion-routine/runs/'+submitted.data.run.id,{token:a.token});assert.equal(result.status,200);assert.equal(result.data.run.status,'completed');assert.match(result.data.run.content,/读书/);
 assert.deepEqual(reads.map(item=>item.userId),[a.user.id]);assert.match(reads[0].query,/当前用户/);
 assert.equal(requests.length,1);assert.equal(requests[0].model,'fixture-chat');assert.equal(requests[0].tools,undefined);assert.ok(requests[0].messages.some(item=>item.content.includes('喜欢读书')));
 assert.equal((await call('/companion-routine/runs/'+submitted.data.run.id,{token:b.token})).status,404);
 const same=await call('/companion-routine/run',{token:a.token,method:'POST',body:{requestId}});assert.equal(same.data.run.id,submitted.data.run.id);assert.equal(requests.length,1);
 const feed=await call('/notifications/companion-feed?after=0',{token:deviceToken});assert.equal(feed.data.events.length,1);assert.equal(feed.data.events[0].runId,result.data.run.id);assert.ok(!feed.data.events[0].body.includes('读书'));
 const oldFeed=await call('/notifications/device/feed?after=0',{token:deviceToken});assert.deepEqual(oldFeed.data.events,[]);assert.equal(oldFeed.data.highWater,0);
 assert.equal((await call('/companion-routine?userId='+a.user.id,{token:b.token})).status,400);
 assert.equal((await call('/notifications/companion-feed?userId='+b.user.id,{token:deviceToken})).status,400);
 const disabled=await call('/admin/users/'+a.user.id,{method:'PATCH',body:{disabled:true}});assert.equal(disabled.status,200);
 assert.equal((await call('/notifications/companion-feed?after=0',{token:deviceToken})).status,401);
});
