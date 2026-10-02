import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { acquireCubismFramework, createCubismFrameController, waitForCubismCore } from '../src/avatar/cubism/runtime.mjs';
import { createCubismParameterBridge } from '../src/avatar/cubism/parameters.mjs';
import { buildHandMotions } from '../scripts/authoring/prepare-akari-hand-motions.mjs';

const hands = ['ParamHandsLift', 'ParamHandsSway', 'ParamSleeveEase'];
const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const near = (value, expected, label = '') => assert.ok(Math.abs(value - expected) < 1e-5, `${label}: ${value} differs from ${expected}`);
let framework, lease, previousCore;
const assets = new Map();

before(async () => {
  const source = await fs.readFile(new URL('../public/vendor/live2d/live2dcubismcore.min.js', import.meta.url), 'utf8');
  const sandbox = { console, setTimeout, clearTimeout, TextDecoder, TextEncoder, atob, btoa, window: {}, document: { currentScript: { src: 'https://petpal.test/vendor/live2d/live2dcubismcore.min.js' } } };
  vm.runInNewContext(source, sandbox, { timeout: 2000, filename: 'licensed-live2dcubismcore.min.js' });
  const core = await waitForCubismCore(() => sandbox.Live2DCubismCore);
  previousCore = globalThis.Live2DCubismCore; globalThis.Live2DCubismCore = core;
  framework = await import('../public/avatars/cubism-runtime/framework.mjs');
  lease = acquireCubismFramework(framework, core);
  for (const version of ['v7', 'v8']) {
    const root = new URL(`../public/avatars/akari-cubism-${version}/`, import.meta.url);
    const settingBytes = buffer(await fs.readFile(new URL('akari.model3.json', root)));
    const manifest = JSON.parse(new TextDecoder().decode(settingBytes));
    const setting = new framework.CubismModelSettingJson(settingBytes, settingBytes.byteLength);
    const moc = buffer(await fs.readFile(new URL(manifest.FileReferences.Moc, root)));
    assert.equal(framework.CubismMoc.hasMocConsistency(moc), true);
    const motionAssets = [];
    for (const [group, entries] of Object.entries(manifest.FileReferences.Motions)) for (const [index, entry] of entries.entries()) {
      const bytes = buffer(await fs.readFile(new URL(entry.File, root)));
      motionAssets.push({ group, index, bytes, json: JSON.parse(new TextDecoder().decode(bytes)) });
    }
    assets.set(version, { manifest, setting, moc, motionAssets });
  }
});

after(() => {
  lease?.release();
  if (previousCore === undefined) delete globalThis.Live2DCubismCore;
  else globalThis.Live2DCubismCore = previousCore;
});

function rig(t, version = 'v8', deformationProfile = 'reference-layered', omitGroups = []) {
  const { setting, moc, motionAssets } = assets.get(version);
  const avatar = new framework.CubismUserModel(); avatar.loadModel(moc, true); t.after(() => avatar.release());
  const model = avatar.getModel(), motions = new Map();
  for (const { group, index, bytes, json } of motionAssets) {
    if (omitGroups.includes(group)) continue;
    const name = `${group}_${index}`;
    const motion = avatar.loadMotion(bytes, bytes.byteLength, name, undefined, undefined, setting, group, index, true);
    assert.ok(motion);
    motion.setEffectIds(Array.from({ length: setting.getEyeBlinkParameterCount() }, (_, i) => setting.getEyeBlinkParameterId(i)), Array.from({ length: setting.getLipSyncParameterCount() }, (_, i) => setting.getLipSyncParameterId(i)));
    motions.set(name, { motion, parameters: new Set(json.Curves.filter(item => item.Target === 'Parameter').map(item => item.Id)) });
  }
  const bridge = createCubismParameterBridge(model, framework.CubismFramework.getIdManager());
  const controller = createCubismFrameController({ model, avatar, bridge, motions, deformationProfile });
  const tick = (seconds, pose = {}, options = {}) => {
    for (let frame = 0; frame < Math.round(seconds * 60); frame++) controller.update(1 / 60, pose, {}, options);
  };
  return { avatar, model, bridge, controller, tick, read: name => bridge.read(name) };
}

