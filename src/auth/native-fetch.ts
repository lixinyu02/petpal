export type RemoteRequest = { id:string;url:string;method:string;headers:Record<string,string>;body?:string;bodyEncoding?:'utf8'|'base64' };
export type RemoteEvent = {type:'headers';status:number;headers:Record<string,string>} | {type:'chunk';bytes:number[]} | {type:'end'} | {type:'error';message:string};
export type RemoteBridge = {remoteRequest(request:RemoteRequest,onEvent:(event:RemoteEvent)=>void):Promise<void>;remoteAbort(id:string):Promise<void>};

/** Use the trusted native transport for remote APIs, retaining the caller's exact credentials. */
export async function connectionFetch(url:string, options:RequestInit = {}):Promise<Response> {
  const bridge = window.petpal;
  if (!bridge?.remoteRequest || !bridge.remoteAbort) return fetch(url,options);
  const destination = new URL(url,location.origin);
  if (destination.origin === location.origin) return fetch(url,options);
  const id=crypto.randomUUID(), headers=Object.fromEntries(new Headers(options.headers));
  let body:string|undefined,bodyEncoding:'utf8'|'base64'='utf8';
  if(options.body!=null){
    if(typeof options.body==='string')body=options.body;
    else {
      const data = options.body instanceof Blob ? new Uint8Array(await options.body.arrayBuffer()) : options.body instanceof ArrayBuffer ? new Uint8Array(options.body) : ArrayBuffer.isView(options.body) ? new Uint8Array(options.body.buffer,options.body.byteOffset,options.body.byteLength) : null;
      if(!data)throw new Error('此请求格式不支持原生远程连接。');
      let binary='';for(let i=0;i<data.length;i+=8192)binary+=String.fromCharCode(...data.subarray(i,i+8192));
      body=btoa(binary);bodyEncoding='base64';
    }
  }
  options.signal?.throwIfAborted();
  return new Promise<Response>((resolve,reject)=>{
    let finished=false,hasHeaders=false;
    let stream:ReadableStreamDefaultController<Uint8Array>;
    const cleanup=()=>options.signal?.removeEventListener('abort',abort);
    const fail=(error:unknown)=>{if(finished)return;finished=true;cleanup();if(hasHeaders)stream.error(error);else reject(error);};
    const cancel=()=>{void bridge.remoteAbort!(id).catch(()=>{});};
    const abort=()=>{cancel();fail(options.signal?.reason || new DOMException('请求已取消','AbortError'));};
    const responseBody=new ReadableStream<Uint8Array>({start(controller){stream=controller;},cancel(){finished=true;cleanup();cancel();}});
    options.signal?.addEventListener('abort',abort,{once:true});
    void bridge.remoteRequest!({id,url:destination.href,method:options.method || 'GET',headers,body,bodyEncoding},event=>{
      if(finished)return;
      try{
        if(event.type==='headers'){
          if(hasHeaders)throw new Error('远程响应重复发送状态。');
          const empty = [204,205,304].includes(event.status) || options.method==='HEAD';
          const response = new Response(empty?null:responseBody,{status:event.status,headers:event.headers});
          hasHeaders=true;resolve(response);
        }else if(event.type==='chunk'){
          if(!hasHeaders)throw new Error('远程响应顺序无效。');stream.enqueue(Uint8Array.from(event.bytes));
        }else if(event.type==='end'){
          if(!hasHeaders)throw new Error('远程服务没有返回响应。');finished=true;cleanup();stream.close();
        }else fail(new Error(event.message));
      }catch(error){cancel();fail(error);}
    }).then(()=>{if(!finished)fail(new Error('远程连接提前结束。'));}).catch(fail);
  });
}
