import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {MODEL_REQUEST_BYTES} from './model-request-limits.mjs';
import {CumulativeMessageAdapter,needsCumulativeMessageMapping} from './response-message-segments.mjs';

const DEFAULTS={requestBytes:MODEL_REQUEST_BYTES,frameBytes:2*1024*1024,outputBytes:24*1024*1024,events:100000};
const invalid=()=>new Error('Responses 流不完整或格式无效，请检查服务兼容性。');
const aborted=()=>Object.assign(new Error('Responses 请求已停止。'),{name:'AbortError'});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\x00-\x1f\x7f]/.test(value);
const index=value=>Number.isSafeInteger(value)&&value>=0&&value<512;
const encode=value=>`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`;
const signalRace=(promise,signal)=>new Promise((resolve,reject)=>{
  const stop=()=>reject(aborted());
  if(signal.aborted){reject(aborted());return;}
  signal.addEventListener('abort',stop,{once:true});
  Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));
});

/** Reconstruct only facts present in text events or complete final items. No tool identity is guessed. */
export class ResponsesStreamNormalizer {
  constructor(){this.items=new Map();this.terminal=[];this.completed=null;this.responseId=null;this.count=0;}
  _state(position,id){
    if(!index(position)||!identifier(id))throw invalid();
    let state=this.items.get(position);
    if(state&&state.id!==id)throw invalid();
    if(!state){state={id,position,item:null,parts:new Map(),buffer:[],toolText:'',toolDelta:false,toolDone:false,done:false};this.items.set(position,state);}
    return state;
  }
  _addMessage(state,out){
    if(state.item){if(state.item.type!=='message')throw invalid();return;}
    state.item={id:state.id,type:'message',status:'in_progress',role:'assistant',content:[]};
    state.synthetic=true;out.push(encode({type:'response.output_item.added',output_index:state.position,item:state.item}));
  }
  _part(state,position,out){
    if(!index(position))throw invalid();this._addMessage(state,out);
    let part=state.parts.get(position);
    if(!part){part={text:'',textDone:false,done:false,synthetic:true};state.parts.set(position,part);out.push(encode({type:'response.content_part.added',item_id:state.id,output_index:state.position,content_index:position,part:{type:'output_text',text:'',annotations:[]}}));}
    return part;
  }
  _validateItem(item){
    if(!object(item)||!identifier(item.id)||typeof item.type!=='string')throw invalid();
    if(item.status!==undefined&&item.status!=='completed')throw invalid();
    if(item.type==='message'&&(!Array.isArray(item.content)||item.role!=='assistant'))throw invalid();
    if(['function_call','custom_tool_call'].includes(item.type)&&(!identifier(item.name)||!identifier(item.call_id)||typeof item[item.type==='function_call'?'arguments':'input']!=='string'))throw invalid();
  }
  _completeItem(position,item,out){
    this._validateItem(item);const state=this._state(position,item.id);
    if(state.done){if(JSON.stringify(state.final)!==JSON.stringify(item))throw invalid();return;}
    if(state.item&&state.item.type!==item.type)throw invalid();
    if(state.pendingType&&state.pendingType!==item.type)throw invalid();
    if(item.type==='message'){
      this._addMessage(state,out);
      for(let i=0;i<item.content.length;i++){
        const content=item.content[i];
        if(content.type!=='output_text')continue;
        if(typeof content.text!=='string')throw invalid();
        const part=this._part(state,i,out);
        if((part.text||part.textDone||part.done)&&part.text!==content.text)throw invalid();
        if(!part.text&&content.text&&!part.textDone){out.push(encode({type:'response.output_text.delta',item_id:item.id,output_index:position,content_index:i,delta:content.text}));part.text=content.text;}
        if(!part.textDone){out.push(encode({type:'response.output_text.done',item_id:item.id,output_index:position,content_index:i,text:content.text}));part.textDone=true;}
        if(!part.done){out.push(encode({type:'response.content_part.done',item_id:item.id,output_index:position,content_index:i,part:content}));part.done=true;}
      }
    }else if(['function_call','custom_tool_call'].includes(item.type)){
      const field=item.type==='function_call'?'arguments':'input',prefix=item.type==='function_call'?'response.function_call_arguments':'response.custom_tool_call_input';
      if((state.toolDelta||state.toolDone)&&state.toolText!==item[field])throw invalid();
      if(state.item&&(state.item.name!==item.name||state.item.call_id!==item.call_id))throw invalid();
      if(!state.item){state.item={...item,status:'in_progress',[field]:''};out.push(encode({type:'response.output_item.added',output_index:position,item:state.item}));}
      out.push(...state.buffer);state.buffer=[];
      if(!state.toolDelta&&!state.toolDone&&item[field])out.push(encode({type:`${prefix}.delta`,item_id:item.id,output_index:position,delta:item[field]}));
      if(!state.toolDone)out.push(encode({type:`${prefix}.done`,item_id:item.id,output_index:position,[field]:item[field]}));
      state.toolDone=true;
    }else if(!state.item){state.item={...item,status:'in_progress'};out.push(encode({type:'response.output_item.added',output_index:position,item:state.item}));}
    state.done=true;state.final=item;
    out.push(encode({type:'response.output_item.done',output_index:position,item}));
  }
  accept(value,raw=encode(value)){
    if(!object(value)||typeof value.type!=='string'||++this.count>DEFAULTS.events)throw invalid();
    const type=value.type,out=[];
    if(value.response_id!==undefined&&(!identifier(value.response_id)||this.responseId&&value.response_id!==this.responseId))throw invalid();
    if(['error','response.failed','response.incomplete'].includes(type))throw invalid();
    if(this.completed){
      if(type!=='response.done'||value.response?.id!==this.completed.id||value.response?.status!=='completed'||JSON.stringify(value.response.output)!==JSON.stringify(this.completed.output))throw invalid();
      if(this.terminal.some(frame=>frame.type==='response.done'))throw invalid();
      this.terminal.push({type,raw});return out;
    }
    if(type==='response.created'){
      if(!identifier(value.response?.id)||this.responseId)throw invalid();this.responseId=value.response.id;
    }else if(type==='response.completed'){
      const response=value.response;
      if(!object(response)||!identifier(response.id)||response.status!=='completed'||!Array.isArray(response.output)||response.output.length>512||(this.responseId&&response.id!==this.responseId))throw invalid();
      const meaningful=response.output.some(item=>item?.type==='message'&&item.role==='assistant'&&Array.isArray(item.content)&&item.content.some(part=>part.type==='output_text'&&typeof part.text==='string'&&part.text.trim()||part.type==='refusal'&&typeof part.refusal==='string'&&part.refusal.trim())||['function_call','custom_tool_call'].includes(item?.type));
      if(!meaningful)throw invalid();
      if(new Set(response.output.map(item=>item?.id)).size!==response.output.length)throw invalid();
      for(let i=0;i<response.output.length;i++)this._completeItem(i,response.output[i],out);
      if([...this.items.values()].some(state=>!state.done||state.buffer.length||state.position>=response.output.length))throw invalid();
      this.completed=response;this.terminal.push({type,raw});
      // Hold all completion markers until EOF, so malformed/truncated suffixes cannot succeed.
      this.terminal.unshift(...out.map(raw=>({type:'completion-item',raw})));return [];
    }else if(type==='response.done')throw invalid();
    else if(type==='response.output_item.added'){
      const item=value.item;if(!object(item)||!identifier(item.id)||typeof item.type!=='string')throw invalid();
      const state=this._state(value.output_index,item.id);
      if(state.item){if(state.synthetic&&state.item.type===item.type)return [];throw invalid();}
      if(['function_call','custom_tool_call'].includes(item.type)&&(!identifier(item.name)||!identifier(item.call_id))){state.pendingType=item.type;return [];}
      state.item=item;
      if(state.buffer.length){out.push(raw,...state.buffer);state.buffer=[];return out;}
    }else if(type==='response.output_item.done'){
      this._completeItem(value.output_index,value.item,out);
      // Preserve the original complete item event, including any provider extension fields.
      if(out.length)out[out.length-1]=raw;return out;
    }else if(type==='response.content_part.added'){
      const state=this._state(value.output_index,value.item_id);this._addMessage(state,out);
      if(!index(value.content_index)||!object(value.part))throw invalid();
      const current=state.parts.get(value.content_index);
      if(current){if(current.synthetic)return out;throw invalid();}
      state.parts.set(value.content_index,{text:'',textDone:false,done:false});
    }else if(type==='response.output_text.delta'||type==='response.output_text.done'){
      const state=this._state(value.output_index,value.item_id),part=this._part(state,value.content_index,out);
      if(state.done||part.textDone||part.done)throw invalid();
      const text=type.endsWith('.delta')?value.delta:value.text;if(typeof text!=='string')throw invalid();
      if(type.endsWith('.delta'))part.text+=text;
      else{if(part.text&&part.text!==text)throw invalid();part.text=text;part.textDone=true;}
    }else if(type==='response.content_part.done'){
      const state=this._state(value.output_index,value.item_id),part=this._part(state,value.content_index,out);
      if(part.done||!object(value.part)||value.part.type==='output_text'&&typeof value.part.text!=='string')throw invalid();
      if(value.part.type==='output_text'){
        if((part.text||part.textDone)&&part.text!==value.part.text)throw invalid();part.text=value.part.text;
      }
      part.done=true;
    }else if(/^response\.(?:function_call_arguments|custom_tool_call_input)\.(?:delta|done)$/.test(type)){
      const state=this._state(value.output_index,value.item_id),field=type.includes('function_call')?'arguments':'input';
      if(state.done||state.toolDone)throw invalid();
      if(type.endsWith('.delta')){if(typeof value.delta!=='string')throw invalid();state.toolDelta=true;state.toolText+=value.delta;}
      else{if(typeof value[field]!=='string'||state.toolDelta&&state.toolText!==value[field])throw invalid();state.toolText=value[field];state.toolDone=true;}
      if(!state.item){state.buffer.push(raw);return [];}
      if(state.item.type!==(field==='arguments'?'function_call':'custom_tool_call'))throw invalid();
    }
    out.push(raw);return out;
  }
  finish(){if(!this.completed)throw invalid();return this.terminal.map(frame=>frame.raw);}
}

