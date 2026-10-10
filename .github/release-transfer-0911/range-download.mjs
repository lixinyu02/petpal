// Fixed HTTPS mirror only. Fragment integrity never substitutes for the frozen whole-file SHA.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {open,mkdir,stat} from 'node:fs/promises';
import {request as httpsRequest} from 'node:https';
import path from 'node:path';
export const MIRROR_ORIGIN='https://magicdatou.top:44318',MAX_CONNECTIONS=8,MAX_GET_ATTEMPTS=1;
export class RangeDownloadError extends Error{}
const need=(value,code)=>{if(!value)throw new RangeDownloadError(code);};
const NETWORK_CODES=new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE','EAI_AGAIN','ENOTFOUND','ENETUNREACH','EHOSTUNREACH','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET']);
const TLS_CODES=new Set(['CERT_HAS_EXPIRED','CERT_NOT_YET_VALID','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','UNABLE_TO_GET_ISSUER_CERT','ERR_TLS_CERT_ALTNAME_INVALID','ERR_SSL_WRONG_VERSION_NUMBER']);
const DISK_CODES=new Set(['EIO','EACCES','EPERM','ENOENT','ENOSPC','EDQUOT','EROFS','EMFILE','ENFILE','EEXIST']);
const ABORT_CODES=new Set(['ABORT_ERR','UND_ERR_ABORTED']);
const RANGE_CODES=new Set(['range-target-size-invalid','range-concurrency-invalid','range-status-rejected','range-encoding-rejected','multipart-range-rejected','content-range-missing-or-invalid','content-range-mismatch','range-declared-length-mismatch','disk-size-overrun','disk-size-mismatch','range-target-invalid','range-deadline','tls-verification-disabled','range-body-size-overrun','range-body-size-mismatch','range-fragment-disk-hash-mismatch','range-fragment-failed','range-attempt-close-failed','range-network-attempts-exhausted','range-fragments-incomplete','range-assembly-size-overrun','range-fragment-changed-before-assembly','range-whole-sha256-mismatch','range-assembled-disk-hash-mismatch','range-download-aborted','range-upstream-transient']);
export const RETRY_HTTP_STATUSES=new Set([502,503,504]);
// Never serialize Error objects: messages, stacks, paths, addresses and URLs may contain secrets.
// Every terminal branch must have an explicit allowed network code before a GET retry is permitted.
export function summarizeFailure(error){
  const codes=new Set(),kinds=new Set(),seen=new Set();let nodes=0,leaves=0,aggregate=false,valid=true,rangeCode=null;
  const visit=(current,depth)=>{
    if(!(current instanceof Error)||depth>=6||nodes>=32||seen.has(current)){valid=false;kinds.add('unknown');return;}
    seen.add(current);nodes++;
    if(current instanceof RangeDownloadError){rangeCode??=RANGE_CODES.has(current.message)?current.message:'range-fragment-failed';kinds.add(current.message==='tls-verification-disabled'?'tls':'range');}
    if(['AbortError','TimeoutError'].includes(current.name))kinds.add('abort');
    let known=false;
    if(current.code!==undefined){
      if(NETWORK_CODES.has(current.code)){codes.add(current.code);kinds.add('network');known=true;}
      else if(TLS_CODES.has(current.code)){codes.add(current.code);kinds.add('tls');}
      else if(DISK_CODES.has(current.code)){codes.add(current.code);kinds.add('filesystem');}
      else if(ABORT_CODES.has(current.code)){codes.add(current.code);kinds.add('abort');}
      else kinds.add('unknown');
    }
    const children=[];
    if(current instanceof AggregateError){aggregate=true;if(!Array.isArray(current.errors)||current.errors.length<1||current.errors.length>16){valid=false;kinds.add('unknown');}else children.push(...current.errors);}
    if(current.cause!==undefined)children.push(current.cause);
    if(!children.length){leaves++;if(!known&&!(current instanceof RangeDownloadError)&&!current.code)kinds.add('unknown');}
    for(const child of children)visit(child,depth+1);
  };
  visit(error,0);const allNetwork=valid&&leaves>0&&codes.size>0&&kinds.size===1&&kinds.has('network');
  return{failureKind:kinds.size===1?[...kinds][0]:'mixed',safeCodes:[...codes].sort(),rangeCode,aggregate,leafCount:leaves,treeNodes:nodes,treeValid:valid,retryableNetwork:allNetwork};
}
export function retryableNetworkCode(error){const summary=summarizeFailure(error);return summary.retryableNetwork?summary.safeCodes[0]:null;}
// Only public mirror GETs use explicit IPv4. TLS still authenticates the original hostname.
// No custom DNS, global dispatcher, certificate bypass, npm dependency or redirect handling.
export function mirrorIPv4Get(value,options,{requestImpl=httpsRequest}={}){
 const url=new URL(value);need(url.origin===MIRROR_ORIGIN&&!url.username&&!url.password&&!url.search&&!url.hash&&/^\/downloads\/[A-Za-z0-9][A-Za-z0-9._-]{0,160}$/.test(url.pathname),'range-target-invalid');
 need(options?.redirect==='error'&&options.signal instanceof AbortSignal&&options.headers?.Authorization===undefined&&Object.keys(options.headers).every(key=>['Range','Accept','Accept-Encoding','User-Agent'].includes(key)),'range-target-invalid');
 return new Promise((resolve,reject)=>{
  let req;req=requestImpl(url,{method:'GET',headers:options.headers,signal:options.signal,family:4,autoSelectFamily:false,rejectUnauthorized:true,agent:false},response=>{
   try{const headers=new Headers();for(const[key,value]of Object.entries(response.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(', '):value);
    response.once('close',()=>req.setTimeout(0));resolve({status:response.statusCode,headers,body:{[Symbol.asyncIterator]:()=>response[Symbol.asyncIterator](),cancel:async()=>{response.destroy();}}});
   }catch(error){response.destroy();reject(error);}
  });
  req.once('error',reject);req.setTimeout(60000,()=>{const error=new Error('Mirror GET idle timeout');error.code='ETIMEDOUT';req.destroy(error);});req.end();
 });
}
async function retryPause(signal,deadline,now){
  signal.throwIfAborted();need(now()+250<deadline,'range-deadline');
  await new Promise((resolve,reject)=>{
    const onAbort=()=>{clearTimeout(timer);signal.removeEventListener('abort',onAbort);reject(signal.reason);};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',onAbort);resolve();},250);
    signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();
  });signal.throwIfAborted();need(now()<deadline,'range-deadline');
}
export function partition(size,connections=MAX_CONNECTIONS){
  need(Number.isSafeInteger(size)&&size>0&&size<=2*1024**3,'range-target-size-invalid');need(Number.isSafeInteger(connections)&&connections>=1&&connections<=MAX_CONNECTIONS,'range-concurrency-invalid');
  const count=Math.min(size,connections);return Array.from({length:count},(_,index)=>{const start=Math.floor(index*size/count),end=Math.floor((index+1)*size/count)-1;return{index,start,end,bytes:end-start+1};});
}
export function validateRangeResponse(response,part,total){
  need(response.status===206&&response.body,'range-status-rejected');
  need(!response.headers.get('content-encoding')||response.headers.get('content-encoding')==='identity','range-encoding-rejected');
  need(!/^multipart\//i.test(response.headers.get('content-type')??''),'multipart-range-rejected');
  const match=/^bytes (0|[1-9][0-9]*)-(0|[1-9][0-9]*)\/(0|[1-9][0-9]*)$/.exec(response.headers.get('content-range')??'');need(match,'content-range-missing-or-invalid');
  const[start,end,size]=match.slice(1).map(Number);need([start,end,size].every(Number.isSafeInteger)&&start===part.start&&end===part.end&&size===total,'content-range-mismatch');
  const length=response.headers.get('content-length');need(length===null||/^(0|[1-9][0-9]*)$/.test(length)&&Number(length)===part.bytes,'range-declared-length-mismatch');
}
async function diskDigest(file,expectedBytes,signal){
  const hash=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(file)){signal?.throwIfAborted();bytes+=chunk.length;need(bytes<=expectedBytes,'disk-size-overrun');hash.update(chunk);}need(bytes===expectedBytes&&(await stat(file)).size===expectedBytes,'disk-size-mismatch');return hash.digest('hex');
}
export async function downloadRanges(target,directory,{fetchImpl=fetch,connections=MAX_CONNECTIONS,deadline=Date.now()+32*60000,now=Date.now,log=()=>{}}={}){
  need(target&&typeof target.name==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,160}$/.test(target.name)&&path.basename(target.name)===target.name&&path.isAbsolute(directory)&&/^[a-f0-9]{64}$/.test(target.sha256??''),'range-target-invalid');need(Number.isFinite(deadline)&&deadline>now()&&deadline-now()<=235*60000,'range-deadline');need(process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','tls-verification-disabled');
  const parts=partition(target.size,connections),controller=new AbortController(),remaining=Math.max(1,deadline-now()),timer=setTimeout(()=>controller.abort(new RangeDownloadError('range-deadline')),remaining),partDirectory=path.join(directory,'range-parts');
  let completed=false,firstFailure=null;
  try{
    await mkdir(partDirectory,{mode:0o700});
    const results=await Promise.allSettled(parts.map(async part=>{
      try{
        for(let attempt=1;attempt<=MAX_GET_ATTEMPTS;attempt++){
          controller.signal.throwIfAborted();need(now()<deadline,'range-deadline');
          const fileName=`part-${String(part.index).padStart(2,'0')}-attempt-${attempt}`,file=path.join(partDirectory,fileName),hash=createHash('sha256');
          let response,output,iterator,error,phase='disk',bytes=0,last=now(),networkCode=null,httpRetry=false;const started=now();
          try{
            output=await open(file,'wx',0o600);
            log('range-get-attempt-reserved',{name:target.name,index:part.index,start:part.start,end:part.end,total:target.size,attempt,fileName,maximumGetAttempts:MAX_GET_ATTEMPTS,fragmentProofOnly:true,installerExecuted:false});
            phase='fetch';controller.signal.throwIfAborted();response=await fetchImpl(`${MIRROR_ORIGIN}/downloads/${target.name}`,{headers:{Range:`bytes=${part.start}-${part.end}`,Accept:'application/octet-stream','Accept-Encoding':'identity','User-Agent':'PetPal-Fixed-Range-Mirror-Transfer'},redirect:'error',signal:controller.signal});
            phase='validation';if(RETRY_HTTP_STATUSES.has(response.status))throw new RangeDownloadError('range-upstream-transient');validateRangeResponse(response,part,target.size);iterator=response.body[Symbol.asyncIterator]();
            while(true){
              controller.signal.throwIfAborted();phase='body';const next=await iterator.next();if(next.done)break;
              phase='validation';const chunk=next.value;bytes+=chunk.length;need(bytes<=part.bytes,'range-body-size-overrun');hash.update(chunk);
              phase='disk';await output.writeFile(chunk);if(now()-last>=60000){log('range-download-progress',{name:target.name,index:part.index,attempt,bytes,total:part.bytes});last=now();}
            }
            phase='validation';need(bytes===part.bytes,'range-body-size-mismatch');phase='disk';await output.sync();await output.close();output=null;
            const sha256=hash.digest('hex');need(await diskDigest(file,part.bytes,controller.signal)===sha256,'range-fragment-disk-hash-mismatch');controller.signal.throwIfAborted();need(now()<deadline,'range-deadline');
            const proof={...part,bytes,sha256,file,attempt};log('range-fragment-verified',{name:target.name,index:part.index,start:part.start,end:part.end,total:target.size,bytes,sha256,attempt,fragmentProofOnly:true,installerExecuted:false});return proof;
          }catch(caught){
            error=caught;const cancelledByPeer=controller.signal.aborted&&firstFailure!==null,summary=summarizeFailure(caught),canRetry=!controller.signal.aborted&&now()<deadline;
            networkCode=['fetch','body'].includes(phase)&&canRetry&&summary.retryableNetwork?summary.safeCodes[0]:null;
            httpRetry=phase==='validation'&&canRetry&&caught instanceof RangeDownloadError&&caught.message==='range-upstream-transient'&&RETRY_HTTP_STATUSES.has(response?.status);
            const willRetry=Boolean((networkCode||httpRetry)&&attempt<MAX_GET_ATTEMPTS);
            log('range-get-attempt-failed',{name:target.name,index:part.index,attempt,phase,partialBytes:bytes,elapsedMilliseconds:Math.max(0,Math.floor(now()-started)),httpStatus:Number.isInteger(response?.status)&&response.status>=100&&response.status<=599?response.status:null,...summary,decision:cancelledByPeer?'peer-cancelled':willRetry?'retry':'stop',firstFailure:!cancelledByPeer&&!willRetry,maximumGetAttempts:MAX_GET_ATTEMPTS,fragmentProofOnly:true,installerExecuted:false});
            if(!willRetry){const failure=caught instanceof RangeDownloadError?caught:new RangeDownloadError('range-fragment-failed',{cause:caught});firstFailure??=failure;controller.abort(firstFailure);}
          }finally{
            try{await iterator?.return();}catch{}try{await response?.body?.cancel();}catch{}
            if(output)try{await output.close();}catch(caught){networkCode=null;httpRetry=false;error??=caught;log('range-get-attempt-failed',{name:target.name,index:part.index,attempt,phase:'disk',partialBytes:bytes,...summarizeFailure(caught),decision:'stop',firstFailure:firstFailure===null,maximumGetAttempts:MAX_GET_ATTEMPTS,fragmentProofOnly:true,installerExecuted:false});const failure=new RangeDownloadError('range-attempt-close-failed',{cause:caught});firstFailure??=failure;controller.abort(firstFailure);}
          }
          if((!networkCode&&!httpRetry)||attempt===MAX_GET_ATTEMPTS||controller.signal.aborted)throw firstFailure??error;
          log(httpRetry?'range-http-retry':'range-network-retry',{name:target.name,index:part.index,attempt,nextAttempt:attempt+1,networkCode,httpStatus:httpRetry?response.status:null,partialBytes:bytes,fileName,maximumGetAttempts:MAX_GET_ATTEMPTS,fragmentProofOnly:true,installerExecuted:false});
          await retryPause(controller.signal,deadline,now);
        }
        throw new RangeDownloadError('range-network-attempts-exhausted');
      }catch(error){const failure=error instanceof RangeDownloadError?error:new RangeDownloadError('range-fragment-failed',{cause:error});firstFailure??=failure;controller.abort(firstFailure);throw failure;}
    }));
    // All cancelled connections have fully exited before rejecting. Never expose a partial as a package.
    const failed=results.find(result=>result.status==='rejected');if(failed)throw firstFailure??failed.reason;controller.signal.throwIfAborted();const fragments=results.map(result=>result.value);need(fragments.length===parts.length,'range-fragments-incomplete');
    const file=path.join(directory,target.name),output=await open(file,'wx',0o600),hash=createHash('sha256');let bytes=0;
    try{for(const part of fragments){let partBytes=0;const partHash=createHash('sha256');for await(const chunk of createReadStream(part.file)){controller.signal.throwIfAborted();partBytes+=chunk.length;bytes+=chunk.length;need(partBytes<=part.bytes&&bytes<=target.size,'range-assembly-size-overrun');partHash.update(chunk);hash.update(chunk);await output.writeFile(chunk);}need(partBytes===part.bytes&&partHash.digest('hex')===part.sha256,'range-fragment-changed-before-assembly');}need(bytes===target.size&&hash.digest('hex')===target.sha256,'range-whole-sha256-mismatch');await output.sync();}finally{await output.close();}
    need(await diskDigest(file,target.size,controller.signal)===target.sha256,'range-assembled-disk-hash-mismatch');controller.signal.throwIfAborted();need(now()<deadline,'range-deadline');completed=true;
    log('mirror-range-assembly-verified',{name:target.name,bytes,sha256:target.sha256,connections:parts.length,fragments:fragments.map(({file,...proof})=>proof),tlsVerification:'enabled',redirectsAllowed:false,installerExecuted:false});
    log('mirror-bytes-verified',{name:target.name,bytes,sha256:target.sha256,downloadMethod:'verified HTTP ranges',connections:parts.length,installerExecuted:false});return{file,fragments:fragments.map(({file,...proof})=>proof),bytes,sha256:target.sha256};
  }finally{clearTimeout(timer);if(!completed)controller.abort(new RangeDownloadError('range-download-aborted'));}
}