test('real V8 exposes only three added native joints and generated motions preserve reviewed V7 curves', t => {
  const value = rig(t);
  assert.equal(value.model.getParameterCount(), 19); assert.equal(value.model.getDrawableCount(), 11);
  for (const name of hands) assert.ok(value.bridge.supported.includes(name));
  const originals = new Map(assets.get('v7').motionAssets.map(({ group, json }) => [group, json]));
  const untouched = JSON.stringify([...originals]);
  const generated = buildHandMotions(originals);
  assert.equal(JSON.stringify([...originals]), untouched, 'authoring must not mutate source objects');
  assert.deepEqual([...generated.keys()].sort(), ['Blink', 'Bow', 'Greet', 'Idle', 'Nod', 'Shake', 'Shy', 'Sway', 'TapHead']);
  for (const [group, source] of originals) {
    assert.deepEqual(generated.get(group).Curves.filter(curve => !hands.includes(curve.Id)), source.Curves, `${group} must retain its already-reviewed face/body curves`);
  }
  for (const { group, json } of assets.get('v8').motionAssets) assert.deepEqual(json, generated.get(group), `${group} must be the reproducible generated asset`);
});

test('actual Shy/Sway/Bow curves reach real hand joints and return to the tiny idle range', t => {
  for (const [gesture, group] of [['shy', 'Shy'], ['sway', 'Sway'], ['bounce', 'Sway'], ['bow', 'Bow']]) {
    const value = rig(t), samples = [];
    value.controller.update(1 / 60, { gesture });
    assert.equal(value.controller.motionGroup, group);
    for (let frame = 0; frame < 3 * 60; frame++) {
      value.controller.update(1 / 60, { gesture });
      samples.push(hands.map(name => value.read(name)));
      for (const vertices of value.model.getModel().drawables.vertexPositions) assert.ok(Array.from(vertices).every(Number.isFinite));
    }
    assert.ok(Math.max(...samples.map(sample => sample[0])) > .23, `${group} must visibly lift the joined hands`);
    assert.ok(Math.max(...samples.map(sample => sample[2])) > .13, `${group} must drive the real sleeve response`);
    if (group === 'Sway') {
      assert.ok(Math.max(...samples.map(sample => sample[1])) > .3);
      assert.ok(Math.min(...samples.map(sample => sample[1])) < -.3);
    }
    value.tick(1, { gesture: 'none' });
    assert.equal(value.controller.motionGroup, 'Idle');
    for (const name of hands) assert.ok(Math.abs(value.read(name)) <= .019, `${group}: ${name} must settle to subtle idle`);
  }
});

test('manual reactions outrank semantic hand gestures and outgoing hand curves survive their official fade', t => {
  const value = rig(t);
  value.tick(.1);
  value.controller.react('greet');
  value.tick(.65, { gesture: 'shy' }, { phase: 'speaking', utteranceId: 'a', speechActive: true });
  assert.equal(value.controller.motionGroup, 'Greet');
  assert.ok(value.read('ParamHandsLift') > .45);
  // A stopped/changed reply must not cancel a user's direct greeting.
  value.controller.update(1 / 60, { gesture: 'bow' }, {}, { phase: 'idle', utteranceId: 'b', speechActive: false });
  assert.equal(value.controller.motionGroup, 'Greet');
  value.controller.react('wake');
  value.controller.update(.05, {});
  assert.equal(value.controller.motionGroup, 'Idle');
  assert.ok(value.avatar._motionManager.getCubismMotionQueueEntries().length > 1);
  assert.ok(value.read('ParamHandsLift') > .1, 'bridge must not zero a fading authored hand joint');
  value.tick(1);
  for (const name of hands) assert.ok(Math.abs(value.read(name)) <= .019);
});

