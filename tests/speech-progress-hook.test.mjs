import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

// Run the shipped hook with a deterministic React lifecycle and audio adapter.
// No speech provider, account service, microphone or production state is used.
const modules={
  react:`export const useRef=(...a)=>globalThis.__speechProgressHook.useRef(...a);export const useState=(...a)=>globalThis.__speechProgressHook.useState(...a);export const useEffect=(...a)=>globalThis.__speechProgressHook.useEffect(...a);export const useCallback=(...a)=>globalThis.__speechProgressHook.useCallback(...a);`,
  api:`export const api=(...a)=>globalThis.__speechProgressHook.api(...a);export const apiSpeechAudio=()=>{throw Error('No real audio');};export const apiSpeechStream=()=>{throw Error('No real stream');};export const getConnection=()=>globalThis.__speechProgressHook.connection;export const getIdentity=()=>globalThis.__speechProgressHook.identity;export const getSessionEpoch=()=>globalThis.__speechProgressHook.epoch;export const isSessionChanged=e=>e?.name==='SessionChangedError';`,
  speech:`export const createSpeechController=o=>globalThis.__speechProgressHook.createPlayer(o);export const selectSpeechVoice=()=>null;`,
  remote:`export const createRemoteSpeechController=o=>globalThis.__speechProgressHook.createPlayer(o);`,
  stream:`export const createStreamingSpeechController=o=>globalThis.__speechProgressHook.createPlayer(o);`,
};
const bundled=await build({entryPoints:[fileURLToPath(new URL('../src/avatar/useSpeech.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'speech-progress-fixture',setup(plugin){
  plugin.onResolve({filter:/.*/},args=>{
    if(args.path==='react')return{path:'react',namespace:'speech-progress-fixture'};
    if(!args.importer.replaceAll('\\','/').endsWith('/src/avatar/useSpeech.ts'))return;
    const key={'../api':'api','./speech.mjs':'speech','./remote-speech.mjs':'remote','./stream-speech.mjs':'stream'}[args.path];
    if(key)return{path:key,namespace:'speech-progress-fixture'};
  });
  plugin.onLoad({filter:/.*/,namespace:'speech-progress-fixture'},args=>({contents:modules[args.path],loader:'js'}));
}}]});
const {useSpeech}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const empty={utteranceId:'',text:'',active:false,pending:false,charIndex:0,ended:true,progressBasis:'none',voiceName:'',error:''};
const tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function harness(context,{separateProgress=true}={}){
  const slots=[],effects=[],players=[];let cursor=0,dirty=false,mounted=true,scope='server:user',allowed=true,renders=0,voice;
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
  const runtime={epoch:1,connection:{token:'isolated-fixture'},identity:{instanceId:'server',userId:'user'},lateWrites:0,
    useRef(value){return slots[cursor++]??={current:value};},
    useState(initial){const index=cursor++;slots[index]??={value:typeof initial==='function'?initial():initial};return[slots[index].value,next=>{if(!mounted){runtime.lateWrites++;return;}const value=typeof next==='function'?next(slots[index].value):next;if(!Object.is(value,slots[index].value)){slots[index].value=value;dirty=true;}}];},
    useCallback(callback,deps){const index=cursor++;if(!same(slots[index]?.deps,deps))slots[index]={callback,deps};return slots[index].callback;},
    useEffect(callback,deps){const index=cursor++,previous=slots[index];if(!same(previous?.deps,deps)){const next={deps,cleanup:null};slots[index]=next;effects.push(()=>{previous?.cleanup?.();next.cleanup=callback();});}},
    async api(path){assert.equal(path,'/voice');return{tts:{mode:'cosyvoice',speed:1}};},
    createPlayer(options){let snapshot={...empty};const player={options,disposed:false,emit(patch){snapshot={...snapshot,...patch};options.onState(snapshot);},stop(){this.emit({active:false,pending:false,ended:true,audioLevel:0,emotion:null,progressBasis:'none'});},dispose(){this.disposed=true;this.emit({active:false,pending:false,ended:true,audioLevel:0,emotion:null});},unlock:async()=>true,speak(request){this.emit({utteranceId:request.utteranceId,text:request.text,pending:true,active:false,ended:false,charIndex:0});return true;},snapshot:()=>snapshot};players.push(player);return player;},
  };
  const window=new EventTarget(),document=new EventTarget(),devices=new EventTarget();document.hidden=false;
  window.localStorage={getItem:()=>null};
  const globals={__speechProgressHook:runtime,window,document,navigator:{mediaDevices:devices,language:'zh-CN'},AudioContext:class FixtureAudioContext{}};
  const descriptors=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const[key,value]of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true});
  function render(){cursor=0;dirty=false;renders++;voice=useSpeech(allowed,scope,{separateProgress});while(effects.length)effects.shift()();return voice;}
  function settle(){let limit=30;while(dirty&&limit-->0)render();assert.ok(limit>0,'hook must settle');return voice;}
  function dispose(){if(!mounted)return;for(const slot of slots)slot?.cleanup?.();mounted=false;}
  context.after(()=>{dispose();for(const[key,value]of descriptors)if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];});
  render();
  return{runtime,players,window,document,get voice(){return voice;},get renders(){return renders;},settle,dispose,
    async ready(){await tick();settle();return voice;},
    emit(patch,player=players.at(-1)){player.emit(patch);return settle();},
    scope(value){scope=value;render();return settle();},
    allowed(value){allowed=value;render();return settle();},
  };
}
const speaking={utteranceId:'reply-one',text:'你好，小伴。',active:true,pending:false,ended:false,progressBasis:'estimated',audioLevel:.1,buffering:false,streaming:true,emotion:null};

