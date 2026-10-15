import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prepareStableRelease, signPreparedStableRelease, stablePackageNames, RELEASE_CHECKS } from '../scripts/prepare-stable-release.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'petpal-stable-preparation-'));
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('petpal-stable-preparation-')); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  await mkdir(path.join(root, 'inputs')); const artifacts = [];
  for (const [name, target] of stablePackageNames('0.9.12')) { const bytes = Buffer.from(`Synthetic package fixture only: ${name}`); await writeFile(path.join(root, 'inputs', name), bytes); artifacts.push({ name, target, file: `inputs/${name}`, bytes: bytes.length, sha256: hash(bytes) }); }
  const evidence = [];
  for (const [index, names] of [[0, artifacts.slice(0, 2)], [1, artifacts.slice(2, 4)], [2, artifacts.slice(4, 5)], [3, artifacts.slice(5, 6)]]) { const content = JSON.stringify({ passed: true, version: '0.9.12', synthetic: true }); const file = `inputs/evidence-${index}.json`; await writeFile(path.join(root, file), content); evidence.push({ file, sha256: hash(content), artifacts: names.map(item => item.name) }); }
  const acceptance = { schemaVersion: 1, passed: true, version: '0.9.12', sourceRevision: 'a'.repeat(40), androidVersionCode: 22, artifacts: artifacts.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })), checks: Object.fromEntries(RELEASE_CHECKS.map(check => [check, true])), boundaries: { ubuntuRuntimeVerified: false, androidDeviceVerified: false, realOpenAiAuthorized: false, realPlanInferenceVerified: false }, evidence };
  const c = { schemaVersion: 1, version: '0.9.12', sourceRevision: 'a'.repeat(40), androidVersionCode: 22, channel: 'stable', sequence: 14, previousSequence: 13, repository: 'lixinyu02/petpal', tag: 'v0.9.12', serverBaseUrl: 'https://magicdatou.top:44318/downloads/', expiresAt: new Date(Date.now() + 86400000).toISOString(), notes: 'Synthetic fixture release.', outputDirectory: '.data/release-0.9.12/prepared', artifacts, acceptance: { file: 'inputs/acceptance.json', sha256: '' } };
  const configFile = path.join(root, 'inputs/config.json');
  const save = async () => { const raw = JSON.stringify(acceptance); await writeFile(path.join(root, c.acceptance.file), raw); c.acceptance.sha256 = hash(raw); await writeFile(configFile, JSON.stringify(c)); };
  await save(); return { root, c, acceptance, configFile, save, prepare: () => prepareStableRelease({ configFile, root }), output: path.join(root, c.outputDirectory) };
}

test('offline stable preparation validates six frozen packages and generates exact current download and five-target update schemas', async t => {
  const f = await fixture(t), result = await f.prepare(); assert.equal(result.passed, true); assert.equal(result.unsigned, true); assert.equal(result.productionChanged, false); assert.equal(result.expectedGitHubAssets, 10);
  const publicFiles = await readdir(path.join(f.output, 'public')); assert.equal(publicFiles.length, 8); assert.equal(publicFiles.includes('petpal-update.json'), false); assert.equal(publicFiles.includes('petpal-update-public-key.txt'), false);
  const m = JSON.parse(await readFile(path.join(f.output, 'public/release-manifest.json'))); assert.equal(m.channel, 'stable'); assert.equal(m.version, '0.9.12'); assert.equal(m.files.length, 6); assert.equal(m.boundaries.realPlanInferenceVerified, false);
  for (const source of ['github', 'server']) { const config = JSON.parse(await readFile(path.join(f.output, `sign-configs/${source}.json`))); assert.equal(config.sequence, 14); assert.equal(config.artifacts.length, 5); assert.equal(config.artifacts.find(item => item.target === 'android').versionCode, 22); assert.equal(config.artifacts.some(item => item.file.endsWith('Windows-x64.zip')), false); }
  await assert.rejects(readFile(path.join(f.root, 'dist/downloads/release-manifest-0.9.12.json')), { code: 'ENOENT' });
});

test('any changed package is rejected before preparation reserves output', async t => {
  const f = await fixture(t); await writeFile(path.join(f.root, f.c.artifacts[0].file), 'modified'); await assert.rejects(f.prepare(), /Frozen package changed/); await assert.rejects(readdir(f.output), { code: 'ENOENT' });
});

test('license and Android signer continuity are mandatory even when archive hashes match', async t => {
  for (const check of ['licenseAudit', 'androidSignatureContinuity']) { const f = await fixture(t); f.acceptance.checks[check] = false; await f.save(); await assert.rejects(f.prepare(), new RegExp(check)); await assert.rejects(readdir(f.output), { code: 'ENOENT' }); }
});

test('stale or unpassed platform evidence cannot be replaced by a true aggregate flag', async t => {
  const f = await fixture(t); const evidence = f.acceptance.evidence[0], raw = JSON.stringify({ passed: false, version: '0.9.12' }); await writeFile(path.join(f.root, evidence.file), raw); evidence.sha256 = hash(raw); await f.save(); await assert.rejects(f.prepare(), /has not passed/);
  await writeFile(path.join(f.root, evidence.file), '{}'); await assert.rejects(f.prepare(), /evidence changed/);
});

test('every package needs bound final evidence and declaration of actual runtime boundaries', async t => {
  const f = await fixture(t); f.acceptance.evidence[0].artifacts.pop(); await f.save(); await assert.rejects(f.prepare(), /Every final package/);
  f.acceptance.evidence[0].artifacts.push(f.c.artifacts[1].name); delete f.acceptance.boundaries.androidDeviceVerified; await f.save(); await assert.rejects(f.prepare(), /androidDeviceVerified/);
});

test('rerun cannot overwrite an accepted candidate or mutate package bytes', async t => {
  const f = await fixture(t); await f.prepare(); const previous = await readFile(path.join(f.output, 'public/release-manifest.json')); await assert.rejects(f.prepare(), { code: 'EEXIST' }); assert.deepEqual(await readFile(path.join(f.output, 'public/release-manifest.json')), previous);
});

test('signing refuses changed prepared config and never signs with a replacement trust anchor', async t => {
  const f = await fixture(t); await f.prepare(); const key = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }), keyFile = path.join(f.root, 'inputs/synthetic-key.pem'); await writeFile(keyFile, key, { mode: 0o600 });
  const sign = () => signPreparedStableRelease({ configFile: f.configFile, githubKeyFile: keyFile, serverKeyFile: keyFile, root: f.root }); await assert.rejects(sign(), /trust anchor changed/);
  await writeFile(path.join(f.output, 'sign-configs/github.json'), '{}'); await assert.rejects(sign(), /signing configuration changed/); await assert.rejects(readFile(path.join(f.output, 'public/petpal-update.json')), { code: 'ENOENT' }); await assert.rejects(readFile(path.join(f.output, 'server/petpal-update.json')), { code: 'ENOENT' });
});
