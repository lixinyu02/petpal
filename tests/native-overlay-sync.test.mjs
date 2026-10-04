import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {isPassiveNativeOverlay} from '../src/auth/overlay-entry.mjs';
import * as uiMotion from '../src/platform/ui-motion.mjs';
import {mountInteractionLayers} from '../src/platform/interaction-layers.mjs';

const compile=async file=>ts.transpileModule(await readFile(new URL(file,import.meta.url),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},
}).outputText;
const [rootSource,settingsSource,motionSource]=await Promise.all([compile('../src/main.tsx'),compile('../src/CompanionOptions.tsx'),compile('../src/platform/ui-motion.ts')]);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));

/** Run the actual TSX effects, rather than repeating their gate in a test helper. */
function fixture({native=true,enabled=true,href='https://app.example/?chat=1&settings=1'}={}){
  let active,capturedRoot,epoch=1,identity={instanceId:'server-a',userId:'alice'},catEnabled=enabled;
  const pending=[],shown=[],events=new EventTarget(),document=new EventTarget();
  document.getElementById=()=>({});
  const react={
    StrictMode:Symbol('StrictMode'),Suspense:Symbol('Suspense'),
    createElement:(type,props,...children)=>({type,props:{...props,children}}),lazy:loader=>({loader}),
    useSyncExternalStore:(_subscribe,snapshot)=>snapshot(),
    useState:initial=>{
      const owner=active,index=owner.index++;
      if(!owner.hooks[index])owner.hooks[index]={state:initial};
      return[owner.hooks[index].state,value=>{owner.hooks[index].state=typeof value==='function'?value(owner.hooks[index].state):value;}];
    },
    useRef:initial=>{
      const owner=active,index=owner.index++;
      if(!owner.hooks[index])owner.hooks[index]={ref:{current:initial}};
      return owner.hooks[index].ref;
    },
    useEffect:(effect,deps)=>{
      const owner=active,index=owner.index++,previous=owner.hooks[index];
      if(!previous||!deps||deps.some((value,at)=>!Object.is(value,previous.deps?.[at])))owner.effects.push(()=>{
        previous?.cleanup?.();owner.hooks[index]={deps,cleanup:effect()};
      });
    },
    useLayoutEffect:(effect,deps)=>react.useEffect(effect,deps),
  };
  const api={getSessionEpoch:()=>epoch,getIdentity:()=>identity,subscribeSession:()=>()=>{},initConnection:()=>Promise.resolve()};
  const preference={readCompanionCatEnabled:()=>catEnabled,useCompanionCatEnabled:()=>[catEnabled,value=>{catEnabled=value;}]};
  const nativeOverlay={status:()=>{const request=deferred();pending.push(request);return request.promise;},stop:()=>Promise.resolve()};
  const modules={
    './platform/interaction-layers.mjs':{mountInteractionLayers},
    react,'react-dom/client':{createRoot:()=>({render:tree=>{capturedRoot=tree;}})},
    'react/jsx-runtime':{jsx:(type,{children,...props})=>react.createElement(type,props,...(Array.isArray(children)?children:children===undefined?[]:[children])),jsxs:(type,{children,...props})=>react.createElement(type,props,...(Array.isArray(children)?children:children===undefined?[]:[children]))},
    '@capacitor/core':{Capacitor:{isNativePlatform:()=>native,getPlatform:()=>native?'android':'web'}},
    './platform/useViewport':{useViewport:()=>{}},'./api':api,'./avatar/preference':preference,
    './platform/theme.ts':{mountThemeLifecycle:()=>()=>{}},
    './ui-motion.mjs':{...uiMotion,createUiMotionController:options=>uiMotion.createUiMotionController({window:events,document,...options})},
    './platform/overlay':{PetOverlay:nativeOverlay,showPet:async options=>{shown.push(options.companionKind);}},
    './platform/task-notification-session':{mountTaskNotificationSession:()=>()=>{},taskNotificationSession:{subscribe:()=>()=>{},snapshot:()=>({status:null,busy:false,error:'',navigation:null}),takeNavigation:()=>null}},
    './auth/LoginGate':{default:Symbol('LoginGate'),__esModule:true},'./auth/overlay-entry.mjs':{isPassiveNativeOverlay},
    'lucide-react':{Cat:Symbol('Cat')},
  };
  const load=source=>{
    const module={exports:{}};
    vm.runInNewContext(source,{module,exports:module.exports,require:name=>{
      if(name.endsWith('.css'))return{};
      if(!Object.hasOwn(modules,name))throw new Error(`Unexpected dependency: ${name}`);
      return modules[name];
    },location:new URL(href),window:events,document,URLSearchParams,Promise});
    return module.exports;
  };
  // Execute the real hook bridge with a DOM-less controller; decoration stays off.
  modules['./platform/ui-motion.ts']=load(motionSource);
  load(rootSource);
  const SessionRoot=capturedRoot.props.children[0].type,CompanionOptions=load(settingsSource).default;
  const mount=component=>{
    const owner={index:0,hooks:[],effects:[],tree:null,render(){
      owner.index=0;owner.effects=[];active=owner;owner.tree=component();active=undefined;
      for(const effect of owner.effects)effect();return owner.tree;
    },unmount(){for(const hook of owner.hooks)hook?.cleanup?.();}};
    owner.render();return owner;
  };
  return{pending,shown,mountRoot:()=>mount(SessionRoot),mountSettings:()=>mount(CompanionOptions),setEnabled:value=>{catEnabled=value;},setEpoch:value=>{epoch=value;},setIdentity:value=>{identity=value;}};
}

