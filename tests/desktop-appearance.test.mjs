import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';

const {createAppearance,createAppearanceHandlers,appearanceArguments,effectiveTheme,COLORS}=createRequire(import.meta.url)('../desktop/appearance.cjs');
const at=(hour,minute=0)=>new Date(2026,9,21,hour,minute,0,0);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
async function fixture(t,{selected,failRename=false}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'petpal-appearance-'));
  const file=path.join(directory,'appearance.json');
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  if(selected!==undefined)await fs.writeFile(file,typeof selected==='string'?selected:JSON.stringify(selected));
  let date=at(12),source='system',timerId=0;
  const timers=new Map(),nativeChanges=[],events=[];
  const nativeTheme={get themeSource(){return source;},set themeSource(value){source=value;nativeChanges.push(value);}};
  const injectedFs={...fs,rename:async(...args)=>{if(failRename)throw Error('fixture-private-path');return fs.rename(...args);}};
  const options={app:{getPath:name=>{assert.equal(name,'userData');return directory;}},nativeTheme,fs:injectedFs,now:()=>date,
    setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id),onChanged:value=>events.push(value)};
  const manager=createAppearance(options);
  t.after(()=>manager.close());
  return{directory,file,manager,options,nativeTheme,nativeChanges,events,timers,setDate:value=>{date=value;},tick(){const [id,timer]=timers.entries().next().value;timers.delete(id);timer.callback();}};
}

test('missing native appearance applies the pale default without creating a file or following OS dark mode',async t=>{
  const f=await fixture(t);await f.manager.load();
  assert.deepEqual(f.manager.current(),{preference:'day',theme:'day',saved:false});
  assert.equal(f.nativeTheme.themeSource,'light');assert.deepEqual(await fs.readdir(f.directory),[]);
  assert.equal(COLORS.day,'#fafbf8');assert.equal(f.timers.size,0);
});

test('theme saves atomically in a fixed native store and survives a different renderer origin and manager restart',async t=>{
  const f=await fixture(t);await f.manager.load();await f.manager.setPreference('night');
  assert.equal(f.nativeTheme.themeSource,'dark');assert.deepEqual(JSON.parse(await fs.readFile(f.file,'utf8')),{version:1,preference:'night'});
  assert.deepEqual(await fs.readdir(f.directory),['appearance.json']);
  await f.manager.close();const restarted=createAppearance(f.options);t.after(()=>restarted.close());
  assert.deepEqual(await restarted.load(),{preference:'night',theme:'night',saved:true});
  assert.equal(appearanceArguments(restarted.current())[0],'--petpal-appearance=night:night:1');
  assert.equal(Object.isFrozen(restarted.current()),true);
});

test('native auto preserves the 07:00-19:00 clock schedule while the renderer is hidden',async t=>{
  const f=await fixture(t);f.setDate(at(6,59));await f.manager.load();await f.manager.setPreference('auto');
  assert.equal(f.nativeTheme.themeSource,'dark');assert.equal(f.timers.size,1);
  assert.ok([...f.timers.values()][0].delay<=60000);
  f.setDate(at(7));f.tick();assert.equal(f.nativeTheme.themeSource,'light');
  f.setDate(at(19));f.tick();assert.equal(f.nativeTheme.themeSource,'dark');
  f.nativeTheme.themeSource='light';f.manager.refresh();
  // No system source was ever selected; manual mode and auto use our effective theme.
  assert.equal(f.nativeChanges.includes('system'),false);
  await f.manager.setPreference('day');assert.equal(f.timers.size,0);assert.equal(f.nativeTheme.themeSource,'light');
  await f.manager.setPreference('auto');assert.equal(f.timers.size,1);await f.manager.close();assert.equal(f.timers.size,0);
});

test('exact boundary calculation accepts only the three existing preferences',()=>{
  for(const hour of [0,6,19,23])assert.equal(effectiveTheme('auto',at(hour)),'night');
  for(const hour of [7,12,18])assert.equal(effectiveTheme('auto',at(hour)),'day');
  assert.equal(effectiveTheme('night',at(12)),'night');assert.equal(effectiveTheme('day',at(23)),'day');
  for(const value of ['system','dark',null,{},[],42,'file:///private'])assert.throws(()=>effectiveTheme(value),{code:'PETPAL_APPEARANCE_INVALID'});
});

test('damaged, oversized or unsupported records are preserved and an ephemeral choice never claims native persistence',async t=>{
  for(const selected of ['{broken','x'.repeat(1025),{version:2,preference:'night'},{version:1,preference:'night',path:'private'},{version:1,preference:'system'}]){
    const f=await fixture(t,{selected});const original=await fs.readFile(f.file);
    await f.manager.load();assert.deepEqual(f.manager.current(),{preference:'day',theme:'day',saved:false});
    const next=await f.manager.setPreference('night');assert.equal(next.saved,false);assert.equal(next.theme,'night');assert.equal(f.nativeTheme.themeSource,'dark');
    assert.deepEqual(await fs.readFile(f.file),original);assert.deepEqual(await fs.readdir(f.directory),['appearance.json']);
  }
});

