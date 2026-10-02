import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { acquireCubismFramework, createCubismFrameController, waitForCubismCore } from '../src/avatar/cubism/runtime.mjs';
import { createCubismParameterBridge } from '../src/avatar/cubism/parameters.mjs';
import { createAvatarPerformance } from '../src/avatar/performance.mjs';

const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-5, `${message}: ${actual} != ${expected}`);
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
  for (const version of ['v10', 'v11', 'v12']) {
    const root = new URL(`../public/avatars/akari-cubism-${version}/`, import.meta.url);
    const bytes = buffer(await fs.readFile(new URL('akari.model3.json', root))), manifest = JSON.parse(new TextDecoder().decode(bytes));
    const setting = new framework.CubismModelSettingJson(bytes, bytes.byteLength);
    const motions = [];
    for (const [group, entries] of Object.entries(manifest.FileReferences.Motions)) for (const [index, entry] of entries.entries()) {
      const content = buffer(await fs.readFile(new URL(entry.File, root)));
      motions.push({ group, index, bytes: content, json: JSON.parse(new TextDecoder().decode(content)) });
    }
    assets.set(version, { setting, moc: buffer(await fs.readFile(new URL(manifest.FileReferences.Moc, root))), physics: buffer(await fs.readFile(new URL(manifest.FileReferences.Physics, root))), motions });
  }
});
after(() => { lease?.release(); if (previousCore === undefined) delete globalThis.Live2DCubismCore; else globalThis.Live2DCubismCore = previousCore; });
function rig(t, version = 'v11', deformationProfile = ['v11', 'v12'].includes(version) ? 'reference-features' : 'reference-layered') {
  const asset = assets.get(version), avatar = new framework.CubismUserModel(); avatar.loadModel(asset.moc, true); avatar.loadPhysics(asset.physics, asset.physics.byteLength); t.after(() => avatar.release());
  const model = avatar.getModel(), motions = new Map();
  for (const { group, index, bytes, json } of asset.motions) {
    const name = `${group}_${index}`, motion = avatar.loadMotion(bytes, bytes.byteLength, name, undefined, undefined, asset.setting, group, index, true);
    motion.setEffectIds(Array.from({ length: asset.setting.getEyeBlinkParameterCount() }, (_, i) => asset.setting.getEyeBlinkParameterId(i)), Array.from({ length: asset.setting.getLipSyncParameterCount() }, (_, i) => asset.setting.getLipSyncParameterId(i)));
    motions.set(name, { motion, parameters: new Set(json.Curves.filter(curve => curve.Target === 'Parameter').map(curve => curve.Id)) });
  }
  const bridge = createCubismParameterBridge(model, framework.CubismFramework.getIdManager());
  return { model, avatar, read: name => bridge.read(name), controller: createCubismFrameController({ model, avatar, bridge, motions, deformationProfile }) };
}

for (const version of ['v11', 'v12']) {
test(version + ': real touch keeps native head/hands but live eyelids do not inherit the legacy long squint', t => {
  const value = rig(t, version), pose = { eyeSmile: .6, speaking: true, mouthOpen: .55, mouthShape: 'A' };
  value.controller.update(.1, pose); value.controller.react('pet');
  let hand = 0, head = 0;
  for (let frame = 0; frame < 90; frame++) {
    const blink = frame >= 32 && frame < 35 ? 1 : 0;
    value.controller.update(1 / 30, { ...pose, blinkLeft: blink, blinkRight: blink });
    for (const eye of ['ParamEyeLOpen', 'ParamEyeROpen']) close(value.read(eye), blink ? 0 : .88, `${eye} touch frame ${frame}`);
    close(value.read('ParamMouthOpenY'), .55, 'speech retains articulation');
    hand = Math.max(hand, value.read('ParamHandsLift')); head = Math.max(head, Math.abs(value.read('ParamAngleZ')));
  }
  assert.ok(hand > .1 && head > .3, 'Removing the old eye squeeze must not remove the native reaction');
  assert.equal(value.controller.motionGroup, 'Idle');
});

test(version + ': the actual pet performance cannot hold eyes near closed for the old TapHead duration', t => {
  const value = rig(t, version), performance = createAvatarPerformance();
  performance.setInput({ utteranceId: 'touch-1', text: '', phase: 'idle' });
  performance.react({ id: 'touch-1', kind: 'pet' }); value.controller.react('pet');
  let run = 0, longest = 0, min = 1;
  for (let frame = 0; frame < 110; frame++) {
    const pose = performance.step(1 / 30);
    value.controller.update(1 / 30, pose, {}, { utteranceId: 'touch-1', phase: 'idle' });
    const eye = Math.min(value.read('ParamEyeLOpen'), value.read('ParamEyeROpen')); min = Math.min(min, eye);
    run = eye < .5 ? run + 1 : 0; longest = Math.max(longest, run);
  }
  assert.ok(longest / 30 <= .2, `Eye narrowing persisted for ${longest / 30}s instead of a brief natural blink`);
  assert.ok(min < .15, 'Existing natural blinking remains enabled');
});

test(version + ': outgoing TapHead does not leave an eyelid squeeze when a hand reaction replaces it', t => {
  const value = rig(t, version); value.controller.react('pet');
  for (let i = 0; i < 18; i++) value.controller.update(1 / 30);
  value.controller.react('hand');
  for (let i = 0; i < 30; i++) { value.controller.update(1 / 30); close(value.read('ParamEyeLOpen'), 1, 'outgoing left lid'); close(value.read('ParamEyeROpen'), 1, 'outgoing right lid'); }
  assert.equal(value.controller.motionGroup, 'Sway');
});

test(version + ': real Wink still closes its right eye while the left eye and speech remain independent', t => {
  const value = rig(t, version); let minimum = 1;
  for (let frame = 0; frame < 42; frame++) {
    const blink = frame >= 4 && frame < 7 ? 1 : 0;
    value.controller.update(1 / 30, { gesture: 'wink', gestureCueId: 'wink-1', blinkLeft: blink, speaking: true, mouthOpen: .6, mouthShape: 'O' });
    minimum = Math.min(minimum, value.read('ParamEyeROpen'));
    close(value.read('ParamEyeLOpen'), 1 - blink, 'left eye keeps its blink'); close(value.read('ParamMouthOpenY'), .6, 'mouth');
  }
  assert.ok(minimum < .02); close(value.read('ParamEyeROpen'), 1, 'Wink must reopen');
});

}

test('V10 and user-supplied models preserve the original authored TapHead eye behavior', t => {
  for (const [version, profile] of [['v10', 'reference-layered'], ['v11', 'standard']]) {
    const value = rig(t, version, profile); value.controller.react('pet');
    let minimum = 1;
    for (let frame = 0; frame < 30; frame++) { value.controller.update(1 / 30); minimum = Math.min(minimum, value.read('ParamEyeLOpen')); }
    assert.ok(minimum > .25 && minimum < .27, `${version}/${profile} lost its authored eye curve`);
  }
});
