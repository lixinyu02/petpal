import path from 'node:path';
import {mkdir,lstat,readFile,open,rename,unlink,chmod} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {memobaseProjectionUserId} from './memory-service.mjs';
const fail=(status,code)=>Object.assign(new Error(code),{status,code});
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v);
export async function createMemoryModels({dataDir,getUser,choices,resolveProvider,getScope,refreshMs=1500}){
 const directory=path.resolve(dataDir,'memory-models');await mkdir(directory,{recursive:true,mode:0o700});
 const identity=await lstat(directory);if(!identity.isDirectory()||identity.isSymbolicLink())throw fail(503,'MEMORY_MODEL_STORAGE');
 const guard=async()=>{const s=await lstat(directory);if(!s.isDirectory()||s.isSymbolicLink()||s.dev!==identity.dev||s.ino!==identity.ino)throw fail(503,'MEMORY_MODEL_STORAGE');};
 async function read(name){await guard();try{const file=path.join(directory,name),s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>2*1024*1024)throw fail(503,'MEMORY_MODEL_STORAGE');return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 async function write(name,value){await guard();const file=path.join(directory,name);try{const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw fail(503,'MEMORY_MODEL_STORAGE');}catch(e){if(e.code!=='ENOENT')throw e;}const temp=file+'.'+randomUUID()+'.tmp',h=await open(temp,'wx',0o600);try{await h.writeFile(JSON.stringify(value)+'\n');await h.sync();await h.close();await guard();await rename(temp,file);if(process.platform!=='win32')await chmod(file,0o600);}finally{await h.close().catch(()=>{});await unlink(temp).catch(()=>{});}}
 let prefs=await read('preferences.json')??{version:1,users:{}},known=await read('bindings.json')??{version:1,users:{}};
 if(prefs.version!==1||known.version!==1||!plain(prefs.users)||!plain(known.users)||Object.keys(prefs.users).length>1000||Object.keys(known.users).length>1000)throw fail(503,'MEMORY_MODEL_STORAGE');
 const preference=id=>{const p=prefs.users[id]??{providerId:null,concurrency:3};if(!plain(p)||Object.keys(p).some(k=>!['providerId','concurrency'].includes(k))||p.providerId!==null&&!uuid(p.providerId)||!Number.isInteger(p.concurrency)||p.concurrency<1||p.concurrency>3)throw fail(503,'MEMORY_MODEL_STORAGE');return p;};
 for(const id of Object.keys(prefs.users))preference(id);
 let closed=false,serial=Promise.resolve(),last='';
 const queue=work=>{const next=serial.catch(()=>{}).then(()=>{if(closed)throw fail(503,'MEMORY_MODEL_CLOSED');return work();});serial=next.catch(()=>{});return next;};
 const user=id=>{const u=getUser(id);if(!u||u.disabled)throw fail(403,'MEMORY_MODEL_ACCOUNT_UNAVAILABLE');return u;};
 async function publish(){
  const routes={};
  for(const [id,binding]of Object.entries(known.users)){
   if(!plain(binding)||!uuid(binding.upstreamUserId)||!Number.isSafeInteger(binding.epoch))throw fail(503,'MEMORY_MODEL_STORAGE');
   try{
    user(id);const scope=await getScope(id),p=preference(id),uid=memobaseProjectionUserId(scope.scope.instanceId,scope.scope.userId,scope.epoch);
    if(uid!==binding.upstreamUserId||scope.epoch!==binding.epoch||!scope.enabled){routes[binding.upstreamUserId]={allowed:false};continue;}
    const available=choices(id),provider=p.providerId===null?null:resolveProvider(id,p.providerId);
    routes[uid]={allowed:true,providerId:p.providerId,concurrency:p.concurrency,authorizedProviderIds:available.map(v=>v.id),provider:provider?{model:provider.model,baseUrl:provider.baseUrl,apiKey:provider.apiKey}:null};
   }catch{routes[binding.upstreamUserId]={allowed:false};}
  }
  const value={schema:'petpal-memory-models.v1',maxConcurrency:3,routes},bytes=JSON.stringify(value);if(bytes!==last){await write('routes.json',value);last=bytes;}
 }
 const timer=refreshMs?setInterval(()=>{void queue(publish).catch(()=>{});},refreshMs):null;timer?.unref?.();
 return {
  directory,
  status(id){user(id);const p=preference(id),providers=choices(id).map(v=>({id:v.id,name:v.name,model:v.model}));let selected;try{selected=p.providerId&&resolveProvider(id,p.providerId);}catch{}return{...p,model:selected?.model??null,providers,available:p.providerId===null||!!selected,maxConcurrency:3};},
  async select(id,input){return queue(async()=>{user(id);if(!plain(input)||Object.keys(input).some(k=>!['providerId','concurrency'].includes(k))||!Object.keys(input).length)throw fail(400,'MEMORY_MODEL_INVALID');const next={...preference(id),...input};if(next.providerId!==null&&!uuid(next.providerId)||!Number.isInteger(next.concurrency)||next.concurrency<1||next.concurrency>3)throw fail(400,'MEMORY_MODEL_INVALID');if(next.providerId!==null)resolveProvider(id,next.providerId);const scope=await getScope(id);user(id);if(next.providerId!==null)resolveProvider(id,next.providerId);const value={...prefs,users:{...prefs.users,[id]:next}};await write('preferences.json',value);prefs=value;known.users[id]={upstreamUserId:memobaseProjectionUserId(scope.scope.instanceId,scope.scope.userId,scope.epoch),epoch:scope.epoch};await write('bindings.json',known);await publish();return this.status(id);});},
  async prepare(id,{upstreamUserId,epoch}){return queue(async()=>{user(id);const scope=await getScope(id);if(scope.epoch!==epoch||!scope.enabled||memobaseProjectionUserId(scope.scope.instanceId,scope.scope.userId,epoch)!==upstreamUserId)throw fail(409,'MEMORY_MODEL_SCOPE_CHANGED');if(preference(id).providerId!==null)resolveProvider(id,preference(id).providerId);known.users[id]={upstreamUserId,epoch};await write('bindings.json',known);await publish();});},
  refresh(){return queue(publish);},
  async close(){closed=true;clearInterval(timer);await serial;},
 };
}
