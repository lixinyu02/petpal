/** Package the split-feature portrait, filtering motions against the real MOC. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { waitForCubismCore } from '../../src/avatar/cubism/runtime.mjs';

const project = path.resolve(import.meta.dirname, '../..');
const baseline = path.join(project, 'public/avatars/akari-cubism-v10');
const bundle = path.join(project, 'public/avatars/akari-cubism-v11');
const authoringOutput = path.join(project, 'outputs/avatars/akari-cubism-v11');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const PATCHES = ['ParamWarm', 'ParamSad', 'ParamPout', 'ParamShy', 'ParamSurprise', 'ParamRelaxed'];
const FEATURES = ['ParamEyeLOpen', 'ParamEyeROpen', 'ParamEyeBallX', 'ParamEyeBallY', 'ParamBrowLY', 'ParamBrowRY', 'ParamBrowLAngle', 'ParamBrowRAngle'];
const RETAINED = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ', 'ParamBreath', 'ParamHairFront', 'ParamHandsLift', 'ParamHandsSway', 'ParamSleeveEase', 'ParamMouthOpenY', 'ParamMouthA', 'ParamMouthO'];

function localReference(name) {
  assert(typeof name === 'string' && name && !name.includes('\\') && !name.includes(':') && !name.startsWith('/') && !name.split('/').includes('..'), `Unsafe model member: ${name}`);
  return name;
}

/** Verify and recount all retained points, including Bezier control values. */
export function filterFeatureMotion(source, parameters) {
  const motion = structuredClone(source);
  assert.equal(motion.Version, 3);
  assert(Number.isFinite(motion.Meta?.Duration) && motion.Meta.Duration > 0, 'Motion duration must be finite and positive');
  assert(Array.isArray(motion.Curves), 'Native curves are required');
  motion.Curves = motion.Curves.filter(curve => curve.Target === 'Parameter' && parameters.has(curve.Id));
  assert.equal(new Set(motion.Curves.map(curve => curve.Id)).size, motion.Curves.length, 'A native parameter may have only one motion curve');
  let segments = 0, points = 0;
  for (const curve of motion.Curves) {
    const range = parameters.get(curve.Id), data = curve.Segments;
    assert(Array.isArray(data) && data.length >= 2, `Invalid native curve: ${curve.Id}`);
    let lastTime = -1;
    const point = index => {
      const time = data[index], value = data[index + 1];
      assert(Number.isFinite(time) && time >= lastTime && time >= 0 && time <= motion.Meta.Duration, `Invalid motion time: ${curve.Id}`);
      assert(Number.isFinite(value) && value >= range.min && value <= range.max, `Motion value exceeds real MOC range: ${curve.Id}`);
      lastTime = time; points++;
    };
    point(0);
    for (let index = 2; index < data.length;) {
      const startTime = lastTime;
      const kind = data[index++], count = kind === 1 ? 3 : [0, 2, 3].includes(kind) ? 1 : 0;
      assert(count && index + count * 2 <= data.length, `Invalid motion segment: ${curve.Id}`);
      for (let i = 0; i < count; i++, index += 2) point(index);
      assert(lastTime > startTime, `Zero-duration motion segment: ${curve.Id}`);
      segments++;
    }
    assert.equal(data[0], 0, `Motion must start at zero: ${curve.Id}`);
    if (!motion.Meta.Loop) assert.equal(data[1], range.default, `Reaction must start at native rest: ${curve.Id}`);
    assert.equal(data.at(-2), motion.Meta.Duration, `Motion must cover full duration: ${curve.Id}`);
    assert.equal(data.at(-1), motion.Meta.Loop ? data[1] : range.default, `Motion must return to its native rest or looping seam: ${curve.Id}`);
  }
  assert(motion.Curves.length > 0, 'Refusing an empty native motion');
  Object.assign(motion.Meta, { CurveCount: motion.Curves.length, TotalSegmentCount: segments, TotalPointCount: points });
  return motion;
}

