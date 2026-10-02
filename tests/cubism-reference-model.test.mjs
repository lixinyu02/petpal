import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { initializeCanvas, readPsd } from 'ag-psd';
import { waitForCubismCore } from '../src/avatar/cubism/runtime.mjs';

const root = process.env.PETPAL_CUBISM_REFERENCE_BUNDLE
  ? pathToFileURL(path.resolve(process.env.PETPAL_CUBISM_REFERENCE_BUNDLE) + path.sep)
  : new URL('../public/avatars/akari-cubism-v7/', import.meta.url);
const bytes = value => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
const baseNames = ['topwear', 'face', 'front hair 1', 'front hair 2'];
const patchParameters = {
  'blink-left': 'ParamEyeLOpen', 'blink-right': 'ParamEyeROpen',
  'mouth-a': 'ParamMouthA', 'mouth-o': 'ParamMouthO',
  warm: 'ParamWarm', sad: 'ParamSad', pout: 'ParamPout',
};
// Native float roundoff is much smaller than one authored pixel. These checks
// concern registration and functionality, never the beauty of the artwork.
const registrationEpsilon = .01;
// Core interpolates several Float32 parent opacities. Four ULPs at 1 permit
// arithmetic roundoff, not a meaningful out-of-range channel value.
const opacityEpsilon = 4 * 2 ** -23;
let model, moc, parameter, drawable, layer, sourceLayers, rest, ppu, originX, originY;

function sample(values = {}) {
  model.parameters.values.set(model.parameters.defaultValues);
  for (const [id, value] of Object.entries(values)) {
    assert.ok(parameter.has(id), `Real MOC parameter required: ${id}`);
    const index = parameter.get(id);
    assert.ok(value >= model.parameters.minimumValues[index] && value <= model.parameters.maximumValues[index], `${id} input outside real range`);
    model.parameters.values[index] = value;
  }
  model.update();
  return Array.from(model.drawables.vertexPositions, points => Array.from(points));
}
const indexOf = name => {
  assert.ok(layer.has(name), `Source layer missing: ${name}`);
  const index = drawable.get(layer.get(name));
  assert.notEqual(index, undefined, `Native drawing missing: ${name}`);
  return index;
};
const opacity = name => model.drawables.opacities[indexOf(name)];
const point = (points, index) => [originX + points[index] * ppu, originY - points[index + 1] * ppu];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const moved = (a, b, index) => Math.hypot(a[index] - b[index], a[index + 1] - b[index + 1]) * ppu;
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function assertUnchanged(before, current, names, label) {
  for (const name of names) {
    const index = indexOf(name);
    for (let vertex = 0; vertex < before[index].length; vertex += 2)
      assert.ok(moved(before[index], current[index], vertex) < registrationEpsilon, `${label}: ${name} vertex ${vertex / 2} moved`);
  }
}

