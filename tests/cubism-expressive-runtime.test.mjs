import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { acquireCubismFramework, createCubismFrameController, loadCubismMotionAssets, waitForCubismCore } from '../src/avatar/cubism/runtime.mjs';
import { createCubismParameterBridge, cubismParameterTargets } from '../src/avatar/cubism/parameters.mjs';

const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const close = (actual, expected, label = '') => assert.ok(Math.abs(actual - expected) < 1e-5, `${label}: ${actual} != ${expected}`);
const assets = new Map();
let framework, lease, previousCore;

before(async () => {
  const source = await fs.readFile(new URL('../public/vendor/live2d/live2dcubismcore.min.js', import.meta.url), 'utf8');
  const sandbox = { console, setTimeout, clearTimeout, TextDecoder, TextEncoder, atob, btoa, window: {}, document: { currentScript: { src: 'https://petpal.test/vendor/live2d/live2dcubismcore.min.js' } } };
  vm.runInNewContext(source, sandbox, { timeout: 2000 });
  const core = await waitForCubismCore(() => sandbox.Live2DCubismCore);
  previousCore = globalThis.Live2DCubismCore; globalThis.Live2DCubismCore = core;
  framework = await import('../public/avatars/cubism-runtime/framework.mjs');
  lease = acquireCubismFramework(framework, core);
  for (const version of ['v8', 'v9']) {
    const root = new URL(`../public/avatars/akari-cubism-${version}/`, import.meta.url);
    const bytes = buffer(await fs.readFile(new URL('akari.model3.json', root)));
    const manifest = JSON.parse(new TextDecoder().decode(bytes));
    const setting = new framework.CubismModelSettingJson(bytes, bytes.byteLength);
    const moc = buffer(await fs.readFile(new URL(manifest.FileReferences.Moc, root)));
    assert.equal(framework.CubismMoc.hasMocConsistency(moc), true);
    const motions = [];
    for (const [group, entries] of Object.entries(manifest.FileReferences.Motions)) for (const [index, entry] of entries.entries()) {
      const content = buffer(await fs.readFile(new URL(entry.File, root)));
      motions.push({ group, index, bytes: content, json: JSON.parse(new TextDecoder().decode(content)) });
    }
    assets.set(version, { setting, moc, motions });
  }
});

after(() => {
  lease?.release();
  if (previousCore === undefined) delete globalThis.Live2DCubismCore;
  else globalThis.Live2DCubismCore = previousCore;
});

function rig(t, version = 'v9') {
  const asset = assets.get(version);
  const avatar = new framework.CubismUserModel(); avatar.loadModel(asset.moc, true); t.after(() => avatar.release());
  const model = avatar.getModel(), motions = new Map();
  for (const { group, index, bytes, json } of asset.motions) {
    const name = `${group}_${index}`;
    const motion = avatar.loadMotion(bytes, bytes.byteLength, name, undefined, undefined, asset.setting, group, index, true);
    motion.setEffectIds([], []);
    motions.set(name, { motion, parameters: new Set(json.Curves.filter(curve => curve.Target === 'Parameter').map(curve => curve.Id)) });
  }
  const bridge = createCubismParameterBridge(model, framework.CubismFramework.getIdManager());
  const controller = createCubismFrameController({ model, avatar, bridge, motions, deformationProfile: 'reference-layered' });
  const tick = (seconds, pose = {}, options = {}, follow = {}) => {
    for (let frame = 0; frame < Math.round(seconds * 60); frame++) controller.update(1 / 60, pose, follow, options);
  };
  return { avatar, model, controller, bridge, tick, read: name => bridge.read(name) };
}