/** Actual Core enumeration prevents metadata-only or virtual parameter claims. */
export async function readFeatureRig(mocBytes) {
  const source = fs.readFileSync(path.join(project, 'public/vendor/live2d/live2dcubismcore.min.js'), 'utf8');
  const sandbox = { console, setTimeout, clearTimeout, TextDecoder, TextEncoder, atob, btoa, window: {}, document: { currentScript: { src: 'https://petpal.test/vendor/live2d/live2dcubismcore.min.js' } } };
  vm.runInNewContext(source, sandbox, { timeout: 2000, filename: 'licensed-live2dcubismcore.min.js' });
  const core = await waitForCubismCore(() => sandbox.Live2DCubismCore);
  const bytes = mocBytes.buffer.slice(mocBytes.byteOffset, mocBytes.byteOffset + mocBytes.byteLength);
  assert.equal(Object.create(core.Moc.prototype).hasMocConsistency(bytes), 1, 'Official Core rejected the feature MOC');
  const moc = core.Moc.fromArrayBuffer(bytes);
  assert(moc, 'Official Core could not revive the MOC');
  let model;
  try {
    model = core.Model.fromMoc(moc); assert(model, 'Official Core could not instantiate the MOC');
    const parameters = new Map(Array.from(model.parameters.ids, (id, index) => [id, { min: model.parameters.minimumValues[index], max: model.parameters.maximumValues[index], default: model.parameters.defaultValues[index] }]));
    assert.equal(parameters.size, model.parameters.count, 'Native parameter IDs must be unique');
    for (const [id, range] of parameters) assert([range.min, range.max, range.default].every(Number.isFinite) && range.min <= range.default && range.default <= range.max, `Invalid native range: ${id}`);
    return { parameters, coreVersion: core.Version.csmGetVersion(), drawableCount: model.drawables.count, vertexCount: Array.from(model.drawables.vertexCounts).reduce((sum, count) => sum + count, 0) };
  } finally { model?.release(); moc._release(); }
}

