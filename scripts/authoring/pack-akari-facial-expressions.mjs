/** Mechanical PSD packing only: original layers and generated donor pixels are never painted or rescaled. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { initializeCanvas, readPsd, writePsdBuffer } from 'ag-psd';

const root = path.resolve(import.meta.dirname, '../..');
const source = 'outputs/avatars/akari-cubism-v7/akari.psd';
const output = path.join(root, 'outputs/avatars/akari-cubism-v10');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
initializeCanvas(() => { throw new Error('Canvas drawing is not used'); },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }));
const inputBytes = fs.readFileSync(path.join(root, source));
const psd = readPsd(inputBytes, { useImageData: true, skipThumbnail: true });
if (psd.width !== 1024 || psd.height !== 1536 || psd.children?.length !== 11) throw new Error('Unexpected V7 PSD');
const oldLayers = [...psd.children];
const mask = oldLayers.find(layer => layer.name === 'warm');
if (!mask?.imageData || !mask.hidden) throw new Error('Expected reviewed local face mask');
const receipts = [];
for (const name of ['shy', 'surprise', 'relaxed']) {
  const file = `artwork/akari/expressions-v10/${name}.png`;
  const bytes = fs.readFileSync(path.join(root, file));
  const donor = PNG.sync.read(bytes);
  if (donor.width !== psd.width || donor.height !== psd.height) throw new Error(`Donor canvas changed: ${name}`);
  const { width, height } = mask.imageData;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const to = (y * width + x) * 4;
    const from = ((mask.top + y) * donor.width + mask.left + x) * 4;
    data.set(donor.data.subarray(from, from + 3), to);
    // Reuse the reviewed interior coverage, while retaining generated donor alpha.
    data[to + 3] = Math.min(mask.imageData.data[to + 3], donor.data[from + 3] >= 245 ? 255 : donor.data[from + 3]);
  }
  const layer = { name, hidden: true, left: mask.left, top: mask.top, imageData: { width, height, data } };
  // PSD is topmost first: place new faces below blink/mouth and above base face.
  psd.children.splice(psd.children.indexOf(mask), 0, layer);
  receipts.push({ name, source: file, sha256: sha(bytes), bounds: [mask.left, mask.top, width, height], pixelsSha256: sha(data) });
}
const bytes = writePsdBuffer(psd, { generateThumbnail: false });
const read = readPsd(bytes, { useImageData: true, skipThumbnail: true });
if (read.children.length !== 14) throw new Error('PSD layer count changed');
for (const layer of [...oldLayers, ...psd.children.filter(layer => !oldLayers.includes(layer))]) {
  const actual = read.children.find(item => item.name === layer.name);
  if (!actual || actual.left !== layer.left || actual.top !== layer.top || !!actual.hidden !== !!layer.hidden ||
    !Buffer.from(actual.imageData.data).equals(Buffer.from(layer.imageData.data))) throw new Error(`Layer readback mismatch: ${layer.name}`);
}
// PSD's composite codec applies and removes a white matte on translucent
// pixels, introducing rounding. Native export consumes the exact layer data.
let compositeAlphaDifference = 0, compositeOpaqueRgbDifference = 0;
for (let i = 0; i < psd.imageData.data.length; i += 4) {
  compositeAlphaDifference = Math.max(compositeAlphaDifference, Math.abs(read.imageData.data[i + 3] - psd.imageData.data[i + 3]));
  if (psd.imageData.data[i + 3] === 255) for (let c = 0; c < 3; c++) compositeOpaqueRgbDifference = Math.max(compositeOpaqueRgbDifference, Math.abs(read.imageData.data[i + c] - psd.imageData.data[i + c]));
}
if (compositeAlphaDifference || compositeOpaqueRgbDifference) throw new Error('Neutral preview opaque pixels or alpha changed');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'akari.psd'), bytes);
const receipt = { schema: 1, source, sourceSha256: sha(inputBytes), psdSha256: sha(bytes), layers: 14,
  unchangedSourceLayers: oldLayers.map(layer => ({ name: layer.name, pixelsSha256: sha(layer.imageData.data) })),
  newLayers: receipts, neutralLayersIdentical: true, compositeAlphaDifference, compositeOpaqueRgbDifference,
  method: 'Unscaled generated face pixels clipped to reviewed V7 local mask; old 11 layers preserved byte for byte; no painted or synthetic features' };
fs.writeFileSync(path.join(output, 'pack-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
