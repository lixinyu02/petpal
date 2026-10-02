import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { acquireCubismFramework, createCubismFrameController, waitForCubismCore } from '../src/avatar/cubism/runtime.mjs';
import { createCubismParameterBridge } from '../src/avatar/cubism/parameters.mjs';

const root = new URL('../public/avatars/akari-cubism-v7/', import.meta.url);
const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const near = (actual, expected, label = '') => assert.ok(Math.abs(actual - expected) < .00001, `${label}: ${actual} differs from ${expected}`);
const angles = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ'];
let framework, lease, manifest, setting, moc, mapping, motionAssets, physics, previousCore;

before(async () => {
  const source = await fs.readFile(new URL('../public/vendor/live2d/live2dcubismcore.min.js', import.meta.url), 'utf8');
  const sandbox = { console, setTimeout, clearTimeout, TextDecoder, TextEncoder, atob, btoa, window: {}, document: { currentScript: { src: 'https://petpal.test/vendor/live2d/live2dcubismcore.min.js' } } };
  vm.runInNewContext(source, sandbox, { timeout: 2000, filename: 'licensed-live2dcubismcore.min.js' });
  const core = await waitForCubismCore(() => sandbox.Live2DCubismCore);
  previousCore = globalThis.Live2DCubismCore;
  globalThis.Live2DCubismCore = core;
  framework = await import('../public/avatars/cubism-runtime/framework.mjs');
  lease = acquireCubismFramework(framework, core);
  const bytes = buffer(await fs.readFile(new URL('akari.model3.json', root)));
  manifest = JSON.parse(new TextDecoder().decode(bytes));
  setting = new framework.CubismModelSettingJson(bytes, bytes.byteLength);
  moc = buffer(await fs.readFile(new URL(manifest.FileReferences.Moc, root)));
  assert.equal(framework.CubismMoc.hasMocConsistency(moc), true);
  mapping = JSON.parse(await fs.readFile(new URL('akari.psd2live.json', root), 'utf8'));
  physics = buffer(await fs.readFile(new URL(manifest.FileReferences.Physics, root)));
  motionAssets = [];
  for (const [group, entries] of Object.entries(manifest.FileReferences.Motions)) {
    for (const [index, entry] of entries.entries()) {
      const bytes = buffer(await fs.readFile(new URL(entry.File, root)));
      motionAssets.push({ group, index, bytes, json: JSON.parse(new TextDecoder().decode(bytes)) });
    }
  }
  assert.deepEqual(motionAssets.map(item => item.group).sort(), ['Blink', 'Greet', 'Idle', 'Nod', 'Shake', 'TapHead']);
});

after(() => {
  lease?.release();
  if (previousCore === undefined) delete globalThis.Live2DCubismCore;
  else globalThis.Live2DCubismCore = previousCore;
});

function rig(t, deformationProfile = 'reference-layered') {
  const avatar = new framework.CubismUserModel();
  avatar.loadModel(moc, true);
  t.after(() => avatar.release());
  const model = avatar.getModel();
  assert.equal(model.getParameterCount(), 16);
  assert.equal(model.getDrawableCount(), 11);
  avatar.loadPhysics(physics, physics.byteLength);
  const motions = new Map();
  for (const { group, index, bytes, json } of motionAssets) {
    const name = `${group}_${index}`;
    const motion = avatar.loadMotion(bytes, bytes.byteLength, name, undefined, undefined, setting, group, index, true);
    assert.ok(motion);
    motion.setEffectIds(Array.from({ length: setting.getEyeBlinkParameterCount() }, (_, i) => setting.getEyeBlinkParameterId(i)), Array.from({ length: setting.getLipSyncParameterCount() }, (_, i) => setting.getLipSyncParameterId(i)));
    motions.set(name, { motion, parameters: new Set(json.Curves.filter(curve => curve.Target === 'Parameter').map(curve => curve.Id)) });
  }
  const bridge = createCubismParameterBridge(model, framework.CubismFramework.getIdManager());
  const controller = createCubismFrameController({ model, avatar, bridge, motions, deformationProfile });
  const ids = Array.from(model.getModel().drawables.ids);
  const opacity = source => {
    const id = mapping.layers.find(item => item.source === source)?.drawable;
    const index = ids.indexOf(id);
    assert.ok(index >= 0, `${source} must map to a real native drawing`);
    return model.getModel().drawables.opacities[index];
  };
  const steps = [];
  const updateMotion = avatar._motionManager.updateMotion;
  avatar._motionManager.updateMotion = function(nativeModel, seconds) {
    steps.push(seconds);
    return updateMotion.call(this, nativeModel, seconds);
  };
  return { avatar, model, controller, read: name => bridge.read(name), opacity, steps };
}

test('real V7 Idle adds no second blink over sixteen seconds; performance blinks remain independent native drawings', t => {
  const value = rig(t);
  const body = [];
  for (let frame = 0; frame < 16 * 60; frame++) {
    value.controller.update(1 / 60);
    near(value.read('ParamEyeLOpen'), 1, `left eye frame ${frame}`);
    near(value.read('ParamEyeROpen'), 1, `right eye frame ${frame}`);
    near(value.opacity('blink-left'), 0);
    near(value.opacity('blink-right'), 0);
    body.push(value.read('ParamBreath'));
  }
  assert.equal(value.controller.motionGroup, 'Idle');
  assert.ok(Math.max(...body) - Math.min(...body) > .8, 'Idle remains genuinely animated');
  for (const [left, right] of [[1, 0], [0, 1], [1, 1], [0, 0]]) {
    value.controller.update(1 / 60, { blinkLeft: left, blinkRight: right });
    near(value.read('ParamEyeLOpen'), 1 - left);
    near(value.read('ParamEyeROpen'), 1 - right);
    near(value.opacity('blink-left'), left);
    near(value.opacity('blink-right'), right);
  }
});

