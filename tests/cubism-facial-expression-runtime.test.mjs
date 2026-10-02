import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { acquireCubismFramework, createCubismFrameController, waitForCubismCore } from '../src/avatar/cubism/runtime.mjs';
import { createCubismParameterBridge, cubismParameterTargets } from '../src/avatar/cubism/parameters.mjs';

const faces = ['ParamWarm', 'ParamSad', 'ParamPout', 'ParamShy', 'ParamSurprise', 'ParamRelaxed'];
const options = { deformationProfile: 'reference-layered', supportedParameters: faces };
const faceValues = targets => faces.map(name => targets[name]);
const expectedFace = name => faces.map(parameter => Number(parameter === name));
const close = (actual, expected, label = '') => assert.ok(Math.abs(actual - expected) < 1e-5, `${label}: ${actual} != ${expected}`);
const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

test('portrait Shy, Surprise and Relaxed choose actual distinct face artwork at full coverage', () => {
  for (const [pose, parameter] of [
    [{ shyAmount: .6, warmAmount: .252, smileAmount: .252 }, 'ParamShy'],
    [{ surpriseAmount: .6 }, 'ParamSurprise'],
    [{ reliefAmount: .6, warmAmount: .39, smileAmount: .3 }, 'ParamRelaxed'],
    [{ tenderAmount: .6, warmAmount: .39 }, 'ParamRelaxed'],
    [{ sleepyAmount: .6, warmAmount: .072 }, 'ParamRelaxed'],
    [{ warmAmount: .6 }, 'ParamWarm'], [{ sadAmount: .6 }, 'ParamSad'], [{ poutAmount: .6 }, 'ParamPout'],
  ]) {
    const result = cubismParameterTargets(pose, {}, options);
    assert.deepEqual(faceValues(result), expectedFace(parameter));
  }
});

test('portrait face selection never crossfades competing pupils, and clears tiny or invalid residuals', () => {
  for (let step = 0; step <= 100; step++) {
    const amount = step / 100;
    const targets = cubismParameterTargets({ shyAmount: 1 - amount, sadAmount: amount, surpriseAmount: amount * .8, reliefAmount: amount * .7 }, {}, options);
    assert.equal(faceValues(targets).filter(value => value === 1).length, 1);
    assert.ok(faceValues(targets).every(value => value === 0 || value === 1));
  }
  assert.deepEqual(faceValues(cubismParameterTargets({ shyAmount: .08, surpriseAmount: .05, tenderAmount: .04 }, {}, options)), expectedFace('neutral'));
  assert.deepEqual(faceValues(cubismParameterTargets({ shyAmount: NaN, surpriseAmount: Infinity, tenderAmount: -1 }, {}, options)), expectedFace('neutral'));
  assert.deepEqual(faceValues(cubismParameterTargets({ sadAmount: .7, shyAmount: .7, surpriseAmount: .7 }, {}, options)), expectedFace('ParamSad'), 'deterministic ties retain the earlier established emotion');
});

test('portrait face changes preserve natural blink and live articulation; hidden and sleeping clear faces immediately', () => {
  const pose = { shyAmount: 1, speaking: true, mouthOpen: .62, mouthShape: 'O', blinkLeft: 1, blinkRight: 0 };
  const targets = cubismParameterTargets(pose, {}, options);
  assert.equal(targets.ParamShy, 1); assert.equal(targets.ParamEyeLOpen, 0); assert.equal(targets.ParamEyeROpen, 1);
  assert.equal(targets.ParamMouthA, 1); assert.equal(targets.ParamMouthO, 1); close(targets.ParamMouthOpenY, .62);
  for (const state of [{ hidden: true }, { sleeping: true }]) {
    const quiet = cubismParameterTargets(pose, {}, { ...options, ...state });
    assert.deepEqual(faceValues(quiet), expectedFace('neutral'));
    assert.equal(quiet.ParamMouthOpenY, 0); assert.equal(quiet.ParamMouthA, 0); assert.equal(quiet.ParamMouthO, 0);
  }
  const reduced = cubismParameterTargets(pose, {}, { ...options, reducedMotion: true });
  assert.equal(reduced.ParamShy, 1); close(reduced.ParamMouthOpenY, .62, 'reduced motion retains speech and facial meaning');
  const stopped = cubismParameterTargets({ ...pose, speaking: false, voiceEnergy: 1 }, {}, options);
  assert.equal(stopped.ParamShy, 1); assert.equal(stopped.ParamMouthOpenY, 0); assert.equal(stopped.ParamMouthA, 0); assert.equal(stopped.ParamMouthO, 0);
});