test('seven expressive native motion groups follow semantic intent once and keep the real rig finite', t => {
  for (const [gesture, expression, group] of [
    ['tilt', 'curious', 'Curious'], ['tilt', 'thoughtful', 'Think'], ['shrug', 'neutral', 'Think'],
    ['leanIn', 'expectant', 'Listen'], ['recoil', 'surprised', 'Surprise'], ['settle', 'tender', 'Reassure'],
    ['peek', 'curious', 'Curious'], ['wink', 'playful', 'Wink'], ['doze', 'sleepy', 'Doze'],
  ]) {
    const value = rig(t), pose = { gesture, expression, gestureCueId: 'cue-1' };
    value.controller.update(.1, pose);
    assert.equal(value.controller.motionGroup, group);
    const amplitudes = [];
    for (let frame = 0; frame < 3 * 60; frame++) {
      value.controller.update(1 / 60, pose);
      amplitudes.push(Math.max(...['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamHandsLift', 'ParamHandsSway'].map(name => Math.abs(value.read(name)))));
      for (const vertices of value.model.getModel().drawables.vertexPositions) assert.ok(Array.from(vertices).every(Number.isFinite));
    }
    assert.ok(Math.max(...amplitudes) > .1, `${group} changes actual rig parameters`);
    assert.equal(value.controller.motionGroup, 'Idle', `${group} should not loop on a stable cue`);
    assert.equal(value.model.getParameterCount(), 19, 'must never invent Core parameters');
  }
});

test('phase entry changes crossfade, repeated packets do not restart, and withdrawn phase cues settle', t => {
  const value = rig(t);
  const listening = { gesture: 'leanIn', gestureCueId: 'phase-1', expression: 'expectant' };
  value.tick(.5, listening, { phase: 'listening', utteranceId: 'a' });
  assert.equal(value.controller.motionGroup, 'Listen');
  const first = value.avatar._motionManager.getCubismMotionQueueEntries()[0];
  value.tick(.2, listening, { phase: 'listening', utteranceId: 'a' });
  assert.equal(value.avatar._motionManager.getCubismMotionQueueEntries()[0], first);
  const thinking = { gesture: 'tilt', gestureCueId: 'phase-2', expression: 'thoughtful' };
  value.controller.update(0, thinking, {}, { phase: 'thinking', utteranceId: 'b' });
  assert.equal(value.controller.motionGroup, 'Think');
  assert.ok(value.avatar._motionManager.getCubismMotionQueueEntries().length > 1, 'outgoing authored parameters retain their fade');
  value.tick(.5, thinking, { phase: 'thinking', utteranceId: 'b' });
  value.controller.update(0, { gesture: 'none', gestureCueId: '' }, {}, { phase: 'idle', utteranceId: 'b' });
  assert.equal(value.controller.motionGroup, 'Idle');
  value.tick(1, { gesture: 'none' }, { phase: 'idle', utteranceId: 'b' });
  assert.ok(Math.abs(value.read('ParamHandsLift')) < .019);
});

test('same-name fresh cues crossfade on a new reply while stale phase and speech cues are consumed', t => {
  for (const phase of ['thinking', 'speaking']) {
    const value = rig(t), pose = { gesture: 'tilt', expression: 'thoughtful', gestureCueId: 'first' };
    value.tick(.5, pose, { phase, utteranceId: 'a', speechActive: true });
    const first = value.avatar._motionManager.getCubismMotionQueueEntries()[0];
    value.controller.update(0, { ...pose, gestureCueId: 'second' }, {}, { phase, utteranceId: 'b', speechActive: true });
    assert.equal(value.controller.motionGroup, 'Think', 'explicit fresh same-name gesture is not swallowed');
    assert.ok(value.avatar._motionManager.getCubismMotionQueueEntries().some(entry => entry !== first));
    value.tick(.4, { ...pose, gestureCueId: 'second' }, { phase, utteranceId: 'b', speechActive: true });
    value.controller.update(0, { ...pose, gestureCueId: 'second' }, {}, { phase: 'idle', utteranceId: 'c', speechActive: false });
    assert.equal(value.controller.motionGroup, 'Idle', 'previous frame cue cannot restart after cancellation');
    value.tick(1, { ...pose, gestureCueId: 'second' }, { phase: 'idle', utteranceId: 'c', speechActive: false });
    assert.equal(value.controller.motionGroup, 'Idle');
  }
});

