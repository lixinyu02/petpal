import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { createCompanionGestures } from '../src/pet/interaction.mjs';

const source = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('main.cjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function smokeFunction(name, environment) {
  const declaration = parsed.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(declaration, `Missing ${name}`);
  const context = vm.createContext(environment);
  vm.runInContext(declaration.getText(parsed), context);
  return context[name];
}

test('desktop release smoke requires a live native Cubism V12 model and rejects fallback', async () => {
  async function inspect({ renderer = 'cubism', native = true, moc = true, displayKind = 'anime', displayCatEnabled = false, legacyKind = null } = {}) {
    let time = 0;
    const canvas = {
      dataset: { avatarRenderer: renderer, petCount: '1', renderFrames: '12', mocVersion: '5', coreVersion: '6', blinkLeft: '0.25' },
      getAttribute: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 300, width: 200, height: 300 }),
      getContext: () => ({ isContextLost: () => false, getParameter: () => 'WebGL' }),
    };
    const win = { webContents: { executeJavaScript: code => vm.runInNewContext(code, {
      document: { hidden: false, querySelectorAll: () => [canvas], querySelector: selector => selector.startsWith('.cubism-scene') ? native : true },
      performance: { getEntriesByType: () => moc ? [{ name: 'http://localhost/avatars/akari-cubism-v12/akari.moc3' }] : [] },
      localStorage: { getItem: key => key === 'petpal.displayCompanion' ? JSON.stringify({ version: 3, kind: displayKind, catEnabled: displayCatEnabled }) : key === 'petpal.companionKind' ? legacyKind : null },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }), URL,
      innerWidth: 400, innerHeight: 600, devicePixelRatio: 1, Date: { now: () => time },
      setTimeout: callback => { time += 26000; callback(); },
    }) } };
    return smokeFunction('inspectAvatarWindow', {})(win, true);
  }
  const ready = await inspect();
  assert.equal(ready.renderer, 'cubism');
  assert.equal(ready.cubismModel, 'akari-cubism-v12');
  assert.equal(ready.blink, '0.25');
  assert.equal((await inspect({ legacyKind: 'cat' })).kind, 'anime', 'legacy raw choice cannot revive a retired renderer');
  for (const setup of [{ renderer: 'mesh2d' }, { renderer: 'three3d' }, { native: false }, { moc: false }, { displayKind: 'cat' }, {displayCatEnabled:true}, {displayCatEnabled:null}]) {
    await assert.rejects(inspect(setup), /did not become ready/);
  }
});

test('desktop smoke rejects retired controls even when their DOM elements are hidden', async () => {
  let choice = false, capability = false;
  const mainWindow = {webContents:{executeJavaScript:code=>vm.runInNewContext(code,{document:{
    querySelectorAll:()=>choice?[{textContent:'3D 小猫',getClientRects:()=>[]}]:[],
    querySelector:()=>capability?{}:null,
  }})}};
  const inspect=smokeFunction('inspectSmokeRetiredCompanionControls',{mainWindow});
  assert.equal((await inspect()).choiceAbsent,true);
  choice=true;await assert.rejects(inspect(),/Retired companion controls/);
  choice=false;capability=true;await assert.rejects(inspect(),/Retired companion controls/);
});

test('legacy native smoke fixture refuses ordinary app profiles before reading or changing preferences', async () => {
  let reads=0;
  const inspect=smokeFunction('inspectSmokeLegacyCompanionFallback',{
    process:{argv:['PetPal.exe'],env:{}},snapshotSmokeRawCompanionPreference:()=>{reads++;},
  });
  await assert.rejects(inspect(),/isolated smoke profile/);
  assert.equal(reads,0);
});