test('portrait half-lidded artwork is not ghosted by approximated sleepy or smiling blink layers', () => {
  for (const pose of [{ sleepyAmount: 1, eyeSmile: .06 }, { tenderAmount: 1, eyeSmile: .72 }, { sadAmount: 1, eyeSmile: 1, sleepyAmount: 1 }]) {
    const open = cubismParameterTargets(pose, {}, options);
    assert.equal(open.ParamEyeLOpen, 1); assert.equal(open.ParamEyeROpen, 1);
    const closed = cubismParameterTargets({ ...pose, blinkLeft: 1, blinkRight: 0 }, {}, options);
    assert.equal(closed.ParamEyeLOpen, 0); assert.equal(closed.ParamEyeROpen, 1);
    const asleep = cubismParameterTargets(pose, {}, { ...options, sleeping: true });
    assert.equal(asleep.ParamEyeLOpen, 0); assert.equal(asleep.ParamEyeROpen, 0);
  }
  const legacy = cubismParameterTargets({ sleepyAmount: 1, eyeSmile: .06 }, {}, { ...options, supportedParameters: ['ParamWarm', 'ParamSad', 'ParamPout'] });
  close(legacy.ParamEyeLOpen, .611, 'older portrait compatibility remains unchanged');
});

test('legacy portraits keep their original continuous patches and missing new channels do not consume the face', () => {
  const legacy = { ...options, supportedParameters: ['ParamWarm', 'ParamSad', 'ParamPout'] };
  for (const [channel, amount] of [['shyAmount', .28], ['reliefAmount', .45], ['tenderAmount', .5]]) {
    const targets = cubismParameterTargets({ [channel]: 1 }, {}, legacy);
    close(targets.ParamWarm, amount); assert.deepEqual(faceValues(targets).slice(1), [0, 0, 0, 0, 0]);
  }
  const withoutShy = cubismParameterTargets({ shyAmount: 1, warmAmount: .4 }, {}, { ...options, supportedParameters: ['ParamWarm', 'ParamSad', 'ParamPout', 'ParamSurprise'] });
  assert.equal(withoutShy.ParamWarm, 1); assert.equal(withoutShy.ParamShy, 0);
  const defaults = cubismParameterTargets({ warmAmount: .4, sadAmount: .3 }, {}, { deformationProfile: 'reference-layered' });
  assert.equal(defaults.ParamWarm, .4); assert.equal(defaults.ParamSad, 0);
});

test('imported models retain authored new-named parameters and bridge never writes a virtual parameter', () => {
  const names = ['ParamShy', 'ParamSurprise', 'ParamRelaxed', 'ParamWarm'], values = [.23, .46, .69, 0];
  const writes = [];
  const model = {
    getParameterCount: () => names.length,
    getParameterIndex: name => names.includes(name) ? names.indexOf(name) : names.length + 10,
    getParameterMinimumValue: () => 0, getParameterMaximumValue: () => 1,
    getParameterValueByIndex: index => values[index],
    setParameterValueByIndex: (index, value) => { assert.ok(index < names.length); writes.push(names[index]); values[index] = value; },
  };
  const bridge = createCubismParameterBridge(model, { getId: name => name });
  assert.deepEqual(new Set(bridge.supported), new Set(names));
  const targets = cubismParameterTargets({ shyAmount: 1, surpriseAmount: 1, reliefAmount: 1, warmAmount: .4 }, {}, { supportedParameters: bridge.supported });
  assert.equal(targets.ParamShy, undefined); assert.equal(targets.ParamSurprise, undefined); assert.equal(targets.ParamRelaxed, undefined);
  bridge.apply(targets);
  assert.deepEqual(values, [.23, .46, .69, .4]); assert.deepEqual(writes, ['ParamWarm']);
});