async function relaySse(body,write,signal,resetIdle,limits,model){
  const reader=body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true}),normalizer=new ResponsesStreamNormalizer();
  const messageAdapter=needsCumulativeMessageMapping(model)?new CumulativeMessageAdapter():null;
  let pending='',received=0,doneMarker=false;
  const consume=async raw=>{
    const lines=raw.split(/\r?\n/),data=[],events=[];
    for(const line of lines){if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));else if(line.startsWith('event:'))events.push(line.slice(6).trim());}
    if(!data.length){await write(raw);return;}
    const text=data.join('\n');
    if(text==='[DONE]'){if(!normalizer.completed||doneMarker)throw invalid();doneMarker=true;return;}
    if(doneMarker)throw invalid();let value;try{value=JSON.parse(text);}catch{throw invalid();}
    if(events.length>1||events.length&&events[0]!==value.type)throw invalid();
    const mapped=messageAdapter?messageAdapter.map(value):value;
    for(const frame of normalizer.accept(mapped,mapped===value?raw:encode(mapped)))await write(frame);
  };
  const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
  try{
    for(;;){
      resetIdle();const {value,done}=await signalRace(reader.read(),signal);if(done)break;
      received+=value.byteLength;if(received>limits.outputBytes)throw invalid();
      pending+=decoder.decode(value,{stream:true});
      for(;;){const match=/\r?\n\r?\n/.exec(pending);if(!match)break;const length=match.index+match[0].length;if(Buffer.byteLength(pending.slice(0,length))>limits.frameBytes)throw invalid();const raw=pending.slice(0,length);pending=pending.slice(length);await consume(raw);}
      if(Buffer.byteLength(pending)>limits.frameBytes)throw invalid();
    }
    pending+=decoder.decode();if(pending.trim())throw invalid();
    // Bound the entire terminal block before publishing any success marker.
    await write(normalizer.finish().join('')+(doneMarker?'data: [DONE]\n\n':''));
  }finally{signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();}
}

