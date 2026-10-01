import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { acquireCubismFramework, createCubismFrameController, waitForCubismCore } from '../src/avatar/cubism/runtime.mjs';
import { createCubismParameterBridge, cubismParameterTargets } from '../src/avatar/cubism/parameters.mjs';

const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < .00001, `${actual} differs from ${expected}`);

test('smile intent controls eyelids independently of the iris squash channel and only the reviewed rig limits speech opening', () => {
  const smile = cubismParameterTargets({ eyeSmile: 1, speaking: true, mouthOpen: .9 });
  assert.equal(smile.ParamEyeBallForm, 0);
  assert.equal(smile.ParamEyeLSmile, 1);
  assert.equal(smile.ParamEyeRSmile, 1);
  assert.equal(smile.ParamMouthOpenY, .9);
  assert.equal(cubismParameterTargets({ speaking: true, mouthOpen: .9 }, {}, { deformationProfile: 'akari-stable' }).ParamMouthOpenY, .6);
  assert.equal(cubismParameterTargets({ speaking: false, mouthOpen: .9 }, {}, { deformationProfile: 'akari-stable' }).ParamMouthOpenY, 0);
});

test('licensed Core and Framework keep reaction angles exclusive through outgoing fades and retain imported-model articulation', async () => {
  const source = await fs.readFile(new URL('../public/vendor/live2d/live2dcubismcore.min.js', import.meta.url), 'utf8');
  const sandbox = { console, setTimeout, clearTimeout, TextDecoder, TextEncoder, atob, btoa, window: {}, document: { currentScript: { src: 'https://petpal.test/vendor/live2d/live2dcubismcore.min.js' } } };
  vm.runInNewContext(source, sandbox, { timeout: 2000, filename: 'licensed-live2dcubismcore.min.js' });
  const core = await waitForCubismCore(() => sandbox.Live2DCubismCore);
  globalThis.Live2DCubismCore = core;
  const framework = await import('../public/avatars/cubism-runtime/framework.mjs');
  const lease = acquireCubismFramework(framework, core);
  const moc = buffer(await fs.readFile(new URL('../public/avatars/akari-cubism-v2/akari.moc3', import.meta.url)));
  let avatar;
  const create = () => {
    avatar = new framework.CubismUserModel(); avatar.loadModel(moc, true);
    const model = avatar.getModel();
    const bridge = createCubismParameterBridge(model, framework.CubismFramework.getIdManager());
    return { model, bridge };
  };
  try {
    let { model, bridge } = create();
    const motions = new Map();
    for (const [name, values] of [['TapHead_0', { ParamAngleX: -3, ParamAngleY: -4, ParamBodyAngleX: 1.2 }], ['Greet_0', { ParamAngleZ: 2 }]]) {
      const curves = Object.entries(values).map(([Id, value]) => ({ Target: 'Parameter', Id, Segments: [0, value, 0, 1.5, value] }));
      const bytes = new TextEncoder().encode(JSON.stringify({ Version: 3, Meta: { Duration: 1.5, Fps: 30, Loop: false, AreBeziersRestricted: true, CurveCount: curves.length, TotalSegmentCount: curves.length, TotalPointCount: curves.length * 2, UserDataCount: 0, TotalUserDataSize: 0 }, FadeInTime: .01, FadeOutTime: .25, Curves: curves })).buffer;
      const motion = avatar.loadMotion(bytes, bytes.byteLength, name);
      motion.setEffectIds([], []);
      motion.setFadeInTime(.01); motion.setFadeOutTime(.25);
      motions.set(name, { motion, parameters: new Set(Object.keys(values)) });
    }
    const controller = createCubismFrameController({ model, avatar, bridge, motions });
    const follow = { headX: 1, headY: 1, headTilt: 1, bodyXPercent: .65 };
    controller.react('pet');
    for (let frame = 0; frame < 6; frame++) controller.update(.1, { headShake: 1, headNod: 1, bodyTurn: 1 }, follow);
    close(bridge.read('ParamAngleX'), -3);
    close(bridge.read('ParamAngleY'), -4);
    close(bridge.read('ParamBodyAngleX'), 1.2);
    controller.react('greet');
    controller.update(.1, {}, follow);
    assert.equal(avatar._motionManager.getCubismMotionQueueEntries().length, 2);
    // The outgoing authored angle stays negative. A pointer add would change
    // it to a positive turn before its official fade completes.
    assert.ok(bridge.read('ParamAngleX') < 0);
    for (let frame = 0; frame < 5; frame++) controller.update(.1, {}, follow);
    assert.equal(avatar._motionManager.getCubismMotionQueueEntries().length, 1);
    close(bridge.read('ParamAngleX'), 12);
    close(bridge.read('ParamAngleZ'), 2);

    avatar.release(); ({ model, bridge } = create());
    const standard = createCubismFrameController({ model, avatar, bridge });
    standard.update(.1, { speaking: true, mouthOpen: .9, eyeSmile: 1 });
    close(bridge.read('ParamMouthOpenY'), .9);
    close(bridge.read('ParamEyeBallForm'), 0);
    avatar.release(); ({ model, bridge } = create());
    const stable = createCubismFrameController({ model, avatar, bridge, deformationProfile: 'akari-stable' });
    stable.update(.1, { speaking: true, mouthOpen: .9 });
    close(bridge.read('ParamMouthOpenY'), .6);
    stable.update(0, { speaking: false });
    assert.equal(bridge.read('ParamMouthOpenY'), 0);

    avatar.release(); ({ model, bridge } = create());
    const bytes = new TextEncoder().encode(JSON.stringify({ Type: 'Live2D Expression', FadeInTime: .01, FadeOutTime: .1, Parameters: [{ Id: 'ParamEyeBallForm', Value: -.35, Blend: 'Overwrite' }] })).buffer;
    const expressions = new Map([['authored', { motion: avatar.loadExpression(bytes, bytes.byteLength, 'authored'), parameters: new Set(['ParamEyeBallForm']) }]]);
    const authored = createCubismFrameController({ model, avatar, bridge, expressions });
    for (let frame = 0; frame < 6; frame++) authored.update(.1, { expression: 'authored', eyeSmile: 1 });
    close(bridge.read('ParamEyeBallForm'), -.35);
  } finally {
    avatar?.release(); lease.release(); delete globalThis.Live2DCubismCore;
  }
});
