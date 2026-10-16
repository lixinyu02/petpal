import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source=ts.transpileModule(await readFile(new URL('../src/main.tsx',import.meta.url),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},
}).outputText;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const flush=async()=>{for(let count=0;count<30;count++)await Promise.resolve();};

/** Exercise the real SessionRoot hooks while the native login read is pending. */
function fixture(){
  const restoration=deferred(),calls=[],window=new EventTarget(),document=new EventTarget();
  document.getElementById=()=>({});
  let captured,owner;
  const react={StrictMode:Symbol('StrictMode'),Suspense:Symbol('Suspense'),lazy:()=>Symbol('lazy'),
    useState(initial){const index=owner.index++;if(!owner.hooks[index])owner.hooks[index]={state:initial};const captured=owner;return[captured.hooks[index].state,value=>{captured.hooks[index].state=value;}];},
    useSyncExternalStore:(_subscribe,snapshot)=>snapshot(),
    useEffect(effect,deps){const index=owner.index++,previous=owner.hooks[index],captured=owner;if(!previous||deps.some((value,at)=>!Object.is(value,previous.deps?.[at])))captured.effects.push(()=>{previous?.cleanup?.();captured.hooks[index]={deps,cleanup:effect()};});},
    useLayoutEffect:(effect,deps)=>react.useEffect(effect,deps),
  };
  const jsx=(type,props)=>({type,props});
  const modules={react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-dom/client':{createRoot:()=>({render:tree=>{captured=tree;}})},
    '@capacitor/core':{Capacitor:{isNativePlatform:()=>true,getPlatform:()=>'android'},registerPlugin:()=>({})},
    './api':{getIdentity:()=>null,getSessionEpoch:()=>1,subscribeSession:()=>()=>{},initConnection:()=>restoration.promise},
    './platform/useViewport':{useViewport(){}},'./platform/ui-motion.ts':{mountUiMotionLifecycle:()=>()=>{}},
    './platform/interaction-layers.mjs':{mountInteractionLayers:()=>()=>{}},'./platform/theme.ts':{mountThemeLifecycle:()=>()=>{}},
    './platform/overlay':{PetOverlay:{stop:async()=>{},status:async()=>({running:false})},showPet:async()=>{}},
    './auth/LoginGate':{default:Symbol('LoginGate'),__esModule:true},'./auth/overlay-entry.mjs':{isPassiveNativeOverlay:()=>false},
    './platform/android-app-proxy':{mountAndroidAppProxyLifecycle:()=>()=>{}},
    './platform/android-official-account':{mountAndroidOfficialSession:()=>{calls.push('mount');return()=>calls.push('cleanup');}},
  };
  const module={exports:{}};
  vm.runInNewContext(source,{module,exports:module.exports,window,document,location:new URL('https://localhost/'),URLSearchParams,Promise,require(name){if(name.endsWith('.css'))return{};assert.ok(Object.hasOwn(modules,name),name);return modules[name];}});
  const component=captured.props.children.type;
  const mount=()=>{
    const current={index:0,hooks:[],effects:[],render(){owner=current;current.index=0;current.effects=[];component();owner=undefined;for(const effect of current.effects)effect();},close(){for(const hook of current.hooks)hook?.cleanup?.();}};
    current.render();return current;
  };
  return{restoration,calls,mount};
}

test('Android does not mount official account lifecycle until saved login restoration settles',async()=>{
  const f=fixture(),root=f.mount();await flush();
  assert.deepEqual(f.calls,[],'empty initial JS identity must not revoke an existing native attempt');
  root.render();await flush();assert.deepEqual(f.calls,[]);
  f.restoration.resolve({token:'synthetic-restored-session'});await flush();root.render();await flush();
  assert.deepEqual(f.calls,['mount']);root.close();assert.deepEqual(f.calls,['mount','cleanup']);
});

test('an abandoned Activity root cannot mount a stale lifecycle after login restoration completes',async()=>{
  const f=fixture(),abandoned=f.mount();abandoned.close();
  const replacement=f.mount();f.restoration.resolve({token:'synthetic-restored-session'});await flush();replacement.render();await flush();
  assert.deepEqual(f.calls,['mount']);replacement.close();
});

test('a failed saved-login read still completes readiness for the explicit signed-out lifecycle',async()=>{
  const f=fixture(),root=f.mount();f.restoration.reject(new Error('synthetic-native-read-error'));await flush();root.render();await flush();
  assert.deepEqual(f.calls,['mount']);root.close();
});
