import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {platformNode,platformOptions,cloudResources} from '../server/cloud-platform-options.mjs';
import {createPlatformDocker} from '../server/cloud-docker-platform.mjs';
import {createCloudDocker} from '../server/cloud-docker.mjs';
import {platformObservation} from '../server/cloud-platform-observation.mjs';
const host=()=>({id:randomUUID(),name:'K3s 专用节点',status:'online',runtimeKind:'kubernetes',templates:['full'],kubernetesConstraints:{pidsLimit:256,pidsConfigured:true,pidsVerifiedAtCreate:true,persistentStorage:true,graphical:false,gpu:false,publishedPorts:false}});
test('bounded K3s metadata and resource defaults retain the fixed PID ceiling',()=>{
 const h=host();h.secret='never-copy';const n=platformNode(h);
 assert.equal(n.ready,true);assert(!JSON.stringify(n).includes('never-copy'));
 assert.deepEqual(platformOptions(n,{nodeId:h.id,bundle:'agent'},{cpus:1,memoryMiB:1024}),{runtimeKind:'kubernetes',resources:{cpus:1,memoryMiB:1024,pids:256}});
 for(const value of [{cpus:NaN},{cpus:'2'},{memoryMiB:255},{pids:true},{gpu:1}])assert.throws(()=>cloudResources(value),{status:400});
 for(const kind of ['unknown',false,''])assert.throws(()=>platformNode({...h,runtimeKind:kind}));
 assert.throws(()=>platformNode({...h,kubernetesConstraints:{...h.kubernetesConstraints,pidsConfigured:'true'}}));
});

test('creating and recovery phases cannot be reported as stopped or ready merely because pods exist',()=>{
 const record={bundle:'desktop'};
 for(const phase of ['creating','recovery_required','pending']){const value=platformObservation({phase,dockerState:'unknown',revision:8},record);assert.equal(value.state,phase==='creating'?'creating':'unknown');assert.equal(value.desktop,false);assert.equal(value.revision,8);}
 assert.equal(platformObservation({phase:'running',dockerState:'unknown',revision:8},record).state,'unknown');
 assert.equal(platformObservation({phase:'running',dockerState:'running',revision:8},record).state,'running');
});