before(async () => {
  const coreSource = await fs.readFile(new URL('../public/vendor/live2d/live2dcubismcore.min.js', import.meta.url), 'utf8');
  const sandbox = { console, setTimeout, clearTimeout, TextDecoder, TextEncoder, atob, btoa, window: {}, document: { currentScript: { src: 'https://petpal.test/vendor/live2d/live2dcubismcore.min.js' } } };
  vm.runInNewContext(coreSource, sandbox, { timeout: 2000 });
  const core = await waitForCubismCore(() => sandbox.Live2DCubismCore);
  const manifest = JSON.parse(await fs.readFile(new URL('akari.model3.json', root), 'utf8'));
  const native = bytes(await fs.readFile(new URL(manifest.FileReferences.Moc, root)));
  assert.equal(core.Moc.prototype.hasMocConsistency(native), 1);
  moc = core.Moc.fromArrayBuffer(native); model = core.Model.fromMoc(moc);
  assert.ok(model);
  parameter = new Map(Array.from(model.parameters.ids, (id, index) => [id, index]));
  drawable = new Map(Array.from(model.drawables.ids, (id, index) => [id, index]));
  const mapping = JSON.parse(await fs.readFile(new URL('akari.psd2live.json', root), 'utf8'));
  layer = new Map(mapping.layers.map(entry => [entry.source, entry.drawable]));
  assert.equal(parameter.size, 16); assert.equal(drawable.size, 11); assert.equal(layer.size, 11);
  assert.equal(new Set(layer.values()).size, 11);
  for (const name of [...baseNames, ...Object.keys(patchParameters)]) indexOf(name);
  ({ PixelsPerUnit: ppu, CanvasOriginX: originX, CanvasOriginY: originY } = model.canvasinfo);
  assert.ok(Number.isFinite(ppu) && ppu > 0);
  assert.equal(model.canvasinfo.CanvasWidth, 1024); assert.equal(model.canvasinfo.CanvasHeight, 1536);
  rest = sample();
  initializeCanvas(() => { throw new Error('Reference checks must decode original PSD pixels without a canvas'); },
    (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }));
  const psd = readPsd(await fs.readFile(new URL('../outputs/avatars/akari-cubism-v7/akari.psd', import.meta.url)), { useImageData: true, skipCompositeImageData: true, skipThumbnail: true });
  assert.equal(psd.width, 1024); assert.equal(psd.height, 1536);
  sourceLayers = new Map(psd.children.map(item => [item.name, item]));
});
after(() => { model?.release(); moc?._release(); });

test('V7 neutral shows only the registered base drawings; native eyelids close independently above emotion patches', () => {
  sample();
  for (const name of baseNames) assert.equal(opacity(name), 1, `${name} belongs to the neutral portrait`);
  for (const [name, id] of Object.entries(patchParameters)) {
    const index = parameter.get(id);
    assert.equal(model.parameters.minimumValues[index], 0); assert.equal(model.parameters.maximumValues[index], 1);
    assert.equal(model.parameters.defaultValues[index], name.startsWith('blink-') ? 1 : 0);
    assert.equal(opacity(name), 0, `${name} must not tint or double the neutral drawing`);
    assert.equal(sourceLayers.get(name).hidden, true, `${name} is hidden in the editable neutral PSD`);
  }
  const order = name => model.drawables.drawOrders[indexOf(name)];
  for (const closed of ['blink-left', 'blink-right']) for (const under of ['face', 'warm', 'sad', 'pout']) assert.ok(order(closed) > order(under), `${closed} must cover ${under}`);
  for (const [left, right] of [[0, 1], [1, 0], [0, 0], [1, 1]]) {
    const current = sample({ ParamEyeLOpen: left, ParamEyeROpen: right, ParamWarm: 1, ParamSad: 1, ParamPout: 1 });
    assert.equal(opacity('blink-left'), 1 - left); assert.equal(opacity('blink-right'), 1 - right);
    assertUnchanged(rest, current, [...baseNames, ...Object.keys(patchParameters)], 'Blink must replace pixels without stretching any feature');
  }
  for (const id of ['ParamEyeLOpen', 'ParamEyeROpen']) {
    let previous = 1;
    for (let step = 0; step <= 20; step++) {
      sample({ [id]: step / 20 });
      const value = opacity(id === 'ParamEyeLOpen' ? 'blink-left' : 'blink-right');
      assert.ok(value >= 0 && value <= previous + 1e-6, 'Opening a native eyelid must be monotonic'); previous = value;
      assert.equal(opacity(id === 'ParamEyeLOpen' ? 'blink-right' : 'blink-left'), 0);
    }
    sample({ [id]: .5 });
    assert.equal(opacity(id === 'ParamEyeLOpen' ? 'blink-left' : 'blink-right'), 1, 'A sustained half-open input must not leave two translucent eyelid drawings');
  }
});

