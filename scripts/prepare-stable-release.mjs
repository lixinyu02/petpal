#!/usr/bin/env node
// Offline preparation only. Nothing here uploads, changes dist/downloads, or
// restarts a service. Signing is a distinct explicit command after acceptance.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createPublicKey } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, open, readFile } from 'node:fs/promises';
import { signUpdateManifest } from './sign-update.mjs';
import { parseStableVersion, verifyUpdateEnvelope } from '../server/updates.mjs';
import { validateServerManifestUrl } from '../server/update-source.mjs';

export const RELEASE_KEY_FINGERPRINTS = Object.freeze({ github: '5e649530901ba590d7ed894e74c3f77e29f34e0ca0ac4c5a5bfe1dfefa300d6c', server: '1841fdaf57bb74769dc94049d07fc79d675f29c4633f156c3b1ec65781f8d5d3' });
export const RELEASE_CHECKS = Object.freeze(['windowsActualStartup', 'ubuntuFullArchiveBytesVerified', 'ubuntuNativeArchitectures', 'androidArchiveAudit', 'androidSignatureContinuity', 'androidOfficialNativeAssets', 'webFullArchiveBytesVerified', 'privateDataScan', 'licenseAudit']);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const json = value => JSON.stringify(value, null, 2) + '\n';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const stablePackageNames = version => new Map([
  [`PetPal-${version}-Windows-x64.exe`, 'windows-x64'], [`PetPal-${version}-Windows-x64.zip`, 'windows-x64'],
  [`PetPal-${version}-Ubuntu-x64.tar.gz`, 'ubuntu-x64'], [`PetPal-${version}-Ubuntu-arm64.tar.gz`, 'ubuntu-arm64'],
  [`PetPal-${version}-Android-debug.apk`, 'android'], [`PetPal-${version}-Web.zip`, 'web'],
]);
const targets = ['windows-x64', 'ubuntu-x64', 'ubuntu-arm64', 'android', 'web'];
function inside(root, file) {
  assert.equal(typeof file, 'string'); assert.ok(file && !path.isAbsolute(file), 'Use a repository-relative path');
  const result = path.resolve(root, file), relative = path.relative(root, result);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Path escapes release workspace'); return result;
}
async function ordinaryDirectory(directory, root) {
  const relative = path.relative(root, directory); assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  let cursor = root;
  for (const part of relative.split(path.sep)) {
    cursor = path.join(cursor, part); try { await mkdir(cursor, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const info = await lstat(cursor); assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Release directory must not be a link');
  }
}
export async function stableFile(file, { maximum = 2 * 1024 ** 3, contents = false } = {}) {
  const before = await lstat(file); assert.ok(before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= maximum, 'Expected a bounded ordinary release file');
  const handle = await open(file, 'r');
  try {
    const opened = await handle.stat(); assert.equal(opened.ino, before.ino); assert.equal(opened.dev, before.dev);
    const hasher = createHash('sha256'), parts = []; let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) { bytes += chunk.length; assert.ok(bytes <= before.size); hasher.update(chunk); if (contents) parts.push(chunk); }
    const after = await handle.stat(), named = await lstat(file);
    assert.equal(bytes, before.size); assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(after.ctimeMs, before.ctimeMs); assert.equal(named.ino, before.ino); assert.equal(named.dev, before.dev); assert.ok(!named.isSymbolicLink());
    return { bytes, sha256: hasher.digest('hex'), ...(contents ? { contents: Buffer.concat(parts) } : {}) };
  } finally { await handle.close(); }
}
async function load(file, maximum = 1024 * 1024) { const value = await stableFile(file, { maximum, contents: true }); return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value.contents).replace(/^\uFEFF/, '')), sha256: value.sha256 }; }
async function writeNew(file, value) { const handle = await open(file, 'wx', 0o644); try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); } }
export function validateStableReleaseConfig(c) {
  assert.ok(object(c)); assert.equal(c.schemaVersion, 1); parseStableVersion(c.version); assert.equal(c.channel, 'stable');
  assert.match(c.sourceRevision, /^[a-f0-9]{40}$/); assert.ok(!/^0{40}$/.test(c.sourceRevision));
  assert.ok(Number.isSafeInteger(c.androidVersionCode) && c.androidVersionCode > 0);
  assert.ok(Number.isSafeInteger(c.previousSequence) && c.previousSequence >= 1); assert.equal(c.sequence, c.previousSequence + 1);
  assert.equal(c.repository, 'lixinyu02/petpal'); assert.equal(c.tag, `v${c.version}`); assert.equal(c.serverBaseUrl, 'https://magicdatou.top:44318/downloads/');
  assert.ok(typeof c.notes === 'string' && c.notes.length > 0 && c.notes.length <= 15000 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(c.notes));
  assert.ok(typeof c.expiresAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(c.expiresAt) && Date.parse(c.expiresAt) > Date.now());
  assert.equal(c.outputDirectory, `.data/release-${c.version}/prepared`, 'Preparation must remain private until explicit promotion');
  assert.ok(object(c.acceptance) && digest(c.acceptance.sha256) && typeof c.acceptance.file === 'string');
  const names = stablePackageNames(c.version); assert.equal(c.artifacts?.length, 6); assert.deepEqual(c.artifacts.map(item => item.name).sort(), [...names.keys()].sort());
  for (const item of c.artifacts) { assert.equal(item.target, names.get(item.name)); assert.ok(typeof item.file === 'string' && item.file); assert.ok(Number.isSafeInteger(item.bytes) && item.bytes > 0 && item.bytes <= 2 * 1024 ** 3); assert.ok(digest(item.sha256)); }
  return c;
}
export async function validateStableAcceptance(c, root = ROOT) {
  const record = await load(inside(root, c.acceptance.file)); assert.equal(record.sha256, c.acceptance.sha256, 'Acceptance receipt changed'); const a = record.value;
  assert.equal(a.schemaVersion, 1); assert.equal(a.passed, true); assert.equal(a.version, c.version); assert.equal(a.sourceRevision, c.sourceRevision); assert.equal(a.androidVersionCode, c.androidVersionCode);
  assert.equal(a.artifacts?.length, 6); assert.deepEqual(a.artifacts.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })).sort((x, y) => x.name.localeCompare(y.name)), c.artifacts.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })).sort((x, y) => x.name.localeCompare(y.name)));
  for (const check of RELEASE_CHECKS) assert.equal(a.checks?.[check], true, `Missing final acceptance ${check}`);
  for (const boundary of ['ubuntuRuntimeVerified', 'androidDeviceVerified', 'realOpenAiAuthorized', 'realPlanInferenceVerified']) assert.equal(typeof a.boundaries?.[boundary], 'boolean', `Missing explicit boundary ${boundary}`);
  assert.ok(Array.isArray(a.evidence) && a.evidence.length >= 4, 'Four platform evidence receipts are required');
  const covered = new Set();
  for (const evidence of a.evidence) {
    assert.ok(digest(evidence.sha256) && typeof evidence.file === 'string' && Array.isArray(evidence.artifacts) && evidence.artifacts.length > 0);
    const receipt = await load(inside(root, evidence.file), 32 * 1024 * 1024); assert.equal(receipt.sha256, evidence.sha256, 'Final acceptance evidence changed');
    assert.ok(receipt.value.passed === true || receipt.value.ok === true, 'Final platform evidence has not passed');
    if (receipt.value.failures !== undefined) assert.deepEqual(receipt.value.failures, []);
    if (receipt.value.version !== undefined) assert.equal(receipt.value.version, c.version);
    if (receipt.value.sourceRevision !== undefined) assert.equal(receipt.value.sourceRevision, c.sourceRevision);
    for (const name of evidence.artifacts) { assert.ok(stablePackageNames(c.version).has(name), 'Evidence covers a foreign package'); covered.add(name); }
  }
  assert.deepEqual([...covered].sort(), c.artifacts.map(item => item.name).sort(), 'Every final package needs hash-bound evidence'); return a;
}
export async function prepareStableRelease({ configFile, root = ROOT } = {}) {
  const { value: c, sha256: configSha256 } = await load(path.resolve(configFile), 128 * 1024); validateStableReleaseConfig(c);
  const acceptance = await validateStableAcceptance(c, root);
  for (const item of c.artifacts) { const actual = await stableFile(inside(root, item.file)); assert.deepEqual(actual, { bytes: item.bytes, sha256: item.sha256 }, `Frozen package changed: ${item.name}`); }
  const output = inside(root, c.outputDirectory); await ordinaryDirectory(output, root);
  for (const name of ['packages', 'public', 'sign-configs', 'receipts', 'server']) await ordinaryDirectory(path.join(output, name), root);
  // Reserve first; a second run cannot partially replace an accepted candidate.
  await writeNew(path.join(output, 'receipts/preparation-attempt.json'), json({ schemaVersion: 1, version: c.version, sourceRevision: c.sourceRevision, configSha256, at: new Date().toISOString() }));
  for (const item of c.artifacts) {
    const destination = path.join(output, 'public', item.name); await copyFile(inside(root, item.file), destination, constants.COPYFILE_EXCL);
    assert.deepEqual(await stableFile(destination), { bytes: item.bytes, sha256: item.sha256 });
  }
  const files = c.artifacts.map(({ name, target, bytes, sha256 }) => ({ name, target, bytes, sha256 }));
  const manifest = { schemaVersion: 1, version: c.version, channel: 'stable', createdAt: new Date().toISOString(), sourceRevision: c.sourceRevision, androidVersionCode: c.androidVersionCode, acceptance: acceptance.checks, boundaries: acceptance.boundaries, files };
  await writeNew(path.join(output, 'public/release-manifest.json'), json(manifest));
  await writeNew(path.join(output, 'public/SHA256SUMS.txt'), files.map(item => `${item.sha256}  ${item.name}`).join('\n') + '\n');
  const selected = targets.map(target => c.artifacts.find(item => item.target === target && (target !== 'windows-x64' || item.name.endsWith('.exe'))));
  const configs = {}, signConfigSha256 = {};
  for (const source of ['github', 'server']) {
    const value = { source, repository: c.repository, ...(source === 'github' ? { tag: c.tag } : { manifestUrl: validateServerManifestUrl(c.serverBaseUrl + 'updates/petpal-update.json') }), sequence: c.sequence, expiresAt: c.expiresAt,
      artifacts: selected.map(item => ({ target: item.target, file: `../public/${item.name}`, version: c.version, ...(item.target === 'android' ? { versionCode: c.androidVersionCode } : {}), notes: c.notes })) };
    configs[source] = path.join(output, `sign-configs/${source}.json`); await writeNew(configs[source], json(value)); signConfigSha256[source] = hash(json(value));
  }
  const report = { schemaVersion: 1, passed: true, version: c.version, sourceRevision: c.sourceRevision, configSha256, signConfigSha256, publicManifestSha256: hash(json(manifest)), publicChecksumsSha256: hash(files.map(item => `${item.sha256}  ${item.name}`).join('\n') + '\n'), artifacts: files, outputDirectory: c.outputDirectory, unsigned: true, packagesVerified: 6, expectedGitHubAssets: 10, signedSequence: null, plannedSequence: c.sequence, productionChanged: false };
  await writeNew(path.join(output, 'receipts/prepared.json'), json(report)); return report;
}
async function trustedKey(file, source) { const value = await stableFile(file, { maximum: 16 * 1024, contents: true }); const publicKey = createPublicKey(value.contents); assert.equal(publicKey.asymmetricKeyType, 'ed25519'); assert.equal(hash(publicKey.export({ type: 'spki', format: 'der' })), RELEASE_KEY_FINGERPRINTS[source], 'Release trust anchor changed'); return publicKey.export({ type: 'spki', format: 'pem' }).toString(); }
export async function signPreparedStableRelease({ configFile, githubKeyFile, serverKeyFile, root = ROOT } = {}) {
  const { value: c, sha256: configSha256 } = await load(path.resolve(configFile), 128 * 1024); validateStableReleaseConfig(c); await validateStableAcceptance(c, root);
  const output = inside(root, c.outputDirectory), prepared = (await load(path.join(output, 'receipts/prepared.json'))).value;
  assert.equal(prepared.configSha256, configSha256); assert.equal(prepared.passed, true);
  for (const item of c.artifacts) assert.deepEqual(await stableFile(path.join(output, 'public', item.name)), { bytes: item.bytes, sha256: item.sha256 });
  for (const source of ['github', 'server']) assert.equal((await stableFile(path.join(output, `sign-configs/${source}.json`), { maximum: 128 * 1024 })).sha256, prepared.signConfigSha256[source], 'Prepared signing configuration changed');
  assert.equal((await stableFile(path.join(output, 'public/release-manifest.json'), { maximum: 128 * 1024 })).sha256, prepared.publicManifestSha256);
  assert.equal((await stableFile(path.join(output, 'public/SHA256SUMS.txt'), { maximum: 128 * 1024 })).sha256, prepared.publicChecksumsSha256);
  const keys = { github: githubKeyFile, server: serverKeyFile }, signed = {};
  // Both identities must pass before either manifest is signed.
  const publicKeys = {}; for (const source of ['github', 'server']) publicKeys[source] = await trustedKey(path.resolve(keys[source]), source);
  for (const source of ['github', 'server']) {
    const filename = path.join(output, source === 'github' ? 'public/petpal-update.json' : 'server/petpal-update.json');
    signed[source] = await signUpdateManifest({ configFile: path.join(output, `sign-configs/${source}.json`), keyFile: keys[source], outputFile: filename });
    const raw = await readFile(filename), verified = verifyUpdateEnvelope(raw, { source, manifestUrl: c.serverBaseUrl + 'updates/petpal-update.json', repository: c.repository, publicKey: publicKeys[source] });
    assert.equal(verified.keyFingerprint, RELEASE_KEY_FINGERPRINTS[source]); assert.equal(verified.sequence, c.sequence); assert.deepEqual(verified.releases.map(item => item.target).sort(), [...targets].sort());
    for (const release of verified.releases) { const artifact = c.artifacts.find(item => item.target === release.target && (item.target !== 'windows-x64' || item.name.endsWith('.exe'))); assert.equal(release.version, c.version); assert.equal(release.bytes, artifact.bytes); assert.equal(release.sha256, artifact.sha256); assert.equal(release.versionCode, release.target === 'android' ? c.androidVersionCode : undefined); assert.equal(release.notes, c.notes); assert.equal(release.url, source === 'server' ? c.serverBaseUrl + 'updates/' + artifact.name : `https://github.com/${c.repository}/releases/download/${c.tag}/${artifact.name}`); }
  }
  await writeNew(path.join(output, 'public/petpal-update-public-key.txt'), publicKeys.github);
  const report = { schemaVersion: 1, passed: true, version: c.version, sourceRevision: c.sourceRevision, configSha256, sequence: c.sequence, githubAssets: 10, signed, productionChanged: false };
  await writeNew(path.join(output, 'receipts/signed.json'), json(report)); return report;
}
async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args, options = {};
  assert.ok(['prepare', 'sign'].includes(command), 'Usage: prepare-stable-release.mjs prepare --config <file> | sign --config <file> --github-key <file> --server-key <file>');
  const allowed = command === 'prepare' ? ['--config'] : ['--config', '--github-key', '--server-key'];
  for (let index = 0; index < rest.length; index += 2) { assert.ok(allowed.includes(rest[index]) && rest[index + 1] && !Object.hasOwn(options, rest[index])); options[rest[index]] = rest[index + 1]; }
  assert.deepEqual(Object.keys(options).sort(), [...allowed].sort());
  const result = command === 'prepare' ? await prepareStableRelease({ configFile: options['--config'] }) : await signPreparedStableRelease({ configFile: options['--config'], githubKeyFile: options['--github-key'], serverKeyFile: options['--server-key'] }); console.log(json(result));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Stable release preparation failed; inspect the explicit configuration and immutable receipts. Production was not changed.'); process.exitCode = 1; });