test('isolated legacy companion smoke restores its private fixture even if native rendering fails', async () => {
  const settings=[],windows=[];let serverKind='anime',inspections=0;
  for(const original of ['anime',null]){
    const data=new Map(original===null?[]:[['petpal.companionKind',original]]);
    const localStorage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
    windows.push({data,original,urls:[],async loadURL(url){this.urls.push(url);},webContents:{executeJavaScript:code=>vm.runInNewContext(code,{localStorage})}});
  }
  const inspect=smokeFunction('inspectSmokeLegacyCompanionFallback',{
    process:{argv:['PetPal.exe','--smoke-test'],env:{PETPAL_SMOKE_PROFILE:'isolated-fixture'}},
    origin:'http://localhost',backend:{token:'fixture-only'},mainWindow:windows[0],petWindow:windows[1],
    snapshotSmokeRawCompanionPreference:async()=>({serverKind}),
    fetch:async(_url,request)=>{serverKind=JSON.parse(request.body).companionKind;settings.push(serverKind);return{ok:true};},
    inspectSmokeAvatarPair:async()=>{inspections++;if(inspections===1)throw Error('Native model failed in fixture');return{};},
  });
  await assert.rejects(inspect(),/Native model failed in fixture/);
  assert.deepEqual(settings,['cat','anime']);assert.equal(serverKind,'anime');assert.equal(inspections,2);
  for(const win of windows)assert.equal(win.data.get('petpal.companionKind')??null,win.original);
  assert.deepEqual(windows[0].urls,['http://localhost','http://localhost']);
  assert.deepEqual(windows[1].urls,['http://localhost/?pet=1&avatar=cat','http://localhost/?pet=1']);
});

