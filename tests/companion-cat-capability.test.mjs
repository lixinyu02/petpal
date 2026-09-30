import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPANION_DISPLAY_KEY, companionCatStorageKey, effectiveCompanionKind,
  companionDisplayRecord, readCompanionDisplay, resolveCompanionDisplay,
  createCompanionCatCapability, isExplicitNativeCatOverlay,
} from '../src/avatar/cat-capability.mjs';
import {createCompanionPreference} from '../src/avatar/preference-store.mjs';

const disk=()=>{
  const values=new Map();
  return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
};

test('legacy, local and server cat preferences stay raw while every unconfigured scope displays anime',async()=>{
  const storage=disk();storage.setItem('petpal.companionKind','cat');
  const preference=createCompanionPreference({storage,scope:'user:server-a:alice'});
  await preference.hydrate('cat');
  const capability=createCompanionCatCapability({storage,scope:'user:server-a:alice'});
  assert.equal(capability.snapshot(),false);assert.equal(preference.snapshot().kind,'cat');
  assert.equal(effectiveCompanionKind(preference.snapshot().kind,capability.snapshot()),'anime');
  assert.equal(storage.getItem('petpal.companionKind'),'cat');
  assert.equal(JSON.parse(storage.getItem('petpal.companionPreference:user%3Aserver-a%3Aalice')).kind,'cat');
  assert.equal(storage.getItem(companionCatStorageKey('user:server-a:alice')),null);
});

test('explicit enable and disable immediately change only the local capability and retain previous selection',async()=>{
  const storage=disk(),calls=[];
  const preference=createCompanionPreference({storage,scope:'alice',connected:()=>true,persist:async kind=>calls.push(kind)});
  await preference.hydrate('cat');
  const capability=createCompanionCatCapability({storage,scope:'alice'}),seen=[];
  capability.subscribe(()=>seen.push(effectiveCompanionKind(preference.snapshot().kind,capability.snapshot())));
  capability.setEnabled(true);capability.setEnabled(false);
  assert.deepEqual(seen,['cat','anime']);assert.deepEqual(calls,[]);
  assert.equal(preference.snapshot().kind,'cat');assert.equal(preference.snapshot().dirty,false);
  assert.equal(createCompanionCatCapability({storage,scope:'alice'}).snapshot(),false);
  capability.setEnabled(true);
  assert.equal(createCompanionCatCapability({storage,scope:'alice'}).snapshot(),true);
});

test('account, server and guest capabilities have independent keys with no legacy inheritance',()=>{
  const storage=disk(),scopes=['user:server-a:alice','user:server-a:bob','user:server-b:alice','guest:https://server-a'];
  const capabilities=scopes.map(scope=>createCompanionCatCapability({storage,scope}));
  capabilities[0].setEnabled(true);
  for(const capability of capabilities)capability.refresh();
  assert.deepEqual(capabilities.map(capability=>capability.snapshot()),[true,false,false,false]);
  assert.equal(new Set(scopes.map(companionCatStorageKey)).size,scopes.length);
});

test('cross-window refresh accepts only this scope and clears on removal or storage.clear',()=>{
  const storage=disk(),key=companionCatStorageKey('alice');
  const alice=createCompanionCatCapability({storage,scope:'alice'}),bob=createCompanionCatCapability({storage,scope:'bob'});
  storage.setItem(key,JSON.stringify({enabled:true}));alice.storageChanged(key);bob.storageChanged(key);
  assert.equal(alice.snapshot(),true);assert.equal(bob.snapshot(),false);
  storage.setItem(companionCatStorageKey('bob'),JSON.stringify({enabled:true}));
  alice.storageChanged(companionCatStorageKey('bob'));assert.equal(alice.snapshot(),true);
  storage.removeItem(key);alice.storageChanged(key);assert.equal(alice.snapshot(),false);
  alice.setEnabled(true);storage.removeItem(key);alice.storageChanged(null);assert.equal(alice.snapshot(),false);
});

