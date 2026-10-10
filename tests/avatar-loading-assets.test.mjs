import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';

const root = new URL('../', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = relative => readFile(new URL(relative, root));
const json = async relative => JSON.parse(await read(relative));
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;

function webp(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length, 'WebP container must not be truncated or extended');
  let dimensions, lossless = false, alpha = false, lossy = false;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const type = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), payload = offset + 8;
    assert.ok(payload + length <= bytes.length, 'WebP chunk must be complete');
    if (type === 'VP8X') {
      assert.equal(length, 10);
      alpha = !!(bytes[payload] & 0x10);
      dimensions = { width: bytes.readUIntLE(payload + 4, 3) + 1, height: bytes.readUIntLE(payload + 7, 3) + 1 };
    } else if (type === 'VP8L') {
      assert.ok(length >= 5); assert.equal(bytes[payload], 0x2f);
      const bits = bytes.readUInt32LE(payload + 1);
      dimensions = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      lossless = true; alpha ||= !!(bits & 0x10000000);
    } else if (type === 'VP8 ') lossy = true;
    offset = payload + length + length % 2;
  }
  assert.ok(dimensions && (lossless || lossy));
  return { dimensions, lossless, lossy, alpha };
}

test('V12 transport is a complete exact lossless WebP bound to the retained source texels and every native asset', async () => {
  const receipt = await json('public/avatars/akari-cubism-v12/texture-transport.json');
  const manifest = await json('public/avatars/akari-cubism-v12/akari.model3.json');
  assert.equal(receipt.source, 'public/avatars/akari-cubism-v11/akari.2048/texture_00.png');
  assert.equal(receipt.format, 'webp-lossless-exact');
  assert.deepEqual(receipt.encoderOptions, ['-lossless', '-exact', '-m', '6']);
  assert.equal(receipt.rgbaEqual, true);
  assert.equal(receipt.published, `public/avatars/akari-cubism-v12/akari.2048/texture_00-${receipt.publishedSha256.slice(0, 12)}.webp`);
  assert.deepEqual(manifest.FileReferences.Textures, [receipt.published.replace('public/avatars/akari-cubism-v12/', '')]);
  const [original, published] = await Promise.all([read(receipt.source), read(receipt.published)]);
  assert.equal(sha(original), receipt.sourceSha256); assert.equal(sha(published), receipt.publishedSha256);
  assert.equal(original.length, receipt.originalBytes); assert.equal(published.length, receipt.publishedBytes);
  const png = PNG.sync.read(original);
  assert.equal(png.width, receipt.width); assert.equal(png.height, receipt.height);
  assert.equal(sha(png.data), receipt.decodedRgbaSha256, 'The recorded exact pixel audit is bound to all retained source channels');
  const encoded = webp(published);
  assert.deepEqual(encoded.dimensions, { width: 2048, height: 2048 });
  assert.equal(encoded.lossless, true); assert.equal(encoded.lossy, false); assert.equal(encoded.alpha, true);
  assert.ok(published.length < original.length * .5, 'Exact transport cuts main texture bytes by at least half');
  const references = manifest.FileReferences;
  const native = [references.Moc, references.Physics, references.DisplayInfo, ...Object.values(references.Motions).flatMap(entries => entries.map(entry => entry.File))].sort();
  assert.equal(Object.values(references.Motions).flat().length, 16);
  assert.deepEqual(Object.keys(receipt.nativeAssetsSha256).sort(), native);
  for (const file of native) assert.equal(sha(await read(`public/avatars/akari-cubism-v12/${file}`)), receipt.nativeAssetsSha256[file], `Native asset changed: ${file}`);
  delete manifest.FileReferences.Textures;
  assert.equal(sha(JSON.stringify(sorted(manifest))), receipt.modelWithoutTexturesSha256, 'All non-texture model fields retain the audited contract');
  assert.equal((await readdir(new URL('public/avatars/akari-cubism-v12/akari.2048/', root))).includes('texture_00.png'), false, 'Duplicate V12 PNG does not enter the public bundle');
});

test('loading-only preview is content addressed, under 120 KB, portrait RGBA with lossless audited alpha', async () => {
  const receipt = await json('public/avatars/akari/loading-preview.json');
  assert.equal(receipt.source, 'artwork/akari/idle.png');
  assert.equal(receipt.format, 'webp-lossy-rgb-lossless-alpha');
  assert.equal(receipt.resizeFilter, 'Pillow-LANCZOS');
  assert.deepEqual(receipt.encoderOptions, ['-q', '85', '-alpha_q', '100', '-exact', '-m', '6']);
  assert.equal(receipt.published, `public/avatars/akari/preview-${receipt.publishedSha256.slice(0, 12)}.webp`);
  const [original, published] = await Promise.all([read(receipt.source), read(receipt.published)]);
  assert.equal(sha(original), receipt.sourceSha256); assert.equal(sha(published), receipt.publishedSha256);
  assert.equal(original.length, receipt.originalBytes); assert.equal(published.length, receipt.publishedBytes);
  assert.equal(receipt.maximumPublishedBytesExclusive, 120000); assert.ok(published.length < 120000);
  const encoded = webp(published);
  assert.deepEqual(encoded.dimensions, { width: 384, height: 576 });
  assert.equal(encoded.alpha, true); assert.equal(encoded.lossy, true);
  assert.equal(receipt.alphaEqual, true); assert.equal(receipt.decodedAlphaSha256, receipt.resizedSourceAlphaSha256);
  for (const field of ['decodedAlphaSha256', 'decodedRgbaSha256']) assert.match(receipt[field], /^[a-f0-9]{64}$/u);
  const fallback = await json('public/avatars/akari/manifest.json');
  assert.equal(fallback.entries.length, 8, 'Loading-only preview is independent of the eight full-resolution expressions');
  assert.ok(fallback.entries.every(entry => entry.width === 1024 && entry.height === 1536));
});