test('V10 real Core applies distinct face opacity, preserves Wink ownership, and closes speech on stop', async t => {
  const source = await fs.readFile(new URL('../public/vendor/live2d/live2dcubismcore.min.js', import.meta.url), 'utf8');
  const sandbox = { console, setTimeout, clearTimeout, TextDecoder, TextEncoder, atob, btoa, window: {}, document: { currentScript: { src: 'https://petpal.test/vendor/live2d/live2dcubismcore.min.js' } } };
  vm.runInNewContext(source, sandbox, { timeout: 2000 });
  const core = await waitForCubismCore(() => sandbox.Live2DCubismCore), previousCore = globalThis.Live2DCubismCore;
  globalThis.Live2DCubismCore = core;
  const framework = await import('../public/avatars/cubism-runtime/framework.mjs');
  const lease = acquireCubismFramework(framework, core);
  let avatar;
  t.after(() => { avatar?.release(); lease.release(); if (previousCore === undefined) delete globalThis.Live2DCubismCore; else globalThis.Live2DCubismCore = previousCore; });
  const root = new URL('../public/avatars/akari-cubism-v10/', import.meta.url);
  const bytes = buffer(await fs.readFile(new URL('akari.model3.json', root)));
  const manifest = JSON.parse(new TextDecoder().decode(bytes));
  const setting = new framework.CubismModelSettingJson(bytes, bytes.byteLength);
  const moc = buffer(await fs.readFile(new URL(manifest.FileReferences.Moc, root)));
  assert.equal(framework.CubismMoc.hasMocConsistency(moc), true);
  avatar = new framework.CubismUserModel(); avatar.loadModel(moc, true);
  const model = avatar.getModel(), motions = new Map();
  for (const [group, entries] of Object.entries(manifest.FileReferences.Motions)) for (const [index, entry] of entries.entries()) {
    const content = buffer(await fs.readFile(new URL(entry.File, root))), json = JSON.parse(new TextDecoder().decode(content)), name = `${group}_${index}`;
    const motion = avatar.loadMotion(content, content.byteLength, name, undefined, undefined, setting, group, index, true); motion.setEffectIds([], []);
    motions.set(name, { motion, parameters: new Set(json.Curves.filter(curve => curve.Target === 'Parameter').map(curve => curve.Id)) });
  }
  const bridge = createCubismParameterBridge(model, framework.CubismFramework.getIdManager());
  for (const name of faces) assert.ok(bridge.supported.includes(name), `${name} must be a real native parameter`);
  const mapping = JSON.parse(await fs.readFile(new URL('akari.psd2live.json', root), 'utf8'));
  const native = model.getModel(), layerIds = new Map(mapping.layers.map(layer => [layer.source, layer.drawable]));
  const faceLayers = new Map(faces.map(name => [name, Array.from(native.drawables.ids).indexOf(layerIds.get(name.slice(5).toLowerCase()))]));
  for (const [name, index] of faceLayers) assert.ok(index >= 0, `${name} must control exported face artwork`);
  // An actual Framework expression attempts to retain an outgoing sad face.
  // The portrait bridge must still display exactly the selected live face.
  const expressionBytes = new TextEncoder().encode(JSON.stringify({ Type: 'Live2DExpression', FadeInTime: 0, FadeOutTime: .4, Parameters: [{ Id: 'ParamSad', Value: 1, Blend: 'Overwrite' }, { Id: 'ParamMouthOpenY', Value: 1, Blend: 'Overwrite' }] })).buffer;
  const expressionMotion = avatar.loadExpression(expressionBytes, expressionBytes.byteLength, 'playful');
  const expressions = new Map([['playful', { motion: expressionMotion, parameters: new Set(['ParamSad', 'ParamMouthOpenY']) }]]);
  const controller = createCubismFrameController({ model, avatar, bridge, motions, expressions, deformationProfile: 'reference-layered' });
  const read = name => bridge.read(name);
  const assertFace = name => faces.forEach(parameter => {
    close(read(parameter), Number(parameter === name), parameter);
    close(native.drawables.opacities[faceLayers.get(parameter)], Number(parameter === name), `${parameter} real drawable opacity`);
  });
  for (const [channel, parameter] of [['shyAmount', 'ParamShy'], ['surpriseAmount', 'ParamSurprise'], ['reliefAmount', 'ParamRelaxed'], ['sadAmount', 'ParamSad'], ['warmAmount', 'ParamWarm'], ['poutAmount', 'ParamPout']]) {
    controller.update(.1, { [channel]: .6, speaking: true, mouthOpen: .6, mouthShape: 'O' });
    assertFace(parameter); close(read('ParamMouthOpenY'), .6); close(read('ParamMouthA'), 1); close(read('ParamMouthO'), 1);
    for (const vertices of model.getModel().drawables.vertexPositions) assert.ok(Array.from(vertices).every(Number.isFinite));
  }
  const pose = { gesture: 'wink', gestureCueId: 'new-face-wink', expression: 'playful', shyAmount: .8, speaking: true, mouthOpen: .58, mouthShape: 'A' };
  let minimumRight = 1, rightReopened = false;
  for (let frame = 0; frame < 65; frame++) {
    controller.update(1 / 60, { ...pose, blinkLeft: frame >= 18 && frame < 23 ? 1 : 0 }, {}, { phase: 'speaking', utteranceId: 'face-speech', speechActive: true });
    assertFace('ParamShy'); close(read('ParamMouthOpenY'), .58); close(read('ParamEyeLOpen'), frame >= 18 && frame < 23 ? 0 : 1);
    minimumRight = Math.min(minimumRight, read('ParamEyeROpen'));
    if (frame > 55 && read('ParamEyeROpen') > .98) rightReopened = true;
  }
  assert.ok(minimumRight < .02); assert.ok(rightReopened);
  controller.update(0, { ...pose, speaking: false, gesture: 'none', gestureCueId: '' }, {}, { phase: 'idle', utteranceId: 'face-speech', speechActive: false });
  assertFace('ParamShy'); close(read('ParamMouthOpenY'), 0); close(read('ParamMouthA'), 0); close(read('ParamMouthO'), 0);
  for (const state of [{ hidden: true }, { sleeping: true }]) {
    controller.update(0, pose, {}, state); assertFace('neutral'); close(read('ParamMouthOpenY'), 0);
    assert.equal(avatar._motionManager.getCubismMotionQueueEntries().length, 0);
  }
});
