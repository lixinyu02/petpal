import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { waitForCubismCore } from '../src/avatar/cubism/runtime.mjs';
import { buildFacialExpressionBundle } from '../scripts/authoring/prepare-akari-facial-expressions.mjs';

const emotions = new Map([
  ['warm', 'ParamWarm'], ['sad', 'ParamSad'], ['pout', 'ParamPout'],
  ['shy', 'ParamShy'], ['surprise', 'ParamSurprise'], ['relaxed', 'ParamRelaxed'],
]);
const arrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
let core, previous, current;

async function loadModel(version) {
  const directory = new URL(`../public/avatars/akari-cubism-v${version}/`, import.meta.url);
  const manifest = JSON.parse(await fs.readFile(new URL('akari.model3.json', directory), 'utf8'));
  const display = JSON.parse(await fs.readFile(new URL(manifest.FileReferences.DisplayInfo, directory), 'utf8'));
  const bytes = arrayBuffer(await fs.readFile(new URL(manifest.FileReferences.Moc, directory)));
  assert.equal(Object.create(core.Moc.prototype).hasMocConsistency(bytes), 1);
  const moc = core.Moc.fromArrayBuffer(bytes), model = core.Model.fromMoc(moc);
  const parameters = new Map(Array.from(model.parameters.ids, (id, index) => [id, index]));
  const drawables = new Map(display.Drawables.map(drawable => [drawable.Name.trim().toLowerCase(), Array.from(model.drawables.ids).indexOf(drawable.Id)]));
  for (const index of drawables.values()) assert.ok(index >= 0, 'Display info must resolve to a native drawable');
  return { model, parameters, drawables, release() { model.release(); moc._release(); } };
}

before(async () => {
  const source = await fs.readFile(new URL('../public/vendor/live2d/live2dcubismcore.min.js', import.meta.url), 'utf8');
  const sandbox = { console, setTimeout, clearTimeout, TextDecoder, TextEncoder, atob, btoa, window: {}, document: { currentScript: { src: 'https://petpal.test/vendor/live2d/live2dcubismcore.min.js' } } };
  vm.runInNewContext(source, sandbox, { timeout: 2000, filename: 'licensed-live2dcubismcore.min.js' });
  core = await waitForCubismCore(() => sandbox.Live2DCubismCore);
  previous = await loadModel(9);
  current = await loadModel(10);
});
after(() => { current?.release(); previous?.release(); });

function sample(rig, values = {}) {
  const { model, parameters } = rig;
  model.parameters.values.set(model.parameters.defaultValues);
  for (const [id, value] of Object.entries(values)) {
    assert.ok(parameters.has(id), `Native parameter missing: ${id}`);
    model.parameters.values[parameters.get(id)] = value;
  }
  model.update();
  return {
    positions: Array.from(model.drawables.vertexPositions, points => Array.from(points)),
    opacities: Array.from(model.drawables.opacities),
    orders: Array.from(model.drawables.drawOrders),
  };
}

test('V10 adds three real local face drawables and native opacity parameters while retaining all V9 bindings', () => {
  assert.equal(current.model.drawables.count, 14);
  assert.equal(current.model.parameters.count, 22);
  assert.deepEqual([...current.drawables.keys()].sort(), [...previous.drawables.keys(), 'shy', 'surprise', 'relaxed'].sort());
  assert.deepEqual([...current.parameters.keys()].sort(), [...previous.parameters.keys(), 'ParamShy', 'ParamSurprise', 'ParamRelaxed'].sort());
  const neutral = sample(current);
  for (const [name, id] of emotions) {
    const index = current.parameters.get(id), parameter = current.model.parameters;
    assert.deepEqual([parameter.minimumValues[index], parameter.maximumValues[index], parameter.defaultValues[index], parameter.keyCounts[index]], [0, 1, 0, 2]);
    assert.equal(neutral.opacities[current.drawables.get(name)], 0, `${name} must be hidden at rest`);
  }
});

