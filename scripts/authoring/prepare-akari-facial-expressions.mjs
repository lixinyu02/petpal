import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const project = path.resolve(import.meta.dirname, '../..');
const baseline = path.join(project, 'public/avatars/akari-cubism-v9');
const bundle = path.join(project, 'public/avatars/akari-cubism-v10');
const authoringOutput = path.join(project, 'outputs/avatars/akari-cubism-v10');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readme = `# Akari V10 局部表情模型

在 V9 的人物、头发、脸型与合手动作基础上，新增 shy（害羞）、surprise（惊讶）、relaxed（放松）三个局部面部素材及真实 Cubism opacity 参数。六种面部素材各自使用同一头部变形器；它们不拉伸五官，眨眼和 A/O 说话嘴型位于表情层之上。

本包为真实 MOC3：14 个 ArtMesh、22 个参数、2955 个顶点。原有十一层图像保持像素一致；十六组 V9 原生 motion 逐字节保留。新的表情不提供独立眉毛、连续半闭眼睑或虹膜几何，手部仍为交握姿势的小幅整体平移。CMO3 未经官方 Cubism Editor 打开、保存与重导出验收。

生成入口：\`Build-AkariCubism.ps1 -Profile reference-expressions\`，再运行 \`node scripts/authoring/prepare-akari-facial-expressions.mjs\`。模型作者素材和 CMO3 存于 \`outputs/avatars/akari-cubism-v10\`，不进入客户端运行时包。
`;

function localReference(name) {
  assert(typeof name === 'string' && name && !name.includes('\\') && !name.includes(':') && !name.startsWith('/') && !name.split('/').includes('..'), `Unsafe model member: ${name}`);
  return name;
}

/** Deterministic runtime-only plan; neither raw exports nor V9 inputs are modified. */
export function buildFacialExpressionBundle(rawFiles, previousFiles) {
  const manifest = JSON.parse(rawFiles.get('akari.model3.json'));
  const previousManifest = JSON.parse(previousFiles.get('akari.model3.json'));
  const metadata = JSON.parse(rawFiles.get('akari.psd2live.json'));
  assert.equal(metadata.petpalAuthoringProfile, 'reference-expressions');
  assert.equal(metadata.nativeBoundParameterIds.length, 22);
  for (const id of ['ParamShy', 'ParamSurprise', 'ParamRelaxed']) assert(metadata.nativeBoundParameterIds.includes(id), `Native expression absent: ${id}`);
  assert.equal(Object.keys(previousManifest.FileReferences.Motions).length, 16, 'All sixteen reviewed V9 motions are required');
  assert.deepEqual(manifest.Groups, previousManifest.Groups, 'Blink and lip-sync groups must remain unchanged');
  const runtimeNames = [manifest.FileReferences.Moc, ...manifest.FileReferences.Textures, manifest.FileReferences.Physics, manifest.FileReferences.DisplayInfo, 'akari.psd2live.json'];
  const files = new Map();
  for (const name of runtimeNames) {
    localReference(name);
    assert(rawFiles.has(name), `Native export missing: ${name}`);
    files.set(name, Buffer.from(rawFiles.get(name)));
  }
  for (const entries of Object.values(previousManifest.FileReferences.Motions)) for (const entry of entries) {
    localReference(entry.File);
    assert(previousFiles.has(entry.File), `Reviewed V9 motion missing: ${entry.File}`);
    assert(!entry.Sound, 'Unexpected unreviewed motion sound');
    files.set(entry.File, Buffer.from(previousFiles.get(entry.File)));
  }
  manifest.FileReferences.Motions = previousManifest.FileReferences.Motions;
  files.set('akari.model3.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  files.set('README.md', Buffer.from(readme));
  assert.equal(files.size, 23, 'Unexpected runtime member count');
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

function writeNewOrIdentical(directory, name, bytes) {
  const target = path.resolve(directory, localReference(name));
  assert(target.startsWith(directory + path.sep), 'Output escaped the version directory');
  if (fs.existsSync(target)) { assert(fs.readFileSync(target).equals(bytes), `Refusing to overwrite a different V10 asset: ${name}`); return; }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: 'wx' });
}

export function prepareFacialExpressions(rawDirectory = path.join(project, '.tools/cubism-authoring/reference-v10-attempt1')) {
  const rawRoot = path.resolve(rawDirectory);
  assert(rawRoot.startsWith(path.join(project, '.tools/cubism-authoring') + path.sep), 'Raw input must be an independent local authoring export');
  const rawFiles = readBundle(rawRoot), previousFiles = readBundle(baseline);
  const receiptBytes = fs.readFileSync(path.join(project, '.tools/cubism-authoring/latest-authoring-receipt.json'));
  const receipt = JSON.parse(receiptBytes);
  assert.equal(receipt.authoringProfile, 'reference-expressions');
  assert.equal(receipt.sourceUnmodified, true);
  assert.equal(receipt.inputPsdSha256, sha256(fs.readFileSync(path.join(authoringOutput, 'akari.psd'))), 'Authoring receipt must belong to the delivered PSD');
  for (const item of receipt.generatedFiles) assert.equal(sha256(rawFiles.get(item.path)), item.sha256, `Raw export/receipt mismatch: ${item.path}`);
  const files = buildFacialExpressionBundle(rawFiles, previousFiles);
  if (fs.existsSync(bundle)) for (const name of readBundle(bundle).keys()) assert(files.has(name), `Unexpected existing V10 member: ${name}`);
  for (const [name, bytes] of files) writeNewOrIdentical(bundle, name, bytes);
  writeNewOrIdentical(authoringOutput, 'akari.cmo3', rawFiles.get('akari.cmo3'));
  writeNewOrIdentical(authoringOutput, 'authoring-receipt.json', receiptBytes);
  const packaging = {
    authoringProfile: 'reference-expressions', rawDirectory: path.relative(project, rawRoot).replaceAll(path.sep, '/'),
    inputPsdSha256: receipt.inputPsdSha256, mocSha256: sha256(files.get('akari.moc3')),
    retainedMotionSource: 'public/avatars/akari-cubism-v9', retainedMotionGroups: 16,
    runtimeFiles: [...files].map(([name, bytes]) => ({ path: name, bytes: bytes.length, sha256: sha256(bytes) })),
    officialCoreValidation: 'Run verify-cubism-model.mjs separately; packaging is not Core or visual acceptance',
    editorValidation: 'CMO3 has not been validated in official Cubism Editor',
  };
  writeNewOrIdentical(authoringOutput, 'packaging-receipt.json', Buffer.from(JSON.stringify(packaging, null, 2) + '\n'));
  console.log(JSON.stringify({ status: 'packaged', files: files.size, motionGroups: 16, mocSha256: packaging.mocSha256 }));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) prepareFacialExpressions(process.argv[2]);
