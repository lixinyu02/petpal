/** Package an explicit V12 candidate; never overwrite a published V11 URL or infer a live target. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildFeatureBundle, readFeatureRig, writeFeaturePackage } from './prepare-akari-feature-motions.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function readBundle(directory, prefix = '', files = new Map()) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) readBundle(path.join(directory, entry.name), `${name}/`, files);
    else { assert(entry.isFile(), `Unexpected model member: ${name}`); files.set(name, fs.readFileSync(path.join(directory, entry.name))); }
  }
  return files;
}
export async function prepareNaturalEyelids(rawDirectory, runtimeDirectory, editableDirectory) {
  assert(rawDirectory && runtimeDirectory && editableDirectory, 'Pass raw export, runtime candidate, and editable candidate directories explicitly');
  const roots = [rawDirectory, runtimeDirectory, editableDirectory].map(value => path.resolve(value));
  assert.equal(new Set(roots).size, 3, 'All three output/input roots must differ');
  for (const target of roots) {
    assert(target.startsWith(project + path.sep), 'Candidate must stay in this repository');
    assert(!target.startsWith(path.join(project, 'releases') + path.sep), 'Frozen installers are not an authoring target');
    assert(!target.startsWith(path.join(project, 'dist') + path.sep), 'Live static root is not an authoring target');
    assert(!target.startsWith(path.join(project, 'public/avatars/akari-cubism-v11')), 'Published V11 assets are immutable');
  }
  assert(roots[0].startsWith(path.join(project, '.tools/cubism-authoring') + path.sep));
  const raw = readBundle(roots[0]), previous = readBundle(path.join(project, 'public/avatars/akari-cubism-v11'));
  const receiptBytes = fs.readFileSync(path.join(project, '.tools/cubism-authoring/latest-authoring-receipt.json'));
  const receipt = JSON.parse(receiptBytes), metadata = JSON.parse(raw.get('akari.psd2live.json'));
  assert.equal(receipt.authoringProfile, 'reference-natural-lids');
  assert.equal(receipt.sourceUnmodified, true);
  assert.equal(metadata.petpalEyelidRevision, 'natural-v12');
  assert(raw.get('akari.cmo3')?.length > 0, 'Matching editable CMO3 is required');
  assert.equal(receipt.inputPsdSha256, hash(fs.readFileSync(path.join(project, 'outputs/avatars/akari-cubism-v11/akari.psd'))));
  for (const member of receipt.generatedFiles) assert.equal(hash(raw.get(member.path)), member.sha256, `Raw receipt mismatch: ${member.path}`);
  const manifest = JSON.parse(raw.get('akari.model3.json'));
  for (const texture of manifest.FileReferences.Textures) assert.deepEqual(raw.get(texture), previous.get(texture), 'V12 must retain the V11 texture bytes');
  const rig = await readFeatureRig(raw.get(manifest.FileReferences.Moc));
  const runtime = buildFeatureBundle(raw, previous, rig);
  runtime.set('README.md', Buffer.from('# Akari V12 自然闭合眼睑\n\n复用 V11 原 PSD/纹理，保持原生 22 参数、16 ArtMesh、16 组动作。仅修订上下睫毛与眼白局部网格，使闭合沿柔缓下弧并保留原生虹膜 mask；正常闭合不通过透明淡出来隐藏眼睛。\n\nCMO3 经生成器 codec 读回，尚未经官方 Editor 打开/保存/重导出。Core 验证不能替代浏览器逐帧验收。\n'));
  const packaged = {
    authoringProfile: 'reference-natural-lids', deformationProfile: 'reference-features', eyelidRevision: 'natural-v12',
    rawDirectory: path.relative(project, roots[0]).replaceAll(path.sep, '/'), inputPsdSha256: receipt.inputPsdSha256,
    mocSha256: hash(runtime.get(manifest.FileReferences.Moc)), coreVersion: rig.coreVersion,
    parameters: [...rig.parameters].map(([id, range]) => ({ id, ...range })), drawableCount: rig.drawableCount,
    vertexCount: rig.vertexCount, unchangedTextureBytes: true, motionGroups: 16,
    runtimeFiles: [...runtime].map(([name, bytes]) => ({ path: name, bytes: bytes.length, sha256: hash(bytes) })),
    visualValidation: 'Separate Chrome acceptance required', editorValidation: 'CMO3 codec only; official Editor unverified',
  };
  const editable = new Map([['akari.cmo3', raw.get('akari.cmo3')], ['authoring-receipt.json', receiptBytes], ['packaging-receipt.json', json(packaged)]]);
  writeFeaturePackage(roots[1], runtime, roots[2], editable);
  return { status: 'candidate-packaged', files: runtime.size, parameters: rig.parameters.size, vertices: rig.vertexCount, mocSha256: packaged.mocSha256 };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) console.log(JSON.stringify(await prepareNaturalEyelids(...process.argv.slice(2))));