test('new facial art preserves original V9 face, hair, body and hand geometry across combined native poses', () => {
  const poses = [{}];
  for (const direction of [-1, 0, 1]) for (const hands of [0, .5, 1]) poses.push({
    ParamAngleX: direction * 45, ParamAngleY: direction * -30, ParamAngleZ: direction * 30,
    ParamBodyAngleX: direction * 10, ParamBodyAngleY: direction * -10, ParamBodyAngleZ: direction * 10,
    ParamBreath: hands, ParamHairFront: direction,
    ParamHandsLift: hands, ParamHandsSway: direction, ParamSleeveEase: hands,
    ParamEyeLOpen: hands, ParamEyeROpen: 1 - hands,
    ParamMouthOpenY: hands, ParamMouthA: hands, ParamMouthO: 1 - hands,
  });
  for (const pose of poses) {
    const oldPose = sample(previous, pose), nextPose = sample(current, pose);
    for (const [name, oldIndex] of previous.drawables) {
      const newIndex = current.drawables.get(name), expected = oldPose.positions[oldIndex], actual = nextPose.positions[newIndex];
      assert.equal(actual.length, expected.length, `${name} original mesh changed`);
      for (let i = 0; i < expected.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) <= 1e-6, `${name} geometry changed with ${JSON.stringify(pose)} at vertex ${i}`);
      assert.equal(nextPose.opacities[newIndex], oldPose.opacities[oldIndex], `${name} old opacity behavior changed`);
    }
  }
});

test('all six native expressions interpolate only their own opacity and remain below blink and actual speech mouth patches', () => {
  const neutral = sample(current);
  for (const [name, id] of emotions) {
    const expressionIndex = current.drawables.get(name);
    for (const value of [0, .25, .5, .75, 1]) {
      const pose = sample(current, { [id]: value });
      assert.deepEqual(pose.positions, neutral.positions, `${name} must never reshape the face or hair`);
      for (let index = 0; index < pose.opacities.length; index++) assert.ok(Math.abs(pose.opacities[index] - (index === expressionIndex ? value : neutral.opacities[index])) < 1e-6, `${name} opacity leaked into drawable ${index}`);
    }
    for (const mouth of ['a', 'o']) {
      const pose = sample(current, { [id]: 1, ParamEyeLOpen: 0, ParamEyeROpen: 0, ParamMouthOpenY: 1, ParamMouthA: mouth === 'a' ? 1 : 0, ParamMouthO: mouth === 'o' ? 1 : 0 });
      assert.equal(pose.opacities[expressionIndex], 1);
      for (const protectedName of ['blink-left', 'blink-right', `mouth-${mouth}`]) {
        const index = current.drawables.get(protectedName);
        assert.equal(pose.opacities[index], 1, `${name} must not suppress ${protectedName}`);
        assert.ok(pose.orders[index] > pose.orders[expressionIndex], `${name} must not paint over ${protectedName}`);
      }
    }
  }
});

test('V10 runtime packaging is reproducible, retains sixteen V9 motions exactly and excludes authoring project files', async () => {
  async function readBundle(directory, prefix = '', files = new Map()) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await readBundle(new URL(`${entry.name}/`, directory), `${name}/`, files);
      else files.set(name, await fs.readFile(new URL(entry.name, directory)));
    }
    return files;
  }
  const actual = await readBundle(new URL('../public/avatars/akari-cubism-v10/', import.meta.url));
  const original = await readBundle(new URL('../public/avatars/akari-cubism-v9/', import.meta.url));
  const raw = new Map(actual);
  raw.set('akari.cmo3', Buffer.from('authoring-only'));
  raw.set('akari.psd', Buffer.from('source-artwork-only'));
  const output = buildFacialExpressionBundle(raw, original);
  assert.deepEqual([...output.keys()].sort(), [...actual.keys()].sort());
  for (const [name, bytes] of actual) assert.deepEqual(output.get(name), bytes, `Delivered V10 differs from deterministic packaging: ${name}`);
  const oldManifest = JSON.parse(original.get('akari.model3.json')), manifest = JSON.parse(actual.get('akari.model3.json'));
  assert.deepEqual(manifest.FileReferences.Motions, oldManifest.FileReferences.Motions);
  for (const entries of Object.values(oldManifest.FileReferences.Motions)) for (const entry of entries) assert.deepEqual(actual.get(entry.File), original.get(entry.File), `Reviewed motion changed: ${entry.File}`);
  assert.equal(output.has('akari.cmo3'), false);
  assert.equal(output.has('akari.psd'), false);
});