test('platform lifecycle uses the latest inspected revision and a bounded cold-start deadline',async()=>{
 const clientId=randomUUID(),r={clientId,userId:randomUUID(),nodeId:randomUUID(),bundle:'agent',projectId:randomUUID(),requestId:randomUUID(),name:'synthetic'},calls=[];
 const driver=createPlatformDocker({credential:async()=>({clientId}),request:async(_kind,route,options)=>{calls.push({route,options});if(route==='/v1/projects')return{id:r.projectId,hostId:r.nodeId};return{id:r.projectId,hostId:r.nodeId,revision:17,bundle:'full',phase:'stopped'};}});
 await driver.create(r);await driver.action(r,'start');
 assert.equal(calls.find(c=>c.route==='/v1/projects').options.timeoutMs,120000);
 const start=calls.find(c=>c.options.body?.operation==='project.start');assert.deepEqual(start.options.body.payload,{revision:17});assert.equal(start.options.timeoutMs,120000);
});
test('unready and unsupported K3s requests cannot be admitted',()=>{
 const h=host(),r={nodeId:h.id,bundle:'agent'},n=platformNode(h);
 assert.throws(()=>platformOptions(n,{bundle:'agent'}),{code:'cloud_kubernetes_node_required'});
 assert.throws(()=>platformOptions(n,{...r,bundle:'desktop'}),{code:'cloud_kubernetes_bundle_unsupported'});
 assert.throws(()=>platformOptions(n,r,{pids:512}),{code:'cloud_kubernetes_pids_unsupported'});
 for(const flag of ['pidsConfigured','pidsVerifiedAtCreate','persistentStorage']){const unready=platformNode({...h,kubernetesConstraints:{...h.kubernetesConstraints,[flag]:false}});assert.equal(unready.ready,false);assert.throws(()=>platformOptions(unready,r),{code:'cloud_kubernetes_not_ready'});}
});
test('platform sends the frozen full CLI resources and refuses node drift before another create',async()=>{
 const h=host(),clientId=randomUUID(),calls=[];
 const driver=createPlatformDocker({credential:async()=>({clientId}),request:async(_kind,route,options)=>{calls.push({route,options});if(route==='/v1/hosts')return{hosts:[h]};return{id:r.projectId,hostId:h.id};}});
 const r={clientId,userId:randomUUID(),nodeId:h.id,requestedNodeId:h.id,bundle:'agent',projectId:randomUUID(),requestId:randomUUID(),name:'test'};
 Object.assign(r,await driver.prepare(r,{memoryMiB:1024}));await driver.create(r);await driver.create(r);
 const sent=calls.filter(c=>c.route==='/v1/projects');assert.equal(sent.length,2);assert.deepEqual(sent[0].options.body,sent[1].options.body);assert.equal(sent[0].options.body.resources.pids,256);assert.equal(sent[0].options.body.bundle,'full');
 h.kubernetesConstraints.pidsLimit=512;await assert.rejects(driver.create(r));assert.equal(calls.filter(c=>c.route==='/v1/projects').length,2);
});
test('K3s inspect uses public host metadata because Platform does not expose runtimeKind on projects',async()=>{
 const h=host(),clientId=randomUUID(),r={clientId,userId:randomUUID(),nodeId:h.id,bundle:'agent',projectId:randomUUID(),runtimeKind:'kubernetes',resources:{pids:256}};
 const driver=createPlatformDocker({credential:async()=>({clientId}),request:async(_kind,route)=>route==='/v1/hosts'?{hosts:[h]}:{id:r.projectId,hostId:h.id,bundle:'full',revision:1,resources:{pids:256},phase:'running'}});
 assert.equal((await driver.inspect(r)).desktop,false);h.runtimeKind='docker';await assert.rejects(driver.inspect(r),{code:'cloud_docker_identity_changed'});
});
test('cloud creation persists resources across restart and never reassigns an uncertain request',async t=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'petpal-k3s-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));
 const nodeId=randomUUID(),clientId=randomUUID(),requestId=randomUUID(),calls=[];let first=true;
 const platform={credential:async()=>({clientId}),prepare:async()=>({runtimeKind:'kubernetes',resources:{cpus:1,memoryMiB:1024,pids:256}}),catalog:async()=>({available:true,nodes:[]}),create:async r=>{calls.push(structuredClone(r));if(first){first=false;throw Error('lost receipt');}return{nodeId};},inspect:async()=>({state:'running',generation:'pod-uid',desktop:false})};
 const opts={dataDir,authorizeUser:id=>({id,enabled:true}),getConfig:()=>({}),publicOrigin:()=>'',localDriver:{status:async()=>({available:false})},platformDriver:platform,refreshMs:0};
 const body={name:'K3s',source:'platform',nodeId,bundle:'agent',requestId,resources:{cpus:1,memoryMiB:1024}};
 const a=await createCloudDocker(opts);await assert.rejects(a.create('u',body));await a.close();
 const b=await createCloudDocker(opts);t.after(()=>b.close());const live=await b.create('u',body);
 assert.equal(live.online,true);assert.equal(live.docker.runtimeKind,'kubernetes');assert.equal(live.docker.resources.pids,256);assert.equal(live.docker.desktopAvailable,false);
 assert.equal(calls.length,2);assert.equal(calls[0].projectId,calls[1].projectId);assert.deepEqual(calls[0].resources,calls[1].resources);
 await assert.rejects(b.create('u',{...body,resources:{cpus:2,memoryMiB:1024}}),{status:409});assert.equal(calls.length,2);
 assert.throws(()=>b.hostFor('other',live.id),{status:404});const journal=JSON.parse(await readFile(path.join(dataDir,'cloud-docker/state.json')));assert.equal(journal.records.length,1);
});
