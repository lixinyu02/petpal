import test from 'node:test';
import assert from 'node:assert/strict';
import {createWakeCueController,wakeCueSamples,WAKE_CUE_DURATION} from '../src/voice/wake-cue.mjs';
import {createVoiceGate} from '../src/voice/audio.mjs';
import {voiceGateProfile} from '../src/voice/detection-preferences.mjs';

const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function harness(t,extra={}){
  const contexts=[],timers=new Map();let timer=0;
  const createContext=()=>{
    const context={state:'suspended',sampleRate:24000,sinkId:'',destination:{},resumes:0,closed:0,nodes:[],gains:[],routes:[],
      resume(){this.resumes++;this.state='running';return Promise.resolve();},
      close(){this.closed++;this.state='closed';return Promise.resolve();},
      async setSinkId(id){this.routes.push(id);this.sinkId=id;},
      createBuffer(channels,length,rate){assert.equal(channels,1);assert.equal(rate,24000);const samples=new Float32Array(length);return{getChannelData:()=>samples,samples};},
      createGain(){const gain={gain:{value:1},disconnects:0,connect(){},disconnect(){this.disconnects++;}};this.gains.push(gain);return gain;},
      createBufferSource(){const node={starts:0,stops:0,disconnects:0,onended:null,connect(){},disconnect(){this.disconnects++;},start(){this.starts++;},stop(){this.stops++;}};this.nodes.push(node);return node;},...extra.context,
    };contexts.push(context);return context;
  };
  const controller=createWakeCueController({createContext,getSpeakerId:()=>extra.speaker??'',schedule(callback,delay){const id=++timer;timers.set(id,{callback,delay});return id;},unschedule:id=>timers.delete(id),...extra.options});
  t.after(()=>controller.dispose());return{controller,contexts,timers};
}

test('cue is finite quiet 140ms PCM with smooth silence at boundaries and no network',()=>{
  for(const rate of [8000,24000,44100,48000,192000]){
    const samples=wakeCueSamples(rate);assert.equal(samples.length,Math.ceil(rate*WAKE_CUE_DURATION));
    assert.ok(samples.every(value=>Number.isFinite(value)&&Math.abs(value)<=.065001));assert.equal(samples[0],0);
    assert.ok(Math.abs(samples.at(-1))<.0001);assert.ok(samples.some(value=>Math.abs(value)>.04));
  }
  for(const invalid of [0,NaN,Infinity,7999,192001])assert.throws(()=>wakeCueSamples(invalid),RangeError);
});

for(const sensitivity of ['noise-reduced','balanced','sensitive'])test(`${sensitivity}: cue alone cannot start VAD; immediately following speech retains its onset`,()=>{
  const profile=voiceGateProfile(sensitivity).listening,gate=createVoiceGate(profile),cue=wakeCueSamples();
  // Feed arbitrary capture alignment, including cues straddling a 250ms boundary.
  for(const offset of [0,3000,5800]){
    gate.reset();const input=new Float32Array(18000);input.set(cue,offset);
    for(let at=0;at<input.length;at+=6000)assert.equal(gate.push(input.slice(at,at+6000)).started,false);
  }
  gate.reset();const first=new Float32Array(6000);first.set(cue);first.fill(.08,cue.length);
  const detected=[gate.push(first),gate.push(new Float32Array(6000).fill(.08))].find(value=>value.started);
  assert.ok(detected);const samples=detected.samples.flatMap(frame=>Array.from(frame));
  assert.ok(samples.includes(first[cue.length]),'no silence/mic pause replaces the user onset');
  assert.ok(samples.filter(value=>value===first[cue.length]).length>=6000-cue.length);
});

