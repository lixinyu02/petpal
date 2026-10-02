import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { acquireCubismFramework, waitForCubismCore } from '../src/avatar/cubism/runtime.mjs';
import { buildExpressionBundle, buildExpressionMotions } from '../scripts/authoring/prepare-akari-expression-motions.mjs';

const root = new URL('../public/avatars/', import.meta.url);
const arrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const expectedGroups = ['Curious', 'Think', 'Listen', 'Surprise', 'Reassure', 'Wink', 'Doze'];
let core, framework, lease, previousCore, manifest, setting, moc, sourceFiles, actualFiles;

async function readBundle(directory, prefix = '', files = new Map()) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) await readBundle(new URL(`${entry.name}/`, directory), `${name}/`, files);
    else files.set(name, await fs.readFile(new URL(entry.name, directory)));
  }
  return files;
}

before(async () => {
  [sourceFiles, actualFiles] = await Promise.all([readBundle(new URL('akari-cubism-v8/', root)), readBundle(new URL('akari-cubism-v9/', root))]);
  const source = await fs.readFile(new URL('../public/vendor/live2d/live2dcubismcore.min.js', import.meta.url), 'utf8');
  const sandbox = { console, setTimeout, clearTimeout, TextDecoder, TextEncoder, atob, btoa, window: {}, document: { currentScript: { src: 'https://petpal.test/vendor/live2d/live2dcubismcore.min.js' } } };
  vm.runInNewContext(source, sandbox, { timeout: 2000, filename: 'licensed-live2dcubismcore.min.js' });
  core = await waitForCubismCore(() => sandbox.Live2DCubismCore);
  previousCore = globalThis.Live2DCubismCore; globalThis.Live2DCubismCore = core;
  framework = await import('../public/avatars/cubism-runtime/framework.mjs');
  lease = acquireCubismFramework(framework, core);
  const bytes = arrayBuffer(actualFiles.get('akari.model3.json'));
  manifest = JSON.parse(actualFiles.get('akari.model3.json'));
  setting = new framework.CubismModelSettingJson(bytes, bytes.byteLength);
  moc = arrayBuffer(actualFiles.get(manifest.FileReferences.Moc));
  assert.equal(framework.CubismMoc.hasMocConsistency(moc), true);
});

after(() => {
  lease?.release();
  if (previousCore === undefined) delete globalThis.Live2DCubismCore;
  else globalThis.Live2DCubismCore = previousCore;
});

function rig(t, group) {
  const avatar = new framework.CubismUserModel(); avatar.loadModel(moc, true);
  t.after(() => avatar.release());
  const model = avatar.getModel(), native = model.getModel();
  const bytes = arrayBuffer(actualFiles.get(manifest.FileReferences.Motions[group][0].File));
  const motion = avatar.loadMotion(bytes, bytes.byteLength, group, undefined, undefined, setting, group, 0, true);
  assert.ok(motion, `Actual Framework must parse ${group}`);
  motion.setEffectIds(Array.from({ length: setting.getEyeBlinkParameterCount() }, (_, i) => setting.getEyeBlinkParameterId(i)), Array.from({ length: setting.getLipSyncParameterCount() }, (_, i) => setting.getLipSyncParameterId(i)));
  const defaults = new Float32Array(native.parameters.defaultValues);
  native.parameters.values.set(defaults); model.update();
  const rest = Array.from(native.drawables.vertexPositions, values => new Float32Array(values));
  const ids = new Map(Array.from(native.parameters.ids, (name, index) => [name, index]));
  avatar._motionManager.startMotionPriority(motion, false, 3);
  return { native, defaults, rest, read: id => native.parameters.values[ids.get(id)], tick() {
    // Fresh neutral contribution per sample isolates the authored native motion
    // from stale parameters, runtime pose input and unrelated eye-blink logic.
    native.parameters.values.set(defaults);
    avatar._motionManager.updateMotion(model, 1 / 60);
    model.update();
  } };
}