test('decoded eyelid and mouth source interiors are fully opaque rather than ghosting the underlying face', () => {
  const alpha = (name, x, y) => {
    const value = sourceLayers.get(name), image = value?.imageData;
    assert.ok(image, `Missing decoded source: ${name}`);
    const col = x - value.left, row = y - value.top;
    assert.ok(col >= 0 && col < image.width && row >= 0 && row < image.height, `${name} does not cover the original feature`);
    return image.data[(row * image.width + col) * 4 + 3];
  };
  // Anatomical interior rectangles in the original reference, deliberately
  // independent of packer crop edges or its fade-mask implementation.
  for (const [name, bounds] of [['blink-right', [367, 352, 463, 414]], ['blink-left', [560, 336, 649, 402]], ['mouth-a', [482, 476, 552, 523]], ['mouth-o', [482, 476, 552, 523]]]) {
    const [x0, y0, x1, y1] = bounds;
    for (let y = y0; y <= y1; y += 3) for (let x = x0; x <= x1; x += 3) assert.equal(alpha(name, x, y), 255, `${name} is translucent at ${x},${y}`);
  }
  assert.notDeepEqual(sourceLayers.get('mouth-a').imageData.data, sourceLayers.get('mouth-o').imageData.data, 'A and O must be distinct actual artwork');
});

test('V7 A/O channels own native visibility while MouthOpenY changes only inner lip vertices and fixes the outer patch', () => {
  for (const name of ['mouth-a', 'mouth-o']) {
    const id = patchParameters[name], other = name === 'mouth-a' ? 'mouth-o' : 'mouth-a';
    for (const value of [0, .08, .4, 1]) {
      sample({ [id]: value, ParamMouthOpenY: 1 });
      assert.equal(opacity(name), value === 0 ? 0 : 1); assert.equal(opacity(other), 0);
    }
  }
  const raw = sample({ ParamMouthOpenY: 1, ParamMouthA: 1, ParamMouthO: 1 });
  for (const open of [0, .2, .4, .65, 1]) {
    const current = sample({ ParamMouthOpenY: open, ParamMouthA: 1, ParamMouthO: 1 });
    assertUnchanged(raw, current, [...baseNames, 'blink-left', 'blink-right', 'warm', 'sad', 'pout'], 'Lip opening must not move the face or other patches');
    for (const name of ['mouth-a', 'mouth-o']) {
      const index = indexOf(name); let moving = 0, edge = 0;
      for (let vertex = 0; vertex < raw[index].length; vertex += 2) {
        const [x, y] = point(raw[index], vertex), motion = moved(raw[index], current[index], vertex);
        assert.ok(Math.abs(raw[index][vertex] - current[index][vertex]) * ppu < registrationEpsilon, 'Lips must not drag sideways');
        assert.ok(motion <= 12.01, `${name} vertex ${vertex / 2} lip motion ${motion}px exceeded 12 authored pixels`);
        if (x <= 474 || x >= 562 || y <= 465 || y >= 529) { edge++; assert.ok(motion < registrationEpsilon, `${name} outer patch slid`); }
        if (motion > .1) moving++;
      }
      assert.ok(edge > 10, 'The test must observe actual fixed boundary vertices');
      if (open < 1) assert.ok(moving > 5, 'MouthOpenY must change native inner geometry, not just opacity');
    }
  }
  sample({ ParamMouthA: 1, ParamMouthO: 1, ParamMouthOpenY: 1 });
  sample(); assert.equal(opacity('mouth-a'), 0); assert.equal(opacity('mouth-o'), 0);
});

function sharedHeadTransform(before, current) {
  const face = indexOf('face'), candidates = [];
  for (let i = 0; i < before[face].length; i += 2) if (point(before[face], i)[1] < 580) candidates.push(i);
  const a = candidates.reduce((best, i) => before[face][i] < before[face][best] ? i : best);
  const b = candidates.reduce((best, i) => distance(point(before[face], a), point(before[face], i)) > distance(point(before[face], a), point(before[face], best)) ? i : best);
  const c = candidates.reduce((best, i) => Math.abs(cross(point(before[face], a), point(before[face], b), point(before[face], i))) > Math.abs(cross(point(before[face], a), point(before[face], b), point(before[face], best))) ? i : best);
  const [p, q, r] = [a, b, c].map(i => point(before[face], i)), [u, v, w] = [a, b, c].map(i => point(current[face], i));
  const determinant = cross(p, q, r); assert.ok(Math.abs(determinant) > 10000, 'Head anchors must span the actual face');
  for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) assert.ok(Math.abs(distance([p, q, r][i], [p, q, r][j]) - distance([u, v, w][i], [u, v, w][j])) < .125, 'Whole-face proportions must stay within one eighth of an authored pixel');
  return value => {
    const alpha = cross(p, value, r) / determinant, beta = cross(p, q, value) / determinant;
    return [u[0] + alpha * (v[0] - u[0]) + beta * (w[0] - u[0]), u[1] + alpha * (v[1] - u[1]) + beta * (w[1] - u[1])];
  };
}

