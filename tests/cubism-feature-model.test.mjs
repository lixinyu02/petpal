import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { waitForCubismCore } from '../src/avatar/cubism/runtime.mjs';

let core, previous, current;
const arrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
async function loadModel(manifestPath) {
  const directory = path.dirname(manifestPath);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const info = JSON.parse(await fs.readFile(path.join(directory, manifest.FileReferences.DisplayInfo), 'utf8'));
  const data = arrayBuffer(await fs.readFile(path.join(directory, manifest.FileReferences.Moc)));
  assert.equal(Object.create(core.Moc.prototype).hasMocConsistency(data), 1);
  const moc = core.Moc.fromArrayBuffer(data), model = core.Model.fromMoc(moc);
  return {
    model, parameters: new Map(Array.from(model.parameters.ids, (id, index) => [id, index])),
    drawings: new Map(info.Drawables.map(item => [item.Name.trim().toLowerCase(), Array.from(model.drawables.ids).indexOf(item.Id)])),
    release() { model.release(); moc._release(); },
  };
}
before(async () => {
  const source = await fs.readFile(new URL('../public/vendor/live2d/live2dcubismcore.min.js', import.meta.url), 'utf8');
  const sandbox = { console, setTimeout, clearTimeout, TextDecoder, TextEncoder, atob, btoa, window: {}, document: { currentScript: { src: 'https://petpal.test/vendor/live2d/live2dcubismcore.min.js' } } };
  vm.runInNewContext(source, sandbox, { timeout: 2000 });
  core = await waitForCubismCore(() => sandbox.Live2DCubismCore);
  previous = await loadModel(fileURLToPath(new URL('../public/avatars/akari-cubism-v10/akari.model3.json', import.meta.url)));
  current = await loadModel(process.env.PETPAL_FEATURE_MANIFEST || fileURLToPath(new URL('../public/avatars/akari-cubism-v11/akari.model3.json', import.meta.url)));
});
after(() => { current?.release(); previous?.release(); });
function sample(rig, values = {}) {
  rig.model.parameters.values.set(rig.model.parameters.defaultValues);
  for (const [id, value] of Object.entries(values)) {
    assert.ok(rig.parameters.has(id), `Native parameter missing: ${id}`);
    rig.model.parameters.values[rig.parameters.get(id)] = value;
  }
  rig.model.update();
  return { points: Array.from(rig.model.drawables.vertexPositions, points => Array.from(points)), opacity: Array.from(rig.model.drawables.opacities) };
}
function closeArray(actual, expected, message, epsilon = 1e-6) {
  assert.equal(actual.length, expected.length, `${message}: vertex count`);
  for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) <= epsilon, `${message}: coordinate ${i}`);
}

test('V11 exports distinct native eye meshes and real aperture masks without whole-face expression patches', () => {
  assert.equal(current.model.drawables.count, 16);
  for (const side of ['left', 'right']) {
    for (const name of ['eyebrow', 'eye-white', 'iris', 'eyelash-upper', 'eyelash-lower']) assert.ok(current.drawings.has(`${name}-${side}`));
    const iris = current.drawings.get(`iris-${side}`), white = current.drawings.get(`eye-white-${side}`);
    assert.deepEqual(Array.from(current.model.drawables.masks[iris]), [white]);
  }
  for (const name of ['warm', 'sad', 'pout', 'shy', 'surprise', 'relaxed', 'blink-left', 'blink-right']) assert.equal(current.drawings.has(name), false);
  assert.equal(current.parameters.has('ParamMouthForm'), false, 'Existing A/O mouth contract is not an invented new mouth-form binding');
});

test('V11 preserves V10 body, hand and hair geometry under combined native motions', () => {
  for (const angle of [-1, 0, 1]) for (const hands of [0, .5, 1]) {
    const values = { ParamAngleX: angle * 45, ParamAngleY: angle * 30, ParamAngleZ: angle * 30,
      ParamBodyAngleX: angle * 10, ParamBodyAngleY: angle * 10, ParamBodyAngleZ: angle * 10,
      ParamHairFront: angle, ParamBreath: hands, ParamHandsLift: hands, ParamHandsSway: angle, ParamSleeveEase: hands };
    const before = sample(previous, values), after = sample(current, values);
    for (const name of ['topwear', 'front hair 1', 'front hair 2', 'mouth-a', 'mouth-o']) closeArray(after.points[current.drawings.get(name)], before.points[previous.drawings.get(name)], `${name}: ${JSON.stringify(values)}`);
  }
});

test('gaze is a rigid iris-only translation even while each eye closes independently', () => {
  for (const left of [0, .17, .53, 1]) for (const right of [0, .37, .81, 1]) {
    const base = { ParamEyeLOpen: left, ParamEyeROpen: right };
    const rest = sample(current, base);
    for (const x of [-1, -.33, .57, 1]) {
      const pose = sample(current, { ...base, ParamEyeBallX: x, ParamEyeBallY: -x });
      for (const [name, index] of current.drawings) {
        if (!name.startsWith('iris-')) closeArray(pose.points[index], rest.points[index], `gaze moved ${name}`);
        else {
          const delta = pose.points[index].map((value, i) => value - rest.points[index][i]);
          assert.ok(Math.abs(delta[0]) > 1e-5);
          // Retained reference head lattice reconstruction is quantized below 0.08 source px.
          for (let i = 0; i < delta.length; i++) assert.ok(Math.abs(delta[i] - delta[i % 2]) * current.model.canvasinfo.PixelsPerUnit < .08, 'Iris was deformed rather than translated');
        }
      }
    }
  }
});

test('left and right eyelids interpolate continuously without moving the opposite eye or face', () => {
  const neutral = sample(current);
  for (const [side, key] of [['left', 'L'], ['right', 'R']]) {
    const closed = sample(current, { [`ParamEye${key}Open`]: 0 });
    const target = new Set(['eye-white', 'eyelash-upper', 'eyelash-lower'].map(name => current.drawings.get(`${name}-${side}`)));
    for (const value of [.125, .375, .625, .875]) {
      const pose = sample(current, { [`ParamEye${key}Open`]: value });
      for (const [, index] of current.drawings) {
        const expected = target.has(index) ? neutral.points[index].map((point, i) => point * value + closed.points[index][i] * (1 - value)) : neutral.points[index];
        closeArray(pose.points[index], expected, `partial blink ${side}/${value}`, .08 / current.model.canvasinfo.PixelsPerUnit);
      }
    }
  }
});

test('brow height and rotation alter only the selected native eyebrow mesh', () => {
  const neutral = sample(current);
  for (const [side, key] of [['left', 'L'], ['right', 'R']]) {
    const index = current.drawings.get(`eyebrow-${side}`);
    for (const height of [-1, .4, 1]) for (const angle of [-1, .3, 1]) {
      const pose = sample(current, { [`ParamBrow${key}Y`]: height, [`ParamBrow${key}Angle`]: angle });
      assert.notDeepEqual(pose.points[index], neutral.points[index]);
      for (const [, other] of current.drawings) if (other !== index) closeArray(pose.points[other], neutral.points[other], 'brow leaked into another drawing');
      assert.deepEqual(pose.opacity, neutral.opacity);
    }
  }
});
