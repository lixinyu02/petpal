import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createThemeController, effectiveTheme, THEME_NATIVE_SESSION_KEY, THEME_STORAGE_KEY} from '../src/platform/theme.mjs';

const date=new Date(2026,9,21,12), tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const snapshot=(preference,saved=true)=>({preference,theme:effectiveTheme(preference,date),saved});
function fixture({initial=snapshot('day',false),values=new Map(),denied=false,transparent=false,status,setPreference}={}){
  const window=new EventTarget(),document=new EventTarget(),writes=[],calls=[],timers=new Map();let counter=0;
  const storage={getItem(key){if(denied)throw Error('storage denied');return values.get(key)??null;},setItem(key,value){if(denied)throw Error('storage denied');values.set(key,value);writes.push([key,value]);}};
  const appearance={initial,status:status??(async()=>initial),setPreference:async value=>{calls.push(value);return setPreference?setPreference(value):snapshot(value);}};
  document.visibilityState='visible';document.documentElement={dataset:transparent?{petpalSurface:'transparent'}:{},style:{}};
  document.querySelector=()=>({setAttribute(){}});
  const controller=createThemeController({window,document,storage,appearance,now:()=>date,setTimeout(callback){timers.set(++counter,callback);return counter;},clearTimeout(id){timers.delete(id);}});
  return{controller,appearance,values,writes,calls,document,window,focus(){window.dispatchEvent(new Event('focus'));}};
}

test('fresh random origin and reused origin both recover the current native seed',async()=>{
  for(const values of [new Map(),new Map([[THEME_STORAGE_KEY,'day'],[THEME_NATIVE_SESSION_KEY,'previous-launch']])]){
    const f=fixture({initial:{...snapshot('night'),sessionId:'current-launch'},values});
    assert.equal(f.controller.snapshot().preference,'night');
    const stop=f.controller.mount();await tick();
    assert.equal(f.controller.snapshot().preference,'night');assert.equal(f.controller.snapshot().saved,true);
    assert.equal(f.values.get(THEME_NATIVE_SESSION_KEY),'current-launch');stop();
  }
});

test('same-window reload uses its latest local choice rather than the immutable launch argument',async()=>{
  const f=fixture({initial:{...snapshot('day'),sessionId:'launch'},values:new Map([[THEME_STORAGE_KEY,'night'],[THEME_NATIVE_SESSION_KEY,'launch']]),status:async()=>snapshot('night')});
  assert.equal(f.controller.snapshot().preference,'night');const stop=f.controller.mount();await tick();
  assert.equal(f.controller.snapshot().preference,'night');stop();
});

test('first installation migrates a legacy local theme instead of overriding it with native default',async()=>{
  const f=fixture({initial:{...snapshot('day',false),sessionId:'launch'},values:new Map([[THEME_STORAGE_KEY,'night']])});
  const stop=f.controller.mount();await tick();
  assert.deepEqual(f.calls,['night']);assert.equal(f.controller.snapshot().saved,true);stop();
});

test('unavailable web storage still restores and saves through the native store',async()=>{
  const f=fixture({initial:{...snapshot('night'),sessionId:'launch'},denied:true});
  const stop=f.controller.mount();await tick();assert.equal(f.controller.snapshot().preference,'night');
  f.controller.setPreference('day');await tick();f.focus();await tick();
  assert.deepEqual(f.controller.snapshot(),snapshot('day'));stop();
});

test('late native hydration cannot overwrite a newer user auto preference with the same effective color',async()=>{
  const reading=deferred(),f=fixture({status:()=>reading.promise});
  const stop=f.controller.mount();f.controller.setPreference('auto');reading.resolve(snapshot('night'));await tick();
  assert.equal(f.controller.snapshot().preference,'auto');assert.equal(f.controller.snapshot().theme,'day');
  assert.equal(f.controller.snapshot().saved,true);assert.deepEqual(f.calls,['auto']);stop();
});

test('out-of-order native write replies never revert newer preference or saved state',async()=>{
  const pending=new Map(),f=fixture({setPreference:value=>{const wait=deferred();pending.set(value,wait);return wait.promise;}});
  const stop=f.controller.mount();await tick();f.controller.setPreference('night');await tick();f.controller.setPreference('auto');await tick();
  pending.get('auto').resolve(snapshot('auto'));await tick();pending.get('night').resolve(snapshot('night'));pending.get('day').resolve(snapshot('day'));await tick();
  assert.deepEqual(f.controller.snapshot(),snapshot('auto'));stop();
});

test('background denial does not spin and a real focus event retries migration',async()=>{
  let foreground=false;const f=fixture({values:new Map([[THEME_STORAGE_KEY,'night']]),setPreference:value=>{if(!foreground)throw Object.assign(Error('background'),{code:'PETPAL_APPEARANCE_BACKGROUND'});return snapshot(value);}});
  const stop=f.controller.mount();await tick();assert.deepEqual(f.calls,['night']);assert.equal(f.controller.snapshot().saved,false);
  await tick();assert.equal(f.calls.length,1);foreground=true;f.focus();await tick();
  assert.deepEqual(f.calls,['night','night']);assert.equal(f.controller.snapshot().saved,true);stop();
});

test('transparent pet never seeds shared storage or calls the desktop appearance bridge',async()=>{
  const values=new Map([[THEME_STORAGE_KEY,'day'],[THEME_NATIVE_SESSION_KEY,'main-launch']]);let reads=0;
  const f=fixture({initial:{...snapshot('night'),sessionId:'pet-launch'},values,transparent:true,status:async()=>{reads++;return snapshot('night');}});
  const stop=f.controller.mount({transparent:true});await tick();assert.equal(reads,0);assert.equal(f.calls.length,0);
  assert.equal(f.values.get(THEME_STORAGE_KEY),'day');assert.equal(f.values.get(THEME_NATIVE_SESSION_KEY),'main-launch');
  assert.equal(f.document.documentElement.style.backgroundColor,'transparent');stop();
});

test('hydration from an unmounted StrictMode generation cannot mutate the new mount',async()=>{
  const old=deferred(),current=deferred();let reads=0;
  const f=fixture({status:()=>++reads===1?old.promise:current.promise});
  const first=f.controller.mount();await tick();first();const second=f.controller.mount();await tick();
  old.resolve(snapshot('night'));await tick();assert.equal(f.controller.snapshot().preference,'day');assert.equal(f.calls.length,0);
  current.resolve(snapshot('day'));await tick();assert.equal(f.controller.snapshot().preference,'day');second();
});

test('first-paint seed agrees with native preference across a new origin and preserves same-session/transparent pages',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),script=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  for(const [saved,marker,overlay,expected] of [['day','old',false,'night'],['day','launch',false,'day'],['day','old',true,'day'],[null,null,false,'night']]){
    const values=new Map([[THEME_STORAGE_KEY,saved],[THEME_NATIVE_SESSION_KEY,marker]]),document={documentElement:{dataset:{},style:{}},querySelector:()=>({setAttribute(){}})};
    class ClockDate extends Date{constructor(...args){super(...(args.length?args:[date.getTime()]));}}
    vm.runInNewContext(script,{Date:ClockDate,window:{petpal:{appearance:{initial:{...snapshot('night'),sessionId:'launch'}}}},localStorage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)},document,location:{search:overlay?'?pet=1':''},URLSearchParams});
    assert.equal(document.documentElement.dataset.theme,expected);if(overlay)assert.equal(values.get(THEME_NATIVE_SESSION_KEY),'old');
  }
});