test('all V7 facial patches follow the same native head transform while actual neck and shoulder vertices stay fixed', () => {
  const poses = [{ ParamAngleX: 45, ParamAngleY: 30, ParamAngleZ: 30 }, { ParamAngleX: -45, ParamAngleY: -30, ParamAngleZ: -30 }];
  for (let step = 0; step < 48; step++) { const t = step * Math.PI / 24; poses.push({ ParamAngleX: 37 * Math.sin(t), ParamAngleY: 23 * Math.cos(t * 2), ParamAngleZ: 18 * Math.sin(t * 3) }); }
  let headMotion = 0, neckVertices = 0;
  for (const pose of poses) {
    const current = sample(pose), transform = sharedHeadTransform(rest, current);
    for (const name of ['face', ...Object.keys(patchParameters)]) {
      const index = indexOf(name);
      for (let vertex = 0; vertex < rest[index].length; vertex += 2) {
        const original = point(rest[index], vertex);
        if (original[1] <= 620) {
          const residual = distance(transform(original), point(current[index], vertex));
          assert.ok(residual < registrationEpsilon, `${name} vertex ${vertex / 2} at y=${original[1]} slides ${residual}px away from the shared head transform`);
          headMotion = Math.max(headMotion, moved(rest[index], current[index], vertex));
        }
        if (name === 'face' && original[1] >= 680) { neckVertices++; assert.ok(moved(rest[index], current[index], vertex) < registrationEpsilon, 'Native neck overlap must not separate from fixed shoulders'); }
      }
    }
    assertUnchanged(rest, current, ['topwear'], 'Head motion must leave the clothed body fixed');
  }
  assert.ok(neckVertices > 20); assert.ok(headMotion > 1 && headMotion < 30, 'Real head response must be present and bounded');
});

test('native body breathing is independent of the face and keeps the neck/upper shoulders fixed', () => {
  const body = indexOf('topwear'); let movedLower = 0, fixedUpper = 0;
  for (const values of [{ ParamBreath: 1 }, { ParamBodyAngleX: 10, ParamBodyAngleY: -10, ParamBodyAngleZ: 10, ParamBreath: 1 }, { ParamBodyAngleX: -10, ParamBodyAngleY: 10, ParamBodyAngleZ: -10 }]) {
    const current = sample(values);
    assertUnchanged(rest, current, ['face', 'front hair 1', 'front hair 2', ...Object.keys(patchParameters)], 'Body input must not pull the head or facial patches');
    for (let vertex = 0; vertex < rest[body].length; vertex += 2) {
      const y = point(rest[body], vertex)[1], motion = moved(rest[body], current[body], vertex);
      if (y <= 860) { fixedUpper++; assert.ok(motion < registrationEpsilon, 'Upper shoulder/collar moved under body input'); }
      if (y >= 1120) movedLower = Math.max(movedLower, motion);
      assert.ok(motion <= 3.01, 'Body breathing must remain within three authored pixels');
    }
  }
  assert.ok(fixedUpper > 20); assert.ok(movedLower > .5, 'Body animation must not be silently disabled');
});

