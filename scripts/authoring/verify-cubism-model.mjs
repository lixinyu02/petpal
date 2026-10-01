import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const [manifestArg, receiptArg, ...flags] = process.argv.slice(2);
assert(manifestArg, 'Usage: node verify-official-core.mjs <model3.json> [receipt.json]');
const projectRoot = path.resolve(import.meta.dirname, '../..');
const coreFlagIndex = flags.indexOf('--core');
const corePath = coreFlagIndex >= 0
  ? path.resolve(flags[coreFlagIndex + 1] ?? '')
  : path.join(projectRoot, 'public/vendor/live2d/live2dcubismcore.min.js');
const manifestPath = path.resolve(manifestArg);
const modelRoot = path.dirname(manifestPath);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const coreBytes = fs.readFileSync(corePath);
const coreLogs = [];
const sandboxConsole = Object.fromEntries(['log', 'warn', 'error'].map(key => [key, (...args) => coreLogs.push(args.map(String).join(' '))]));
const context = vm.createContext({ console: sandboxConsole, Buffer, setTimeout, clearTimeout, atob });
// Execute the exact official embedded runtime. No altered runtime, filesystem API, or network API enters the VM.
vm.runInContext(coreBytes.toString('utf8'), context, { filename: 'official-cubism-core.js', timeout: 10000 });
const core = context.Live2DCubismCore;
assert(core, 'Official Core namespace missing');
let version;
const readyDeadline = Date.now() + 10000;
while (Date.now() < readyDeadline) {
  try { version = core.Version.csmGetVersion(); break; } catch { await new Promise(resolve => setTimeout(resolve, 25)); }
}
assert(Number.isInteger(version) && version > 0, 'Official Core did not initialize');
core.Logging.csmSetLogFunction(message => coreLogs.push(String(message)));