function gestureHarness() {
  let time = 0, action = 'idle', sequence = 0;
  const timers = new Map(), emitted = [], inputs = [], pauses = [];
  const gestures = createCompanionGestures({
    emit(next) { emitted.push(next); action = next === 'wake' ? 'idle' : next; },
    getAction: () => action, now: () => time,
    schedule(callback, delay) { const id = ++sequence; timers.set(id, { callback, at: time + delay }); return id; },
    unschedule: id => timers.delete(id),
  });
  function advance(duration) {
    const end = time + duration;
    while (true) {
      const entry = [...timers].filter(([,value]) => value.at <= end).sort((a,b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      time = entry[1].at; timers.delete(entry[0]); entry[1].callback();
    }
    time = end;
  }
  const canvas = { getAttribute: () => null, getBoundingClientRect: () => ({ left: 100, top: 50, width: 200, height: 300 }) };
  const document = { querySelectorAll: () => [canvas] };
  const mainWindow = { show() {}, focus() {}, webContents: {
    executeJavaScript: script => vm.runInNewContext(script, { document, innerWidth: 1180, innerHeight: 800 }),
    sendInputEvent(event) {
      inputs.push(event);
      const point = { id: 1, x: event.x, y: event.y, button: 0, pointerType: 'mouse', isPrimary: true, hit: true };
      if (event.type === 'mouseDown') gestures.down(point);
      if (event.type === 'mouseUp') gestures.up(point);
      if (event.type === 'mouseMove') gestures.move(point);
    },
  } };
  const gesture = smokeFunction('gestureSmokeCharacter', {
    mainWindow,
    setTimeout(callback, duration) { pauses.push(duration); advance(duration); callback(); },
  });
  return { gesture, advance, emitted, inputs, pauses, document };
}

test('native smoke pointer sequence reaches real tap, double-tap, rest and wake behavior', async () => {
  const f = gestureHarness();
  await f.gesture('tap'); f.advance(301); assert.deepEqual(f.emitted, ['pet']);
  await f.gesture('double-tap'); f.advance(301); assert.deepEqual(f.emitted, ['pet','jump']);
  await f.gesture('hold'); f.advance(301); assert.deepEqual(f.emitted, ['pet','jump','sleep']);
  await f.gesture('tap'); f.advance(301); assert.deepEqual(f.emitted, ['pet','jump','sleep','wake']);
  assert.equal(f.inputs.filter(event => event.type === 'mouseDown').length, 5);
  assert.equal(f.inputs.filter(event => event.type === 'mouseUp').length, 5);
  assert.ok(f.pauses.includes(800));
  for (const event of f.inputs) assert.deepEqual({x:event.x,y:event.y}, {x:200,y:236});
});

test('native smoke fails clearly when the interactive character is missing', async () => {
  const f = gestureHarness();
  f.document.querySelectorAll = () => [];
  await assert.rejects(f.gesture('tap'), /Interactive companion is unavailable/);
  await assert.rejects(f.gesture('unknown'), /Unknown smoke gesture/);
  assert.equal(f.inputs.length, 0);
  f.document.querySelectorAll = () => [{ getAttribute: () => null, getBoundingClientRect: () => ({ left: 100, top: 50, width: 200, height: 0 }) }];
  await assert.rejects(f.gesture('tap'), /Interactive companion is unavailable/);
  assert.equal(f.inputs.length, 0, 'a zero-height scene cannot count as a real character interaction');
});

test('native app smoke feeds real SSE records through Chat and restores instrumentation on failure', async () => {
  const origin = 'http://127.0.0.1:4318';
  const state = { conversations: [] };
  const nativeFetch = async url => {
    assert.equal(url, `${origin}/api/state`);
    return Response.json(state);
  };
  const originalSpeak = () => {};
  const window = { fetch: nativeFetch, speechSynthesis: { speak: originalSpeak }, petpal: { connection: async () => ({url:origin,token:'fixture'}) } };
  const document = { querySelector: () => null };
  const renderer = vm.createContext({ window, document, speechSynthesis: window.speechSynthesis, location: { href: `${origin}/?chat=1`, origin }, URL, Response, ReadableStream, TextEncoder });
  let calls = 0, fixture, delayedSpeechEvent;
  const mainWindow = { loadURL: async () => {}, show() {}, focus() {}, webContents: {
    async executeJavaScript(script) {
      calls++;
      if (calls === 2) throw new Error('intentional failure after instrumentation');
      const result = await vm.runInContext(script, renderer);
      if (calls === 1) {
        fixture = window.__appFixture;
        await window.fetch(`${origin}/api/conversations`, { method: 'POST', body: JSON.stringify({providerId:'isolated-model'}) });
        fixture.nextReply = '谢谢你。';
        const response = await window.fetch(`${origin}/api/conversations/app-fixture/messages`, { method: 'POST', body: JSON.stringify({content:'原生验收'}) });
        const chunks = []; for await (const bytes of response.body) chunks.push(bytes);
        assert.equal(chunks.length, 1);
        const payload = new TextDecoder().decode(chunks[0]);
        const records = payload.trim().split('\n\n').map(record => {
          const [event, data] = record.split('\n');
          return { event: event.slice(7), data: JSON.parse(data.slice(6)) };
        });
        assert.deepEqual(records.map(record => record.event), ['meta','delta','done']);
        assert.equal(records[1].data.text, '谢谢你。');
        assert.equal(records[2].data.conversation.messages[0].content, '原生验收');
        window.speechSynthesis.speak({ addEventListener(type, callback) { if(type === 'end')delayedSpeechEvent = callback; } });
      }
      return result;
    },
  } };
  const inspect = smokeFunction('inspectAppFixture', {
    origin, backend:{token:'fixture'}, fetch: async () => ({ok:true}), mainWindow,
    expandSmokeAppCompanion: async () => ({expanded:true,clicked:true}), inspectAvatarWindow: async () => ({}), process: {env:{}},
  });
  await assert.rejects(inspect(), /intentional failure after instrumentation/);
  assert.equal(window.fetch, nativeFetch);
  assert.equal(window.speechSynthesis.speak, originalSpeak);
  assert.equal(window.__appFixture, undefined);
  assert.doesNotThrow(() => delayedSpeechEvent({charIndex:3}));
  assert.equal(fixture.speechEvents.at(-1).type, 'end');
});
