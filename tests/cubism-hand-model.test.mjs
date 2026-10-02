import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { waitForCubismCore } from '../src/avatar/cubism/runtime.mjs';

const root = new URL('../public/avatars/akari-cubism-v8/', import.meta.url);
const bytes = value => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
const handIds = ['ParamHandsLift', 'ParamHandsSway', 'ParamSleeveEase'];
let core, moc, model, oldMoc, oldModel, parameter, layer, rest, body, ppu, ox, oy;
const point = (vertices, i) => [ox + vertices[i] * ppu, oy - vertices[i + 1] * ppu];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const area = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function sample(values = {}) {
  model.parameters.values.set(model.parameters.defaultValues);
  for (const [name, value] of Object.entries(values)) {
    assert.ok(parameter.has(name), `Missing real parameter: ${name}`);
    model.parameters.values[parameter.get(name)] = value;
  }
  model.update();
  return Array.from(model.drawables.vertexPositions, values => Array.from(values));
}
function compareFixed(current, before = rest) {
  for (let d = 0; d < current.length; d++) {
    if (d === body) continue;
    for (let i = 0; i < before[d].length; i += 2)
      assert.ok(distance(point(before[d], i), point(current[d], i)) < .01, `Hand input moved non-body drawing ${d}`);
  }
  let upper = 0;
  for (let i = 0; i < rest[body].length; i += 2) if (point(rest[body], i)[1] <= 860) {
    upper++; assert.ok(distance(point(before[body], i), point(current[body], i)) < .01, 'Hand input pulled neck/collar');
  }
  assert.ok(upper > 20);
}
before(async () => {
  const code = await fs.readFile(new URL('../public/vendor/live2d/live2dcubismcore.min.js', import.meta.url), 'utf8');
  const sandbox = { console, setTimeout, clearTimeout, TextDecoder, TextEncoder, atob, btoa, window: {}, document: { currentScript: { src: 'https://petpal.test/vendor/live2d/live2dcubismcore.min.js' } } };
  vm.runInNewContext(code, sandbox, { timeout: 2000 });
  core = await waitForCubismCore(() => sandbox.Live2DCubismCore);
  const manifest = JSON.parse(await fs.readFile(new URL('akari.model3.json', root)));
  const data = bytes(await fs.readFile(new URL(manifest.FileReferences.Moc, root)));
  assert.equal(core.Moc.prototype.hasMocConsistency(data), 1);
  moc = core.Moc.fromArrayBuffer(data); model = core.Model.fromMoc(moc);
  parameter = new Map(Array.from(model.parameters.ids, (name, i) => [name, i]));
  const mapping = JSON.parse(await fs.readFile(new URL('akari.psd2live.json', root)));
  const drawing = new Map(Array.from(model.drawables.ids, (name, i) => [name, i]));
  layer = new Map(mapping.layers.map(item => [item.source, drawing.get(item.drawable)]));
  body = layer.get('topwear'); assert.notEqual(body, undefined);
  ({ PixelsPerUnit: ppu, CanvasOriginX: ox, CanvasOriginY: oy } = model.canvasinfo);
  rest = sample();
  oldMoc = core.Moc.fromArrayBuffer(bytes(await fs.readFile(new URL('../public/avatars/akari-cubism-v7/akari.moc3', import.meta.url))));
  oldModel = core.Model.fromMoc(oldMoc); oldModel.update();
});
after(() => { model?.release(); moc?._release(); oldModel?.release(); oldMoc?._release(); });

test('V8 adds three real hand parameters without replacing the original face/hair or advertising finger bones', () => {
  assert.equal(model.parameters.count, 19); assert.equal(model.drawables.count, 11);
  for (const name of handIds) {
    const i = parameter.get(name); assert.notEqual(i, undefined);
    assert.equal(model.parameters.defaultValues[i], 0);
    assert.equal(model.parameters.minimumValues[i], name === 'ParamHandsSway' ? -1 : 0);
    assert.equal(model.parameters.maximumValues[i], 1);
  }
  for (let i = 0; i < oldModel.parameters.count; i++) {
    const name = oldModel.parameters.ids[i], j = parameter.get(name); assert.notEqual(j, undefined);
    assert.equal(model.parameters.defaultValues[j], oldModel.parameters.defaultValues[i]);
    assert.equal(model.parameters.minimumValues[j], oldModel.parameters.minimumValues[i]);
    assert.equal(model.parameters.maximumValues[j], oldModel.parameters.maximumValues[i]);
  }
  const oldIds = new Map(Array.from(oldModel.drawables.ids, (name, i) => [name, i]));
  for (let d = 0; d < rest.length; d++) if (d !== body) {
    const old = oldIds.get(model.drawables.ids[d]); assert.notEqual(old, undefined);
    const previous = oldModel.drawables.vertexPositions[old];
    assert.equal(rest[d].length, previous.length, 'Non-body topology changed');
    for (let i = 0; i < previous.length; i++) assert.ok(Math.abs(rest[d][i] - previous[i]) * ppu < .001, 'Non-body neutral geometry changed beyond Core float roundoff');
  }
  assert.ok(rest[body].length / 2 < 8000, 'Hand mesh must stay bounded on mobile');
  assert.equal([...parameter.keys()].some(id => /Finger|Elbow|ArmL|ArmR/.test(id)), false);
});