/** Pure byte plan. Native ranges must come from readFeatureRig at packaging. */
export function buildFeatureBundle(rawFiles, previousFiles, rig) {
  const manifest = JSON.parse(rawFiles.get('akari.model3.json'));
  const previous = JSON.parse(previousFiles.get('akari.model3.json'));
  const metadata = JSON.parse(rawFiles.get('akari.psd2live.json'));
  assert.equal(metadata.petpalAuthoringProfile, 'reference-features');
  assert.deepEqual([...metadata.nativeBoundParameterIds].sort(), [...rig.parameters.keys()].sort(), 'Authoring metadata must match actual native IDs');
  for (const id of FEATURES) assert(rig.parameters.has(id), `Continuous feature missing: ${id}`);
  for (const id of FEATURES) {
    const range = rig.parameters.get(id), eyeOpen = /^ParamEye[LR]Open$/u.test(id);
    assert.deepEqual([range.min, range.max, range.default], eyeOpen ? [0, 1, 1] : [-1, 1, 0], `Continuous parameter contract changed: ${id}`);
  }
  for (const id of RETAINED) assert(rig.parameters.has(id), `Retained native parameter missing: ${id}`);
  for (const id of PATCHES) assert(!rig.parameters.has(id), `Whole-face patch is forbidden in V11: ${id}`);
  for (const id of ['ParamEyeBallForm', 'ParamMouthForm']) assert(!rig.parameters.has(id), `Unreviewed feature geometry is forbidden in V11: ${id}`);
  assert.equal(Object.keys(previous.FileReferences.Motions).length, 16, 'All sixteen reviewed motions are required');
  for (const group of manifest.Groups || []) for (const id of group.Ids || []) assert(rig.parameters.has(id), `Effect group references virtual parameter: ${id}`);
  assert(!manifest.FileReferences.Expressions?.length, 'Feature expressions are continuous runtime intents, not inherited patch assets');
  const names = [manifest.FileReferences.Moc, ...manifest.FileReferences.Textures, manifest.FileReferences.Physics, manifest.FileReferences.DisplayInfo, 'akari.psd2live.json'];
  const files = new Map();
  for (const name of names.filter(Boolean)) {
    localReference(name); assert(rawFiles.has(name), `Native export missing: ${name}`);
    files.set(name, Buffer.from(rawFiles.get(name)));
  }
  if (manifest.FileReferences.Physics) {
    const physics = JSON.parse(files.get(manifest.FileReferences.Physics));
    for (const setting of physics.PhysicsSettings || []) {
      for (const input of setting.Input || []) assert(rig.parameters.has(input.Source.Id), `Physics input references virtual parameter: ${input.Source.Id}`);
      for (const output of setting.Output || []) assert(rig.parameters.has(output.Destination.Id), `Physics output references virtual parameter: ${output.Destination.Id}`);
    }
  }
  manifest.FileReferences.Motions = structuredClone(previous.FileReferences.Motions);
  for (const entries of Object.values(manifest.FileReferences.Motions)) for (const entry of entries) {
    localReference(entry.File); assert(!entry.Sound, 'Unexpected unreviewed motion sound');
    assert(previousFiles.has(entry.File), `Reviewed motion missing: ${entry.File}`);
    files.set(entry.File, json(filterFeatureMotion(JSON.parse(previousFiles.get(entry.File)), rig.parameters)));
  }
  files.set('akari.model3.json', json(manifest));
  files.set('README.md', Buffer.from(`# Akari V11 连续五官模型\n\n独立左右眉毛、眼白、虹膜和眼睑网格，通过真实 Cubism 参数连续控制眉高、眉角、凝视与闭眼；虹膜使用原生眼白遮罩。整脸表情切换层已移除。保留原有头发、身体、合手动作和 A/O 朗读嘴型，未新增连续嘴角几何。\n\nOfficial Core 实际读出 ${rig.drawableCount} 个 ArtMesh、${rig.parameters.size} 个参数、${rig.vertexCount} 个顶点。16 组原生 motion 继承 V10，仅保留新 MOC 存在的参数并重新计算曲线元数据。\n\n生成入口：\`Build-AkariCubism.ps1 -Profile reference-features\`，再运行 \`node scripts/authoring/prepare-akari-feature-motions.mjs <raw-export-directory>\`。CMO3 尚未经过官方 Cubism Editor 打开、保存与重导出验收。Core 结构验证不能替代浏览器视觉验收。\n`));
  return files;
}

function readBundle(directory, prefix = '', files = new Map()) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) readBundle(path.join(directory, entry.name), `${name}/`, files);
    else { assert(entry.isFile(), `Unexpected non-regular model member: ${name}`); files.set(name, fs.readFileSync(path.join(directory, entry.name))); }
  }
  return files;
}
/** Preflight every destination before publishing any new member. The manifest
 * is last; a interrupted publish can be completed by an identical retry. */
