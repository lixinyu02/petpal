import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.transpileModule(await readFile(new URL('../src/platform/useAndroidScreen.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({native=true,platform='android',setAppearance=async()=>({nativeInsets:true})}={}){
  let state={theme:'day',preference:'day'},effect,deps;const calls=[],document=new EventTarget(),window=new EventTarget(),module={exports:{}};
  document.visibilityState='visible';document.documentElement={dataset:{}};
  const modules={react:{useEffect(fn,next){effect=fn;deps=next;}},'@capacitor/core':{Capacitor:{isNativePlatform:()=>native,getPlatform:()=>platform},registerPlugin:()=>({setAppearance(input){calls.push(input);return setAppearance(input);}})},'./theme.ts':{useTheme:()=>state}};
  vm.runInNewContext(source,{module,exports:module.exports,require:name=>modules[name],window,document});
  return{calls,document,render(next=state,disabled=false){state=next;module.exports.useAndroidScreen(disabled);return{deps,cleanup:effect()};}};
}
test('Android sends preference changes even when day and auto have the same current color',async()=>{
  const f=fixture(),first=f.render();await tick();first.cleanup();const second=f.render({theme:'day',preference:'auto'});await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[{theme:'day',preference:'day'},{theme:'day',preference:'auto'}]);
  assert.ok(second.deps.includes('auto'));assert.equal(f.document.documentElement.dataset.nativeInsets,'true');second.cleanup();
});
test('older Android clients receive a compatible theme-only retry',async()=>{
  const f=fixture({setAppearance:async input=>{if(input.preference)throw Error('older native schema');return{nativeInsets:true};}}),entry=f.render({theme:'night',preference:'night'});await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[{theme:'night',preference:'night'},{theme:'night'}]);entry.cleanup();
});
test('a delayed rejected old request cannot apply its compatibility fallback after a newer theme',async()=>{
  let reject;const pending=new Promise((_,no)=>{reject=no;});
  const f=fixture({setAppearance:input=>input.theme==='day'?pending:Promise.resolve({nativeInsets:false})}),first=f.render();first.cleanup();const second=f.render({theme:'night',preference:'night'});reject(Error('old rejection'));await tick();
  assert.equal(f.calls.length,2);assert.equal(f.document.documentElement.dataset.nativeInsets,'false');second.cleanup();
});
test('web, non-Android and disabled overlay entries do not call the appearance bridge',async()=>{
  for(const options of [{native:false},{platform:'ios'},{}]){
    const f=fixture(options),entry=f.render(undefined,!Object.keys(options).length);await tick();assert.equal(f.calls.length,0);entry.cleanup?.();
  }
});
