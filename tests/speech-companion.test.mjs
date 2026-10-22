import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

// Execute the shipped portrait bridge. Only React's scheduling and the GPU leaf
// are isolated; speech-to-pose selection remains the production implementation.
const bundled=await build({entryPoints:[fileURLToPath(new URL('../src/SpeechCompanion.tsx',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'portrait-progress-fixture',setup(plugin){
  plugin.onResolve({filter:/^(react|react\/jsx-runtime|\.\/CatV2)$/},args=>({path:args.path,namespace:'portrait-fixture'}));
  plugin.onLoad({filter:/.*/,namespace:'portrait-fixture'},args=>({loader:'js',contents:args.path==='react'
    ? 'export const memo=type=>({type});export const useSyncExternalStore=(subscribe,snapshot)=>globalThis.__portraitProgress.read(subscribe,snapshot);'
    : args.path==='react/jsx-runtime'?'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;'
    : 'export default function Cat(){};'}));
}}]});
const {default:Portrait}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const idle={utteranceId:'reply',text:'文字回复',phase:'thinking'};
const initial={utteranceId:'voice',text:'语音正文',active:false,pending:false,charIndex:0,ended:true,progressBasis:'none',voiceName:'',error:''};
function fixture(t,patch={}){
  let state={...initial,...patch};const source={snapshot:()=>state,subscribe:()=>()=>{}};
  globalThis.__portraitProgress={read(subscribe,snapshot){assert.equal(subscribe,source.subscribe);assert.equal(snapshot,source.snapshot);return snapshot();}};
  t.after(()=>delete globalThis.__portraitProgress);
  const onState=()=>{},onInteract=()=>{};
  return{update(patch){state={...state,...patch};},render(extra={}){return Portrait.type({progress:source,idleInput:idle,sleeping:false,onState,onInteract,...extra}).props;},onState,onInteract};
}

test('idle portrait retains the text-response input and exact interaction callbacks',t=>{
  const f=fixture(t),props=f.render();assert.equal(props.performanceInput,idle);assert.equal(props.onState,f.onState);assert.equal(props.onInteract,f.onInteract);
});
test('portrait receives the complete latest audio envelope, boundary and emotion',t=>{
  const emotion={label:'happy',intensity:.7},f=fixture(t,{active:true,ended:false});
  for(let i=1;i<=100;i++){
    f.update({charIndex:i,audioLevel:i/100,emotion});const input=f.render().performanceInput;
    assert.equal(input.phase,'speaking');assert.equal(input.utteranceId,'voice');assert.equal(input.speech.charIndex,i);assert.equal(input.speech.audioLevel,i/100);assert.equal(input.speech.emotion,emotion);
  }
});
test('pending playback keeps the original speaking pose with an inactive mouth source',t=>{
  const f=fixture(t,{pending:true,ended:false}),input=f.render().performanceInput;
  assert.equal(input.phase,'speaking');assert.equal(input.speech.active,false);assert.equal(input.text,'语音正文');
});
test('stop and sleep immediately restore the idle/sleep input',t=>{
  const f=fixture(t,{active:true,ended:false});assert.notEqual(f.render().performanceInput,idle);
  f.update({active:false,pending:false,ended:true,audioLevel:0});assert.equal(f.render().performanceInput,idle);
  f.update({active:true,ended:false});const sleep={utteranceId:'sleep',text:'',phase:'idle'};
  assert.equal(f.render({sleeping:true,idleInput:sleep}).performanceInput,sleep);
});
test('replacing the source switches to the new account snapshot without reusing old text',t=>{
  const f=fixture(t,{active:true,ended:false});assert.equal(f.render().performanceInput.text,'语音正文');
  // A remounted/current-account source is independently owned by useSpeech.
  const source={snapshot:()=>({...initial,text:'新账号',active:true,ended:false}),subscribe:()=>()=>{}};
  globalThis.__portraitProgress.read=(subscribe,snapshot)=>{assert.equal(subscribe,source.subscribe);return snapshot();};
  assert.equal(Portrait.type({progress:source,idleInput:idle,sleeping:false,onState:f.onState,onInteract:f.onInteract}).props.performanceInput.text,'新账号');
});
