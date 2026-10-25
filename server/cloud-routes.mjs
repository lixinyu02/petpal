import express from 'express';
import {Readable} from 'node:stream';
import {MODEL_REQUEST_BYTES} from './model-request-limits.mjs';

const failure=(status,message)=>Object.assign(new Error(message),{status});
const fields=(req,allowed=[])=>{
 if(Object.keys(req.query).length||Object.keys(req.body??{}).some(key=>!allowed.includes(key)))throw failure(400,'请求含有不支持的字段。');
};
const publicLinks=value=>({links:Object.entries(value.links??{}).map(([kind,link])=>({...link,kind,paired:link.state==='ready',error:link.lastError||'',catalogUpdatedAt:link.updatedAt}))});

/** Narrow model capability, before the ordinary account JSON/auth middleware. */
export function mountCloudModelRoute(app,getCloud){
 app.post('/api/cloud-docker/model/v1/responses',express.raw({type:'application/json',limit:MODEL_REQUEST_BYTES}),async(req,res)=>{
  if(Object.keys(req.query).length)throw failure(400,'模型代理不接受查询参数。');
  const abort=new AbortController(),close=()=>{if(!res.writableEnded)abort.abort();};res.once('close',close);
  try{
   const upstream=await getCloud().modelRequest({authorization:req.headers.authorization,path:'/responses',headers:req.headers,body:req.body,signal:abort.signal});
   res.status(upstream.status);res.set('Cache-Control','no-store');res.set('Content-Type',upstream.headers.get('content-type')||'application/json');
   if(!upstream.body){res.end();return;}
   const stream=Readable.fromWeb(upstream.body);stream.on('error',()=>res.destroy());await new Promise(resolve=>{res.once('finish',resolve);res.once('close',()=>{stream.destroy();resolve();});stream.pipe(res);});
  }finally{res.off('close',close);}
 });
}

export function mountCloudRoutes({app,cloud,links,desktop,auth,admin,executorAuth,syncModels,syncHosts=async()=>{},stopHostWork}){
 app.get('/api/service-links',async(req,res)=>{admin(req);fields(req);const value=await links.status();admin(req);res.json(publicLinks(value));});
 app.post('/api/service-links/:kind/pair',async(req,res)=>{admin(req);fields(req,['baseUrl','code']);try{await links.pair(req.params.kind,req.body);}finally{await syncModels();}admin(req);res.json(publicLinks(await links.status()));});
 app.post('/api/service-links/:kind/refresh',async(req,res)=>{admin(req);fields(req);try{await links.refresh(req.params.kind);}finally{await syncModels();}admin(req);res.json(publicLinks(await links.status()));});
 app.delete('/api/service-links/:kind',async(req,res)=>{admin(req);fields(req);try{const pending=links.disconnect(req.params.kind);pending.catch(()=>{});await syncModels();await pending;}finally{await syncModels();}admin(req);res.json(publicLinks(await links.status()));});
 app.get('/api/cloud-docker',async(req,res)=>{auth(req);fields(req);await cloud.refresh?.(req.user.id);await syncHosts();auth(req);res.json({instances:cloud.list(req.user.id)});});
 app.get('/api/cloud-docker/catalog',async(req,res)=>{auth(req);fields(req);const value=await cloud.catalog(req.user.id);auth(req);res.json(value);});
 app.post('/api/cloud-docker/prepare',async(req,res)=>{admin(req);fields(req);const value=await cloud.prepare(req.user.id);admin(req);res.json(value);});
 app.post('/api/cloud-docker',async(req,res)=>{auth(req);fields(req,['name','source','nodeId','bundle','requestId']);let instance;try{instance=await cloud.create(req.user.id,req.body);}finally{await syncHosts();}auth(req);res.status(201).json({instance});});
 for(const action of ['start','stop'])app.post(`/api/cloud-docker/:id/${action}`,async(req,res)=>{
  auth(req);fields(req);cloud.hostFor(req.user.id,req.params.id);
  if(action==='stop')await stopHostWork(req.params.id);
  const instance=await cloud.action(req.user.id,req.params.id,action);auth(req);res.json({instance});
 });
 app.post('/api/cloud-docker/:id/desktop-ticket',(req,res)=>{auth(req);fields(req);res.status(201).json(desktop.issue(executorAuth(req),req.params.id));});
}