test('appearance never replaces a non-regular target',async t=>{
  const f=await fixture(t);await fs.mkdir(f.file);await f.manager.load();
  assert.equal((await f.manager.setPreference('night')).saved,false);assert.equal((await fs.lstat(f.file)).isDirectory(),true);
  // Directory targets exercise the same lstat rejection on Windows without requiring symlink privileges.
});

test('a failed atomic save leaves the exact previous file and no temporary file while applying a truthful session-only appearance',async t=>{
  const f=await fixture(t,{selected:{version:1,preference:'day'},failRename:true});const original=await fs.readFile(f.file);
  await f.manager.load();assert.deepEqual(await f.manager.setPreference('night'),{preference:'night',theme:'night',saved:false});
  assert.deepEqual(await fs.readFile(f.file),original);assert.deepEqual(await fs.readdir(f.directory),['appearance.json']);
});

test('concurrent native preference updates serialize and the last submitted choice survives restart',async t=>{
  const f=await fixture(t);await f.manager.load();
  const results=await Promise.all([f.manager.setPreference('night'),f.manager.setPreference('auto'),f.manager.setPreference('day')]);
  assert.deepEqual(results.map(value=>value.preference),['night','auto','day']);assert.equal(f.manager.current().preference,'day');
  assert.deepEqual(JSON.parse(await fs.readFile(f.file,'utf8')),{version:1,preference:'day'});
});

test('queued writes recheck foreground ownership before persistence and never apply a rejected request',async t=>{
  const f=await fixture(t);await f.manager.load();
  const enter=deferred(),release=deferred();let foreground=true,calls=0;
  const pending=f.manager.setPreference('night',{authorize:async()=>{if(++calls===1){enter.resolve();await release.promise;}if(!foreground)throw Object.assign(Error('controlled'),{code:'PETPAL_APPEARANCE_BACKGROUND'});}});
  await enter.promise;foreground=false;release.resolve();await assert.rejects(pending,{code:'PETPAL_APPEARANCE_BACKGROUND'});
  assert.deepEqual(await fs.readdir(f.directory),[]);assert.equal(f.nativeTheme.themeSource,'light');
});

test('closing prevents queued saves and waits until their cleanup finishes',async t=>{
  const f=await fixture(t);await f.manager.load();const enter=deferred(),release=deferred();
  const pending=f.manager.setPreference('night',{authorize:async()=>{enter.resolve();await release.promise;}});await enter.promise;
  const rejected=assert.rejects(pending,{code:'PETPAL_APPEARANCE_CLOSING'}),closed=f.manager.close();release.resolve();await rejected;await closed;
  assert.deepEqual(await fs.readdir(f.directory),[]);await assert.rejects(f.manager.setPreference('day'),{code:'PETPAL_APPEARANCE_CLOSING'});
});

test('appearance IPC is a fixed enum-only facade and only a trusted foreground main window can write',async()=>{
  let trusted=true,foreground=false;const event={},calls=[];
  const manager={refresh:()=>({preference:'day',theme:'day',saved:false,privatePath:'/private'}),async setPreference(value,{authorize}){await authorize();calls.push(value);return{preference:value,theme:value,saved:true,privatePath:'/private'};}};
  const handlers=createAppearanceHandlers(manager,{isAllowed:sender=>sender===event&&trusted,isForeground:()=>foreground});
  assert.deepEqual(Object.keys(handlers).sort(),['petpal:appearance:set-preference','petpal:appearance:status']);
  assert.deepEqual(await handlers['petpal:appearance:status'](event),{preference:'day',theme:'day',saved:false});
  await assert.rejects(handlers['petpal:appearance:set-preference'](event,'night'),{code:'PETPAL_APPEARANCE_BACKGROUND'});assert.deepEqual(calls,[]);
  foreground=true;assert.deepEqual(await handlers['petpal:appearance:set-preference'](event,'night'),{preference:'night',theme:'night',saved:true});
  for(const selected of [{preference:'night',file:'/private'},null,'system','dark',[]])await assert.rejects(handlers['petpal:appearance:set-preference'](event,selected),{code:'PETPAL_APPEARANCE_INVALID'});
  trusted=false;await assert.rejects(handlers['petpal:appearance:status'](event),{code:'PETPAL_APPEARANCE_UNTRUSTED'});
});

test('unexpected native exceptions do not expose private runtime details across the appearance bridge',async()=>{
  const privateMessage='fixture-private-runtime-file-and-token';
  const handlers=createAppearanceHandlers({refresh(){throw Error(privateMessage);},async setPreference(){throw Error(privateMessage);}},{isAllowed:()=>true,isForeground:()=>true});
  for(const [name,args] of [['petpal:appearance:status',[]],['petpal:appearance:set-preference',['night']]])await assert.rejects(handlers[name]({},...args),error=>error.code==='PETPAL_APPEARANCE_UNAVAILABLE'&&!error.message.includes(privateMessage));
});

