import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { mountOpenCliRoutes } from '../server/opencli-routes.mjs';
import { listenFixture } from './helpers/loopback.mjs';

async function fixture(t) {
  const app=express(),probes=new Set(),calls=[];
  const manager={config:async()=>({revision:'fixture',enabled:true}),status:async()=>({queryReady:true}),sites:async args=>({sites:[],args}),configure:async body=>{calls.push(body);return body;},executeBrowser:async(body,{signal})=>{calls.push(body);return {ok:true};}};
  app.use(express.json());
  app.use((req,res,next)=>{const role=req.headers['x-fixture-role'];if(!role)return res.sendStatus(401);req.user={id:role,role};req.sessionHash='session';next();});
  mountOpenCliRoutes({app,manager,probes,requireAdmin:user=>{if(user.role!=='owner')throw Object.assign(new Error('owner required'),{status:403});},requireCurrentAuth:()=>{}});
  app.use((error,req,res,next)=>res.status(error.status??500).json({error:error.message}));
  const server=http.createServer(app);await listenFixture(server);
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  return {calls,probes,manager,request:(route,role='owner',body,method=body===undefined?'GET':'POST')=>fetch(`http://127.0.0.1:${server.address().port}/api/desktop-tools/opencli/${route}`,{method,headers:{...(role?{'x-fixture-role':role}:{}),'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})})};
}

test('OpenCLI management requires login and owner for every route',async t=>{
  const f=await fixture(t);
  for(const [route,body,method] of [['config'],['status'],['sites?site=npm'],['config',{revision:'fixture',enabled:false},'PATCH'],['action',{action:'connect'}]]){
    assert.equal((await f.request(route,null,body,method)).status,401);
    assert.equal((await f.request(route,'member',body,method)).status,403);
  }
  assert.deepEqual(f.calls,[]);
  const sites=await f.request('sites?site=npm&command=package');assert.equal(sites.status,200);assert.deepEqual((await sites.json()).args,{site:'npm',command:'package'});
});

test('browser actions register revocable probes and release them on failure',async t=>{
  const f=await fixture(t);let entered,release;
  const started=new Promise(resolve=>{entered=resolve;});
  f.manager.executeBrowser=async(body,{signal})=>{entered();await new Promise((resolve,reject)=>{release=resolve;signal.addEventListener('abort',()=>reject(Object.assign(new Error('stopped'),{status:499})),{once:true});});return {ok:true};};
  const pending=f.request('action','owner',{action:'connect'});await started;
  assert.equal(f.probes.size,1);const probe=[...f.probes][0];assert.equal(probe.mode,'opencli');assert.equal(probe.userId,'owner');
  probe.controller.abort();assert.equal((await pending).status,499);await probe.done;assert.equal(f.probes.size,0);
});