test('unlock resumes in the start gesture; warm play reuses the chosen speaker without creating contexts',async t=>{
  const h=harness(t,{speaker:'headphones'}),ready=h.controller.unlock();
  assert.equal(h.contexts[0].resumes,1);assert.equal(h.controller.play(),false);assert.equal(await ready,true);
  const context=h.contexts[0];assert.deepEqual(context.routes,['headphones']);assert.equal(h.timers.size,0);
  assert.equal(h.controller.play(),true);assert.equal(context.nodes[0].starts,1);
  context.nodes[0].onended();assert.equal(context.gains[0].gain.value,0);
  assert.equal(await h.controller.unlock(),true);assert.equal(h.controller.play(),true);assert.equal(h.contexts.length,1);
  h.controller.stop();assert.equal(context.nodes[1].stops,1);assert.equal(context.gains[1].gain.value,0);
  assert.equal(h.controller.play(),true,'interrupt may stop cue without losing the warmed session');
});

test('signal cancellation is synchronous and late ended cannot cancel a later cue',async t=>{
  const h=harness(t);await h.controller.unlock();const abort=new AbortController();assert.equal(h.controller.play(abort.signal),true);
  const first=h.contexts[0].nodes[0],late=first.onended;abort.abort();assert.equal(first.stops,1);
  assert.equal(h.controller.play(abort.signal),false);assert.equal(h.controller.play(),true);late();
  assert.equal(h.contexts[0].nodes[1].stops,0);h.controller.release();assert.equal(h.contexts[0].closed,1);
  assert.equal(h.controller.play(),false);await h.controller.unlock();assert.equal(h.contexts.length,2);
});

for(const stage of ['resume','route'])test(`release during pending ${stage} resolves unlock and prevents delayed sound`,async t=>{
  const pending=deferred(),h=harness(t,{speaker:'speaker',context:stage==='resume'?{resume(){this.resumes++;return pending.promise;}}:{setSinkId(id){this.routes.push(id);return pending.promise;}}});
  const ready=h.controller.unlock();await flush();h.controller.release();assert.equal(await ready,false);
  pending.resolve();await flush();assert.equal(h.controller.play(),false);assert.equal(h.contexts[0].nodes.length,0);assert.equal(h.contexts[0].closed,1);
  await h.controller.unlock();assert.equal(h.contexts.length,2,'old completion cannot poison a new holder');
});

for(const mode of ['unsupported','reject','wrong-sink'])test(`custom speaker ${mode} stays silent rather than falling back`,async t=>{
  const context=mode==='unsupported'?{setSinkId:undefined}:mode==='reject'?{setSinkId(){return Promise.reject(new Error('removed'));}}:{async setSinkId(){}};
  const h=harness(t,{speaker:'headphones',context});assert.equal(await h.controller.unlock(),false);
  assert.equal(h.controller.play(),false);assert.equal(h.contexts[0].nodes.length,0);assert.equal(h.contexts[0].closed,1);
});

test('routing timeout closes context and no late resolve can play',async t=>{
  const pending=deferred(),h=harness(t,{speaker:'slow',context:{setSinkId:()=>pending.promise}});
  const ready=h.controller.unlock();await flush();const timeout=[...h.timers.values()][0];assert.equal(timeout.delay,5000);timeout.callback();
  assert.equal(await ready,false);pending.resolve();await flush();assert.equal(h.controller.play(),false);assert.equal(h.contexts[0].closed,1);
});

test('suspended, changed sink, unavailable AudioContext and disposed players stay silent',async t=>{
  const h=harness(t,{speaker:'headphones'});await h.controller.unlock();h.contexts[0].sinkId='other';assert.equal(h.controller.play(),false);
  h.contexts[0].sinkId='headphones';h.contexts[0].state='suspended';assert.equal(h.controller.play(),false);
  h.controller.dispose();assert.equal(await h.controller.unlock(),false);assert.equal(h.controller.play(),false);
  const unavailable=harness(t,{options:{createContext(){throw new Error('No audio');}}});assert.equal(await unavailable.controller.unlock(),false);
});

test('source start failure releases all nodes and never throws into Chat',async t=>{
  const h=harness(t,{context:{createBufferSource(){const node={disconnects:0,connect(){},disconnect(){this.disconnects++;},start(){throw new Error('device gone');},stop(){}};this.nodes.push(node);return node;}}});
  await h.controller.unlock();assert.equal(h.controller.play(),false);assert.ok(h.contexts[0].nodes[0].disconnects>=1);assert.equal(h.contexts[0].gains[0].gain.value,0);
});