test('delayed native status still replaces a running cat after leaving the settings child',async()=>{
  const current=fixture(),root=current.mountRoot(),settings=current.mountSettings();
  await flush();root.render();
  assert.equal(current.pending.length,0);
  settings.tree.props.children[0].props.onClick();
  root.render();settings.render();
  assert.equal(current.pending.length,1);
  settings.unmount(); // Switching settings tabs keeps SessionRoot mounted.
  current.pending[0].resolve({running:true,companionKind:'cat'});await flush();
  assert.deepEqual(current.shown,['anime']);root.unmount();
});

test('a renewed opt-in blocks the delayed old disable even before React cleans its effect',async()=>{
  const current=fixture({enabled:false}),root=current.mountRoot();
  current.setEnabled(true);
  current.pending[0].resolve({running:true,companionKind:'cat'});await flush();
  assert.deepEqual(current.shown,[]);root.render();root.unmount();
});

test('old account and identity responses are ignored before the root rerenders',async()=>{
  for(const change of [current=>current.setEpoch(2),current=>current.setIdentity({instanceId:'server-a',userId:'bob'})]){
    const current=fixture({enabled:false}),root=current.mountRoot();change(current);
    current.pending[0].resolve({running:true,companionKind:'cat'});await flush();
    assert.deepEqual(current.shown,[]);root.unmount();
  }
});

test('unmounting the root cancels its outstanding synchronization',async()=>{
  const current=fixture({enabled:false}),root=current.mountRoot();root.unmount();
  current.pending[0].resolve({running:true,companionKind:'cat'});await flush();
  assert.deepEqual(current.shown,[]);
});

test('web pages and the passive native asset renderer never query or start native overlays',()=>{
  for(const options of [{native:false,enabled:false},{enabled:false,href:'https://appassets.androidplatform.net/assets/public/index.html?overlay=1&avatar=cat'}]){
    const current=fixture(options),root=current.mountRoot();assert.equal(current.pending.length,0);assert.deepEqual(current.shown,[]);root.unmount();
  }
});

test('only an already running cat is synchronized; stopped or anime overlays stay untouched',async()=>{
  for(const status of [{running:false,companionKind:'cat'},{running:true,companionKind:'anime'}]){
    const current=fixture({enabled:false}),root=current.mountRoot();current.pending[0].resolve(status);await flush();
    assert.deepEqual(current.shown,[]);root.unmount();
  }
  const current=fixture({enabled:false}),root=current.mountRoot();current.pending[0].reject(new Error('native unavailable'));await flush();
  assert.deepEqual(current.shown,[]);root.unmount();
});