test('V9 is a deterministic 16-group motion-only extension preserving the actual V8 rig and nine motions byte for byte', () => {
  const originals = new Map([...sourceFiles].map(([name, bytes]) => [name, hash(bytes)]));
  const generated = buildExpressionBundle(sourceFiles), again = buildExpressionBundle(sourceFiles);
  assert.deepEqual([...sourceFiles].map(([name, bytes]) => [name, hash(bytes)]), [...originals], 'Pure preparation must not mutate V8 inputs');
  assert.deepEqual([...generated.keys()].sort(), [...actualFiles.keys()].sort());
  for (const [name, bytes] of generated) {
    assert.equal(hash(again.get(name)), hash(bytes), `${name} must reproduce identically`);
    assert.equal(hash(actualFiles.get(name)), hash(bytes), `${name} must match delivered V9`);
    assert.ok(!name.startsWith('/') && !name.includes('..'), 'Every planned output stays inside V9');
  }
  for (const [name, bytes] of sourceFiles) if (!['akari.model3.json', 'README.md'].includes(name)) assert.equal(hash(actualFiles.get(name)), hash(bytes), `Reviewed V8 file changed: ${name}`);
  assert.equal(hash(actualFiles.get('akari.moc3')), '29ebb1c652f658b2033996583409b920beecd94d2c2b3667b6c67e6820694246');
  assert.equal(Object.keys(manifest.FileReferences.Motions).length, 16, 'Do not silently raise the runtime resource bound');
  const oldManifest = JSON.parse(sourceFiles.get('akari.model3.json'));
  for (const [group, entries] of Object.entries(oldManifest.FileReferences.Motions)) assert.deepEqual(manifest.FileReferences.Motions[group], entries);
  const nativeMoc = core.Moc.fromArrayBuffer(moc), nativeModel = core.Model.fromMoc(nativeMoc);
  try { assert.equal(nativeModel.parameters.count, 19); assert.equal(nativeModel.drawables.count, 11); }
  finally { nativeModel.release(); nativeMoc._release(); }
});

test('all seven native curve assets use existing parameter ranges, remain bounded and start/end at neutral', t => {
  const value = rig(t, 'Curious'), parameters = value.native.parameters;
  const generated = buildExpressionMotions();
  assert.deepEqual([...generated.keys()], expectedGroups);
  assert.deepEqual([...generated.values()].map(item => item.Meta.Duration), [1.6, 1.6, 1.9, 1.25, 1.9, 1.35, 2.4]);
  for (const [group, motion] of generated) {
    assert.deepEqual(JSON.parse(actualFiles.get(manifest.FileReferences.Motions[group][0].File)), motion);
    assert.equal(motion.Meta.Loop, false); assert.equal(motion.Meta.CurveCount, motion.Curves.length);
    let segments = 0, points = 0;
    for (const curve of motion.Curves) {
      assert.equal(curve.Target, 'Parameter');
      const index = Array.from(parameters.ids).indexOf(curve.Id);
      assert.ok(index >= 0, `${group}: ${curve.Id} must be native`);
      assert.ok(!/Mouth|Pout|Sad|Warm/.test(curve.Id), `${group} must not replace talking mouth or expression patches`);
      assert.equal(curve.Segments[0], 0); assert.equal(curve.Segments[1], parameters.defaultValues[index]);
      assert.equal(curve.Segments.at(-2), motion.Meta.Duration); assert.equal(curve.Segments.at(-1), parameters.defaultValues[index]);
      points++;
      let previousTime = 0;
      for (let i = 2; i < curve.Segments.length;) {
        assert.equal(curve.Segments[i++], 1, 'Only smooth restricted cubic curves are authored'); segments++;
        for (let p = 0; p < 3; p++) {
          const time = curve.Segments[i++], input = curve.Segments[i++]; points++;
          assert.ok(Number.isFinite(time) && time >= previousTime && time <= motion.Meta.Duration); previousTime = time;
          assert.ok(Number.isFinite(input) && input >= parameters.minimumValues[index] && input <= parameters.maximumValues[index]);
          if (/Angle/.test(curve.Id)) assert.ok(Math.abs(input) <= 3, 'Preserve the restrained face/body movement envelope');
        }
      }
    }
    assert.equal(motion.Meta.TotalSegmentCount, segments); assert.equal(motion.Meta.TotalPointCount, points);
  }
});