test('separate progress keeps 100 lip-sync updates out of parent React state',async context=>{
  const h=harness(context);await h.ready();h.emit(speaking);const before=h.renders;
  const source=h.voice.progress;let deliveries=0;const unsubscribe=source?.subscribe(()=>deliveries++);
  for(let i=1;i<=100;i++)h.emit({charIndex:i,audioLevel:i/100,emotion:{emotion:i%2?'happy':'gentle',intensity:'natural',source:'rules'}});
  assert.equal(h.renders-before,0,'lip-sync updates must not schedule the workspace');
  assert.ok(source,'hook exposes the complete independent progress source');assert.equal(source,h.voice.progress);
  assert.equal(deliveries,100);assert.equal(source.snapshot().charIndex,100);assert.equal(source.snapshot().audioLevel,1);assert.equal(source.snapshot().emotion.emotion,'gentle');
  unsubscribe();h.emit({charIndex:101});assert.equal(deliveries,100);
});

test('control, buffer, progress basis and failure transitions immediately update the parent',async context=>{
  const h=harness(context);await h.ready();const source=h.voice.progress;
  for(const patch of [{...speaking,active:false,pending:true},{active:true,pending:false},{buffering:true},{buffering:false},{streaming:false},{progressBasis:'boundary'},{voiceName:'fixture voice'},{error:'fixture playback failure',active:false,ended:true}]){
    const before=h.renders;h.emit(patch);assert.ok(h.renders>before,'control transitions cannot be swallowed');
    for(const[key,value]of Object.entries(patch))assert.deepEqual(h.voice[key],value);
  }
  assert.equal(source?.snapshot().error,'fixture playback failure');
});

test('default speech hook still publishes full progress for existing voice conversation callers',async context=>{
  const h=harness(context,{separateProgress:false});await h.ready();h.emit(speaking);const before=h.renders;
  for(let i=1;i<=8;i++)h.emit({charIndex:i,audioLevel:i/10});
  assert.equal(h.renders-before,8);assert.equal(h.voice.charIndex,8);assert.equal(h.voice.audioLevel,.8);
});

test('completed speech resolves awaiter and explicit stop clears independent mouth progress',async context=>{
  const h=harness(context);await h.ready();const done=h.voice.speakAsync('一段测试。','async-reply');
  h.settle();h.emit({active:true,pending:false,charIndex:2,audioLevel:.7});h.emit({active:false,pending:false,ended:true,charIndex:5,audioLevel:0});await done;
  assert.equal(h.voice.progress?.snapshot().ended,true);
  h.emit(speaking);h.voice.stop();h.settle();
  assert.equal(h.voice.playing,false);assert.equal(h.voice.progress?.snapshot().active,false);assert.equal(h.voice.progress?.snapshot().audioLevel,0);
});

test('duplicate terminal frames still reach a newly registered completion awaiter',async context=>{
  const h=harness(context);await h.ready();
  h.emit({...speaking,active:false,ended:true,charIndex:6,audioLevel:0});
  const player=h.players[0],source=h.voice.progress,before=source.snapshot();
  // Some local engines may repeat their last terminal frame without publishing
  // a preceding pending frame. Store deduplication cannot own completion.
  player.speak=()=>true;
  const done=h.voice.speakAsync(speaking.text,speaking.utteranceId);
  h.emit({});await done;assert.equal(source.snapshot(),before);
});

for(const event of ['visibilitychange','pagehide','petpal:audio-output-change'])test(`${event} stops playback and clears its independent mouth envelope`,async context=>{
  const h=harness(context);await h.ready();h.emit(speaking);
  if(event==='visibilitychange'){h.document.hidden=true;h.document.dispatchEvent(new Event(event));}
  else h.window.dispatchEvent(new Event(event));
  h.settle();assert.equal(h.voice.playing,false);assert.equal(h.voice.progress.snapshot().audioLevel,0);assert.equal(h.voice.progress.snapshot().ended,true);
});

test('configuration replacement fences a former player callback within the same account',async context=>{
  const h=harness(context);await h.ready();h.emit(speaking);const old=h.players[0];
  h.window.dispatchEvent(new Event('petpal:voice-settings-change'));await tick();h.settle();
  assert.ok(old.disposed);assert.equal(h.players.length,2);const before=h.renders;
  h.emit({...speaking,text:'STALE PRIVATE SPEECH',audioLevel:.9},old);
  assert.equal(h.renders,before,'disposed controller cannot publish into the current account');
  assert.equal(h.voice.progress?.snapshot().text,'');
});

test('account change and unmount reset progress and reject late speech data',async context=>{
  const h=harness(context);await h.ready();h.emit(speaking);const old=h.players[0],source=h.voice.progress;
  h.runtime.epoch++;h.runtime.identity={instanceId:'server',userId:'other'};h.window.dispatchEvent(new Event('petpal:session-change'));h.scope('server:other');await tick();h.settle();
  assert.equal(source?.snapshot().text,'');h.emit({...speaking,text:'FORMER ACCOUNT'},old);assert.equal(source?.snapshot().text,'');
  h.emit({...speaking,text:'current account'});h.dispose();assert.equal(source?.snapshot().text,'');
  h.players.at(-1).emit({...speaking,text:'AFTER UNMOUNT'});assert.equal(source?.snapshot().text,'');assert.equal(h.runtime.lateWrites,0);
});