test('actual V7 TapHead retains closed eyelids; Greet retains authored lids and performance wink, and quiet states close lips', t => {
  const pet = rig(t);
  pet.controller.update(.1);
  pet.controller.react('pet');
  let petClosure = 0;
  for (let frame = 0; frame < 3 * 60; frame++) {
    pet.controller.update(1 / 60);
    petClosure = Math.max(petClosure, Math.min(pet.opacity('blink-left'), pet.opacity('blink-right')));
  }
  near(petClosure, 1, 'TapHead must visibly close both actual eyelid drawings');

  const greet = rig(t);
  greet.controller.update(.1);
  greet.controller.react('greet');
  let greetMinimum = 1;
  for (let frame = 0; frame < 45; frame++) {
    greet.controller.update(1 / 60);
    greetMinimum = Math.min(greetMinimum, greet.read('ParamEyeLOpen'));
  }
  // The reviewed Greet curve bottoms at .76, above the V7 .60 closure
  // threshold. Keep that authored value; its full wink is performance-driven.
  assert.ok(greetMinimum < .8 && greetMinimum > .7, `Greet's actual eyelid curve was lost: ${greetMinimum}`);
  greet.controller.update(1 / 60, { blinkRight: 1 });
  near(greet.opacity('blink-right'), 1);
  near(greet.opacity('blink-left'), 0);

  const talking = { speaking: true, mouthOpen: .7, mouthShape: 'O' };
  for (const quiet of [{ pose: { speaking: false, voiceEnergy: 1 } }, { options: { hidden: true } }, { options: { sleeping: true } }]) {
    greet.controller.update(.1, talking);
    near(greet.read('ParamMouthOpenY'), .7);
    near(greet.opacity('mouth-a'), 1);
    near(greet.opacity('mouth-o'), 1);
    greet.controller.update(0, quiet.pose || talking, {}, quiet.options || {});
    for (const name of ['ParamMouthOpenY', 'ParamMouthA', 'ParamMouthO']) near(greet.read(name), 0);
    near(greet.opacity('mouth-a'), 0);
    near(greet.opacity('mouth-o'), 0);
  }
  assert.equal(greet.avatar._motionManager.getCubismMotionQueueEntries().length, 0);
});

test('other profiles keep native Idle blinks and full speed with the identical real V7 model bytes', t => {
  for (const profile of ['standard', 'akari-stable']) {
    const value = rig(t, profile);
    let closure = 0;
    for (let frame = 0; frame < 16 * 60; frame++) {
      value.controller.update(1 / 60);
      closure = Math.max(closure, value.opacity('blink-left'));
    }
    near(closure, 1, `${profile} must retain its native Idle blink`);
    assert.ok(value.steps.every(step => Math.abs(step - 1 / 60) < 1e-12), `${profile} must retain its motion clock`);
  }
});

test('real pure Idle uses a slower clock and smaller angles, while outgoing reactions keep normal time and amplitude', t => {
  const reference = rig(t), original = rig(t, 'standard');
  for (let frame = 0; frame < 25; frame++) {
    reference.controller.update(.1);
    original.controller.update(.075);
    for (const name of angles) near(reference.read(name), original.read(name) * .7, `${name} frame ${frame}`);
  }
  assert.ok(reference.steps.every(step => Math.abs(step - .075) < 1e-12));

  // Use a fresh pair so their real queues and initial times are identical.
  const reacting = rig(t), unchanged = rig(t, 'standard');
  for (const item of [reacting, unchanged]) item.controller.react('pet');
  for (let frame = 0; frame < 8; frame++) {
    reacting.controller.update(.1); unchanged.controller.update(.1);
    near(reacting.steps.at(-1), .1);
    for (const name of angles) near(reacting.read(name), unchanged.read(name), `${name} active reaction`);
  }
  for (const item of [reacting, unchanged]) item.controller.react('wake');
  assert.equal(reacting.controller.motionGroup, 'Idle');
  assert.equal(reacting.avatar._motionManager.getCubismMotionQueueEntries().length, 2, 'An outgoing TapHead must coexist with the newly requested Idle');
  let fadingFrames = 0, resumedPureIdle = false;
  for (let frame = 0; frame < 20; frame++) {
    const outgoing = reacting.avatar._motionManager.getCubismMotionQueueEntries().length > 1;
    reacting.controller.update(.05); unchanged.controller.update(.05);
    near(reacting.steps.at(-1), outgoing ? .05 : .0375, 'queue-aware playback clock');
    if (outgoing) fadingFrames++;
    if (reacting.avatar._motionManager.getCubismMotionQueueEntries().length > 1) {
      for (const name of angles) near(reacting.read(name), unchanged.read(name), `${name} outgoing reaction`);
    }
    if (!outgoing) resumedPureIdle = true;
  }
  assert.ok(fadingFrames > 1, 'The test must cover a real multi-frame outgoing fade');
  assert.equal(resumedPureIdle, true, 'The test must cover transition back to the slower Idle');
});
