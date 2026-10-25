const memory=new Map(),prefix='petpal.cloud-create.';
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const resources=r=>r===undefined||r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).every(k=>['cpus','memoryMiB','pids'].includes(k))&&Number.isFinite(r.cpus)&&r.cpus>=.1&&r.cpus<=128&&Number.isSafeInteger(r.memoryMiB)&&r.memoryMiB>=256&&r.memoryMiB<=1048576&&(r.pids===undefined||Number.isSafeInteger(r.pids)&&r.pids>=32&&r.pids<=8192);
const valid=value=>value&&uuid(value.requestId)&&value.body&&typeof value.body.name==='string'&&value.body.name.length<=80&&resources(value.body.resources)&&['local','platform'].includes(value.body.source)&&['desktop','agent'].includes(value.body.bundle)&&Object.keys(value.body).every(key=>['name','source','bundle','nodeId','resources'].includes(key))&&(value.body.nodeId===undefined||typeof value.body.nodeId==='string'&&value.body.nodeId.length<=160);
const storage=()=>{try{return globalThis.window?.localStorage;}catch{return undefined;}};
const copy=value=>value?JSON.parse(JSON.stringify(value)):null;
export function pendingCloudCreate(scope){
  if(!scope)return null;
  if(!memory.has(scope))try{const raw=storage()?.getItem(prefix+encodeURIComponent(scope));if(raw&&raw.length<3000){const parsed=JSON.parse(raw);if(valid(parsed))memory.set(scope,parsed);}}catch{/* A denied storage still retains this page's request identity. */}
  return copy(memory.get(scope));
}
/** Reserve before network IO. An uncertain create cannot silently become a
 * different configuration, even after leaving and reopening the page. */
export function reserveCloudCreate(scope,body,newId=()=>crypto.randomUUID()){
  if(!scope)throw new Error('请先登录账号。');
  const previous=pendingCloudCreate(scope);
  if(previous){if(JSON.stringify(previous.body)!==JSON.stringify(body))throw new Error('上次创建的结果尚未确认，请先确认原请求。');return previous;}
  const value={requestId:newId(),body:copy(body)};if(!valid(value))throw new Error('创建参数无效。');
  memory.set(scope,value);try{storage()?.setItem(prefix+encodeURIComponent(scope),JSON.stringify(value));}catch{}
  return copy(value);
}
export function clearCloudCreate(scope,requestId){
  const value=pendingCloudCreate(scope);if(!value||value.requestId!==requestId)return false;
  memory.delete(scope);try{const target=storage(),key=prefix+encodeURIComponent(scope),saved=target?.getItem(key);if(saved&&JSON.parse(saved)?.requestId===requestId)target.removeItem(key);}catch{}
  return true;
}
