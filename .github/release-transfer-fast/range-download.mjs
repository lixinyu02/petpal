// Fixed HTTPS mirror only. Fragment integrity never substitutes for the frozen whole-file SHA.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {open,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
export const MIRROR_ORIGIN='https://magicdatou.top:44318',MAX_CONNECTIONS=8;
export class RangeDownloadError extends Error{}
const need=(value,code)=>{if(!value)throw new RangeDownloadError(code);};
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
      let response,output;
      try{
        controller.signal.throwIfAborted();response=await fetchImpl(`${MIRROR_ORIGIN}/downloads/${target.name}`,{headers:{Range:`bytes=${part.start}-${part.end}`,Accept:'application/octet-stream','Accept-Encoding':'identity','User-Agent':'PetPal-Fixed-Range-Mirror-Transfer'},redirect:'error',signal:controller.signal});validateRangeResponse(response,part,target.size);
        const file=path.join(partDirectory,`part-${String(part.index).padStart(2,'0')}`),hash=createHash('sha256');output=await open(file,'wx',0o600);let bytes=0,last=now();
        for await(const chunk of response.body){controller.signal.throwIfAborted();bytes+=chunk.length;need(bytes<=part.bytes,'range-body-size-overrun');hash.update(chunk);await output.writeFile(chunk);if(now()-last>=60000){log('range-download-progress',{name:target.name,index:part.index,bytes,total:part.bytes});last=now();}}
        need(bytes===part.bytes,'range-body-size-mismatch');await output.sync();await output.close();output=null;const sha256=hash.digest('hex');need(await diskDigest(file,part.bytes,controller.signal)===sha256,'range-fragment-disk-hash-mismatch');
        const proof={...part,bytes,sha256,file};log('range-fragment-verified',{name:target.name,index:part.index,start:part.start,end:part.end,total:target.size,bytes,sha256,fragmentProofOnly:true,installerExecuted:false});return proof;
      }catch(error){const failure=error instanceof RangeDownloadError?error:new RangeDownloadError('range-fragment-failed',{cause:error});firstFailure??=failure;controller.abort(firstFailure);throw failure;}
      finally{try{await response?.body?.cancel();}catch{}if(output)await output.close().catch(()=>{});}
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
