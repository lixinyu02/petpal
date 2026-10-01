import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { initializeCanvas, readPsd } from 'ag-psd';

// Decode the saved PSD channel pixels directly. No canvas rendering, source
// hashes or recreation of the packer's crop/eye-scaling implementation is used.
initializeCanvas(() => { throw new Error('Source coverage must use raw PSD imageData'); },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }));

function alphaAt(layer, x, y) {
  const image = layer.imageData;
  assert.ok(image && image.data.length === image.width * image.height * 4, `${layer.name} needs decoded RGBA pixels`);
  if (layer.hidden || x < layer.left || y < layer.top || x >= layer.left + image.width || y >= layer.top + image.height) return 0;
  return image.data[((y - layer.top) * image.width + x - layer.left) * 4 + 3] / 255 * (layer.opacity ?? 1);
}

async function sourceCoverage(directory) {
  const psd = readPsd(await fs.readFile(new URL('akari.psd', directory)), { useImageData: true, skipCompositeImageData: true, skipThumbnail: true });
  const flatten = layers => layers.flatMap(layer => [layer, ...flatten(layer.children || [])]);
  const layers = flatten(psd.children || []), names = new Map(layers.map(layer => [layer.name, layer]));
  const face = names.get('face'), brows = [names.get('eyebrow-r'), names.get('eyebrow-l')];
  const eyes = [names.get('eyewhite-r'), names.get('eyewhite-l')];
  const hair = layers.filter(layer => /^front hair(?: \d+)?$/u.test(layer.name));
  assert.ok(face && brows.every(Boolean) && eyes.every(Boolean) && hair.length, 'PSD must contain the real face, eyebrows, eyes and foreground hair');
  const foreheadBottom = Math.min(...brows.map(layer => layer.top));
  assert.equal(foreheadBottom, 292, 'Measure the original eyebrow-top boundary in authored pixels');
  const hairAlpha = (x, y) => 1 - hair.reduce((remaining, layer) => remaining * (1 - alphaAt(layer, x, y)), 1);
  const gaps = [480, 512, 550].map(x => {
    let current = 0, longest = 0, facePixels = 0;
    for (let y = face.top; y < foreheadBottom; y++) {
      const skin = alphaAt(face, x, y) >= .5;
      if (skin) facePixels++;
      // Use the longest exposed run, so a stray hair pixel near a brow cannot
      // hide a large naked forehead higher up the same anatomical column.
      current = skin && hairAlpha(x, y) < .5 ? current + 1 : 0;
      longest = Math.max(longest, current);
    }
    assert.ok(facePixels > 70, `x=${x} must cross the actual forehead skin`);
    return { x, exposedGapPx: longest };
  });
  const eyeCoverage = eyes.map(layer => {
    let eyeAlpha = 0, occludedAlpha = 0;
    for (let y = layer.top; y < layer.top + layer.imageData.height; y++) {
      for (let x = layer.left; x < layer.left + layer.imageData.width; x++) {
        const amount = alphaAt(layer, x, y);
        eyeAlpha += amount;
        occludedAlpha += amount * hairAlpha(x, y);
      }
    }
    assert.ok(eyeAlpha > 1, `${layer.name} must retain visible native eye pixels`);
    return { eye: layer.name, occludedFraction: occludedAlpha / eyeAlpha };
  });
  return { foreheadBottom, gaps, eyeCoverage };
}

function coveredForeheadAndVisibleEyes(result) {
  for (const gap of result.gaps) assert.ok(gap.exposedGapPx <= 70, `forehead x=${gap.x} has ${gap.exposedGapPx}px of exposed skin`);
  for (const eye of result.eyeCoverage) assert.ok(eye.occludedFraction < .02, `${eye.eye} is ${(eye.occludedFraction * 100).toFixed(3)}% covered by foreground hair`);
}

test('native V4 PSD foreground hair covers the forehead while leaving the adjusted eye-white masks visible', async t => {
  const result = await sourceCoverage(new URL('../outputs/avatars/akari-cubism-v4/', import.meta.url));
  coveredForeheadAndVisibleEyes(result);
  t.diagnostic(`V4 registered source alpha ${JSON.stringify(result)}`);
});

test('the same native-alpha coverage acceptance rejects the old V2 exposed forehead', async t => {
  const result = await sourceCoverage(new URL('../outputs/avatars/akari-cubism-v2/', import.meta.url));
  assert.throws(() => coveredForeheadAndVisibleEyes(result), /forehead x=.*exposed skin/u);
  assert.ok(result.gaps.filter(gap => gap.exposedGapPx > 70).length >= 2, 'the real old hair must fail at multiple forehead columns');
  t.diagnostic(`V2 exposed-forehead negative control ${JSON.stringify(result)}`);
});
