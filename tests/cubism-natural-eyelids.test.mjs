import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { waitForCubismCore } from '../src/avatar/cubism/runtime.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
let core, old, current;
async function load(manifestFile) {
  const directory = path.dirname(manifestFile), manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  const bytes = await fs.readFile(path.join(directory, manifest.FileReferences.Moc));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  assert.equal(Object.create(core.Moc.prototype).hasMocConsistency(buffer), 1);
  const moc = core.Moc.fromArrayBuffer(buffer), model = core.Model.fromMoc(moc);
  const display = JSON.parse(await fs.readFile(path.join(directory, manifest.FileReferences.DisplayInfo), 'utf8'));
  const draw = new Map(display.Drawables.map(item => [item.Name, Array.from(model.drawables.ids).indexOf(item.Id)]));
  return { model, manifest, directory, draw, release() { model.release(); moc._release(); } };
}
before(async () => {
  const source = await fs.readFile(path.join(project, 'public/vendor/live2d/live2dcubismcore.min.js'), 'utf8');
  const sandbox = { console, setTimeout, clearTimeout, TextDecoder, TextEncoder, atob, btoa, window: {}, document: { currentScript: { src: 'https://petpal.test/core.js' } } };
  vm.runInNewContext(source, sandbox, { timeout: 2000 });
  core = await waitForCubismCore(() => sandbox.Live2DCubismCore);
  old = await load(path.join(project, 'public/avatars/akari-cubism-v11/akari.model3.json'));
  current = await load(process.env.PETPAL_NATURAL_LIDS_MANIFEST || path.join(project, 'public/avatars/akari-cubism-v12/akari.model3.json'));
});
after(() => { current?.release(); old?.release(); });
function sample(rig, parameters = {}) {
  const model = rig.model;
  model.parameters.values.set(model.parameters.defaultValues);
  for (const [name, value] of Object.entries(parameters)) {
    const index = Array.from(model.parameters.ids).indexOf(name); assert(index >= 0); model.parameters.values[index] = value;
  }
  model.update();
  return { points: Array.from(model.drawables.vertexPositions, p => Array.from(p)), opacity: Array.from(model.drawables.opacities) };
}

test('V12 retains audited V11 RGBA texels, native parameters and unrelated meshes under combined poses', async () => {
  assert.deepEqual(Array.from(current.model.parameters.ids), Array.from(old.model.parameters.ids));
  for (const field of ['minimumValues', 'maximumValues', 'defaultValues']) assert.deepEqual(Array.from(current.model.parameters[field]), Array.from(old.model.parameters[field]));
  assert.equal(current.model.drawables.count, 16);
  assert.equal(current.manifest.FileReferences.Textures.length, old.manifest.FileReferences.Textures.length);
  for (let i = 0; i < old.manifest.FileReferences.Textures.length; i++) {
    const [original, published] = await Promise.all([
      fs.readFile(path.join(old.directory, old.manifest.FileReferences.Textures[i])),
      fs.readFile(path.join(current.directory, current.manifest.FileReferences.Textures[i])),
    ]);
    if (current.manifest.FileReferences.Textures[i].endsWith('.png')) assert.deepEqual(published, original);
    else {
      // The developer asset audit compares decoded WebP RGBA, including alpha=0
      // RGB. These hashes bind that audit to the actual retained V11 PNG and V12
      // bytes without adding an image decoder dependency to the Node test runner.
      const receipt = JSON.parse(await fs.readFile(path.join(current.directory, 'texture-transport.json'), 'utf8'));
      const sha = bytes => createHash('sha256').update(bytes).digest('hex');
      assert.equal(receipt.sourceSha256, sha(original));
      assert.equal(receipt.publishedSha256, sha(published));
      assert.equal(receipt.decodedRgbaSha256, sha(PNG.sync.read(original).data));
      assert.equal(receipt.rgbaEqual, true);
      assert.equal(receipt.format, 'webp-lossless-exact');
      assert.ok(receipt.published.endsWith(`/${current.manifest.FileReferences.Textures[i]}`));
    }
  }
  for (const sign of [-1, 0, 1]) {
    const pose = { ParamAngleX: 30 * sign, ParamAngleY: 20 * sign, ParamAngleZ: 20 * sign, ParamHandsLift: (sign + 1) / 2, ParamHandsSway: sign, ParamHairFront: sign, ParamMouthOpenY: .6, ParamMouthA: 1, ParamBrowLY: sign, ParamEyeBallX: sign };
    const a = sample(old, pose), b = sample(current, pose);
    for (const [name, index] of current.draw) if (!/^(eye-white|eyelash-upper|eyelash-lower)-/u.test(name)) assert.deepEqual(b.points[index], a.points[old.draw.get(name)], `Unrelated geometry changed: ${name}`);
  }
});

