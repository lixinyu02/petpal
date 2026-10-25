import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {mkdir,lstat,realpath,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {HISTORY_IMPORT_FILES,readHistoryFile,validateHistoryBundle,buildHistoryMemoryEvents} from '../server/history-archives.mjs';

const fail=code=>Object.assign(new Error(code),{code});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function safeDirectory(directory,{create=false}={}){if(create)await mkdir(directory,{recursive:true,mode:0o700});const info=await lstat(directory),resolved=await realpath(directory);if(!info.isDirectory()||info.isSymbolicLink()||(process.platform==='win32'?resolved.toLowerCase()!==path.resolve(directory).toLowerCase():resolved!==path.resolve(directory)))throw fail('HISTORY_UNSAFE_LOCAL_DIRECTORY');}
const options={bundle:{type:'string'},'server-url':{type:'string'},'token-file':{type:'string'},'user-id':{type:'string'},'data-dir':{type:'string'},'plan-only':{type:'boolean'},'memory-limit':{type:'string'},all:{type:'boolean'},resume:{type:'string'},'no-wait':{type:'boolean'},epoch:{type:'string'},help:{type:'boolean'}};
export const HISTORY_IMPORT_HELP='node scripts/import-wechat-history.mjs --bundle PATH --server-url URL --token-file PATH --user-id ID --data-dir PATH (--memory-limit N | --all) [--no-wait]\nOffline: --bundle PATH --plan-only [--user-id ID --epoch N]\nResume: --resume JOB_UUID --server-url URL --token-file PATH --user-id ID --data-dir PATH (--all | --memory-limit N)';

/** Explicit local operator tool. It never edits active state.json or creates a second store. */
export async function runWeChatHistoryImport(args,{fetchImpl=globalThis.fetch,pollMs=2000}={}){
 const {values}=parseArgs({args,options,strict:true,allowPositionals:false});if(values.help)return{help:HISTORY_IMPORT_HELP};
 const epoch=values.epoch===undefined?1:Number(values.epoch);if(!Number.isSafeInteger(epoch)||epoch<1)throw fail('HISTORY_INVALID_EPOCH');
 let bundle;
 if(values.bundle)bundle=await validateHistoryBundle(path.resolve(values.bundle));
 if(values['plan-only']){if(!bundle||values.resume||values.all||values['memory-limit'])throw fail('HISTORY_INVALID_MODE');const events=buildHistoryMemoryEvents(bundle,{accountId:values['user-id']||'offline-preview',archiveId:'00000000-0000-4000-8000-000000000000',epoch}).map(({messageIds,...event})=>event);return{mode:'offline-plan',networkRequests:0,datasetId:bundle.datasetId,personName:bundle.personName,messageCount:bundle.records.length,selectedMessageCount:bundle.selectedCount,memoryEvents:events.length,maxMemoryCharacters:Math.max(0,...events.map(e=>e.userText.length)),memoryTextBytes:events.reduce((n,e)=>n+Buffer.byteLength(e.userText),0),sourceStart:bundle.sourceStart,sourceEnd:bundle.sourceEnd,epochIsPreview:true};}
 if(!values['server-url']||!values['token-file']||!values['user-id']||!values['data-dir']||!bundle&&!values.resume)throw fail('HISTORY_REQUIRED_ARGUMENTS');
 if(Boolean(values.all)===Boolean(values['memory-limit']))throw fail('HISTORY_EXPLICIT_LIMIT_REQUIRED');
 const limit=values['memory-limit']===undefined?undefined:Number(values['memory-limit']);if(limit!==undefined&&(!Number.isSafeInteger(limit)||limit<1||limit>2000))throw fail('HISTORY_INVALID_LIMIT');
 let server;try{server=new URL(values['server-url']);if(!['http:','https:'].includes(server.protocol)||server.username||server.password||server.search||server.hash)throw new Error();}catch{throw fail('HISTORY_INVALID_SERVER');}
 const base=server.href.replace(/\/$/,''),dataDir=path.resolve(values['data-dir']);await safeDirectory(dataDir);
 const token=(await readHistoryFile(path.resolve(values['token-file']),16384)).toString('utf8').trim();if(!token||/[\r\n]/.test(token))throw fail('HISTORY_INVALID_TOKEN_FILE');
 const prefix='/api/admin/users/'+encodeURIComponent(values['user-id'])+'/history-archives';
 const request=async(route,method='GET',body)=>{let response;try{response=await fetchImpl(base+route,{method,headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(60000)});}catch{throw fail('HISTORY_OPERATION_UNCONFIRMED_CHECK_JOB');}let value;try{value=await response.json();}catch{throw fail('HISTORY_INVALID_SERVER_RESPONSE');}if(!response.ok)throw fail(typeof value.code==='string'&&/^[A-Z_]+$/.test(value.code)?value.code:'HISTORY_SERVER_STATUS_'+response.status);return value;};
 let job;
 if(values.resume){if(!/^[a-f0-9-]{36}$/i.test(values.resume))throw fail('HISTORY_INVALID_JOB');job=(await request(prefix+'/jobs/'+values.resume)).job;if(!job?.id)throw fail('HISTORY_INVALID_SERVER_RESPONSE');job=(await request(prefix+'/jobs/'+job.id+'/resume','POST',limit===undefined?{}:{memoryLimit:limit})).job;}
 else{
  const target=await request(prefix);if(!Number.isSafeInteger(target.memory?.epoch))throw fail('HISTORY_INVALID_SERVER_RESPONSE');
  const staged=await request(prefix+'/staging','POST',{datasetId:bundle.datasetId,personName:bundle.personName,epoch:target.memory.epoch,manifestSha256:bundle.manifestSha256});job=staged.job;const stage=staged.staging;
  if(!job?.id||!stage||stage.id!==job.id||stage.relativePath!==`history-archives/staging/${job.id}`||!Array.isArray(stage.files)||JSON.stringify([...stage.files].sort())!==JSON.stringify(['manifest.json',...HISTORY_IMPORT_FILES].sort()))throw fail('HISTORY_INVALID_SERVER_RESPONSE');
  const directory=path.join(dataDir,'history-archives','staging',job.id);await safeDirectory(path.join(dataDir,'history-archives'));await safeDirectory(path.join(dataDir,'history-archives','staging'));await safeDirectory(directory);
  const marker=JSON.parse((await readHistoryFile(path.join(directory,'.stage-owner.json'),4096)).toString('utf8'));if(marker.id!==job.id||marker.accountId!==values['user-id']||marker.datasetId!==bundle.datasetId||marker.manifestSha256!==bundle.manifestSha256||marker.epoch!==target.memory.epoch||marker.nonce!==stage.nonce)throw fail('HISTORY_SERVER_DIRECTORY_MISMATCH');
  if(job.state==='staging')for(const name of stage.files){const source=await readHistoryFile(path.join(path.resolve(values.bundle),name));const manifest=JSON.parse((await readHistoryFile(path.join(path.resolve(values.bundle),'manifest.json'),64*1024)).toString('utf8')),expected=name==='manifest.json'?bundle.manifestSha256:manifest.files[name].sha256;if(hash(source)!==expected)throw fail('HISTORY_SOURCE_CHANGED');const file=path.join(directory,name);await safeDirectory(path.dirname(file),{create:true});let existing;try{existing=await readHistoryFile(file);}catch(e){if(e.code!=='ENOENT')throw e;}if(existing){if(hash(existing)!==expected)throw fail('HISTORY_LOCAL_STAGING_CONFLICT');continue;}const handle=await open(file,'wx',0o600);try{await handle.writeFile(source);await handle.sync();}finally{await handle.close();}}
  job=(await request(prefix+'/staging/'+job.id+'/start','POST',limit===undefined?{}:{memoryLimit:limit})).job;
 }
 if(!job?.id)throw fail('HISTORY_INVALID_SERVER_RESPONSE');
 if(!values['no-wait'])while(['staging','prepared','working'].includes(job.state)){await delay(pollMs);job=(await request(prefix+'/jobs/'+job.id)).job;}
 return{job,privateContentPrinted:false,automaticWriteRetries:0};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const result=await runWeChatHistoryImport(process.argv.slice(2));console.log(JSON.stringify(result));if(result.job&&!['complete','working','prepared'].includes(result.job.state)&&result.job.pauseReason!=='sample-limit')process.exitCode=1;}
 catch(error){console.error(JSON.stringify({passed:false,code:/^[A-Z][A-Z0-9_]{2,100}$/.test(error?.code||'')?error.code:'HISTORY_IMPORT_FAILED',privateContentPrinted:false,automaticWriteRetries:0}));process.exitCode=1;}
}
