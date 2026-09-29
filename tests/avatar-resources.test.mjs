import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAvatarImage, loadAvatarImages } from '../src/avatar/anime-resources.mjs';

test('the body becomes usable before optional images finish and one missing expression does not stop the others', async () => {
  const events = [];
  let unblock;
  const pending = loadAvatarImages({
    load: async name => {
      events.push(`load:${name}`);
      if (name === 'blink') await new Promise(resolve => { unblock = resolve; });
      if (name === 'talk') throw new Error('404');
      return { name };
    },
    onBase: image => events.push(`base:${image.name}`),
    onVariant: image => events.push(`variant:${image.name}`),
    onIssue: name => events.push(`issue:${name}`),
  });
  await Promise.resolve();
  assert.deepEqual(events, ['load:idle', 'base:idle', 'load:blink']);
  unblock(); await pending;
  assert.ok(events.includes('issue:talk'));
  assert.ok(events.includes('variant:round'));
  assert.ok(events.includes('variant:warm'));
  assert.ok(events.includes('variant:sad'));
  assert.ok(events.includes('variant:pout'));
  assert.equal(events.filter(event => event.startsWith('base:')).length, 1);
});

test('missing sad artwork keeps the visible body and all six original textures available', async () => {
  const bases=[],variants=[],issues=[];
  await loadAvatarImages({load:async name=>{if(name==='sad')throw new Error('optional 404');return{name};},onBase:image=>bases.push(image.name),onVariant:image=>variants.push(image.name),onIssue:name=>issues.push(name)});
  assert.deepEqual(bases,['idle']);assert.deepEqual(variants,['blink','talk','round','curious','warm','pout']);assert.deepEqual(issues,['sad']);
});

test('missing pout or both optional portraits keeps the base and original expression images',async()=>{
  for(const missing of [['pout'],['sad','pout']]){
    const bases=[],variants=[],issues=[];
    await loadAvatarImages({load:async name=>{if(missing.includes(name))throw new Error('optional 404');return{name};},onBase:image=>bases.push(image.name),onVariant:image=>variants.push(image.name),onIssue:name=>issues.push(name)});
    assert.deepEqual(bases,['idle']);assert.deepEqual(issues,missing);
    assert.deepEqual(variants,['blink','talk','round','curious','warm',...(missing.includes('sad')?[]:['sad'])]);
  }
});

test('missing idle uses an independent same-character portrait, while total base failure never reports ready', async () => {
  const bases = [], issues = [], variants = [];
  await loadAvatarImages({
    load: async name => { if (name === 'idle') throw new Error('404'); return { name }; },
    onBase: image => bases.push(image.name), onVariant: image => variants.push(image.name), onIssue: name => issues.push(name),
  });
  assert.deepEqual(bases, ['warm']); assert.deepEqual(issues, ['idle']);
  assert.ok(!variants.includes('warm'));
  let called = false;
  await loadAvatarImages({ load: async () => { throw new Error('offline'); }, onBase: () => { called = true; }, onVariant: () => { called = true; }, onIssue: () => {} });
  assert.equal(called, false);
});

test('unmount or retry drops a late image and schedules no further requests', async () => {
  let stopped = false, unblock;
  const calls = [];
  const pending = loadAvatarImages({
    load: name => { calls.push(name); return new Promise(resolve => { unblock = resolve; }); },
    onBase: () => assert.fail('late base callback'), onVariant: () => assert.fail('late expression callback'),
    onIssue: () => assert.fail('late failure callback'), isStopped: () => stopped,
  });
  stopped = true; unblock({}); await pending;
  assert.deepEqual(calls, ['idle']);
});

test('image requests time out, cancel cleanly, and a new attempt can succeed', async t => {
  const images = [];
  class TestImage {
    naturalWidth = 1024; naturalHeight = 1536;
    onload = null; onerror = null; src = '';
    constructor() { images.push(this); }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: TestImage });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'Image', previous); else delete globalThis.Image; });
  await assert.rejects(loadAvatarImage('idle', { timeoutMs: 5 }), /timed out/);
  assert.equal(images[0].src, ''); assert.equal(images[0].onload, null);
  const controller = new AbortController();
  const pending = loadAvatarImage('blink', { signal: controller.signal });
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(images[1].src, ''); assert.equal(images[1].onerror, null);
  const retry = loadAvatarImage('idle');
  assert.equal(images[2].src, '/avatars/akari/idle.png');
  images[2].onload(); assert.equal(await retry, images[2]);
  assert.equal(images[2].onload, null);
});