test('101 actual Core closure samples retain native masks, rigid iris, positive triangles and no dissolve', () => {
  const rest = sample(current), model = current.model, ppu = model.canvasinfo.PixelsPerUnit;
  const area = (p, a, b, c) => (p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[b + 1] - p[a + 1]) * (p[c] - p[a]);
  for (const [side, key] of [['left', 'L'], ['right', 'R']]) {
    const ids = ['eye-white', 'eyelash-upper', 'eyelash-lower'].map(name => current.draw.get(`${name}-${side}`));
    const iris = current.draw.get(`iris-${side}`), white = ids[0];
    assert.deepEqual(Array.from(model.drawables.masks[iris]), [white]);
    for (let frame = 0; frame <= 100; frame++) {
      const open = frame / 100, pose = sample(current, { [`ParamEye${key}Open`]: open });
      const same = (a, b) => a.length === b.length && a.every((value, i) => Math.abs(value - b[i]) * ppu < .001);
      assert(same(pose.points[iris], rest.points[iris]), 'Blink squashes the iris');
      for (let index = 0; index < pose.points.length; index++) if (!ids.includes(index)) assert(same(pose.points[index], rest.points[index]), 'Blink affects another drawing');
      for (const index of ids) {
        const positions = pose.points[index], original = rest.points[index], triangles = model.drawables.indices[index];
        assert(positions.every(Number.isFinite));
        for (let i = 0; i < positions.length; i += 2) assert(Math.abs(positions[i] - original[i]) * ppu < .08, 'Eye width changed beyond native reconstruction tolerance');
        for (let t = 0; t < triangles.length; t += 3) {
          const [a, b, c] = Array.from(triangles.slice(t, t + 3), vertex => vertex * 2);
          assert(area(positions, a, b, c) / area(original, a, b, c) > .001, 'Native triangle folded');
        }
      }
      assert.equal(pose.opacity[iris], open === 0 ? 0 : 1, 'Iris dissolves instead of being cropped');
      assert.equal(pose.opacity[white], open === 0 ? 0 : 1, 'White dissolves during normal closure');
      for (const index of ids.slice(1)) assert.equal(pose.opacity[index], 1, 'Lash opacity changes during blink');
    }
  }
});

test('actual closed upper-lash alpha center bends down rather than preserving the open smile arch', async () => {
  const receipt = JSON.parse(await fs.readFile(path.join(project, 'outputs/avatars/akari-cubism-v11/pack-receipt.json'), 'utf8'));
  const neutral = sample(current), closed = sample(current, { ParamEyeLOpen: 0, ParamEyeROpen: 0 });
  const { PixelsPerUnit: ppu, CanvasOriginX: originX, CanvasOriginY: originY } = current.model.canvasinfo;
  for (const side of ['left', 'right']) {
    const name = `eyelash-upper-${side}`, layer = receipt.layers.find(item => item.name === name);
    const image = PNG.sync.read(await fs.readFile(path.join(project, `artwork/akari/features-v11/${name}.png`)));
    const index = current.draw.get(name), rest = neutral.points[index], target = closed.points[index];
    const columnCount = rest.length / 2 / 5;
    const centerAt = fraction => {
      const white = receipt.layers.find(item => item.name === `eye-white-${side}`).bounds;
      const wanted = white[0] + white[2] * fraction;
      let column = 0;
      for (let c = 1; c < columnCount; c++) if (Math.abs(rest[c * 2] * ppu + originX - wanted) < Math.abs(rest[column * 2] * ppu + originX - wanted)) column = c;
      const x = Math.round(rest[column * 2] * ppu + originX - layer.bounds[0]);
      let sum = 0, alpha = 0;
      for (let y = 0; y < image.height; y++) { const a = image.data[(y * image.width + x) * 4 + 3]; alpha += a; sum += (layer.bounds[1] + y + .5) * a; }
      assert(alpha > 0);
      const top = column * 2 + 1, bottom = (4 * columnCount + column) * 2 + 1;
      const sourceY = sum / alpha, sourceTop = originY - rest[top] * ppu, sourceBottom = originY - rest[bottom] * ppu;
      const t = (sourceY - sourceTop) / (sourceBottom - sourceTop);
      return { open: sourceY, closed: originY - (target[top] * (1 - t) + target[bottom] * t) * ppu };
    };
    const a = centerAt(.1), middle = centerAt(.5), b = centerAt(.9);
    assert(middle.open < (a.open + b.open) / 2 - 6, 'Fixture must start with an open upper arch');
    assert(middle.closed > (a.closed + b.closed) / 2 + 6, 'Closed eyelash retains the wrong arch direction');
  }
});
