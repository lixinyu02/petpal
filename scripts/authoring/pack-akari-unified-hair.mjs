/** Mechanical RGBA sampling and layered PSD encoding only; never paints or repairs artwork. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import { initializeCanvas, writePsdBuffer, readPsd } from 'ag-psd';

const arguments_ = process.argv.slice(2);
assert(arguments_.length === 0 || arguments_.length === 1 && ['--v5', '--v6'].includes(arguments_[0]),
  'Use no arguments for the immutable V4 layout, or --v5 / --v6 for the corresponding fixed source directory');
const version = arguments_.length === 0 ? 4 : arguments_[0] === '--v5' ? 5 : 6;
const v5 = version >= 5, v6 = version === 6;
const project = fs.realpathSync(path.resolve(import.meta.dirname, '../..'));
const directory = path.join(project, `outputs/avatars/akari-cubism-v${version}`);
const classic = path.join(project, 'outputs/avatars/akari-cubism');
const continuous = path.join(project, 'outputs/avatars/akari-cubism-v2');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const relative = filename => path.relative(directory, filename).split(path.sep).join('/');

function insideProject(filename) {
  const member = path.relative(project, filename);
  assert(member && !path.isAbsolute(member) && member !== '..' && !member.startsWith('..' + path.sep), 'Asset path must remain inside PetPal');
}
function checkedDirectory(filename) {
  insideProject(filename);
  const entry = fs.lstatSync(filename);
  assert(entry.isDirectory() && !entry.isSymbolicLink(), 'Asset directory must be a real local directory');
  const resolved = fs.realpathSync(filename);
  insideProject(resolved);
  assert.equal(resolved, filename, 'Asset directory must not resolve through a different source path');
}
function readFile(filename) {
  insideProject(filename);
  const entry = fs.lstatSync(filename);
  assert(entry.isFile() && !entry.isSymbolicLink(), 'Source must be an existing regular file');
  const resolved = fs.realpathSync(filename);
  insideProject(resolved);
  assert.equal(resolved, filename, 'Source must not resolve through a different source path');
  return fs.readFileSync(filename);
}
for (const sourceDirectory of [directory, classic, continuous]) checkedDirectory(sourceDirectory);

function readJson(filename) {
  const bytes = readFile(filename);
  return { value: JSON.parse(bytes.toString('utf8')), file: relative(filename), sha256: hash(bytes) };
}
const avatarLayout = readJson(path.join(directory, 'layout.json'));
const classicLayout = readJson(path.join(classic, 'layout.json'));
const bodyLayout = readJson(path.join(continuous, 'layout.json'));
const classicReceipt = readJson(path.join(classic, 'pack-receipt.json'));
const bodyReceipt = readJson(path.join(continuous, 'pack-receipt.json'));
const layout = avatarLayout.value, original = classicLayout.value, previous = bodyLayout.value;
for (const document of [layout, original, previous]) {
  assert.equal(document.width, 1024, 'The original canvas width must be retained');
  assert.equal(document.height, 1536, 'The original canvas height must be retained');
}
if (v5) assert(typeof layout.frontHair?.file === 'string' && /^[^/\\]+\.png$/i.test(layout.frontHair.file),
  'V5 front hair must identify a sibling PNG source');
else assert.equal(layout.frontHair?.file, 'front-hair.png', 'V4 must use its sibling front-hair.png');
assert.equal(previous.body?.file, 'body-continuous.png', 'The V2 continuous body source must be retained');
const eyeAdjustment = layout.eyeAdjustment ?? { scale: 1, irisScale: 1 };
assert(eyeAdjustment && typeof eyeAdjustment === 'object' && !Array.isArray(eyeAdjustment), 'eyeAdjustment must be an object');
const eyeScale = eyeAdjustment.scale ?? 1, irisScale = eyeAdjustment.irisScale ?? 1;
for (const [label, value] of [['eye scale', eyeScale], ['iris scale', irisScale]]) {
  assert(Number.isFinite(value) && value > 0 && value <= 1, `${label} must be greater than zero and no greater than one`);
}
function offsets(value, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must identify both eye sides`);
  assert.deepEqual(Object.keys(value).sort(), ['l', 'r'], `${label} must contain only l and r`);
  for (const side of ['r', 'l']) assert(Array.isArray(value[side]) && value[side].length === 2 &&
    value[side].every(Number.isSafeInteger), `${label}.${side} must contain two integer pixel offsets`);
  return { r: [...value.r], l: [...value.l] };
}
const eyeOffsets = v5 ? offsets(eyeAdjustment.offsets, 'eyeAdjustment.offsets') : undefined;
const eyebrowAdjustment = v5 ? layout.eyebrowAdjustment : undefined;
if (v5) assert(eyebrowAdjustment && typeof eyebrowAdjustment === 'object' && !Array.isArray(eyebrowAdjustment),
  'V5 eyebrowAdjustment must be an object');
const eyebrowScale = eyebrowAdjustment?.scale;
if (v5) assert(Number.isFinite(eyebrowScale) && eyebrowScale > 0 && eyebrowScale <= 1,
  'Eyebrow scale must be greater than zero and no greater than one');
const eyebrowOffsets = v5 ? offsets(eyebrowAdjustment.offsets, 'eyebrowAdjustment.offsets') : undefined;
if (v5) {
  assert(layout.face && typeof layout.face === 'object' && !Array.isArray(layout.face), 'V5 face placement is required');
  assert.equal(layout.nose?.file, 'nose-soft.png', 'V5 must use its sibling nose-soft.png replacement');
}
const eyeOverrideNames = ['eyewhite-r', 'eyewhite-l', 'eyelash-r', 'eyelash-l'];
const layerOverrides = v6 ? layout.layerOverrides : undefined;
if (v6) {
  assert(layerOverrides && typeof layerOverrides === 'object' && !Array.isArray(layerOverrides),
    'V6 layerOverrides must contain the four matched eye illustration layers');
  assert.deepEqual(Object.keys(layerOverrides).sort(), [...eyeOverrideNames].sort(),
    'V6 layerOverrides must contain exactly eyewhite-r/l and eyelash-r/l; other layers cannot be overridden');
  for (const name of eyeOverrideNames) {
    const override = layerOverrides[name];
    assert(override && typeof override === 'object' && !Array.isArray(override), `${name} override must be an object`);
    assert.equal(override.file, 'eyes-soft-atlas.png', `${name} must use the fixed sibling eyes-soft-atlas.png basename`);
    if (override.offset !== undefined) assert(Array.isArray(override.offset) && override.offset.length === 2 &&
      override.offset.every(Number.isSafeInteger), `${name} override offset must contain two integer pixel offsets`);
  }
}

const originalNames = [
  'back hair', 'neck', 'topwear', 'face', 'blush',
  'eyewhite-r', 'eyewhite-l', 'irides-r', 'irides-l', 'eyelash-r', 'eyelash-l',
  'eye close-r', 'eye close-l', 'tears', 'eyebrow-r', 'eyebrow-l',
  'mouth open', 'nose', 'mouth close', 'front hair 1', 'front hair 2',
];
assert(Array.isArray(original.layers), 'The classic layer layout is required');
assert.deepEqual(original.layers.map(layer => layer.name), originalNames, 'Classic layer identity and order must remain unchanged');
assert(Array.isArray(classicReceipt.value.layers), 'The classic source receipt is required');
assert.deepEqual(classicReceipt.value.layers.map(layer => layer.name), originalNames, 'Classic receipt must identify every original layer');
const classicRecords = new Map(classicReceipt.value.layers.map(layer => [layer.name, layer]));
const previousBody = bodyReceipt.value.layers?.filter(layer => layer.name === 'topwear');
assert.equal(previousBody?.length, 1, 'The V2 body receipt must identify one continuous topwear layer');
assert.deepEqual(previousBody[0].source, previous.body.source, 'The V2 body crop must not change');
assert.deepEqual(previousBody[0].target, previous.body.target, 'The V2 body placement must not change');

function rectangle(value, label, maximumWidth, maximumHeight) {
  assert(Array.isArray(value) && value.length === 4, `${label} must contain four integers`);
  assert(value.every(number => Number.isSafeInteger(number) && number >= 0), `${label} must contain nonnegative safe integers`);
  const [left, top, width, height] = value;
  assert(width > 0 && height > 0 && left + width <= maximumWidth && top + height <= maximumHeight, `${label} escapes its image or canvas`);
  return value;
}
function readPng(filename) {
  const bytes = readFile(filename);
  // Bound decoded allocation before asking pngjs to decompress the source.
  assert(bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR', 'A real PNG source is required');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert(width > 0 && height > 0 && width <= 16384 && height <= 16384 && width * height <= 64 * 1024 * 1024, 'PNG dimensions exceed the source budget');
  const png = PNG.sync.read(bytes);
  assert.equal(png.width, width); assert.equal(png.height, height);
  assert.equal(png.data.length, width * height * 4, 'PNG must decode to RGBA pixels');
  return { png, bytes, filename };
}
function sample(image, source, target, label) {
  const [sx, sy, sw, sh] = rectangle(source, `${label} crop`, image.width, image.height);
  const [, , width, height] = rectangle(target, `${label} target`, layout.width, layout.height);
  const pixels = new Uint8ClampedArray(width * height * 4);
  // X and Y are independently scaled as specified by the layout. The entire
  // crop is sampled without assuming the generated PNG has any particular size.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = ((sy + Math.floor(y * sh / height)) * image.width + sx + Math.floor(x * sw / width)) * 4;
    pixels.set(image.data.subarray(from, from + 4), (y * width + x) * 4);
  }
  return pixels;
}
function adjustEye(item) {
  const match = /^(eyewhite|irides|eyelash|eye close)-([rl])$/.exec(item.name);
  if (!match) return { target: [...item.target], transform: { kind: 'none' } };
  const [, feature, side] = match;
  const eyeWhite = original.layers.find(layer => layer.name === `eyewhite-${side}`);
  assert(eyeWhite, `The original ${side} eye white anchor is required`);
  const [anchorLeft, anchorTop, anchorWidth, anchorHeight] = rectangle(eyeWhite.target,
    `${side} eye anchor`, layout.width, layout.height);
  const anchor = [anchorLeft + anchorWidth / 2, anchorTop + anchorHeight / 2];
  const [left, top, width, height] = rectangle(item.target, `${item.name} original placement`, layout.width, layout.height);
  let target = [Math.round(anchor[0] + (left - anchor[0]) * eyeScale),
    Math.round(anchor[1] + (top - anchor[1]) * eyeScale),
    Math.max(1, Math.round(width * eyeScale)), Math.max(1, Math.round(height * eyeScale))];
  const transform = { kind: 'eye-group-scale', side, anchor, scale: eyeScale,
    originalTarget: [...item.target], groupTarget: [...target] };
  if (feature === 'irides') {
    const irisAnchor = [target[0] + target[2] / 2, target[1] + target[3] / 2];
    const irisWidth = Math.max(1, Math.round(target[2] * irisScale));
    const irisHeight = Math.max(1, Math.round(target[3] * irisScale));
    target = [Math.round(irisAnchor[0] - irisWidth / 2), Math.round(irisAnchor[1] - irisHeight / 2), irisWidth, irisHeight];
    Object.assign(transform, { irisAnchor, irisScale });
  }
  if (v5) {
    transform.offset = [...eyeOffsets[side]];
    transform.scaledTarget = [...target];
    target[0] += eyeOffsets[side][0]; target[1] += eyeOffsets[side][1];
  }
  rectangle(target, `${item.name} effective placement`, layout.width, layout.height);
  return { target, transform };
}
function adjustFeature(item) {
  const eye = adjustEye(item);
  if (!v5 || eye.transform.kind !== 'none') return eye;
  if (item.name === 'face') {
    const target = [...rectangle(layout.face.targetOverride, 'V5 face targetOverride', layout.width, layout.height)];
    rectangle(item.target, 'Original face placement', layout.width, layout.height);
    return { target, transform: { kind: 'layout-target-override', originalTarget: [...item.target],
      scale: [target[2] / item.target[2], target[3] / item.target[3]] } };
  }
  const match = /^eyebrow-([rl])$/.exec(item.name);
  if (!match) return eye;
  const side = match[1];
  const [left, top, width, height] = rectangle(item.target, `${item.name} original placement`, layout.width, layout.height);
  const anchor = [left + width / 2, top + height / 2];
  const scaledTarget = [Math.round(anchor[0] + (left - anchor[0]) * eyebrowScale),
    Math.round(anchor[1] + (top - anchor[1]) * eyebrowScale),
    Math.max(1, Math.round(width * eyebrowScale)), Math.max(1, Math.round(height * eyebrowScale))];
  const offset = [...eyebrowOffsets[side]];
  const target = [scaledTarget[0] + offset[0], scaledTarget[1] + offset[1], scaledTarget[2], scaledTarget[3]];
  rectangle(target, `${item.name} effective placement`, layout.width, layout.height);
  return { target, transform: { kind: 'eyebrow-scale-offset', side, anchor, scale: eyebrowScale,
    originalTarget: [...item.target], scaledTarget, offset } };
}
const body = readPng(path.join(continuous, previous.body.file));
assert.equal(hash(body.bytes), bodyReceipt.value.bodySha256, 'The V2 body PNG differs from its reviewed receipt');
assert.equal(hash(body.bytes), previousBody[0].sha256, 'The V2 body layer receipt differs');
const hair = readPng(path.join(directory, layout.frontHair.file));
const nose = v5 ? readPng(path.join(directory, layout.nose.file)) : undefined;
const eyeAtlas = v6 ? readPng(path.join(directory, 'eyes-soft-atlas.png')) : undefined;
const children = [], sources = [];
function addLayer(name, image, source, target, pixels, reused, transform = {
  kind: 'layout-sampling', scale: [target[2] / source[2], target[3] / source[3]],
}) {
  const [left, top, width, height] = rectangle(target, `${name} target`, layout.width, layout.height);
  assert.equal(pixels.length, width * height * 4, 'Layer RGBA dimensions differ from its placement');
  assert(pixels.some((value, index) => index % 4 === 3 && value > 0), `${name} contains no visible source pixels`);
  children.push({ name, left, top, right: left + width, bottom: top + height,
    imageData: { width, height, data: pixels } });
  sources.push({ name, file: relative(image.filename), sha256: hash(image.bytes),
    decodedSize: [image.png.width, image.png.height], source, target, effectiveTarget: [...target], transform,
    rgbaSha256: hash(pixels), reused });
}
for (const item of original.layers) {
  if (['neck', 'front hair 1', 'front hair 2'].includes(item.name)) continue;
  if (item.name === 'topwear') {
    addLayer(item.name, body, previous.body.source, previous.body.target,
      sample(body.png, previous.body.source, previous.body.target, 'continuous body'), true);
  } else {
    const record = classicRecords.get(item.name);
    assert.deepEqual(item.target, record.target, `Classic placement changed: ${item.name}`);
    if (v5 && item.name === 'nose') {
      addLayer(item.name, nose, layout.nose.source, layout.nose.target,
        sample(nose.png, layout.nose.source, layout.nose.target, 'soft nose replacement'), false,
        { kind: 'replacement-layout-sampling', originalFile: relative(path.join(classic, 'layers', item.name + '.png')), originalSourceSha256: record.sha256,
          originalTarget: [...item.target],
          scale: [layout.nose.target[2] / layout.nose.source[2], layout.nose.target[3] / layout.nose.source[3]] });
      continue;
    }
    const image = readPng(path.join(classic, 'layers', item.name + '.png'));
    assert.equal(hash(image.bytes), record.sha256, `Classic pixels changed: ${item.name}`);
    const [, , width, height] = rectangle(item.target, `${item.name} target`, layout.width, layout.height);
    assert.equal(image.png.width, width, `Classic layer width changed: ${item.name}`);
    assert.equal(image.png.height, height, `Classic layer height changed: ${item.name}`);
    const { target, transform } = adjustFeature(item);
    if (v6 && Object.hasOwn(layerOverrides, item.name)) {
      const override = layerOverrides[item.name];
      const replacementOffset = override.offset === undefined ? [0, 0] : [...override.offset];
      const replacementTarget = [target[0] + replacementOffset[0], target[1] + replacementOffset[1], target[2], target[3]];
      rectangle(replacementTarget, `${item.name} replacement placement`, layout.width, layout.height);
      addLayer(item.name, eyeAtlas, override.source, replacementTarget,
        sample(eyeAtlas.png, override.source, replacementTarget, `${item.name} matched eye replacement`), false,
        { ...transform, kind: 'replacement-eye-layout-sampling', placementKind: transform.kind,
          originalFile: relative(image.filename), originalSourceSha256: record.sha256,
          placementTarget: [...target], replacementOffset,
          samplingScale: [replacementTarget[2] / override.source[2], replacementTarget[3] / override.source[3]] });
      continue;
    }
    addLayer(item.name, image, [0, 0, width, height], target,
      transform.kind === 'none' ? new Uint8ClampedArray(image.png.data)
        : sample(image.png, [0, 0, width, height], target, item.name), true, transform);
  }
}
addLayer('front hair', hair, layout.frontHair.source, layout.frontHair.target,
  sample(hair.png, layout.frontHair.source, layout.frontHair.target, 'unified front hair'), false);
assert.equal(children.length, 19, 'The avatar must contain exactly nineteen layers');
assert.equal(new Set(children.map(layer => layer.name)).size, 19, 'Avatar layer names must be unique');
assert.equal(children.at(-1).name, 'front hair', 'The unified hair must be the topmost source layer');

function composite(neutralOnly) {
  const output = new PNG({ width: layout.width, height: layout.height });
  for (const layer of children) {
    if (neutralOnly && /^(eye close|mouth open|blush|tears)/.test(layer.name)) continue;
    const image = layer.imageData;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const from = (y * image.width + x) * 4, to = ((layer.top + y) * layout.width + layer.left + x) * 4;
      const alpha = image.data[from + 3] / 255, previousAlpha = output.data[to + 3] / 255;
      const total = alpha + previousAlpha * (1 - alpha);
      if (total > 0) for (let channel = 0; channel < 3; channel++) {
        output.data[to + channel] = Math.round((image.data[from + channel] * alpha + output.data[to + channel] * previousAlpha * (1 - alpha)) / total);
      }
      output.data[to + 3] = Math.round(total * 255);
    }
  }
  return output;
}
const assembled = composite(false), neutralBytes = PNG.sync.write(composite(true));
const psd = writePsdBuffer({ width: layout.width, height: layout.height,
  imageData: { width: layout.width, height: layout.height, data: new Uint8ClampedArray(assembled.data) }, children },
{ generateThumbnail: false, trimImageData: false, noBackground: true });

// Decode the serialized PSD into raw ImageData. No browser canvas, alpha
// premultiplication, or procedural image editing is involved in the readback.
initializeCanvas(() => { throw new Error('Canvas creation is forbidden in this mechanical packer'); },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }));
const parsed = readPsd(psd, { useImageData: true, skipCompositeImageData: true, skipThumbnail: true });
assert.equal(parsed.width, layout.width); assert.equal(parsed.height, layout.height);
assert.equal(parsed.children?.length, 19, 'Actual PSD readback layer count differs');
for (const [index, expected] of children.entries()) {
  const actual = parsed.children[index], expectedPixels = expected.imageData, actualPixels = actual.imageData;
  assert.equal(actual.name, expected.name, 'Actual PSD readback layer order differs');
  assert.deepEqual([actual.left, actual.top, actual.right, actual.bottom],
    [expected.left, expected.top, expected.right, expected.bottom], `Actual PSD rectangle differs: ${expected.name}`);
  assert(actualPixels && !actual.children?.length, `Actual PSD must contain raw layer pixels: ${expected.name}`);
  assert.equal(actualPixels.width, expectedPixels.width); assert.equal(actualPixels.height, expectedPixels.height);
  assert.equal(actualPixels.data.byteLength, expectedPixels.data.byteLength, `Actual PSD pixel count differs: ${expected.name}`);
  const bytesOf = pixels => Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  assert(bytesOf(actualPixels.data).equals(bytesOf(expectedPixels.data)), `Actual PSD RGBA bytes differ: ${expected.name}`);
}

const receipt = {
  schema: 1,
  method: v6
    ? 'Classic face source with registered target override; per-side anchored eye and eyebrow scale/offset; four matched eye-white and upper-eyelash illustrations sampled to unchanged target rectangles; V2 continuous body retained; generated unified front hair and soft nose replacement; nearest RGBA sampling and PSD encoding only'
    : v5
    ? 'Classic face source with registered target override; per-side anchored eye and eyebrow scale/offset; V2 continuous body retained; generated unified front hair and soft nose replacement; nearest RGBA sampling and PSD encoding only'
    : 'Classic face and feature sources plus V2 continuous body retained; optional anchored eye and iris reduction; one generated unified front hair; nearest RGBA sampling and PSD encoding only',
  canvas: [layout.width, layout.height],
  eyeAdjustment: { scale: eyeScale, irisScale },
  ...(v5 ? { eyeAdjustment: { scale: eyeScale, irisScale, offsets: eyeOffsets },
    eyebrowAdjustment: { scale: eyebrowScale, offsets: eyebrowOffsets },
    faceAdjustment: { targetOverride: [...layout.face.targetOverride] }, noseSha256: hash(nose.bytes) } : {}),
  ...(v6 ? { eyeAtlasSha256: hash(eyeAtlas.bytes), layerOverrides: eyeOverrideNames.map(name => ({ name,
    file: layerOverrides[name].file, source: [...layerOverrides[name].source],
    ...(layerOverrides[name].offset === undefined ? {} : { offset: [...layerOverrides[name].offset] }) })) } : {}),
  layouts: [avatarLayout, classicLayout, bodyLayout].map(({ file, sha256 }) => ({ file, sha256 })),
  sourceReceipts: [classicReceipt, bodyReceipt].map(({ file, sha256 }) => ({ file, sha256 })),
  bodySha256: hash(body.bytes), frontHairSha256: hash(hair.bytes),
  psdSha256: hash(psd), neutralLayoutSha256: hash(neutralBytes),
  readback: { status: 'pass', layerCount: 19, checks: ['canvas', 'layer names and order', 'layer rectangles', 'exact decoded RGBA bytes'] },
  layers: sources,
};
const artifacts = new Map([
  ['akari.psd', psd], ['neutral-layout.png', neutralBytes],
  ['pack-receipt.json', Buffer.from(JSON.stringify(receipt, null, 2) + '\n')],
]);
function preflightOutput(filename) {
  insideProject(filename);
  let entry;
  try { entry = fs.lstatSync(filename); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  assert(entry.isFile() && !entry.isSymbolicLink(), 'Output must be a regular generated file');
  assert.equal(fs.realpathSync(filename), filename, 'Output must not resolve through another path');
}
for (const name of artifacts.keys()) preflightOutput(path.join(directory, name));
const pending = [];
try {
  // Every layer has passed serialized readback before any output is replaced.
  // Stage all members, then atomically replace each one; publish the receipt last.
  for (const [name, bytes] of artifacts) {
    const target = path.join(directory, name), temporary = target + '.' + randomUUID() + '.tmp';
    fs.writeFileSync(temporary, bytes, { flag: 'wx' });
    pending.push({ target, temporary });
    assert(readFile(temporary).equals(bytes), 'Staged output bytes differ from the verified content');
  }
  for (const member of pending) fs.renameSync(member.temporary, member.target);
} finally {
  for (const member of pending) if (fs.existsSync(member.temporary)) fs.unlinkSync(member.temporary);
}
console.log(JSON.stringify({ layers: children.length, psdBytes: psd.length, psdSha256: hash(psd), readback: 'pass' }));
