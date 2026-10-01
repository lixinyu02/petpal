/** Mechanical atlas extraction / PSD packaging. No artwork is drawn here. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PNG } from 'pngjs';
import { writePsdBuffer, readPsd } from 'ag-psd';

const directory = path.resolve(process.argv[2] || 'outputs/avatars/akari-cubism');
const layout = JSON.parse(fs.readFileSync(path.join(directory, 'layout.json'), 'utf8'));
const atlases = new Map();
const getAtlas = name => {
  if (path.basename(name) !== name) throw new Error('Atlas must be a sibling PNG');
  if (!atlases.has(name)) atlases.set(name, PNG.sync.read(fs.readFileSync(path.join(directory, name))));
  return atlases.get(name);
};
const composite = new PNG({ width: layout.width, height: layout.height });
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const records = [];
fs.mkdirSync(path.join(directory, 'layers'), { recursive: true });
const layers = layout.layers.map(item => {
  const source = getAtlas(item.atlas || layout.atlas);
  const [sx, sy, sw, sh] = item.source;
  const [left, top, width, height] = item.target;
  if ([sx, sy, sw, sh, left, top, width, height].some(n => !Number.isInteger(n) || n < 0)
      || sx + sw > source.width || sy + sh > source.height
      || left + width > layout.width || top + height > layout.height || !sw || !sh || !width || !height) {
    throw new Error(`Invalid layer rectangle: ${item.name}`);
  }
  const data = new Uint8ClampedArray(width * height * 4);
  // Deterministic nearest source sampling preserves RGBA values, including generated alpha.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const src = ((sy + Math.min(sh - 1, Math.floor(y * sh / height))) * source.width
      + sx + Math.min(sw - 1, Math.floor(x * sw / width))) * 4;
    data.set(source.data.subarray(src, src + 4), (y * width + x) * 4);
  }
  const image = new PNG({ width, height }); image.data = Buffer.from(data);
  const buffer = PNG.sync.write(image);
  fs.writeFileSync(path.join(directory, 'layers', `${item.name}.png`), buffer);
  records.push({ ...item, sha256: hash(buffer), alpha: [Math.min(...new Set(data.filter((_, i) => i % 4 === 3))), Math.max(...new Set(data.filter((_, i) => i % 4 === 3)))] });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const a = (y * width + x) * 4, b = ((top + y) * layout.width + left + x) * 4;
    const srcA = data[a + 3] / 255, dstA = composite.data[b + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA > 0) for (let c = 0; c < 3; c++) composite.data[b + c] = Math.round((data[a + c] * srcA + composite.data[b + c] * dstA * (1 - srcA)) / outA);
    composite.data[b + 3] = Math.round(outA * 255);
  }
  return { name: item.name, left, top, imageData: { width, height, data } };
});
const imageData = { width: layout.width, height: layout.height, data: new Uint8ClampedArray(composite.data) };
const psd = writePsdBuffer({ width: layout.width, height: layout.height, imageData, children: layers }, { generateThumbnail: false });
fs.writeFileSync(path.join(directory, 'akari.psd'), psd);
fs.writeFileSync(path.join(directory, 'assembled.png'), PNG.sync.write(composite));
const readback = readPsd(psd, { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true });
if (readback.children.length !== layers.length) throw new Error('PSD layer readback mismatch');
fs.writeFileSync(path.join(directory, 'pack-receipt.json'), JSON.stringify({
  schema: 1, atlases: [...atlases.keys()].map(file => ({ file, sha256: hash(fs.readFileSync(path.join(directory, file))) })),
  psdSha256: hash(psd), canvas: [layout.width, layout.height], layers: records,
  method: 'Generated raster parts; deterministic crop, scale, offset and RGB8 PSD packaging; no procedural artwork.'
}, null, 2) + '\n');
console.log(JSON.stringify({ psd: path.join(directory, 'akari.psd'), layers: layers.length, bytes: psd.length }));