test('production Electron IPC wiring rejects other origins, subframes, other windows, background writes and shutdown',async()=>{
  const source=await fs.readFile(new URL('../desktop/main.cjs',import.meta.url),'utf8');
  const parsed=ts.createSourceFile('main.cjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const trusted=parsed.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='isTrusted');
  const boot=parsed.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='boot');
  const registration=boot.body.statements.find(node=>ts.isForOfStatement(node)&&node.getText(parsed).includes('createAppearanceHandlers'));
  assert.ok(trusted);assert.ok(registration);
  const origin='http://127.0.0.1:43891',frame={url:origin},contents={mainFrame:frame},calls=[],handlers={};let visible=true,focused=true;
  const mainWindow={webContents:contents,isDestroyed:()=>false,isVisible:()=>visible,isFocused:()=>focused};
  const appearance={refresh:()=>({preference:'day',theme:'day',saved:false}),async setPreference(selected,{authorize}){await authorize();calls.push(selected);return{preference:selected,theme:selected,saved:true};}};
  const context=vm.createContext({URL,origin,mainWindow,petWindow:null,quitting:false,appearance,createAppearanceHandlers,
    BrowserWindow:{fromWebContents:value=>value===contents?mainWindow:null},ipcMain:{handle:(channel,handler)=>{handlers[channel]=handler;}}});
  vm.runInContext(`${trusted.getText(parsed)}\n${registration.getText(parsed)}`,context);
  const event={sender:contents,senderFrame:frame},set=handlers['petpal:appearance:set-preference'];
  assert.equal((await handlers['petpal:appearance:status'](event)).theme,'day');await set(event,'night');assert.deepEqual(calls,['night']);
  for(const rejected of [{sender:{},senderFrame:frame},{sender:contents,senderFrame:{url:origin}},{sender:contents,senderFrame:{url:'https://outside.example'}}])await assert.rejects(set(rejected,'night'),{code:'PETPAL_APPEARANCE_UNTRUSTED'});
  frame.url='https://outside.example';await assert.rejects(set(event,'night'),{code:'PETPAL_APPEARANCE_UNTRUSTED'});frame.url=origin;
  for(const scenario of ['hidden','unfocused']){visible=scenario!=='hidden';focused=scenario!=='unfocused';assert.equal((await handlers['petpal:appearance:status'](event)).theme,'day');await assert.rejects(set(event,'night'),{code:'PETPAL_APPEARANCE_BACKGROUND'});}
  visible=focused=true;context.quitting=true;await assert.rejects(set(event,'night'),{code:'PETPAL_APPEARANCE_UNTRUSTED'});assert.deepEqual(calls,['night']);
});

test('the real preload exposes a validated immutable startup seed before any network or storage read',async()=>{
  const source=await fs.readFile(new URL('../desktop/preload.cjs',import.meta.url),'utf8');
  function preload(args){let bridge;const calls=[];
    vm.runInNewContext(source,{process:{argv:args,platform:'win32',arch:'x64'},require:name=>{assert.equal(name,'electron');return{contextBridge:{exposeInMainWorld(_name,value){bridge=value;}},ipcRenderer:{invoke:async(...input)=>{calls.push(input);return{preference:'night',theme:'night',saved:true};}}};},sessionStorage:{getItem(){assert.fail('Appearance must not read a login token');}}});
    return{bridge,calls};
  }
  const f=preload(['electron','--petpal-appearance=auto:night:1']);assert.deepEqual(JSON.parse(JSON.stringify(f.bridge.appearance.initial)),{preference:'auto',theme:'night',saved:true});assert.equal(Object.isFrozen(f.bridge.appearance.initial),true);assert.deepEqual(f.calls,[]);
  const sessionId='12345678-1234-1234-1234-123456789abc';
  const seeded=preload(appearanceArguments({preference:'night',theme:'night',saved:true},sessionId));
  assert.equal(seeded.bridge.appearance.initial.sessionId,sessionId);
  await f.bridge.appearance.setPreference('night');await f.bridge.appearance.status();assert.deepEqual(f.calls,[['petpal:appearance:set-preference','night'],['petpal:appearance:status']]);
  const count=f.calls.length;for(const input of ['system',{preference:'night'},null])await assert.rejects(f.bridge.appearance.setPreference(input));assert.equal(f.calls.length,count);
  for(const args of [[],['--petpal-appearance=night:night:1','--petpal-appearance=day:day:1'],['--petpal-appearance=dark:night:1'],['--petpal-appearance=day:night:1'],['--petpal-appearance=file:///private']])assert.deepEqual(JSON.parse(JSON.stringify(preload(args).bridge.appearance.initial)),{preference:'day',theme:'day',saved:false});
});