function resolveAsset(relative) {
  assert(typeof relative === 'string' && relative && !/^[a-z]+:/i.test(relative), 'Only local model file references are allowed');
  const target = path.resolve(modelRoot, relative);
  assert(target.startsWith(modelRoot + path.sep), 'Model reference escapes the bundle');
  assert(fs.statSync(target).isFile(), `Referenced asset missing: ${relative}`);
  return target;
}
const references = manifest.FileReferences;
assert(references?.Moc && Array.isArray(references.Textures) && references.Textures.length, 'Model references incomplete');
const referencedPaths = new Set([references.Moc, ...references.Textures]);
for (const key of ['Physics', 'Pose', 'UserData', 'DisplayInfo']) if (references[key]) referencedPaths.add(references[key]);
for (const entries of Object.values(references.Motions ?? {})) for (const entry of entries) {
  referencedPaths.add(entry.File);
  if (entry.Sound) referencedPaths.add(entry.Sound);
}
for (const entry of references.Expressions ?? []) referencedPaths.add(entry.File);
const files = [...referencedPaths].map(relative => {
  const bytes = fs.readFileSync(resolveAsset(relative));
  return { path: relative, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
});
const mocBuffer = fs.readFileSync(resolveAsset(references.Moc));
const mocArray = mocBuffer.buffer.slice(mocBuffer.byteOffset, mocBuffer.byteOffset + mocBuffer.byteLength);
assert.equal(mocBuffer.subarray(0, 4).toString('ascii'), 'MOC3', 'Actual binary MOC3 required');
const checker = Object.create(core.Moc.prototype);
const consistency = checker.hasMocConsistency(mocArray);
assert.equal(consistency, 1, 'Official Core rejected the MOC3 consistency');
const invalid = mocArray.slice(0);
new Uint8Array(invalid)[0] ^= 0xff;
assert.equal(checker.hasMocConsistency(invalid), 0, 'Corrupt-magic negative control must be rejected');
const mocVersion = core.Version.csmGetMocVersion(mocArray);
const moc = core.Moc.fromArrayBuffer(mocArray);
assert(moc, 'Official Core could not revive the actual MOC3');
const model = core.Model.fromMoc(moc);
assert(model, 'Official Core could not instantiate the actual model');
let receipt;
try {
  const parameters = Array.from(model.parameters.ids, (id, index) => ({
    id, min: model.parameters.minimumValues[index], max: model.parameters.maximumValues[index],
    default: model.parameters.defaultValues[index], keyCount: model.parameters.keyCounts[index],
  }));
  for (const parameter of parameters) {
    assert([parameter.min, parameter.max, parameter.default].every(Number.isFinite), `Non-finite parameter: ${parameter.id}`);
    assert(parameter.min <= parameter.default && parameter.default <= parameter.max, `Invalid parameter range: ${parameter.id}`);
  }
  const required = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamEyeLOpen', 'ParamEyeROpen', 'ParamEyeBallX', 'ParamEyeBallY', 'ParamMouthOpenY', 'ParamBreath'];
  for (const id of required) assert(parameters.some(parameter => parameter.id === id), `Required rig parameter missing: ${id}`);
  const indexById = new Map(parameters.map((parameter, index) => [parameter.id, index]));
  const emotionParameters = ['ParamCheek', 'ParamTear'];
  if (flags.includes('--require-emotions')) for (const id of emotionParameters) assert(indexById.has(id), `Actual emotion parameter missing: ${id}`);
  const displayInfo = references.DisplayInfo ? JSON.parse(fs.readFileSync(resolveAsset(references.DisplayInfo), 'utf8')) : null;
  const canvas = model.canvasinfo;
  assert([canvas.CanvasWidth, canvas.CanvasHeight, canvas.PixelsPerUnit].every(value => Number.isFinite(value) && value > 0), 'Invalid canvas dimensions');
  const coordinateBound = 3 * Math.max(canvas.CanvasWidth, canvas.CanvasHeight) / canvas.PixelsPerUnit;

  function samplePose(name, values = {}) {
    model.parameters.values.set(model.parameters.defaultValues);
    for (const [id, value] of Object.entries(values)) {
      assert(indexById.has(id), `Unknown sampled parameter: ${id}`);
      model.parameters.values[indexById.get(id)] = value;
    }
    model.update();
    const drawables = model.drawables;
    assert(drawables.count > 5, 'A layered rig needs multiple real drawables');
    const positions = [];
    const opacities = Array.from(drawables.opacities);
    let vertexCount = 0;
    let indexCount = 0;
    for (let index = 0; index < drawables.count; index += 1) {
      const vertex = Array.from(drawables.vertexPositions[index]);
      const uv = Array.from(drawables.vertexUvs[index]);
      const triangles = Array.from(drawables.indices[index]);
      assert.equal(vertex.length, drawables.vertexCounts[index] * 2, `Vertex count mismatch: ${name}`);
      assert.equal(uv.length, vertex.length, `UV count mismatch: ${name}`);
      assert(vertex.every(value => Number.isFinite(value) && Math.abs(value) < coordinateBound), `Invalid/exploded geometry: ${name}`);
      assert(uv.every(value => Number.isFinite(value) && value >= -0.0001 && value <= 1.0001), `Invalid UV: ${name}`);
      assert.equal(triangles.length, drawables.indexCounts[index], `Index count mismatch: ${name}`);
      assert.equal(triangles.length % 3, 0, `Non-triangle indices: ${name}`);
      assert(triangles.every(value => value >= 0 && value < drawables.vertexCounts[index]), `Triangle index out of range: ${name}`);
      assert(drawables.textureIndices[index] >= 0 && drawables.textureIndices[index] < references.Textures.length, 'Invalid texture index');
      assert(Array.from(drawables.masks[index]).every(value => value >= 0 && value < drawables.count), 'Invalid mask target');
      assert(Number.isFinite(opacities[index]) && opacities[index] >= -0.0001 && opacities[index] <= 1.0001, 'Invalid drawable opacity');
      positions.push(vertex);
      vertexCount += drawables.vertexCounts[index];
      indexCount += triangles.length;
    }
    return { name, values, positions, opacities, vertexCount, triangleCount: indexCount / 3 };
  }
  const neutral = samplePose('neutral');
  const neutralBoundsByDrawable = neutral.positions.map((vertices, index) => {
    const x = vertices.filter((_, coordinate) => coordinate % 2 === 0);
    const y = vertices.filter((_, coordinate) => coordinate % 2 === 1);
    return {
      id: model.drawables.ids[index], minX: Math.min(...x), maxX: Math.max(...x),
      minY: Math.min(...y), maxY: Math.max(...y),
      opacity: neutral.opacities[index], textureIndex: model.drawables.textureIndices[index],
      vertexCount: model.drawables.vertexCounts[index],
    };
  });
  const neutralBounds = {
    minX: Math.min(...neutralBoundsByDrawable.map(drawable => drawable.minX)),
    maxX: Math.max(...neutralBoundsByDrawable.map(drawable => drawable.maxX)),
    minY: Math.min(...neutralBoundsByDrawable.map(drawable => drawable.minY)),
    maxY: Math.max(...neutralBoundsByDrawable.map(drawable => drawable.maxY)),
  };
  const samples = [];
  const angleX = parameters[indexById.get('ParamAngleX')];
  const angleY = parameters[indexById.get('ParamAngleY')];
  for (const x of [angleX.min, 0, angleX.max]) for (const y of [angleY.min, 0, angleY.max]) samples.push(samplePose(`head-${x}-${y}`, { ParamAngleX: x, ParamAngleY: y }));
  for (const id of required.filter(id => !['ParamAngleX', 'ParamAngleY', 'ParamAngleZ'].includes(id))) {
    const parameter = parameters[indexById.get(id)];
    samples.push(samplePose(`${id}-min`, { [id]: parameter.min }));
    samples.push(samplePose(`${id}-max`, { [id]: parameter.max }));
  }
  function deltaFromNeutral(sample) {
    let maxVertexDelta = 0;
    let maxOpacityDelta = 0;
    for (let d = 0; d < sample.positions.length; d += 1) {
      for (let p = 0; p < sample.positions[d].length; p += 1) maxVertexDelta = Math.max(maxVertexDelta, Math.abs(sample.positions[d][p] - neutral.positions[d][p]));
      maxOpacityDelta = Math.max(maxOpacityDelta, Math.abs(sample.opacities[d] - neutral.opacities[d]));
    }
    return { name: sample.name, values: sample.values, maxVertexDelta, maxOpacityDelta, finiteGeometry: true };
  }
  const sampledDeltas = samples.map(deltaFromNeutral);
  for (const id of ['ParamEyeLOpen', 'ParamEyeROpen', 'ParamEyeBallX', 'ParamEyeBallY', 'ParamMouthOpenY', 'ParamBreath']) {
    assert(sampledDeltas.some(sample => sample.name.startsWith(id) && (sample.maxVertexDelta > 0.000001 || sample.maxOpacityDelta > 0.000001)), `Parameter has no actual geometry/opacity response: ${id}`);
  }
  assert(sampledDeltas.some(sample => sample.name.startsWith('head-') && sample.maxVertexDelta > 0.000001), 'Head turns must change actual vertices');
  const emotionBindings = [];
  const drawableIndexById = new Map(Array.from(model.drawables.ids, (id, index) => [id, index]));
  function centroid(vertices) {
    const pointCount = vertices.length / 2;
    return [vertices.filter((_, index) => index % 2 === 0).reduce((sum, value) => sum + value, 0) / pointCount,
      vertices.filter((_, index) => index % 2 === 1).reduce((sum, value) => sum + value, 0) / pointCount];
  }
  for (const [id, sourceName] of [['ParamCheek', 'blush'], ['ParamTear', 'tears']]) {
    if (!indexById.has(id)) continue;
    const parameter = parameters[indexById.get(id)];
    assert.deepEqual([parameter.min, parameter.max, parameter.default], [0, 1, 0], `Actual emotion range/default mismatch: ${id}`);
    assert.equal(parameter.keyCount, 2, `Emotion binding must contain the two actual 0/1 keys: ${id}`);
    const matching = displayInfo?.Drawables?.filter(drawable => drawable.Name.trim().toLowerCase() === sourceName) ?? [];
    assert(matching.length, `Emotion source drawable not found in actual display info: ${sourceName}`);
    const indices = matching.map(drawable => {
      assert(drawableIndexById.has(drawable.Id), `Emotion drawable missing in actual MOC3: ${drawable.Id}`);
      return drawableIndexById.get(drawable.Id);
    });
    const opacityEndpoints = [];
    for (const value of [0, 0.5, 1]) {
      const pose = samplePose(`${id}-${value}`, { [id]: value });
      let maxOtherOpacityDelta = 0;
      for (let index = 0; index < pose.opacities.length; index += 1) {
        if (indices.includes(index)) assert(Math.abs(pose.opacities[index] - value) < 0.000001, `Opacity endpoint not bound to ${id}: ${model.drawables.ids[index]}`);
        else maxOtherOpacityDelta = Math.max(maxOtherOpacityDelta, Math.abs(pose.opacities[index] - neutral.opacities[index]));
      }
      assert(maxOtherOpacityDelta < 0.000001, `Emotion parameter changed unrelated opacity: ${id}`);
      opacityEndpoints.push({ value, drawables: indices.map(index => ({ id: model.drawables.ids[index], opacity: pose.opacities[index] })), maxOtherOpacityDelta });
      sampledDeltas.push(deltaFromNeutral(pose));
    }
    const faceEntry = displayInfo.Drawables.find(drawable => drawable.Name.trim().toLowerCase() === 'face');
    const faceIndex = drawableIndexById.get(faceEntry?.Id);
    assert(Number.isInteger(faceIndex), 'Actual face drawable required for head-follow acceptance');
    const headFollow = [];
    const headNeutral = samplePose(`${id}-visible-neutral`, { [id]: 1, ParamAngleX: 0, ParamAngleY: 0 });
    for (const headParameter of ['ParamAngleX', 'ParamAngleY']) for (const value of [parameters[indexById.get(headParameter)].min, parameters[indexById.get(headParameter)].max]) {
      const pose = samplePose(`${id}-visible-${headParameter}-${value}`, { [id]: 1, ParamAngleX: 0, ParamAngleY: 0, [headParameter]: value });
      const faceCenter = centroid(headNeutral.positions[faceIndex]);
      const movedFaceCenter = centroid(pose.positions[faceIndex]);
      const faceShift = movedFaceCenter.map((coordinate, index) => coordinate - faceCenter[index]);
      const entries = indices.map(index => {
        const center = centroid(headNeutral.positions[index]);
        const movedCenter = centroid(pose.positions[index]);
        const shift = movedCenter.map((coordinate, axis) => coordinate - center[axis]);
        const maxVertexDelta = Math.max(...pose.positions[index].map((coordinate, axis) => Math.abs(coordinate - headNeutral.positions[index][axis])));
        const directionDotProduct = shift[0] * faceShift[0] + shift[1] * faceShift[1];
        assert(maxVertexDelta > 0.000001, `Emotion artwork does not follow actual head vertices: ${id}/${headParameter}`);
        assert(directionDotProduct > 0, `Emotion artwork moves contrary to the actual face: ${id}/${headParameter}`);
        return { id: model.drawables.ids[index], maxVertexDelta, centroidShift: shift, directionDotProduct };
      });
      headFollow.push({ parameter: headParameter, value, faceCentroidShift: faceShift, drawables: entries });
      sampledDeltas.push(deltaFromNeutral(pose));
    }
    emotionBindings.push({ parameter: id, sourceName, actualDrawableIds: matching.map(drawable => drawable.Id), opacityEndpoints, headFollow, isolationPassed: true });
  }
  receipt = {
    status: 'pass', officialCoreExecuted: true, officialCoreConsistency: consistency,
    corruptMagicNegativeControl: 'rejected', coreVersion: `${version >>> 24}.${(version >>> 16) & 0xff}.${version & 0xffff}`,
    coreVersionRaw: version, latestSupportedMocVersion: core.Version.csmGetLatestMocVersion(),
    coreSha256: crypto.createHash('sha256').update(coreBytes).digest('hex'),
    mocVersion, mocSha256: crypto.createHash('sha256').update(mocBuffer).digest('hex'),
    manifest: path.relative(projectRoot, manifestPath).replaceAll(path.sep, '/'),
    canvas: { width: canvas.CanvasWidth, height: canvas.CanvasHeight, originX: canvas.CanvasOriginX, originY: canvas.CanvasOriginY, pixelsPerUnit: canvas.PixelsPerUnit },
    layout: manifest.Layout ?? null, neutralBounds, neutralBoundsByDrawable,
    drawables: model.drawables.count, parts: model.parts.count, vertices: neutral.vertexCount, triangles: neutral.triangleCount,
    parameters, sampledDeltas, emotionBindings, files, logs: coreLogs,
    scope: 'Official Core consistency, actual model instantiation and sampled mesh/parameter execution; browser rendering and visual quality require separate acceptance.',
  };
} finally {
  model.release();
  moc._release();
}
if (receiptArg) fs.writeFileSync(path.resolve(receiptArg), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ status: receipt.status, coreVersion: receipt.coreVersion, consistency, mocVersion, drawables: receipt.drawables, parameters: receipt.parameters.length, vertices: receipt.vertices, poses: receipt.sampledDeltas.length, receipt: receiptArg ?? null }));