/** API-mode-only owned loopback endpoint. Upstream URL and credentials never come from a request. */
export async function createCodexTransport({config,fetchImpl=fetch,authorizeModel,requestTimeoutMs=180000,idleTimeoutMs=30000,limits:overrides={}}={}){
  if(config?.mode!=='api'||typeof config.baseUrl!=='string'||typeof config.model!=='string'||typeof config.apiKey!=='string')throw new Error('Codex API transport 需要已验证的 API 配置。');
  if(authorizeModel!==undefined&&typeof authorizeModel!=='function')throw new Error('Codex transport 模型授权回调无效。');
  const upstream=new URL(`${config.baseUrl.replace(/\/$/,'')}/responses`);
  if(!['http:','https:'].includes(upstream.protocol)||upstream.username||upstream.password||upstream.search||upstream.hash)throw new Error('Codex API transport 地址无效。');
  const model=config.model,upstreamKey=config.apiKey,apiKey=randomBytes(32).toString('hex'),expected=Buffer.from(`Bearer ${apiKey}`),limits={...DEFAULTS,...overrides};
  for(const name of ['requestBytes','frameBytes','outputBytes'])if(!Number.isSafeInteger(limits[name])||limits[name]<1||limits[name]>DEFAULTS[name])throw new Error('Codex transport 大小限制无效。');
  if(!Number.isFinite(requestTimeoutMs)||requestTimeoutMs<1||!Number.isFinite(idleTimeoutMs)||idleTimeoutMs<1)throw new Error('Codex transport 超时无效。');
  const active=new Set();let closing=null,closed=false,baseUrl;
  const server=http.createServer({maxHeaderSize:16384},(req,res)=>{
    const sendError=(status,message)=>{if(!res.destroyed&&!res.headersSent){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:{message,type:'petpal_transport_error'}}));}};
    const supplied=Buffer.from(typeof req.headers.authorization==='string'?req.headers.authorization:'');
    if(closed){sendError(503,'Codex transport 已关闭。');return;}
    if(req.method!=='POST'||req.url!=='/responses'){sendError(404,'不支持此路径或方法。');return;}
    if(req.headers.host!==new URL(baseUrl).host||req.headers.origin||supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){sendError(401,'本机 Codex transport 凭据无效。');return;}
    if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')||req.headers['content-encoding']&&!/^identity$/i.test(req.headers['content-encoding'])){sendError(415,'仅支持未压缩的 JSON。');return;}
    if(active.size>=8){sendError(503,'本机 Codex transport 请求过多。');return;}
    const controller=new AbortController(),signal=controller.signal,state={controller,done:null};active.add(state);
    const stop=()=>controller.abort(),disconnected=()=>{if(!res.writableEnded)stop();};req.once('aborted',stop);res.once('close',disconnected);
    let idle,output=0;const resetIdle=()=>{clearTimeout(idle);idle=setTimeout(stop,idleTimeoutMs);};
    const timer=setTimeout(stop,requestTimeoutMs);resetIdle();
    const incomplete=()=>{if(!req.complete)req.destroy();};signal.addEventListener('abort',incomplete,{once:true});
    const write=async frame=>{
      signal.throwIfAborted();output+=Buffer.byteLength(frame);if(output>limits.outputBytes)throw invalid();
      if(!res.write(frame))await signalRace(new Promise(resolve=>res.once('drain',resolve)),signal);
    };
    state.done=(async()=>{
      const declared=req.headers['content-length'];if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>limits.requestBytes))throw invalid();
      const chunks=[];let size=0;
      for await(const chunk of req){signal.throwIfAborted();resetIdle();size+=chunk.length;if(size>limits.requestBytes)throw invalid();chunks.push(chunk);}
      let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw invalid();}
      // The configured model remains the default. Other models must be
      // explicitly authorized by an active bridge run, never by the request.
      if(!object(body)||body.stream!==true||typeof body.model!=='string'||(body.model!==model&&authorizeModel?.(body.model)!==true))throw invalid();
      signal.throwIfAborted();resetIdle();
      const response=await signalRace(fetchImpl(upstream.href,{method:'POST',redirect:'manual',credentials:'omit',signal,headers:{'Content-Type':'application/json',Accept:'text/event-stream','Accept-Encoding':'identity',...(upstreamKey?{Authorization:`Bearer ${upstreamKey}`}:{})},body:JSON.stringify(body)}),signal);
      if(response.status!==200||response.redirected||!response.body||!/^text\/event-stream(?:\s*;|$)/i.test(response.headers.get('content-type')||'')){
        await response.body?.cancel();sendError([401,403,429].includes(response.status)?response.status:502,'Responses 上游请求失败，请检查服务配置。');return;
      }
      let headerBytes=0;for(const [key,value] of response.headers)headerBytes+=key.length+value.length;if(headerBytes>16384)throw invalid();
      const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>limits.outputBytes))throw invalid();
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});
      await relaySse(response.body,write,signal,resetIdle,limits,body.model);signal.throwIfAborted();res.end();
    })().catch(()=>{
      if(!res.headersSent)sendError(signal.aborted?504:502,'Responses 请求未完成，请重试或检查服务兼容性。');
      else if(!res.destroyed){res.end(encode({type:'error',code:'petpal_transport_error',message:'Responses 请求未完成，请重试或检查服务兼容性。'}));}
    }).finally(()=>{clearTimeout(timer);clearTimeout(idle);signal.removeEventListener('abort',incomplete);controller.abort();req.removeListener('aborted',stop);res.removeListener('close',disconnected);active.delete(state);});
  });
  server.maxHeadersCount=64;server.headersTimeout=10000;server.requestTimeout=requestTimeoutMs;server.keepAliveTimeout=1000;
  server.on('clientError',(_error,socket)=>socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  baseUrl=`http://127.0.0.1:${server.address().port}`;
  const cancelAll=async()=>{const requests=[...active];for(const request of requests)request.controller.abort();await Promise.allSettled(requests.map(request=>request.done));};
  return {baseUrl,apiKey,get activeRequests(){return active.size;},cancelAll,close(){if(closing)return closing;closed=true;closing=(async()=>{const drained=cancelAll();const stopped=new Promise(resolve=>server.close(resolve));server.closeAllConnections();await drained;await stopped;})();return closing;}};
}
