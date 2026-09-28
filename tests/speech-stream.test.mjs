import test from 'node:test';
import assert from 'node:assert/strict';
import { readSpeechStream } from '../src/avatar/speech-stream.mjs';

const format={type:'format',format:'pcm_s16le',sampleRate:24000,channels:1};
const audio=bytes=>({type:'audio',data:Buffer.from(bytes).toString('base64')});
const end=bytes=>({type:'end',bytes});
const encode=frames=>frames.map(frame=>JSON.stringify(frame)+'\n').join('');
const response=frames=>new Response(encode(frames),{headers:{'content-type':'application/x-ndjson; charset=utf-8'}});
const handlers={onFormat(){},onAudio(){}};
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};};

test('PCM framing incrementally delivers odd audio chunks before upstream completion',async()=>{
  let controller;const chunks=[],formats=[];
  const source=new Response(new ReadableStream({start(value){controller=value;}}),{headers:{'content-type':'application/x-ndjson'}});
  const heard=deferred();let finished=false;
  const pending=readSpeechStream(source,{onFormat:value=>formats.push(value),onAudio:bytes=>{chunks.push([...bytes]);heard.resolve();}}).then(()=>{finished=true;});
  const text=encode([format,audio([1,2,3])]),bytes=new TextEncoder().encode(text);
  for(let index=0;index<bytes.length;index+=7)controller.enqueue(bytes.slice(index,index+7));
  await heard.promise;assert.equal(finished,false);assert.deepEqual(chunks,[[1,2,3]]);assert.equal(formats[0].sampleRate,24000);
  controller.enqueue(new TextEncoder().encode(encode([audio([4]),end(4)])));controller.close();await pending;
  assert.deepEqual(chunks,[[1,2,3],[4]]);
});

test('PCM frame consumer backpressure prevents dispatching following audio',async()=>{
  const held=deferred(),started=deferred();let count=0;
  const pending=readSpeechStream(response([format,audio([1,2]),audio([3,4]),end(4)]),{onFormat(){},async onAudio(){count++;if(count===1){started.resolve();await held.promise;}}});
  await started.promise;assert.equal(count,1);await Promise.resolve();assert.equal(count,1);
  held.resolve();await pending;assert.equal(count,2);
});

test('PCM framing rejects missing/invalid completion, unsafe format and malformed payloads',async t=>{
  const cases=[
    ['missing end',[format,audio([1,2])]],['empty',[format,end(0)]],['odd total',[format,audio([1]),end(1)]],
    ['wrong size',[format,audio([1,2]),end(4)]],['audio before format',[audio([1,2]),format,end(2)]],
    ['duplicate format',[format,format,audio([1,2]),end(2)]],['unsupported rate',[{...format,sampleRate:48000},audio([1,2]),end(2)]],
    ['unsupported channel',[{...format,channels:2},audio([1,2]),end(2)]],['duplicate end',[format,audio([1,2]),end(2),end(2)]],
    ['audio after end',[format,audio([1,2]),end(2),audio([3,4])]],['base64',[format,{type:'audio',data:'not base64'}]],
    ['noncanonical base64',[format,{type:'audio',data:'Af=='}]],['oversized chunk',[format,audio(new Uint8Array(24577))]],
  ];
  for(const[name,frames]of cases)await t.test(name,()=>assert.rejects(readSpeechStream(response(frames),handlers),/语音流/));
  await assert.rejects(readSpeechStream(new Response(encode([format,audio([1,2]),end(2)]),{headers:{'content-type':'audio/wav'}}),handlers),/语音流/);
  await assert.rejects(readSpeechStream(new Response('{'+ 'a'.repeat(40000),{headers:{'content-type':'application/x-ndjson'}}),handlers),/语音流/);
});

test('PCM framing preserves explicit safe errors and stops silent source on abort',async()=>{
  await assert.rejects(readSpeechStream(response([format,{type:'error',message:'语音服务繁忙，请稍后重试。'}]),handlers),/服务繁忙/);
  const controller=new AbortController();let cancelled=false;
  const source=new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'application/x-ndjson'}});
  const pending=readSpeechStream(source,{...handlers,signal:controller.signal});controller.abort();
  await assert.rejects(pending,{name:'AbortError'});assert.equal(cancelled,true);
});

test('PCM framing caps total PCM bytes instead of retaining an unbounded audio response',async()=>{
  const pcm=audio(new Uint8Array(24576));
  await assert.rejects(readSpeechStream(response([format,...Array(854).fill(pcm),end(854*24576)]),handlers),/超过大小限制/);
});
