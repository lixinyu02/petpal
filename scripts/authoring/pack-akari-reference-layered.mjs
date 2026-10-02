/** Mechanical source segmentation and PSD encoding. No artwork is painted or rescaled. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { initializeCanvas, writePsdBuffer, readPsd } from 'ag-psd';

const root = path.resolve(import.meta.dirname, '../..');
const output = path.join(root, 'outputs/avatars/akari-cubism-v7');
const source = path.join(root, 'artwork/akari');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
initializeCanvas(() => { throw new Error('Canvas drawing is not used by this mechanical packer'); },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }));
const images = new Map(), sources = [];
for (const name of ['idle', 'blink', 'talk', 'round', 'warm', 'sad', 'pout']) {
  const bytes = fs.readFileSync(path.join(source, name + '.png'));
  const png = PNG.sync.read(bytes);
  if (png.width !== 1024 || png.height !== 1536) throw new Error('Reference canvas changed');
  images.set(name, png); sources.push({ file: 'artwork/akari/' + name + '.png', sha256: hash(bytes) });
}
const idle = images.get('idle'), { width, height } = idle;
const smooth = x => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const box = (x, y, l, t, r, b, feather = 8) => smooth(Math.min(x - l, r - x, y - t, b - y) / feather);
const ellipse = (x, y, cx, cy, rx, ry, feather = .12) => smooth((1 - Math.hypot((x - cx) / rx, (y - cy) / ry)) / feather);
const tipLeft = (x, y) => box(x, y, 190, 465, 436, 708, 32) * smooth((y - 475) / 80) * (1 - smooth((x - 379) / 57));
const tipRight = (x, y) => box(x, y, 586, 460, 837, 708, 32) * smooth((y - 475) / 80) * smooth((x - 590) / 64);
const children = [], layerReceipt = [];
function layer(name, donor, alphaAt, optional = false) {
  const png = images.get(donor), pixels = new Uint8ClampedArray(width * height * 4);
  let left = width, top = height, right = 0, bottom = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, a = Math.round(255 * Math.min(1, Math.max(0, alphaAt(x, y, i))));
    if (!a) continue;
    pixels.set(png.data.subarray(i, i + 3), i); pixels[i + 3] = a;
    left = Math.min(left, x); right = Math.max(right, x + 1); top = Math.min(top, y); bottom = Math.max(bottom, y + 1);
  }
  if (right <= left || bottom <= top) throw new Error('Empty layer: ' + name);
  const w = right - left, h = bottom - top, cropped = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) cropped.set(pixels.subarray(((top + y) * width + left) * 4, ((top + y) * width + right) * 4), y * w * 4);
  const item = { name, left, top, hidden: optional, imageData: { width: w, height: h, data: cropped } };
  children.push(item); layerReceipt.push({ name, donor, bounds: [left, top, w, h], defaultVisible: !optional });
  return item;
}
// Inverse source-over alpha ownership preserves the exact neutral image, including
// its antialiased silhouette. Adding two source-alpha masks would darken seams.
const remainder = (a, upper) => upper >= 1 ? 0 : Math.max(0, (a - upper) / (1 - upper));
function alphas(x, y, i) {
  const a = idle.data[i + 3] / 255;
  const left = a * tipLeft(x, y), right = a * tipRight(x, y);
  const remaining = remainder(remainder(a, right), left);
  const head = remaining * (1 - smooth((y - 700) / 40));
  return { left, right, head, body: remainder(remaining, head) };
}
layer('topwear', 'idle', (x, y, i) => alphas(x, y, i).body);
layer('face', 'idle', (x, y, i) => alphas(x, y, i).head);
layer('front hair 1', 'idle', (x, y, i) => alphas(x, y, i).left);
layer('front hair 2', 'idle', (x, y, i) => alphas(x, y, i).right);
const faceMask = (x, y) => Math.max(box(x, y, 349, 271, 672, 430, 14), ellipse(x, y, 515, 441, 157, 113, .15));
for (const emotion of ['warm', 'sad', 'pout']) layer(emotion, emotion, (x, y, i) => faceMask(x, y) * Math.min(1, idle.data[i + 3] / 245), true);
// Fully covered interiors avoid ghosting the original open iris through a 251/255 donor alpha.
layer('blink-right', 'blink', (x, y, i) => box(x, y, 342, 334, 487, 432, 9) * Math.min(1, idle.data[i + 3] / 245), true);
layer('blink-left', 'blink', (x, y, i) => box(x, y, 542, 315, 671, 420, 9) * Math.min(1, idle.data[i + 3] / 245), true);
const mouthMask = (x, y) => box(x, y, 463, 459, 569, 541, 10);
layer('mouth-a', 'talk', (x, y, i) => mouthMask(x, y) * Math.min(1, idle.data[i + 3] / 245), true);
layer('mouth-o', 'round', (x, y, i) => mouthMask(x, y) * Math.min(1, idle.data[i + 3] / 245), true);

function composite(active) {
  const result = new PNG({ width, height });
  for (const item of children) {
    if (!active.has(item.name)) continue;
    const data = item.imageData;
    for (let y = 0; y < data.height; y++) for (let x = 0; x < data.width; x++) {
      const from = (y * data.width + x) * 4, to = ((item.top + y) * width + item.left + x) * 4;
      const a = data.data[from + 3] / 255, b = result.data[to + 3] / 255, total = a + b * (1 - a);
      if (total) for (let c = 0; c < 3; c++) result.data[to + c] = Math.round((data.data[from + c] * a + result.data[to + c] * b * (1 - a)) / total);
      result.data[to + 3] = Math.round(total * 255);
    }
  }
  return result;
}
const neutralLayers = new Set(layerReceipt.filter(layer => layer.defaultVisible).map(layer => layer.name));
const neutral = composite(neutralLayers);
let maxAlphaDifference = 0, maxRgbDifference = 0, differences = 0;
for (let i = 0; i < idle.data.length; i += 4) {
  const da = Math.abs(neutral.data[i + 3] - idle.data[i + 3]); maxAlphaDifference = Math.max(maxAlphaDifference, da);
  if (idle.data[i + 3] && neutral.data[i + 3]) for (let c = 0; c < 3; c++) maxRgbDifference = Math.max(maxRgbDifference, Math.abs(neutral.data[i + c] - idle.data[i + c]));
  if (da > 1) differences++;
}
if (maxAlphaDifference > 1 || maxRgbDifference > 1 || differences) throw new Error('Neutral source-over mismatch');
fs.mkdirSync(output, { recursive: true });
// PSD stores topmost first, while the compositor and native draw orders run bottommost first.
const psd = writePsdBuffer({ width, height, imageData: { width, height, data: new Uint8ClampedArray(neutral.data) }, children: [...children].reverse() }, { generateThumbnail: false });
const parsed = readPsd(psd, { useImageData: true, skipCompositeImageData: true, skipThumbnail: true });
if (parsed.children.length !== children.length) throw new Error('PSD layer readback mismatch');
for (const item of children) {
  const read = parsed.children.find(candidate => candidate.name === item.name);
  if (!read || read.left !== item.left || read.top !== item.top || Boolean(read.hidden) !== item.hidden ||
      read.imageData?.width !== item.imageData.width || read.imageData?.height !== item.imageData.height ||
      !Buffer.from(read.imageData.data).equals(Buffer.from(item.imageData.data))) throw new Error('PSD pixel/state readback mismatch: ' + item.name);
}
fs.writeFileSync(path.join(output, 'akari.psd'), psd);
fs.writeFileSync(path.join(output, 'neutral-layout.png'), PNG.sync.write(neutral));
for (const pose of ['blink', 'mouth-a', 'mouth-o', 'warm', 'sad', 'pout']) {
  const active = new Set(neutralLayers);
  if (pose === 'blink') { active.add('blink-left'); active.add('blink-right'); } else active.add(pose);
  fs.writeFileSync(path.join(output, pose + '-layout.png'), PNG.sync.write(composite(active)));
}
fs.writeFileSync(path.join(output, 'pack-receipt.json'), JSON.stringify({ schema: 1, method: 'Unscaled original neutral pixels; inverse source-over head/body/hair segmentation; same-character local expression patches; native layered PSD encoding', canvas: [width, height], sources, layers: layerReceipt, psdSha256: hash(psd), neutralComparison: { maxAlphaDifference, maxRgbDifference }, boundary: 'Mechanical source and composites only; native exporter/Core/browser must be verified separately' }, null, 2) + '\n');
console.log(JSON.stringify({ layers: children.length, psdBytes: psd.length, psdSha256: hash(psd), maxAlphaDifference, maxRgbDifference }));