export function writeFeaturePackage(publicDirectory, runtimeFiles, outputDirectory, authoringFiles) {
  const publicRoot = path.resolve(publicDirectory), outputRoot = path.resolve(outputDirectory);
  assert(publicRoot !== outputRoot, 'Runtime and editable assets need separate destinations');
  if (fs.existsSync(publicRoot)) for (const name of readBundle(publicRoot).keys()) assert(runtimeFiles.has(name), `Unexpected existing V11 member: ${name}`);
  const runtimeOrder = [...runtimeFiles].sort(([a], [b]) => Number(a === 'akari.model3.json') - Number(b === 'akari.model3.json'));
  const pending = [...authoringFiles].map(([name, bytes]) => ({ directory: outputRoot, name, bytes }))
    .concat(runtimeOrder.map(([name, bytes]) => ({ directory: publicRoot, name, bytes })))
    .map(item => {
      const target = path.resolve(item.directory, localReference(item.name));
      assert(target.startsWith(item.directory + path.sep), 'Output escaped the version directory');
      assert(Buffer.isBuffer(item.bytes), `Packaging bytes missing: ${item.name}`);
      if (fs.existsSync(target)) {
        assert(fs.lstatSync(target).isFile(), `Non-regular output member: ${item.name}`);
        assert(fs.readFileSync(target).equals(item.bytes), `Refusing to overwrite a different V11 asset: ${item.name}`);
      }
      return { ...item, target };
    });
  for (const { target, name, bytes } of pending) {
    if (fs.existsSync(target)) { assert(fs.readFileSync(target).equals(bytes), `Output changed during packaging: ${name}`); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = path.join(path.dirname(target), `.petpal-${randomUUID()}.partial`);
    try {
      fs.writeFileSync(temporary, bytes, { flag: 'wx' });
      // An atomic exclusive hard-link publishes only the fully written bytes;
      // unlike rename it cannot replace a concurrently-created destination.
      try { fs.linkSync(temporary, target); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        assert(fs.readFileSync(target).equals(bytes), `Output changed during packaging: ${name}`);
      }
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
}
export async function prepareFeatureMotions(rawDirectory) {
  assert(rawDirectory, 'Pass the completed independent authoring directory');
  const rawRoot = path.resolve(rawDirectory);
  assert(rawRoot.startsWith(path.join(project, '.tools/cubism-authoring') + path.sep), 'Raw input must be an independent local authoring export');
  const rawFiles = readBundle(rawRoot), previousFiles = readBundle(baseline);
  const receiptBytes = fs.readFileSync(path.join(project, '.tools/cubism-authoring/latest-authoring-receipt.json')), receipt = JSON.parse(receiptBytes);
  assert.equal(receipt.authoringProfile, 'reference-features'); assert.equal(receipt.sourceUnmodified, true);
  assert.equal(receipt.inputPsdSha256, sha256(fs.readFileSync(path.join(authoringOutput, 'akari.psd'))), 'Receipt must belong to the delivered PSD');
  for (const item of receipt.generatedFiles) assert.equal(sha256(rawFiles.get(item.path)), item.sha256, `Raw export/receipt mismatch: ${item.path}`);
  const rawManifest = JSON.parse(rawFiles.get('akari.model3.json'));
  const rig = await readFeatureRig(rawFiles.get(rawManifest.FileReferences.Moc));
  const files = buildFeatureBundle(rawFiles, previousFiles, rig);
  const authoringFiles = new Map([['akari.cmo3', rawFiles.get('akari.cmo3')], ['authoring-receipt.json', receiptBytes], ['packaging-receipt.json', json({ authoringProfile: 'reference-features', rawDirectory: path.relative(project, rawRoot).replaceAll(path.sep, '/'), inputPsdSha256: receipt.inputPsdSha256, mocSha256: sha256(files.get(rawManifest.FileReferences.Moc)), coreVersion: rig.coreVersion, parameters: [...rig.parameters].map(([id, range]) => ({ id, ...range })), drawableCount: rig.drawableCount, vertexCount: rig.vertexCount, filteredMotionSource: 'public/avatars/akari-cubism-v10', motionGroups: 16, runtimeFiles: [...files].map(([name, bytes]) => ({ path: name, bytes: bytes.length, sha256: sha256(bytes) })), visualValidation: 'Separate browser acceptance required', editorValidation: 'CMO3 has not been validated in official Cubism Editor' })]]);
  writeFeaturePackage(bundle, files, authoringOutput, authoringFiles);
  console.log(JSON.stringify({ status: 'packaged', files: files.size, motionGroups: 16, parameters: rig.parameters.size, mocSha256: sha256(files.get(rawManifest.FileReferences.Moc)) }));
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await prepareFeatureMotions(process.argv[2]);