function area(vertices, a, b, c) {
  return (vertices[b] - vertices[a]) * (vertices[c + 1] - vertices[a + 1]) - (vertices[b + 1] - vertices[a + 1]) * (vertices[c] - vertices[a]);
}

test('actual Framework playback of all seven new groups keeps real Core vertices finite and triangle orientation intact', t => {
  for (const [group, motion] of buildExpressionMotions()) {
    const value = rig(t, group), native = value.native, ppu = native.canvasinfo.PixelsPerUnit;
    let maxMovement = 0;
    for (let frame = 0; frame <= Math.ceil((motion.Meta.Duration + .2) * 60); frame++) {
      value.tick();
      for (let d = 0; d < native.drawables.count; d++) {
        const current = native.drawables.vertexPositions[d], rest = value.rest[d], indices = native.drawables.indices[d];
        for (let i = 0; i < current.length; i += 2) {
          assert.ok(Number.isFinite(current[i]) && Number.isFinite(current[i + 1]), `${group}: non-finite vertex`);
          maxMovement = Math.max(maxMovement, Math.hypot(current[i] - rest[i], current[i + 1] - rest[i + 1]) * ppu);
        }
        for (let i = 0; i < indices.length; i += 3) {
          const a = indices[i] * 2, b = indices[i + 1] * 2, c = indices[i + 2] * 2, original = area(rest, a, b, c);
          if (Math.abs(original) * ppu * ppu < .25) continue;
          assert.ok(original * area(current, a, b, c) > 0, `${group}: inverted native triangle ${d}:${i / 3}`);
        }
      }
      for (let i = 0; i < native.parameters.count; i++) assert.ok(native.parameters.values[i] >= native.parameters.minimumValues[i] - 1e-6 && native.parameters.values[i] <= native.parameters.maximumValues[i] + 1e-6);
    }
    assert.ok(maxMovement > .2 && maxMovement < 24, `${group}: movement must be visible yet restrained (${maxMovement} px)`);
    assert.deepEqual(Array.from(native.parameters.values), Array.from(value.defaults), `${group}: native playback must settle at neutral`);
  }
});

test('Wink closes only the right eye and Doze briefly closes both without taking over the mouth', t => {
  for (const group of ['Wink', 'Doze']) {
    const value = rig(t, group), motion = buildExpressionMotions().get(group), samples = [];
    for (let frame = 0; frame < Math.ceil((motion.Meta.Duration + .1) * 60); frame++) {
      value.tick();
      samples.push([value.read('ParamEyeLOpen'), value.read('ParamEyeROpen')]);
      for (const id of ['ParamMouthOpenY', 'ParamMouthA', 'ParamMouthO', 'ParamWarm', 'ParamSad', 'ParamPout']) assert.equal(value.read(id), 0, `${group} must leave ${id} alone`);
    }
    const closed = samples.filter(sample => sample[1] < .01);
    assert.ok(closed.length >= 5, `${group} must actually reach full right-eye closure`);
    assert.ok(closed.length < 25, `${group} must reopen promptly`);
    if (group === 'Wink') assert.ok(samples.every(sample => sample[0] === 1), 'Wink asset must not close the left eye');
    else assert.ok(closed.every(sample => sample[0] < .01), 'Doze must briefly close both eyes together');
    assert.deepEqual(samples.at(-1), [1, 1]);
  }
});