test('stopping playback, changing reply or withdrawing an emotional cue cancels only speech-owned motions without replay', t => {
  for (const cancellation of [
    { options: { phase: 'idle', utteranceId: 'a', speechActive: false } },
    { options: { phase: 'speaking', utteranceId: 'b', speechActive: true } },
    { options: { phase: 'speaking', utteranceId: 'a', speechActive: false } },
    { options: { phase: 'speaking', utteranceId: 'a', speechActive: true }, pose: { gesture: 'none', speaking: true, mouthOpen: .65, mouthShape: 'A' } },
  ]) {
    const value = rig(t);
    const talking = { gesture: 'shy', speaking: true, mouthOpen: .65, mouthShape: 'A' };
    value.tick(.8, talking, { phase: 'speaking', utteranceId: 'a', speechActive: true });
    assert.equal(value.controller.motionGroup, 'Shy');
    assert.ok(value.read('ParamHandsLift') > .6);
    const pose = cancellation.pose || { gesture: 'shy', speaking: false };
    value.controller.update(0, pose, {}, cancellation.options);
    assert.equal(value.controller.motionGroup, 'Idle');
    near(value.read('ParamMouthOpenY'), pose.speaking ? .65 : 0, 'gesture cancellation must not delay mouth closure or interrupt continuing speech');
    value.tick(1, pose, cancellation.options);
    assert.equal(value.controller.motionGroup, 'Idle', 'stale performance cue cannot restart the cancelled motion');
    for (const name of hands) assert.ok(Math.abs(value.read(name)) <= .019);
  }
});

test('hidden, sleeping and reduced-motion immediately clear real hands and all queued fades, while reduced mode keeps articulation', t => {
  for (const options of [{ hidden: true }, { sleeping: true }, { reducedMotion: true }]) {
    const value = rig(t);
    value.controller.react('greet'); value.tick(.5);
    value.controller.react('pet'); value.tick(.3);
    assert.ok(value.avatar._motionManager.getCubismMotionQueueEntries().length > 1);
    value.controller.update(0, { speaking: true, mouthOpen: .6, mouthShape: 'O' }, {}, options);
    assert.equal(value.avatar._motionManager.getCubismMotionQueueEntries().length, 0);
    for (const name of hands) near(value.read(name), 0, name);
    near(value.read('ParamMouthOpenY'), options.reducedMotion ? .6 : 0);
    value.controller.react('greet');
    value.tick(1, { gesture: 'none' });
    assert.equal(value.controller.motionGroup, 'Idle');
    for (const name of hands) assert.ok(Math.abs(value.read(name)) <= .019, 'suppressed reactions must not be replayed');
  }
});

test('older real models ignore missing optional hand joints and groups while retaining their original interactions', t => {
  for (const profile of ['standard', 'akari-stable', 'reference-layered']) {
    const value = rig(t, 'v7', profile);
    assert.equal(value.model.getParameterCount(), 16);
    for (const name of hands) { assert.equal(value.bridge.supported.includes(name), false); assert.equal(value.read(name), undefined); }
    value.controller.update(.1, { gesture: 'shy' });
    assert.equal(value.controller.motionGroup, 'Idle');
    value.controller.react('greet'); value.tick(.7, { gesture: 'sway' });
    assert.equal(value.controller.motionGroup, 'Greet');
    assert.ok(value.read('ParamAngleY') < -.1);
  }
});

test('manual fallback promotes an already-playing speech Nod without restarting it or allowing speech cancellation', t => {
  const value = rig(t, 'v7', 'standard', ['Greet', 'TapHead']);
  value.tick(.45, { gesture: 'nod' }, { phase: 'speaking', utteranceId: 'a', speechActive: true });
  assert.equal(value.controller.motionGroup, 'Nod');
  const entries = value.avatar._motionManager.getCubismMotionQueueEntries();
  const entry = entries[0];
  value.controller.react('greet');
  assert.equal(value.avatar._motionManager.getCubismMotionQueueEntries().length, 1, 'same native fallback should not restart/crossfade itself');
  assert.equal(value.avatar._motionManager.getCubismMotionQueueEntries()[0], entry);
  value.tick(.5, { gesture: 'none' }, { phase: 'idle', utteranceId: 'b', speechActive: false });
  assert.equal(value.controller.motionGroup, 'Nod', 'explicit fallback gesture must survive cancelled speech');
});