test('ASR drafts changing utterance IDs do not restart a single listening or thinking entry', t => {
  for (const [phase, gesture, expression] of [['listening', 'leanIn', 'expectant'], ['thinking', 'tilt', 'thoughtful']]) {
    const value = rig(t), baseline = rig(t);
    const pose = { gesture, expression, gestureCueId: 'one-phase-entry' };
    let first;
    for (let frame = 0; frame < 180; frame++) {
      value.controller.update(1 / 60, pose, {}, { phase, utteranceId: `draft-${frame}` });
      baseline.controller.update(1 / 60, pose, {}, { phase, utteranceId: 'stable-draft' });
      for (const name of ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamHandsLift']) close(value.read(name), baseline.read(name), `${phase}/${name}`);
      const entries = value.avatar._motionManager.getCubismMotionQueueEntries();
      if (!first) first = entries[0];
      if (frame < 60) assert.equal(entries[0], first, 'draft packets must not restart or crossfade the entry motion');
    }
    assert.equal(value.controller.motionGroup, 'Idle');
  }
});

test('manual reactions consume automatic cues and hidden or reduced-mode cues cannot replay on resume', t => {
  const value = rig(t);
  value.controller.react('pet');
  value.tick(.3, { gesture: 'tilt', expression: 'thoughtful', gestureCueId: 'auto' }, { phase: 'thinking', utteranceId: 'a' });
  assert.equal(value.controller.motionGroup, 'TapHead');
  value.tick(3, { gesture: 'tilt', expression: 'thoughtful', gestureCueId: 'auto' }, { phase: 'thinking', utteranceId: 'a' });
  assert.equal(value.controller.motionGroup, 'Idle', 'consumed cue cannot replay when manual motion ends');
  for (const quiet of [{ hidden: true }, { reducedMotion: true }, { sleeping: true }]) {
    const pose = { gesture: 'wink', expression: 'playful', gestureCueId: `muted-${Object.keys(quiet)[0]}`, speaking: true, mouthOpen: .6 };
    value.controller.update(.1, pose, {}, { phase: 'speaking', utteranceId: 'b', speechActive: true, ...quiet });
    assert.equal(value.avatar._motionManager.getCubismMotionQueueEntries().length, 0);
    close(value.read('ParamHandsLift'), 0);
    close(value.read('ParamMouthOpenY'), quiet.reducedMotion ? .6 : 0);
    value.tick(1, pose, { phase: 'speaking', utteranceId: 'b', speechActive: true });
    assert.equal(value.controller.motionGroup, 'Idle');
  }
});

test('native Wink owns only its right eyelid, ordinary left blink and live mouth retain independent timing', t => {
  const value = rig(t), baseline = rig(t);
  const pose = { gesture: 'wink', gestureCueId: 'wink', expression: 'playful', speaking: true, mouthOpen: .62, mouthShape: 'O' };
  let rightMinimum = 1, rightAfterBlink = 0;
  for (let frame = 0; frame < 60; frame++) {
    const naturalBlink = frame >= 20 && frame < 27 ? 1 : 0;
    value.controller.update(1 / 60, { ...pose, blinkLeft: naturalBlink, blinkRight: naturalBlink }, {}, { phase: 'speaking', utteranceId: 'a', speechActive: true });
    baseline.controller.update(1 / 60, pose, {}, { phase: 'speaking', utteranceId: 'a', speechActive: true });
    close(value.read('ParamEyeROpen'), baseline.read('ParamEyeROpen'), 'right closure must not be multiplied by an unrelated ordinary blink');
    close(value.read('ParamEyeLOpen'), naturalBlink ? 0 : 1);
    close(value.read('ParamMouthOpenY'), .62); close(value.read('ParamMouthA'), 1); close(value.read('ParamMouthO'), 1);
    rightMinimum = Math.min(rightMinimum, value.read('ParamEyeROpen'));
    if (frame === 59) rightAfterBlink = value.read('ParamEyeROpen');
  }
  assert.ok(rightMinimum < .02, 'right eye actually closes');
  assert.ok(rightAfterBlink > .98, 'right eye reopens after its authored short blink');
  value.controller.update(0, { ...pose, speaking: false, gesture: 'none', gestureCueId: '' }, {}, { phase: 'idle', utteranceId: 'a', speechActive: false });
  close(value.read('ParamMouthOpenY'), 0); close(value.read('ParamMouthA'), 0); close(value.read('ParamMouthO'), 0);
});

test('new expressive gestures safely fall back on V8 without changing existing touch support', t => {
  const value = rig(t, 'v8');
  for (const gesture of ['tilt', 'leanIn', 'recoil', 'settle', 'wink', 'doze']) {
    value.controller.update(.1, { gesture, gestureCueId: gesture });
    assert.equal(value.controller.motionGroup, 'Idle');
  }
  value.controller.react('greet'); value.tick(.5);
  assert.equal(value.controller.motionGroup, 'Greet');
  assert.ok(value.read('ParamHandsLift') > .2);
});

test('secondary face intent uses one real portrait patch without changing imported-model parameter semantics', () => {
  const options = { deformationProfile: 'reference-layered', supportedParameters: ['ParamWarm', 'ParamSad', 'ParamPout'] };
  for (const [channel, parameter, peak] of [['concernAmount', 'ParamSad', .24], ['aggrievedAmount', 'ParamSad', .42], ['hesitantAmount', 'ParamSad', .14], ['tenderAmount', 'ParamWarm', .5], ['reliefAmount', 'ParamWarm', .45], ['shyAmount', 'ParamWarm', .28]]) {
    const pose = { [channel]: 1 }, result = cubismParameterTargets(pose, {}, options);
    close(result[parameter], peak);
    for (const other of ['ParamWarm', 'ParamSad', 'ParamPout'].filter(name => name !== parameter)) close(result[other], 0);
    close(cubismParameterTargets(pose)[parameter], 0, 'standard imported rig does not inherit portrait expression remapping');
    close(cubismParameterTargets(pose, {}, { ...options, hidden: true })[parameter], 0);
  }
  const mixed = cubismParameterTargets({ warmAmount: .8, sadAmount: .4, poutAmount: .6, concernAmount: 1, reliefAmount: 1 }, {}, options);
  close(mixed.ParamWarm, .8); close(mixed.ParamSad, 0); close(mixed.ParamPout, 0);
});

test('motion fetch batches run at most three reads, decode in manifest order, and retain size caps', async () => {
  let active = 0, maximum = 0;
  const decoded = [], signals = [], items = Array.from({ length: 8 }, (_, index) => ({ url: `local-${index}` }));
  await loadCubismMotionAssets(items, { fetchBytes: async (url, options) => {
    assert.equal(options.maxBytes, 1024 * 1024); assert.ok(options.signal instanceof AbortSignal);
    signals.push(options.signal);
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, (3 - Number(url.at(-1)) % 3) * 2));
    active--; return new Uint8Array([Number(url.at(-1))]).buffer;
  } }, (item, bytes) => { assert.equal(active, 0, 'native decode starts only once this small batch has settled'); decoded.push([item.url, new Uint8Array(bytes)[0]]); });
  assert.equal(maximum, 3);
  assert.ok(signals.every(signal => !signal.aborted), 'successful resource responses must not be retroactively aborted');
  assert.deepEqual(decoded, items.map((item, index) => [item.url, index]));
});

