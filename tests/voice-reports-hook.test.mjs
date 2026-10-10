import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

// Execute the shipped hook and state machine. Substitute React's scheduler,
// authenticated transport and devices, rather than a second report pipeline.
const fakeModules={
  react:`export const useRef=(...args)=>globalThis.__voiceReportsHook.useRef(...args);export const useState=(...args)=>globalThis.__voiceReportsHook.useState(...args);export const useEffect=(...args)=>globalThis.__voiceReportsHook.useEffect(...args);export const useCallback=(...args)=>globalThis.__voiceReportsHook.useCallback(...args);`,
  api:`export const api=(...args)=>globalThis.__voiceReportsHook.api(...args);export const streamMessage=(...args)=>globalThis.__voiceReportsHook.streamMessage(...args);export const getSessionEpoch=()=>globalThis.__voiceReportsHook.epoch;export const getIdentity=()=>globalThis.__voiceReportsHook.identity;export const getConnection=()=>({token:'test-token'});`,
  speech:`export const useSpeech=()=>globalThis.__voiceReportsHook.speech;`,
  capture:`export const createVoiceCapture=(...args)=>globalThis.__voiceReportsHook.createCapture(...args);`,
  asr:`export const openAsrSession=(...args)=>globalThis.__voiceReportsHook.openAsr(...args);`,
};
const bundled=await build({entryPoints:[fileURLToPath(new URL('../src/voice/useVoiceConversation.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'voice-hook-boundaries',setup(plugin){
  plugin.onResolve({filter:/.*/},args=>{
    if(args.path==='react')return{path:'react',namespace:'voice-hook-fake'};
    if(!args.importer.replaceAll('\\','/').endsWith('/src/voice/useVoiceConversation.ts'))return;
    const key={'../api':'api','../avatar/useSpeech':'speech','./capture':'capture','./api':'asr'}[args.path];
    if(key)return{path:key,namespace:'voice-hook-fake'};
  });
  plugin.onLoad({filter:/.*/,namespace:'voice-hook-fake'},args=>({contents:fakeModules[args.path],loader:'js'}));
}}]});
const {useVoiceConversation}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`).catch(error=>{throw new Error(`Voice hook bundle import failed: ${error.message}`);});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
const report=(id,content='后台任务已完成。')=>({id,role:'assistant',status:'complete',assistantTaskId:'task',content});
const conversation=messages=>({id:'voice-chat',mode:'chat',messages,assistantTasks:[]});
function harness(context){
  const slots=[],effects=[],calls=[],streams=[],plays=[],sessions=[],captures=[],baselines=[];let cursor=0,baseline=conversation([]);
  const same=(first,second)=>first&&second&&first.length===second.length&&first.every((value,index)=>Object.is(value,second[index]));
  const runtime={epoch:1,identity:{instanceId:'server',userId:'member'},options:{allowed:true,scope:'server:member',providerId:'model'},
    useRef(value){const index=cursor++;return(slots[index]??={current:value});},
    useState(value){const index=cursor++;slots[index]??={value};return[slots[index].value,next=>{slots[index].value=typeof next==='function'?next(slots[index].value):next;}];},
    useCallback(callback,deps){const index=cursor++,previous=slots[index];if(!previous||!same(previous.deps,deps))slots[index]={callback,deps};return slots[index].callback;},
    useEffect(callback,deps){const index=cursor++,previous=slots[index];if(!previous||!same(previous.deps,deps)){const next={deps,cleanup:null};slots[index]=next;effects.push(()=>{previous?.cleanup?.();next.cleanup=callback();});}},
    api(path,options={}){calls.push({path,options});if(path==='/voice')return Promise.resolve(runtime.voiceConfig||{});if(path==='/voice/asr')return Promise.resolve({configured:true});if(path==='/conversations')return Promise.resolve(conversation([]));if(path.endsWith('/stop'))return Promise.resolve({ok:true});return baselines.length?baselines.shift().promise:Promise.resolve(baseline);},
    streamMessage(id,text,signal,onEvent){calls.push({path:'messages',id,text});const pending=deferred(),entry={id,text,signal,onEvent,...pending};streams.push(entry);signal.addEventListener('abort',()=>pending.reject(signal.reason),{once:true});return pending.promise;},
    createCapture(handlers){const capture={handlers,stopped:false,async start(){},pause(){},stop(){this.stopped=true;}};captures.push(capture);return capture;},
    async openAsr(signal,onTranscript){const final=deferred(),session={signal,onTranscript,final,async send(){},finish:()=>final.promise,cancel(){}};sessions.push(session);return session;},
    speech:{engine:'cosyvoice',streamingEnabled:true,supported:true,unlock:async()=>true,stop(){},speakAsync(text,id,signal){const pending=deferred();plays.push({text,id,signal,...pending});signal.addEventListener('abort',()=>pending.reject(signal.reason),{once:true});return pending.promise;}},
  };
  const document=new EventTarget();document.hidden=false;const window=new EventTarget(),navigator={mediaDevices:new EventTarget()};
  const preferences=new Map();window.localStorage={getItem:key=>preferences.get(key)||null,setItem:(key,value)=>preferences.set(key,value)};
  const values={__voiceReportsHook:runtime,document,window,navigator},descriptors=new Map(Object.keys(values).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const[key,value]of Object.entries(values))Object.defineProperty(globalThis,key,{value,configurable:true});
  context.after(()=>{for(const slot of slots)slot?.cleanup?.();for(const[key,descriptor]of descriptors)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
  function render(options={}){runtime.options={...runtime.options,...options};cursor=0;const voice=useVoiceConversation(runtime.options);while(effects.length)effects.shift()();return voice;}
  const voice=render();
  return{voice,render,runtime,calls,streams,plays,sessions,baselines,window,document,navigator,captures,preferences,baseline(value){baseline=value;},feed(level=.05){captures.at(-1).handlers.onFrame(new Float32Array(6000).fill(level),level);},async ask(text='继续聊'){this.feed();this.feed();await flush();const finishing=voice.finishUtterance();sessions.at(-1).final.resolve(text);await flush();return{finishing};}};
}

test('real hook reads account wake settings at each start and settings changes stop the old microphone',async context=>{
  const h=harness(context);h.runtime.voiceConfig={wake:{enabled:true,phrases:['你好小伴'],idleTimeoutSeconds:30}};
  await h.voice.start();assert.equal(h.render().phase,'armed');assert.equal(h.calls.filter(call=>call.path==='/voice').length,1);
  h.runtime.voiceConfig.wake={enabled:true,phrases:['新的小伴'],idleTimeoutSeconds:60};h.window.dispatchEvent(new Event('petpal:voice-settings-change'));
  assert.equal(h.captures[0].stopped,true);await h.voice.start();assert.deepEqual(h.render().wake.phrases,['新的小伴']);
  const wrong=await h.ask('你好小伴');await wrong.finishing;assert.equal(h.streams.length,0);const wake=await h.ask('新的小伴');await wake.finishing;assert.equal(h.render().phase,'listening');h.voice.stop();
});

for(const event of ['hidden','pagehide','petpal:session-change','petpal:voice-settings-change','petpal:audio-output-change','devicechange'])test(`armed microphone releases on ${event}`,async context=>{
  const h=harness(context);h.runtime.voiceConfig={wake:{enabled:true}};await h.voice.start();
  if(event==='hidden'){h.document.hidden=true;h.document.dispatchEvent(new Event('visibilitychange'));}
  else if(event==='devicechange')h.navigator.mediaDevices.dispatchEvent(new Event(event));else h.window.dispatchEvent(new Event(event));
  assert.equal(h.render().active,false);assert.equal(h.captures[0].stopped,true);h.feed(.1);await flush();assert.equal(h.sessions.length,0);
});

test('late account settings cannot reactivate a stopped startup; logged-out voice acquires no microphone',async context=>{
  const h=harness(context),ready=deferred(),original=h.runtime.api;
  h.runtime.api=(path,options)=>path==='/voice'?ready.promise:original(path,options);
  const starting=h.voice.start();assert.equal(h.render().phase,'starting');h.voice.stop();ready.resolve({wake:{enabled:true}});await starting;
  assert.equal(h.render().active,false);assert.equal(h.captures[0].stopped,true);assert.equal(h.sessions.length,0);
  h.render({allowed:false});await h.voice.start();assert.equal(h.captures.length,1);assert.equal(h.render().phase,'error');
});

test('real hook reads account-scoped sensitivity and stops then reloads it after settings change',async context=>{
  const h=harness(context),key=`petpal.voiceDetection:${encodeURIComponent(h.runtime.options.scope)}`;
  h.preferences.set(key,'sensitive');await h.voice.start();h.feed(.018);await flush();assert.equal(h.sessions.length,1,'saved light-speech setting reaches the real gate');
  h.preferences.set(key,'noise-reduced');h.window.dispatchEvent(new Event('petpal:voice-settings-change'));assert.equal(h.render().active,false);
  await h.voice.start();for(let i=0;i<20;i++)h.feed(.018);await flush();assert.equal(h.sessions.length,1,'new anti-noise profile does not open another ASR');
  h.feed(.065);h.feed(.065);await flush();assert.equal(h.sessions.length,2);h.voice.stop();
});

test('real hook GET seeds history before POST, truncates only speech, and reseeds reused conversation after stop/start',async context=>{
  const h=harness(context),old=report('old'),full=report('long','**完成结果** '+('详细结果😀'.repeat(2500)));h.baseline(conversation([old]));
  await h.voice.start();const first=await h.ask();assert.equal(h.calls.findIndex(call=>call.path==='/conversations/voice-chat')<h.calls.findIndex(call=>call.path==='messages'),true);
  h.streams[0].onEvent({type:'done',data:{conversation:conversation([old,full])}});h.streams[0].resolve();await first.finishing;await flush();
  assert.equal(h.plays.length,1);assert.ok(h.plays[0].text.length<=180);assert.equal(full.content.length>1000,true);
  h.voice.stop();await flush();const paused=report('paused');h.voice.updateAssistantTasks(conversation([old,full,paused]));h.baseline(conversation([old,full,paused]));
  await h.voice.start();assert.equal(h.render().assistantTasks.length,0);const second=await h.ask();assert.equal(h.calls.filter(call=>call.path==='/conversations/voice-chat').length,2);assert.equal(h.calls.filter(call=>call.path==='/conversations').length,1,'same provider reuses its voice conversation');
  const fresh=report('fresh','这是重新开启语音后的新结果。');h.streams[1].onEvent({type:'done',data:{conversation:conversation([old,full,paused,fresh])}});h.streams[1].resolve();await second.finishing;await flush();
  assert.equal(h.plays.length,2);assert.equal(h.plays[1].text,fresh.content);h.voice.stop();await flush();
});

test('real hook ignores a late first-turn baseline after stop while the new voice session seeds and submits normally',async context=>{
  const h=harness(context),previous=deferred(),next=deferred();h.baselines.push(previous,next);
  await h.voice.start();const first=await h.ask('旧问题');assert.equal(h.streams.length,0);const oldRequest=h.calls.find(call=>call.path==='/conversations/voice-chat');
  h.voice.stop();await h.voice.start();const second=await h.ask('新问题');assert.equal(oldRequest.options.signal.aborted,true);
  next.resolve(conversation([report('new-baseline')]));await flush();assert.equal(h.streams.length,1);assert.equal(h.streams[0].text,'新问题');
  previous.resolve(conversation([report('old-baseline')]));await first.finishing;assert.equal(h.streams.length,1);assert.equal(h.plays.length,0);
  h.streams[0].onEvent({type:'done',data:{conversation:conversation([report('new-baseline')])}});h.streams[0].resolve();await second.finishing;h.voice.stop();await flush();
});
