import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as capability from '../src/avatar/cat-capability.mjs';
import {createCompanionPreference} from '../src/avatar/preference-store.mjs';

const disk=()=>{const values=new Map();return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};};
const compile=async file=>ts.transpileModule(await readFile(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const [preferenceSource,overlaySource]=await Promise.all([compile('../src/avatar/preference.ts'),compile('../src/platform/overlay.ts')]);

function preferenceFixture({storage=disk(),href='https://app.example/'}={}){
  let identity={instanceId:'server-a',userId:'alice'},epoch=1;
  const subscribers=new Set(),calls=[],window=new EventTarget(),location=new URL(href),module={exports:{}};
  window.localStorage=storage;
  const api={getIdentity:()=>identity,getSessionEpoch:()=>epoch,getConnection:()=>({url:'https://server-a',token:'fixture-only'}),subscribeSession:callback=>{subscribers.add(callback);return()=>subscribers.delete(callback);},SessionChangedError:class extends Error{},api:async(_url,options)=>{calls.push(JSON.parse(options.body));}};
  const modules={'react':{useSyncExternalStore:(_subscribe,snapshot)=>snapshot()},'../api':api,'./preference-store.mjs':{createCompanionPreference},'./cat-capability.mjs':capability};
  vm.runInNewContext(preferenceSource,{module,exports:module.exports,require:name=>{assert.ok(Object.hasOwn(modules,name),name);return modules[name];},window,location,URLSearchParams,AbortController,setTimeout,clearTimeout});
  return{preference:module.exports,storage,calls,change(next){identity=next;epoch++;for(const callback of subscribers)callback();}};
}

test('legacy raw account preference is retained while the actual display and shared publication always use anime',async()=>{
  const storage=disk();storage.setItem('petpal.companionKind','cat');
  const f=preferenceFixture({storage}),key='petpal.companionPreference:user%3Aserver-a%3Aalice';
  await f.preference.hydrateCompanion('cat');
  assert.equal(f.preference.readCompanion(),'anime');assert.equal(f.preference.useCompanion()[0],'anime');
  assert.equal(storage.getItem('petpal.companionKind'),'cat');assert.equal(JSON.parse(storage.getItem(key)).kind,'cat');
  assert.deepEqual(JSON.parse(storage.getItem(capability.COMPANION_DISPLAY_KEY)),{version:3,kind:'anime',catEnabled:false});assert.deepEqual(f.calls,[]);
});

test('retired device capability cannot be enabled and does not mutate scoped old records or emit changes',()=>{
  const storage=disk(),key=capability.companionCatStorageKey('alice'),old='{"version":2,"enabled":true}';storage.setItem(key,old);
  const disabled=capability.createCompanionCatCapability({storage,scope:'alice'}),seen=[];disabled.subscribe(()=>seen.push(disabled.snapshot()));
  for(const value of [true,false,true]){disabled.setEnabled(value);disabled.refresh();disabled.storageChanged(key);assert.equal(disabled.snapshot(),false);}
  assert.equal(storage.getItem(key),old);assert.deepEqual(seen,[]);disabled.dispose();disabled.setEnabled(true);assert.equal(disabled.snapshot(),false);
  for(const value of ['true',1,null,{}])assert.throws(()=>disabled.setEnabled(value),/boolean/);
  const denied=capability.createCompanionCatCapability({storage:{getItem(){throw Error('denied');},setItem(){throw Error('denied');}}});denied.setEnabled(true);assert.equal(denied.snapshot(),false);
});

test('effective display rejects every previous opt-in, record and explicit native cat URL',()=>{
  const native='https://appassets.androidplatform.net/assets/public/index.html?overlay=1&avatar=cat';
  assert.equal(capability.isExplicitNativeCatOverlay(native),false);
  for(const kind of ['anime','cat',undefined])for(const enabled of [true,false]){
    assert.equal(capability.effectiveCompanionKind(kind,enabled),'anime');
    assert.deepEqual(JSON.parse(capability.companionDisplayRecord(kind,enabled)),{version:3,kind:'anime',catEnabled:false});
  }
  for(const raw of [undefined,'invalid','null','{"version":3,"kind":"cat","catEnabled":true}','{"version":2,"kind":"cat","catEnabled":true}']){
    assert.deepEqual(capability.readCompanionDisplay(raw),{kind:'anime',catEnabled:false});
    for(const search of ['?pet=1&avatar=cat','?overlay=1&avatar=cat','?chat=1&avatar=cat'])assert.equal(capability.resolveCompanionDisplay({kind:'cat',catEnabled:true,search,floating:true,displayRaw:raw,href:native}),'anime');
  }
});

test('old opt-ins remain account and backend scoped without inheriting another account on session changes',async()=>{
  const storage=disk(),alice='petpal.companionPreference:user%3Aserver-a%3Aalice',bob='petpal.companionPreference:user%3Aserver-a%3Abob';
  storage.setItem(alice,'{"kind":"cat","dirty":false}');storage.setItem(bob,'{"kind":"anime","dirty":false}');
  const f=preferenceFixture({storage});assert.equal(f.preference.readCompanion(),'anime');
  f.change({instanceId:'server-a',userId:'bob'});await f.preference.hydrateCompanion('anime');assert.equal(f.preference.readCompanion(),'anime');
  f.change({instanceId:'server-b',userId:'alice'});await f.preference.hydrateCompanion('cat');assert.equal(f.preference.readCompanion(),'anime');
  assert.equal(JSON.parse(storage.getItem(alice)).kind,'cat');assert.equal(JSON.parse(storage.getItem(bob)).kind,'anime');assert.deepEqual(f.calls,[]);
  assert.equal(new Set(['user:server-a:alice','user:server-a:bob','user:server-b:alice','guest:https://server-a'].map(capability.companionCatStorageKey)).size,4);
});

test('actual legacy setters cannot activate cat or send a new cat selection to the backend',async()=>{
  const f=preferenceFixture();await f.preference.hydrateCompanion('cat');
  const[,setEnabled]=f.preference.useCompanionCatEnabled();setEnabled(true);
  assert.equal(f.preference.readCompanionCatEnabled(),false);assert.equal(f.preference.readCompanion(),'anime');
  await f.preference.chooseCompanion('cat');assert.deepEqual(f.calls,[{companionKind:'anime'}]);assert.equal(f.preference.readCompanion(),'anime');
  await assert.rejects(()=>f.preference.chooseCompanion('invalid'),/invalid/);assert.deepEqual(f.calls,[{companionKind:'anime'}]);
});

test('actual passive renderer ignores stale shared publication and native cat URL',async()=>{
  const storage=disk();storage.setItem(capability.COMPANION_DISPLAY_KEY,'{"version":3,"kind":"cat","catEnabled":true}');
  const f=preferenceFixture({storage,href:'https://appassets.androidplatform.net/assets/public/index.html?overlay=1&avatar=cat'});
  await f.preference.hydrateCompanion('cat');assert.equal(f.preference.readCompanion(),'anime');
  assert.equal(JSON.parse(storage.getItem(capability.COMPANION_DISPLAY_KEY)).kind,'cat','Passive renderer must not overwrite another window publication.');
});

test('native overlay requests always use anime, including old callers requesting cat',async()=>{
  const calls=[],module={exports:{}};
  vm.runInNewContext(overlaySource,{module,exports:module.exports,require:name=>{assert.equal(name,'@capacitor/core');return{registerPlugin:()=>({showPet:async options=>{calls.push(options.companionKind);return options;}})};}});
  for(const options of [undefined,{companionKind:'cat'},{companionKind:'anime'}])await module.exports.showPet(options);
  assert.deepEqual(calls,['anime','anime','anime']);
});