test('failed or aborted motion batch settles cancelled siblings without decoding or requesting the next batch', async () => {
  for (const external of [false, true]) {
    const cancel = new AbortController(), requested = [], settled = [], decoded = [];
    const failure = new Error(external ? 'cancel avatar' : 'unavailable motion');
    await assert.rejects(loadCubismMotionAssets(Array.from({ length: 7 }, (_, index) => ({ url: `local-${index}` })), {
      signal: cancel.signal,
      fetchBytes: async (url, { signal }) => {
        requested.push(url);
        try {
          await new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            if (url === 'local-1') queueMicrotask(() => external ? cancel.abort(failure) : reject(failure));
          });
        } finally { settled.push(url); }
      },
    }, item => decoded.push(item.url)), failure);
    assert.deepEqual(requested, ['local-0', 'local-1', 'local-2']);
    assert.deepEqual([...settled].sort(), [...requested].sort()); assert.deepEqual(decoded, []);
  }
  const requested = [];
  await assert.rejects(loadCubismMotionAssets([{ url: 'one' }, { url: 'two' }, { url: 'three' }, { url: 'four' }], {
    fetchBytes: async url => { requested.push(url); return new ArrayBuffer(1); },
  }, () => { throw new Error('invalid native motion'); }), /invalid native motion/u);
  assert.deepEqual(requested, ['one', 'two', 'three'], 'native decode failure stops before another batch');
});