test('native hair physics keeps real roots attached, moves lower tips, and never moves face pixels', () => {
  for (const head of [{}, { ParamAngleX: 45, ParamAngleY: 30, ParamAngleZ: 30 }, { ParamAngleX: -45, ParamAngleY: -30, ParamAngleZ: -30 }]) {
    const before = sample(head);
    for (const amount of [-1, 1]) {
      const current = sample({ ...head, ParamHairFront: amount });
      assertUnchanged(before, current, ['face', 'topwear', ...Object.keys(patchParameters)], 'Hair physics must not move facial pixels');
      for (const name of ['front hair 1', 'front hair 2']) {
        const index = indexOf(name), ys = rest[index].filter((_, i) => i % 2).map(y => originY - y * ppu), low = Math.min(...ys), high = Math.max(...ys);
        let roots = 0, tipMotion = 0;
        for (let vertex = 0; vertex < rest[index].length; vertex += 2) {
          const y = point(rest[index], vertex)[1], motion = moved(before[index], current[index], vertex);
          if (y < low + (high - low) * .25) { roots++; assert.ok(motion < registrationEpsilon, `${name} scalp attachment slides`); }
          if (y > low + (high - low) * .75) tipMotion = Math.max(tipMotion, motion);
          assert.ok(motion < 2, 'Hair exceeded the gentle two-pixel envelope');
        }
        assert.ok(roots > 5); assert.ok(tipMotion > .05, `${name} tips must really move`);
      }
    }
  }
});

test('normal combined native poses remain finite without triangle flips; unsupported feature parameters are absent', () => {
  for (const id of ['ParamEyeBallX', 'ParamEyeBallY', 'ParamEyeBallForm', 'ParamBrowLY', 'ParamBrowRY', 'ParamMouthForm', 'ParamHairBack']) assert.equal(parameter.has(id), false, `${id} must not advertise a nonexistent binding or revive generated facial warping`);
  for (let step = 0; step <= 120; step++) {
    const t = step * Math.PI / 60, unit = value => (1 + value) / 2;
    const current = sample({ ParamAngleX: 40 * Math.sin(t), ParamAngleY: 25 * Math.cos(t * 2), ParamAngleZ: 24 * Math.sin(t * 3), ParamBodyAngleX: 8 * Math.cos(t), ParamBodyAngleY: 8 * Math.sin(t * 2), ParamBodyAngleZ: 8 * Math.cos(t * 3), ParamBreath: unit(Math.sin(t)), ParamHairFront: Math.sin(t * 3), ParamMouthOpenY: unit(Math.cos(t)), ParamMouthA: unit(Math.sin(t)), ParamMouthO: unit(Math.cos(t)), ParamEyeLOpen: unit(Math.sin(t * 2)), ParamEyeROpen: unit(Math.cos(t * 2)), ParamWarm: unit(Math.sin(t)), ParamSad: unit(Math.cos(t)), ParamPout: unit(Math.sin(t * 2)) });
    for (let drawing = 0; drawing < current.length; drawing++) {
      const alpha = model.drawables.opacities[drawing];
      assert.ok(Number.isFinite(alpha) && alpha >= -opacityEpsilon && alpha <= 1 + opacityEpsilon, `${model.drawables.ids[drawing]} opacity ${alpha} exceeds Float32 roundoff`);
      for (let vertex = 0; vertex < current[drawing].length; vertex += 2) assert.ok(Number.isFinite(current[drawing][vertex]) && Number.isFinite(current[drawing][vertex + 1]) && moved(rest[drawing], current[drawing], vertex) < 40, `Combined pose exploded drawing ${drawing}`);
      const indices = model.drawables.indices[drawing];
      for (let triangle = 0; triangle < indices.length; triangle += 3) {
        const vertices = Array.from(indices.subarray(triangle, triangle + 3), value => value * 2);
        const originalArea = cross(...vertices.map(value => point(rest[drawing], value)));
        if (Math.abs(originalArea) < .25) continue; // Exclude numerically degenerate contour slivers.
        const area = cross(...vertices.map(value => point(current[drawing], value)));
        assert.ok(area * originalArea > 0, `Combined pose inverted native triangle in ${model.drawables.ids[drawing]}`);
      }
    }
  }
});