test('each new channel changes actual hand/sleeve geometry while the face, hair and collar stay fixed', () => {
  for (const name of handIds) {
    const current = sample({ [name]: 1 }); compareFixed(current);
    const moved = rest[body].filter((_, i) => i % 2 === 0).map((_, j) => distance(point(rest[body], j * 2), point(current[body], j * 2)));
    assert.ok(Math.max(...moved) > 1, `${name} is inert`);
    assert.ok(Math.max(...moved) < 19, `${name} exceeded restrained hand envelope`);
  }
});

test('both interlocked hands translate together without pulling fingers apart or stretching their triangles', () => {
  const palmVertices = [];
  for (let i = 0; i < rest[body].length; i += 2) {
    const [x, y] = point(rest[body], i);
    if (x >= 355 && x <= 680 && y >= 1290 && y <= 1440) palmVertices.push(i);
  }
  assert.ok(palmVertices.length > 35, 'Observe actual interior vertices across both palms');
  assert.ok(palmVertices.some(i => point(rest[body], i)[0] < 450));
  assert.ok(palmVertices.some(i => point(rest[body], i)[0] > 580));
  for (const lift of [0, .35, .7, 1]) for (const sway of [-1, -.4, 0, .6, 1]) for (const sleeve of [0, .5, 1]) {
    const current = sample({ ParamHandsLift: lift, ParamHandsSway: sway, ParamSleeveEase: sleeve }); compareFixed(current);
    const first = palmVertices[0], a = point(rest[body], first), b = point(current[body], first), shift = [b[0] - a[0], b[1] - a[1]];
    for (const i of palmVertices) {
      const from = point(rest[body], i), to = point(current[body], i);
      const residual = distance([to[0] - from[0], to[1] - from[1]], shift);
      // The original parent warp is evaluated by Core after native mesh deltas.
      // Its baked interpolation gives <=0.200 source-pixel residual at full
      // parameter extremes; enforce a quarter-pixel visual registration limit
      // (under 0.1 CSS px on the 412px viewport), not bit-identical translation.
      assert.ok(residual < .25, `Clasp/finger registration changed: ${JSON.stringify({lift,sway,sleeve,from,shift,actual:[to[0]-from[0],to[1]-from[1]],residual})}`);
    }
    assert.ok(Math.hypot(...shift) < 19, 'Hand displacement too large');
    if (lift === 1) assert.ok(shift[1] < -8, 'Hands must visibly rise');
  }
});

test('combined head/body/hand poses remain finite with positive triangle orientation and return to exact rest', () => {
  for (let n = 0; n <= 120; n++) {
    const t = n * Math.PI / 60;
    const values = { ParamAngleX: 40 * Math.sin(t), ParamAngleY: 25 * Math.cos(t * 2), ParamAngleZ: 24 * Math.sin(t * 3), ParamBodyAngleX: 8 * Math.cos(t), ParamBodyAngleY: 8 * Math.sin(t * 2), ParamBodyAngleZ: 8 * Math.cos(t * 3), ParamBreath: (1 + Math.sin(t)) / 2, ParamHairFront: Math.sin(t), ParamHandsLift: (1 + Math.cos(t)) / 2, ParamHandsSway: Math.sin(t * 3), ParamSleeveEase: (1 + Math.sin(t * 2)) / 2 };
    const current = sample(values);
    for (let d = 0; d < current.length; d++) {
      for (let i = 0; i < current[d].length; i += 2) assert.ok(Number.isFinite(current[d][i]) && Number.isFinite(current[d][i + 1]) && distance(point(rest[d], i), point(current[d], i)) < 40);
      const ids = model.drawables.indices[d];
      for (let k = 0; k < ids.length; k += 3) {
        const indices = [ids[k] * 2, ids[k + 1] * 2, ids[k + 2] * 2];
        const a = area(...indices.map(i => point(rest[d], i))); if (Math.abs(a) < .25) continue;
        const b = area(...indices.map(i => point(current[d], i)));
        assert.ok(a * b > 0, `Inverted triangle ${d}:${k / 3}`);
        if (d === body) assert.ok(Math.abs(b / a - 1) < .35, 'Body mesh sheared excessively');
      }
    }
  }
  assert.deepEqual(sample(), rest);
});
