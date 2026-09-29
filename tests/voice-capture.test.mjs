import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Bundle the shipped TypeScript module, then substitute browser devices only.
const bundled=await build({entryPoints:[fileURLToPath(new URL('../src/voice/capture.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser'});
const {createVoiceCapture}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function install(context){
  const acquisitions=[],contexts=[],worklets=[],requests=[],frames=[],errors=[];
  const makeNode=()=>({connected:false,connect(){this.connected=true;},disconnect(){this.connected=false;}});
  class AudioContext {
    state='suspended';destination={};closed=0;modules=[];gains=[];sources=[];
    audioWorklet={addModule:async url=>{this.modules.push(url);}};
    constructor(){contexts.push(this);}
    resume(){this.state='running';return Promise.resolve();}
    close(){this.closed++;this.state='closed';return Promise.resolve();}
    createGain(){const gain={...makeNode(),gain:{value:1}};this.gains.push(gain);return gain;}
    createMediaStreamSource(stream){const source={...makeNode(),stream};this.sources.push(source);return source;}
  }
  class AudioWorkletNode {
    port={onmessage:null,closed:false,close(){this.closed=true;}};onprocessorerror=null;connected=false;
    constructor(context,name){assert.equal(name,'petpal-microphone');worklets.push(this);}
    connect(){this.connected=true;}disconnect(){this.connected=false;}
  }
  const descriptors=new Map(['window','navigator','AudioContext','AudioWorkletNode'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries({window:{isSecureContext:true},navigator:{mediaDevices:{getUserMedia(options){requests.push(options);const pending=deferred();acquisitions.push(pending);return pending.promise;}}},AudioContext,AudioWorkletNode}))Object.defineProperty(globalThis,key,{value,configurable:true});
  context.after(()=>{for(const [key,descriptor]of descriptors)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
  function stream(){const track={onended:null,stops:0,stop(){this.stops++;}},stream={track,getTracks:()=>[track],getAudioTracks:()=>[track]};return stream;}
  const capture=createVoiceCapture({onFrame:(samples,level)=>frames.push({samples,level}),onError:error=>errors.push(error)});
  context.after(()=>capture.stop());
  return {capture,acquisitions,contexts,worklets,requests,frames,errors,stream};
}

test('capture starts on the click stack, uses selected microphone and mutes monitoring',async context=>{
  const h=install(context),starting=h.capture.start('chosen-mic');
  assert.equal(h.contexts.length,1);assert.equal(h.contexts[0].state,'running');assert.equal(h.acquisitions.length,1);
  assert.deepEqual(h.requests[0].audio.deviceId,{exact:'chosen-mic'});assert.equal(h.requests[0].audio.echoCancellation,true);
  const stream=h.stream();h.acquisitions[0].resolve(stream);await starting;
  assert.equal(h.contexts[0].gains[0].gain.value,0);assert.equal(h.contexts[0].modules.length,1);
  h.worklets[0].port.onmessage({data:new Float32Array(6000).fill(.1)});assert.equal(h.frames.length,1);assert.ok(Math.abs(h.frames[0].level-.1)<1e-5);
  const late=h.worklets[0].port.onmessage;h.capture.pause();assert.equal(stream.track.stops,1);assert.equal(h.worklets[0].port.closed,true);late({data:new Float32Array(6000)});assert.equal(h.frames.length,1);
  const second=h.capture.start();h.acquisitions[1].resolve(h.stream());await second;assert.equal(h.contexts.length,1);assert.equal(h.contexts[0].modules.length,1);
  h.capture.stop();assert.equal(h.contexts[0].closed,1);
});

test('superseded microphone permission promises cannot damage a later recording',async context=>{
  const h=install(context),first=h.capture.start(),second=h.capture.start();
  const previous=h.stream(),current=h.stream();h.acquisitions[1].resolve(current);await second;
  h.acquisitions[0].resolve(previous);await assert.rejects(first,{name:'AbortError'});
  assert.equal(previous.track.stops,1);assert.equal(current.track.stops,0);assert.equal(h.worklets[0].connected,true);
  h.capture.stop();assert.equal(current.track.stops,1);
});

test('stop during the permission prompt closes context and stops any late acquired tracks',async context=>{
  const h=install(context),pending=h.capture.start();h.capture.stop();const late=h.stream();h.acquisitions[0].resolve(late);
  await assert.rejects(pending,{name:'AbortError'});assert.ok(late.track.stops>=1);assert.equal(h.contexts[0].closed,1);assert.equal(h.worklets.length,0);
});

test('device loss and malformed frames stop tracks and report a recoverable error',async context=>{
  const h=install(context),pending=h.capture.start();const stream=h.stream();h.acquisitions[0].resolve(stream);await pending;
  stream.track.onended();assert.equal(stream.track.stops,1);assert.match(h.errors[0].message,/麦克风已断开/);
  const again=h.capture.start(),second=h.stream();h.acquisitions[1].resolve(second);await again;
  h.worklets[1].port.onmessage({data:new Float32Array([NaN])});assert.equal(second.track.stops,1);assert.match(h.errors[1].message,/格式/);assert.equal(h.frames.length,0);
});
