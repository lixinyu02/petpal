import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { acquireCubismFramework, createCubismFrameController, waitForCubismCore } from '../src/avatar/cubism/runtime.mjs';
import { createCubismParameterBridge } from '../src/avatar/cubism/parameters.mjs';

const assetRoot = new URL('../public/avatars/akari-cubism-v2/', import.meta.url);
const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

test('actual licensed Core and Framework compose v2 authored reactions, exit cleanly, and cancel every native queue', async () => {
  const source = await fs.readFile(new URL('../public/vendor/live2d/live2dcubismcore.min.js', import.meta.url), 'utf8');
  const sandbox = { console, setTimeout, clearTimeout, TextDecoder, TextEncoder, atob, btoa, window: {}, document: { currentScript: { src: 'https://petpal.test/vendor/live2d/live2dcubismcore.min.js' } } };
  vm.runInNewContext(source, sandbox, { timeout: 2000, filename: 'licensed-live2dcubismcore.min.js' });
  const core = await waitForCubismCore(() => sandbox.Live2DCubismCore);
  globalThis.Live2DCubismCore = core;
  const framework = await import('../public/avatars/cubism-runtime/framework.mjs');
  const lease = acquireCubismFramework(framework, core);
  let avatar;
  try {
    const settingBytes = buffer(await fs.readFile(new URL('akari.model3.json', assetRoot)));
    const manifest = JSON.parse(new TextDecoder().decode(settingBytes));
    const setting = new framework.CubismModelSettingJson(settingBytes, settingBytes.byteLength);
    const moc = buffer(await fs.readFile(new URL(manifest.FileReferences.Moc, assetRoot)));
    assert.equal(framework.CubismMoc.hasMocConsistency(moc), true);
    avatar = new framework.CubismUserModel(); avatar.loadModel(moc, true);
    const model = avatar.getModel();
    if (manifest.FileReferences.Physics) {
      const physics = buffer(await fs.readFile(new URL(manifest.FileReferences.Physics, assetRoot)));
      avatar.loadPhysics(physics, physics.byteLength);
    }
    const motions = new Map();
    for (const [group, entries] of Object.entries(manifest.FileReferences.Motions)) {
      for (const [index, entry] of entries.entries()) {
        const bytes = buffer(await fs.readFile(new URL(entry.File, assetRoot)));
        const json = JSON.parse(new TextDecoder().decode(bytes));
        const motion = avatar.loadMotion(bytes, bytes.byteLength, `${group}_${index}`, undefined, undefined, setting, group, index, true);
        assert.ok(motion);
        motion.setEffectIds(Array.from({ length: setting.getEyeBlinkParameterCount() }, (_, i) => setting.getEyeBlinkParameterId(i)), Array.from({ length: setting.getLipSyncParameterCount() }, (_, i) => setting.getLipSyncParameterId(i)));
        motions.set(`${group}_${index}`, { motion, parameters: new Set(json.Curves.filter(curve => curve.Target === 'Parameter').map(curve => curve.Id)) });
      }
    }
    const bridge = createCubismParameterBridge(model, framework.CubismFramework.getIdManager());
    const controller = createCubismFrameController({ model, avatar, bridge, motions });
    assert.ok(bridge.supported.includes('ParamCheek'));
    assert.ok(bridge.supported.includes('ParamBrowLY'));
    const read = name => bridge.read(name);
    const breathe = [];
    for (let frame = 0; frame < 60; frame++) { controller.update(1 / 30, {}); breathe.push(read('ParamBreath')); }
    assert.equal(controller.motionGroup, 'Idle');
    assert.ok(Math.max(...breathe) - Math.min(...breathe) > .15);
    controller.react('pet');
    controller.update(1 / 30, { gesture: 'nod', headNod: .8 });
    assert.equal(controller.motionGroup, 'TapHead');
    assert.ok(avatar._motionManager.getCubismMotionQueueEntries().length >= 2);
    const samples = [];
    for (let frame = 0; frame < 110; frame++) {
      controller.update(1 / 30, { gesture: 'none' });
      samples.push({ eye: read('ParamEyeLOpen'), cheek: read('ParamCheek'), brow: read('ParamBrowLY'), form: read('ParamMouthForm') });
      for (const vertices of model.getModel().drawables.vertexPositions) assert.ok(Array.from(vertices).every(Number.isFinite));
    }
    assert.ok(Math.min(...samples.map(sample => sample.eye)) < .65);
    assert.ok(Math.max(...samples.map(sample => sample.cheek)) > .25);
    assert.ok(Math.max(...samples.map(sample => sample.brow)) > .06);
    assert.ok(Math.max(...samples.map(sample => sample.form)) > .15);
    assert.equal(controller.motionGroup, 'Idle');
    assert.ok(Math.abs(read('ParamCheek')) < .0001);
    assert.ok(Math.abs(read('ParamBrowLY')) < .0001);
    assert.ok(Math.abs(read('ParamMouthForm')) < .0001);
    controller.react('greet');
    for (let frame = 0; frame < 15; frame++) controller.update(1 / 30, {});
    controller.react('pet');
    controller.update(1 / 30, { speaking: true, mouthOpen: .7, mouthShape: 'O' });
    assert.ok(avatar._motionManager.getCubismMotionQueueEntries().length >= 2);
    assert.ok(Math.abs(read('ParamMouthOpenY') - .7) < .0001);
    controller.update(0, { speaking: true, mouthOpen: .7 }, {}, { hidden: true });
    assert.equal(avatar._motionManager.getCubismMotionQueueEntries().length, 0);
    assert.equal(avatar._expressionManager.getCubismMotionQueueEntries().length, 0);
    assert.equal(read('ParamMouthOpenY'), 0);
    assert.equal(read('ParamCheek'), 0);
    controller.update(0, { speaking: true, mouthOpen: .7 }, {}, { reducedMotion: true });
    assert.ok(Math.abs(read('ParamMouthOpenY') - .7) < .0001);
    controller.update(0, { speaking: true, mouthOpen: .7 }, {}, { sleeping: true });
    assert.equal(read('ParamMouthOpenY'), 0); assert.equal(read('ParamEyeLOpen'), 0); assert.equal(read('ParamEyeROpen'), 0);
    // Exercise real ExpressionMotion blending as well as the authored motion
    // files. The empty expression has no synthetic rig parameter to fall back on.
    avatar.release(); avatar = new framework.CubismUserModel(); avatar.loadModel(moc, true);
    const expressionModel = avatar.getModel();
    const expressionBridge = createCubismParameterBridge(expressionModel, framework.CubismFramework.getIdManager());
    const expressions = new Map();
    for (const [name, parameters] of [['happy', [{ Id: 'ParamCheek', Value: .65, Blend: 'Overwrite' }]], ['neutral', []]]) {
      const bytes = new TextEncoder().encode(JSON.stringify({ Type: 'Live2D Expression', FadeInTime: .25, FadeOutTime: .25, Parameters: parameters })).buffer;
      expressions.set(name, { motion: avatar.loadExpression(bytes, bytes.byteLength, name), parameters: new Set(parameters.map(parameter => parameter.Id)) });
    }
    const face = createCubismFrameController({ model: expressionModel, avatar, bridge: expressionBridge, expressions });
    for (let frame = 0; frame < 20; frame++) face.update(1 / 30, { expression: 'happy', blush: .2 });
    assert.ok(expressionBridge.read('ParamCheek') > .6);
    face.update(1 / 30, { expression: 'unknown', blush: .2 });
    assert.equal(avatar._expressionManager.getCubismMotionQueueEntries().length, 2);
    for (let frame = 0; frame < 20; frame++) face.update(1 / 30, { expression: 'unknown', blush: .2 });
    assert.ok(Math.abs(expressionBridge.read('ParamCheek') - .2) < .0001);
    face.update(0, { expression: 'happy' }, {}, { hidden: true });
    face.update(1 / 30, { expression: 'neutral' });
    assert.equal(expressionBridge.read('ParamCheek'), 0);
  } finally {
    avatar?.release(); lease.release(); delete globalThis.Live2DCubismCore;
  }
});
