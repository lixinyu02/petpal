import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAvatarPerformance } from '../src/avatar/performance.mjs';
import { createAvatarPresence } from '../src/avatar/presence.mjs';
import { cubismParameterTargets, createCubismParameterBridge } from '../src/avatar/cubism/parameters.mjs';
import { createCubismFrameController } from '../src/avatar/cubism/runtime.mjs';
import { filterFeatureMotion, readFeatureRig, buildFeatureBundle, writeFeaturePackage } from '../scripts/authoring/prepare-akari-feature-motions.mjs';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} differs from ${expected}`);
const features = ['ParamEyeLOpen', 'ParamEyeROpen', 'ParamEyeBallX', 'ParamEyeBallY', 'ParamBrowLY', 'ParamBrowRY', 'ParamBrowLAngle', 'ParamBrowRAngle'];
const options = { deformationProfile: 'reference-features', supportedParameters: features };
const patches = ['ParamWarm', 'ParamSad', 'ParamPout', 'ParamShy', 'ParamSurprise', 'ParamRelaxed'];
const targets = (pose, follow = {}, state = {}) => cubismParameterTargets(pose, follow, { ...options, ...state });

test('split-feature portrait keeps continuous intermediate eye and brow poses without whole-face patch changes', () => {
  let previousEye = 1, previousBrow = 0;
  for (let step = 0; step <= 100; step++) {
    const amount = step / 100;
    const target = targets({ eyeSmile: amount, reliefAmount: amount, browRaise: amount, browTilt: amount, warmAmount: amount, sadAmount: amount, poutAmount: amount, shyAmount: amount, surpriseAmount: amount });
    assert.ok(target.ParamEyeLOpen <= previousEye); assert.ok(target.ParamBrowLY >= previousBrow);
    close(target.ParamBrowLY, target.ParamBrowRY); close(target.ParamBrowLAngle, -target.ParamBrowRAngle);
    assert.ok(target.ParamEyeLOpen >= .26); assert.ok(patches.every(name => !target[name]));
    previousEye = target.ParamEyeLOpen; previousBrow = target.ParamBrowLY;
  }
  const halfway = targets({ sleepyAmount: .5, browRaise: .5, browTilt: .5 });
  assert.ok(halfway.ParamEyeLOpen > .58 && halfway.ParamEyeLOpen < 1);
  assert.ok(halfway.ParamBrowLY > 0 && halfway.ParamBrowLY < .7);
  const oldPortrait = cubismParameterTargets({ shyAmount: .5, eyeSmile: .8 }, {}, { deformationProfile: 'reference-layered', supportedParameters: ['ParamShy'] });
  assert.equal(oldPortrait.ParamShy, 1); assert.equal(oldPortrait.ParamEyeLOpen, 1, 'V10 discrete artwork must retain its earlier behavior');
});

test('existing dialogue emotion and gaze springs drive real feature targets without applying semantic gaze twice', () => {
  const result = new Map();
  for (const [name, text] of [['happy', '我很开心。'], ['sad', '我很伤心。'], ['shy', '我有点害羞。'], ['surprised', '我很惊讶。'], ['relieved', '我终于放心了。']]) {
    const performance = createAvatarPerformance(), presence = createAvatarPresence();
    let pose, follow;
    for (let frame = 0; frame < 12; frame++) {
      performance.setInput({ utteranceId: `feature-${name}`, text, phase: 'speaking', speech: { active: true, charIndex: 0, audioLevel: .55 } });
      pose = performance.step(.05);
      follow = presence.step(.05, { gazeX: pose.gazeOffsetX, gazeY: pose.gazeOffsetY, phase: 'speaking' });
    }
    assert.equal(pose.expression, name);
    const target = targets(pose, follow);
    close(target.ParamEyeBallX, follow.gazeX); close(target.ParamEyeBallY, follow.gazeY);
    assert.ok(patches.every(parameter => !target[parameter]));
    result.set(name, target);
  }
  assert.ok(result.get('happy').ParamEyeLOpen < result.get('surprised').ParamEyeLOpen);
  assert.ok(result.get('sad').ParamBrowLAngle > result.get('happy').ParamBrowLAngle);
  assert.ok(result.get('surprised').ParamBrowLY > result.get('shy').ParamBrowLY);
  assert.ok(result.get('shy').ParamEyeBallX < -.15);
  assert.ok(result.get('relieved').ParamEyeLOpen < result.get('surprised').ParamEyeLOpen);
});

test('continuous lids combine with independent blink and preserve speech mouth coverage and immediate silence', () => {
  const pose = { sleepyAmount: .8, blinkLeft: 1, blinkRight: .5, speaking: true, mouthOpen: .58, mouthShape: 'O', surpriseAmount: 1 };
  const target = targets(pose);
  assert.equal(target.ParamEyeLOpen, 0); close(target.ParamEyeROpen, (1 - .8 * .42) * .5);
  assert.equal(target.ParamMouthA, 1); assert.equal(target.ParamMouthO, 1); close(target.ParamMouthOpenY, .58);
  const silence = targets({ ...pose, speaking: false, voiceEnergy: 1 });
  for (const name of ['ParamMouthOpenY', 'ParamMouthA', 'ParamMouthO']) assert.equal(silence[name], 0);
  for (const state of [{ hidden: true }, { sleeping: true }]) {
    const quiet = targets({ ...pose, browRaise: 1, browTilt: 1, blush: 1 }, { gazeX: 1, gazeY: -1 }, state);
    for (const name of ['ParamBrowLY', 'ParamBrowRY', 'ParamBrowLAngle', 'ParamBrowRAngle', 'ParamEyeBallX', 'ParamEyeBallY', 'ParamCheek', 'ParamMouthOpenY', 'ParamMouthA', 'ParamMouthO']) assert.equal(quiet[name], 0);
    assert.equal(quiet.ParamEyeLOpen, state.sleeping ? 0 : 1); assert.equal(quiet.ParamEyeROpen, state.sleeping ? 0 : 1);
  }
  const reduced = targets({ ...pose, blinkLeft: 0, blinkRight: 0 }, { gazeX: .8 }, { reducedMotion: true });
  assert.equal(reduced.ParamEyeBallX, 0); close(reduced.ParamMouthOpenY, .58); assert.ok(reduced.ParamEyeLOpen < 1);
});

function frameRig() {
  const names = [...features, 'ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamHandsLift', 'ParamHandsSway', 'ParamSleeveEase', 'ParamMouthOpenY', 'ParamMouthA', 'ParamMouthO'];
  const indices = new Map(names.map((name, index) => [name, index]));
  const defaults = names.map(name => /^ParamEye[LR]Open$/u.test(name) ? 1 : 0), values = [...defaults], writes = [];
  const model = {
    getParameterCount: () => names.length, getParameterIndex: name => indices.get(name) ?? names.length + 20,
    getParameterMinimumValue: index => /^ParamAngle/u.test(names[index]) ? -30 : /Open|Mouth[AO]$|HandsLift|SleeveEase/u.test(names[index]) ? 0 : -1,
    getParameterMaximumValue: index => /^ParamAngle/u.test(names[index]) ? 30 : 1,
    getParameterValueByIndex: index => values[index],
    setParameterValueByIndex: (index, value) => { assert.ok(index < names.length); values[index] = value; writes.push(names[index]); },
    saveParameters() {}, loadParameters() { values.splice(0, values.length, ...defaults); }, update() {},
  };
  const set = (name, value) => model.setParameterValueByIndex(indices.get(name), value);
  const queue = () => ({
    entries: [], starts: [], isFinished() { return !this.entries.length; }, getCubismMotionQueueEntries() { return this.entries; },
    stopAllMotions() { this.entries.length = 0; },
    startMotion(motion) { this.starts.push(motion); this.entries.push({ getCubismMotion: () => motion }); },
    startMotionPriority(motion) { this.startMotion(motion); },
    updateMotion() { for (const entry of this.entries) for (const [name, value] of Object.entries(entry.getCubismMotion())) set(name, value); },
  });
  const motionManager = queue(), expressionManager = queue();
  const motions = new Map(Object.entries({ Idle_0: { ParamEyeLOpen: .2, ParamEyeROpen: .2 }, Wink_0: { ParamEyeROpen: .1 }, TapHead_0: { ParamAngleX: -2, ParamBrowLY: .5, ParamBrowLAngle: .25, ParamHandsLift: .4 }, Sway_0: { ParamHandsLift: .25 } }).map(([name, motion]) => [name, { motion, parameters: new Set(Object.keys(motion)) }]));
  const avatar = { _motionManager: motionManager, _expressionManager: expressionManager, _physics: { evaluate() { set('ParamMouthOpenY', 1); set('ParamMouthA', 1); set('ParamMouthO', 1); } } };
  const bridge = createCubismParameterBridge(model, { getId: name => name });
  const controller = createCubismFrameController({ model, avatar, bridge, motions, deformationProfile: 'reference-features' });
  return { controller, bridge, writes, motionManager };
}

test('feature controller suppresses idle double blinking, preserves native Wink and manual ownership, and clears lifecycle queues', () => {
  const rig = frameRig();
  assert.equal(rig.bridge.supported.includes('ParamCheek'), false); assert.equal(rig.bridge.supported.includes('ParamMouthForm'), false);
  rig.controller.update(.1, { sleepyAmount: .5, blinkLeft: .5 });
  close(rig.bridge.read('ParamEyeLOpen'), .395); close(rig.bridge.read('ParamEyeROpen'), .79);
  rig.controller.update(.1, { gesture: 'wink', gestureCueId: 'wink-feature-1', blinkLeft: 1, blinkRight: 1, speaking: true, mouthOpen: .4, mouthShape: 'O' }, {}, { phase: 'speaking', utteranceId: 'speech-1', speechActive: true });
  assert.equal(rig.controller.motionGroup, 'Wink'); assert.equal(rig.bridge.read('ParamEyeLOpen'), 0); close(rig.bridge.read('ParamEyeROpen'), .1);
  close(rig.bridge.read('ParamMouthOpenY'), .4); assert.equal(rig.bridge.read('ParamMouthA'), 1); assert.equal(rig.bridge.read('ParamMouthO'), 1);
  rig.controller.react('pet');
  rig.controller.update(.1, { gesture: 'wink', gestureCueId: 'wink-feature-2', browRaise: .1, browTilt: .1 });
  assert.equal(rig.controller.motionGroup, 'TapHead'); close(rig.bridge.read('ParamBrowLY'), .5); close(rig.bridge.read('ParamBrowLAngle'), .25);
  assert.ok(rig.bridge.read('ParamHandsLift') > .3 && rig.bridge.read('ParamHandsLift') < .4, 'hands approach the native pose without a visible handoff step');
  for (const name of ['ParamMouthOpenY', 'ParamMouthA', 'ParamMouthO']) assert.equal(rig.bridge.read(name), 0, 'Silent articulation overrides native physics immediately');
  rig.controller.update(0, { gesture: 'wink', gestureCueId: 'wink-feature-2', speaking: true, mouthOpen: 1 }, {}, { hidden: true });
  assert.equal(rig.motionManager.entries.length, 0); assert.equal(rig.controller.motionGroup, '');
  rig.controller.update(.1, { gesture: 'none' }); assert.equal(rig.controller.motionGroup, 'Idle');
  assert.ok(rig.writes.every(name => !patches.includes(name) && name !== 'ParamCheek' && name !== 'ParamMouthForm'), 'Only real mesh channels may be written');
});

test('V11 geometry hands off between pointer and native motion continuously without easing away blink or mouth authority', () => {
  const rig = frameRig();
  for (let frame = 0; frame < 60; frame++) rig.controller.update(1 / 60, {}, { headX: 1 });
  close(rig.bridge.read('ParamAngleX'), 12);
  rig.controller.react('pet'); rig.controller.update(0, {}, { headX: 1 });
  close(rig.bridge.read('ParamAngleX'), 12, 'zero-time ownership changes retain the rendered joint');
  rig.controller.update(1 / 60, { blinkLeft: 1, speaking: true, mouthOpen: .7, mouthShape: 'A' }, { headX: 1 });
  assert.ok(rig.bridge.read('ParamAngleX') > 8 && rig.bridge.read('ParamAngleX') < 12);
  assert.equal(rig.bridge.read('ParamEyeLOpen'), 0); close(rig.bridge.read('ParamMouthOpenY'), .7);
  rig.motionManager.entries.length = 0;
  const before = rig.bridge.read('ParamAngleX'); rig.controller.update(0, {}, { headX: -1 }); close(rig.bridge.read('ParamAngleX'), before);
  rig.controller.update(0, {}, {}, { hidden: true }); assert.equal(rig.bridge.read('ParamAngleX'), 0);
  rig.controller.update(.1); rig.controller.react('hand'); rig.controller.update(.1);
  assert.equal(rig.controller.motionGroup, 'Sway'); assert.ok(rig.bridge.read('ParamHandsLift') > 0 && rig.bridge.read('ParamHandsLift') < .25);
});

test('motion filter removes deleted and virtual parameters, recounts retained Beziers, and fails on invalid real keys', () => {
  const parameters = new Map([['ParamBrowLY', { min: -1, max: 1, default: 0 }]]);
  const source = { Version: 3, Meta: { Duration: 1, Loop: false, CurveCount: 90 }, Curves: [
    { Target: 'Parameter', Id: 'ParamBrowLY', Segments: [0, 0, 1, .1, 0, .2, .5, .3, .5, 0, 1, 0] },
    { Target: 'Parameter', Id: 'ParamWarm', Segments: [0, 0, 0, 1, 1] },
    { Target: 'Model', Id: 'Opacity', Segments: [0, 1, 0, 1, 1] },
  ] };
  const filtered = filterFeatureMotion(source, parameters);
  assert.deepEqual(filtered.Curves.map(curve => curve.Id), ['ParamBrowLY']);
  assert.deepEqual([filtered.Meta.CurveCount, filtered.Meta.TotalSegmentCount, filtered.Meta.TotalPointCount], [1, 2, 5]);
  assert.equal(source.Curves.length, 3, 'Reviewed source must not be mutated');
  const invalid = structuredClone(source); invalid.Curves[0].Segments[8] = 1.1;
  assert.throws(() => filterFeatureMotion(invalid, parameters), /exceeds real MOC range/);
  assert.throws(() => filterFeatureMotion(source, new Map()), /empty native motion/);
  const duplicate = structuredClone(source); duplicate.Curves.push(duplicate.Curves[0]);
  assert.throws(() => filterFeatureMotion(duplicate, parameters), /only one motion curve/);
  const zeroDuration = structuredClone(source); zeroDuration.Curves[0].Segments = [0, 0, 0, 0, .2, 0, 1, 0];
  assert.throws(() => filterFeatureMotion(zeroDuration, parameters), /Zero-duration motion segment/);
  const truncated = structuredClone(source); truncated.Curves[0].Segments.pop();
  assert.throws(() => filterFeatureMotion(truncated, parameters), /Invalid motion segment/);
  for (const segment of [0, 2, 3]) {
    const steps = structuredClone(source); steps.Curves[0].Segments = [0, 0, segment, .5, .3, segment, 1, 0];
    const counted = filterFeatureMotion(steps, parameters);
    assert.equal(counted.Meta.TotalSegmentCount, 2); assert.equal(counted.Meta.TotalPointCount, 3);
  }
});

test('package preflight detects authoring conflicts before writing runtime and supports an identical interrupted retry', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'petpal-feature-package-'));
  t.after(async () => { assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  const output = path.join(root, 'authoring'), published = path.join(root, 'public');
  const runtimeFiles = new Map([['akari.model3.json', Buffer.from('manifest')], ['akari.moc3', Buffer.from('MOC')], ['atlas/texture.png', Buffer.from('texture')]]);
  const authoringFiles = new Map([['akari.cmo3', Buffer.from('editable')], ['receipt.json', Buffer.from('receipt')]]);
  await fs.mkdir(output); await fs.writeFile(path.join(output, 'akari.cmo3'), 'different editable');
  assert.throws(() => writeFeaturePackage(published, runtimeFiles, output, authoringFiles), /different V11 asset/);
  assert.equal(fsSync.existsSync(published), false); assert.equal(fsSync.existsSync(path.join(output, 'receipt.json')), false);
  await fs.writeFile(path.join(output, 'akari.cmo3'), 'editable');
  const originalLink = fsSync.linkSync;
  try {
    fsSync.linkSync = (from, to) => {
      if (to.endsWith('texture.png')) throw Object.assign(new Error('test disk full'), { code: 'ENOSPC' });
      return originalLink(from, to);
    };
    assert.throws(() => writeFeaturePackage(published, runtimeFiles, output, authoringFiles), /test disk full/);
  } finally { fsSync.linkSync = originalLink; }
  assert.equal(await fs.readFile(path.join(published, 'akari.moc3'), 'utf8'), 'MOC');
  assert.equal(fsSync.existsSync(path.join(published, 'akari.model3.json')), false, 'Manifest cannot advertise an incomplete package');
  assert.deepEqual(await fs.readdir(path.join(published, 'atlas')), [], 'Failed atomic writes leave no visible or partial asset');
  writeFeaturePackage(published, runtimeFiles, output, authoringFiles);
  writeFeaturePackage(published, runtimeFiles, output, authoringFiles);
  for (const [name, bytes] of runtimeFiles) assert.deepEqual(await fs.readFile(path.join(published, name)), bytes);
  for (const [name, bytes] of authoringFiles) assert.deepEqual(await fs.readFile(path.join(output, name)), bytes);
});

test('all 16 reviewed motions remain valid when filtered against an actual Core parameter set minus removed face patches', async () => {
  const root = new URL('../public/avatars/akari-cubism-v10/', import.meta.url), manifest = JSON.parse(await fs.readFile(new URL('akari.model3.json', root), 'utf8'));
  const rig = await readFeatureRig(await fs.readFile(new URL(manifest.FileReferences.Moc, root)));
  for (const id of patches) rig.parameters.delete(id);
  let count = 0;
  for (const entries of Object.values(manifest.FileReferences.Motions)) for (const entry of entries) {
    const source = JSON.parse(await fs.readFile(new URL(entry.File, root), 'utf8'));
    const filtered = filterFeatureMotion(source, rig.parameters);
    assert.ok(filtered.Curves.every(curve => rig.parameters.has(curve.Id) && !patches.includes(curve.Id)));
    assert.equal(filtered.Meta.Duration, source.Meta.Duration); count++;
  }
  assert.equal(count, 16);
  // Packaging must not mistake an existing patch rig for a feature rig.
  const rawFiles = new Map([['akari.model3.json', Buffer.from(JSON.stringify(manifest))], ['akari.psd2live.json', Buffer.from(JSON.stringify({ petpalAuthoringProfile: 'reference-features', nativeBoundParameterIds: [...rig.parameters.keys()] }))]]);
  assert.throws(() => buildFeatureBundle(rawFiles, rawFiles, rig), /Continuous feature missing/);
});