test('invalid records and nonboolean values fail closed without inheriting an old enabled value',()=>{
  const storage=disk(),key=companionCatStorageKey('alice');
  const capability=createCompanionCatCapability({storage,scope:'alice'});
  for(const raw of ['invalid','null','[]','{}','{"enabled":"true"}','{"enabled":1}','x'.repeat(257)]){
    capability.setEnabled(true);storage.setItem(key,raw);capability.refresh();assert.equal(capability.snapshot(),false,raw);
  }
  for(const value of ['true',1,null,{}])assert.throws(()=>capability.setEnabled(value),/boolean/);
});

test('denied storage keeps an explicit choice in memory while disposal blocks old-scope changes and callbacks',()=>{
  const blocked={getItem(){throw new Error('denied');},setItem(){throw new Error('denied');}};
  const capability=createCompanionCatCapability({storage:blocked,scope:'old'}),seen=[];
  capability.subscribe(()=>seen.push(capability.snapshot()));
  assert.equal(capability.snapshot(),false);capability.setEnabled(true);capability.refresh();assert.equal(capability.snapshot(),true);
  capability.dispose();capability.setEnabled(false);capability.storageChanged(null);
  assert.equal(capability.snapshot(),true);assert.deepEqual(seen,[true]);
  assert.equal(createCompanionCatCapability({storage:blocked,scope:'new'}).snapshot(),false);
  const absent=createCompanionCatCapability({scope:'no-storage'});absent.setEnabled(true);absent.refresh();assert.equal(absent.snapshot(),true);
});

test('public display publication is effective and cannot expose an old raw cat when disabled',()=>{
  const record=JSON.parse(companionDisplayRecord('cat',false));
  assert.deepEqual(record,{version:2,kind:'anime',catEnabled:false});
  assert.equal(COMPANION_DISPLAY_KEY,'petpal.displayCompanion');
  for(const raw of [undefined,'invalid','null','{"kind":"cat"}','{"version":2,"kind":"cat","catEnabled":"true"}']){
    assert.deepEqual(readCompanionDisplay(raw),{kind:'anime',catEnabled:false});
    assert.equal(resolveCompanionDisplay({floating:true,search:'?pet=1&avatar=cat',displayRaw:raw}),'anime');
  }
});

test('floating and ordinary overlay queries follow only a current explicit displayed cat and react to disabling',()=>{
  for(const search of ['?pet=1','?pet=1&avatar=cat','?overlay=1&avatar=cat']){
    assert.equal(resolveCompanionDisplay({search,floating:search.includes('pet='),displayRaw:companionDisplayRecord('cat',true)}),'cat');
    assert.equal(resolveCompanionDisplay({search,floating:search.includes('pet='),displayRaw:companionDisplayRecord('cat',false)}),'anime');
    assert.equal(resolveCompanionDisplay({search,floating:search.includes('pet='),displayRaw:companionDisplayRecord('anime',true)}),'anime');
  }
  assert.equal(resolveCompanionDisplay({kind:'cat',catEnabled:false,search:'?chat=1&avatar=cat'}),'anime');
  assert.equal(resolveCompanionDisplay({kind:'cat',catEnabled:true,search:'?chat=1&avatar=anime'}),'cat');
});

test('only the existing exact Android asset URL conveys native explicit cat intent without a shared storage origin',()=>{
  const href='https://appassets.androidplatform.net/assets/public/index.html?overlay=1&avatar=cat';
  assert.equal(isExplicitNativeCatOverlay(href),true);
  assert.equal(resolveCompanionDisplay({search:'?overlay=1&avatar=cat',href}),'cat');
  for(const invalid of [
    'https://example.com/assets/public/index.html?overlay=1&avatar=cat',
    'http://appassets.androidplatform.net/assets/public/index.html?overlay=1&avatar=cat',
    href+'&other=1',href+'#old','https://appassets.androidplatform.net/?overlay=1&avatar=cat',
    'https://appassets.androidplatform.net/assets/public/index.html?avatar=cat',
    'https://appassets.androidplatform.net/assets/public/index.html?overlay=1&avatar=anime',
    'https://user:pass@appassets.androidplatform.net/assets/public/index.html?overlay=1&avatar=cat',
  ]){
    assert.equal(isExplicitNativeCatOverlay(invalid),false,invalid);
    assert.equal(resolveCompanionDisplay({search:'?overlay=1&avatar=cat',href:invalid}),'anime');
  }
});
