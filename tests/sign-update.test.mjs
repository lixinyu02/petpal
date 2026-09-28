import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, stat, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { generateUpdateKeys, signUpdateManifest } from '../scripts/sign-update.mjs';
import { verifyUpdateEnvelope, UPDATE_FILE_LIMIT } from '../server/updates.mjs';

const run = promisify(execFile), script = fileURLToPath(new URL('../scripts/sign-update.mjs', import.meta.url));
const epoch = Date.parse('2026-09-28T12:00:00Z');
const bytes = Buffer.from('fixture update contents; this is never executed\n');
const config = () => ({ repository: 'lixinyu02/petpal', tag: 'v0.7.0', sequence: 17, expiresAt: '2026-10-28T12:00:00Z', artifacts: [{ target: 'windows-x64', file: 'PetPal-0.7.0-Windows-x64.exe', version: '0.7.0', notes: '离线临时测试安装包' }] });
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-sign-update-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const keyDir = path.join(directory, 'keys');
  const keyResult = await generateUpdateKeys(keyDir);
  const configFile = path.join(directory, 'release.json'), keyFile = path.join(keyDir, 'update-private.pem'), outputFile = path.join(directory, 'output', 'petpal-update.json');
  await writeFile(configFile, JSON.stringify(config()));
  await writeFile(path.join(directory, config().artifacts[0].file), bytes);
  return { directory, keyDir, keyResult, configFile, keyFile, outputFile, async sign(overrides = {}) { return signUpdateManifest({ configFile, keyFile, outputFile, now: epoch, ...overrides }); } };
}

test('keygen needs an explicit path, creates Ed25519 files and refuses any overwrite', async t => {
  await assert.rejects(generateUpdateKeys(), /显式/);
  const f = await fixture(t);
  const privateBytes = await readFile(f.keyFile), publicBytes = await readFile(f.keyResult.publicKeyPath);
  assert.equal(createPrivateKey(privateBytes).asymmetricKeyType, 'ed25519');
  assert.equal(createPublicKey(publicBytes).asymmetricKeyType, 'ed25519');
  assert.deepEqual(createPublicKey(privateBytes).export({ type: 'spki', format: 'der' }), createPublicKey(publicBytes).export({ type: 'spki', format: 'der' }));
  await assert.rejects(generateUpdateKeys(f.keyDir), /已存在/);
  assert.deepEqual(await readFile(f.keyFile), privateBytes);
  const partial = path.join(f.directory, 'partial-keys'); await mkdir(partial);
  await writeFile(path.join(partial, 'update-public.pem'), 'preexisting public file');
  await assert.rejects(generateUpdateKeys(partial), /已存在/);
  assert.deepEqual(await readdir(partial), ['update-public.pem']);
  if (process.platform !== 'win32') assert.equal((await stat(f.keyFile)).mode & 0o777, 0o600);
});

test('CLI prints only the public key path, rejects missing/unknown arguments and never auto-generates keys', async t => {
  const f = await fixture(t), cliDirectory = path.join(f.directory, 'cli-keys');
  const result = await run(process.execPath, [script, 'keygen', '--out-dir', cliDirectory]);
  assert.match(result.stdout, /update-public\.pem/);
  assert.doesNotMatch(result.stdout + result.stderr, /update-private|BEGIN.*PRIVATE/);
  for (const args of [['keygen'], ['keygen', '--out-dir', cliDirectory, '--out-dir', cliDirectory], ['sign', '--config', f.configFile], ['upload'], ['sign', '--config', f.configFile, '--key', f.keyFile, '--out', f.outputFile, '--token', 'fixture']]) await assert.rejects(run(process.execPath, [script, ...args]), error => error.code === 1);
  assert.deepEqual((await readdir(f.directory)).sort(), ['PetPal-0.7.0-Windows-x64.exe', 'cli-keys', 'keys', 'release.json'].sort());
});

test('sign hashes real file bytes, derives immutable GitHub URL and self-verifies exact signed payload', async t => {
  const f = await fixture(t), result = await f.sign();
  const envelopeBytes = await readFile(f.outputFile), pem = await readFile(f.keyResult.publicKeyPath, 'utf8');
  const payload = verifyUpdateEnvelope(envelopeBytes, { repository: config().repository, publicKey: pem, now: epoch });
  assert.equal(payload.sequence, 17); assert.equal(payload.issuedAt, new Date(epoch).toISOString());
  assert.equal(payload.releases[0].bytes, bytes.length);
  assert.equal(payload.releases[0].sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(payload.releases[0].url, 'https://github.com/lixinyu02/petpal/releases/download/v0.7.0/PetPal-0.7.0-Windows-x64.exe');
  assert.equal(payload.releases[0].id, 'windows-x64-0.7.0'); assert.equal(payload.releases[0].format, 'portable-exe');
  assert.equal(result.bytes, envelopeBytes.length); assert.equal(result.sha256, createHash('sha256').update(envelopeBytes).digest('hex'));
  assert.doesNotMatch(envelopeBytes.toString('utf8'), /PRIVATE KEY|fixture update contents|keys[\\/]/);
  const envelope = JSON.parse(envelopeBytes); envelope.payload = Buffer.from(JSON.stringify({ ...payload, sequence: 18 })).toString('base64url');
  assert.throws(() => verifyUpdateEnvelope(Buffer.from(JSON.stringify(envelope)), { repository: config().repository, publicKey: pem, now: epoch }), /签名/);
  const different = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
  assert.throws(() => verifyUpdateEnvelope(envelopeBytes, { repository: config().repository, publicKey: different, now: epoch }), /签名/);
  await assert.rejects(f.sign(), /已存在/); assert.deepEqual(await readFile(f.outputFile), envelopeBytes);
});

test('artifact paths resolve relative to config and all five targets receive fixed formats', async t => {
  const f = await fixture(t), sub = path.join(f.directory, 'configuration'); await mkdir(sub);
  const value = config();
  value.artifacts = [
    { target: 'windows-x64', file: '../windows.exe', version: '0.7.0' },
    { target: 'ubuntu-x64', file: '../linux-x64.tar.gz', version: '0.7.0' },
    { target: 'ubuntu-arm64', file: '../linux-arm64.tar.gz', version: '0.7.0' },
    { target: 'android', file: '../android.apk', version: '0.7.0', versionCode: 7 },
    { target: 'web', file: '../web.zip', version: '0.7.0' },
  ];
  for (const item of value.artifacts) await writeFile(path.resolve(sub, item.file), bytes);
  const file = path.join(sub, 'release.json'); await writeFile(file, JSON.stringify(value));
  await f.sign({ configFile: file });
  const validated = verifyUpdateEnvelope(await readFile(f.outputFile), { repository: value.repository, publicKey: await readFile(f.keyResult.publicKeyPath, 'utf8'), now: epoch });
  assert.deepEqual(validated.releases.map(item => item.format), ['portable-exe', 'tar.gz', 'tar.gz', 'apk', 'web-zip']);
  assert.equal(validated.releases[3].versionCode, 7); assert.equal(validated.releases[0].notes, '');
});

test('sign rejects public, malformed and non-Ed25519 private keys without creating output', async t => {
  const f = await fixture(t), invalid = path.join(f.directory, 'wrong.pem');
  for (const contents of ['not a key', await readFile(f.keyResult.publicKeyPath), generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' })]) {
    await writeFile(invalid, contents);
    await assert.rejects(f.sign({ keyFile: invalid }), /Ed25519 私钥/);
  }
  await assert.rejects(stat(f.outputFile), { code: 'ENOENT' });
});

test('config rejects invalid target/version/sequence/expiry and caller-supplied hashes or URLs', async t => {
  const f = await fixture(t);
  const changes = [value => { value.repository = 'https://github.com/owner/repo'; }, value => { value.tag = '../escape'; }, value => { value.sequence = 0; }, value => { value.sequence = 1.5; }, value => { value.expiresAt = '2026-09-28T11:59:59Z'; }, value => { value.expiresAt = '2027-02-30T12:00:00Z'; }, value => { value.artifacts = []; }, value => { value.artifacts.push(value.artifacts[0]); }, value => { value.artifacts[0].target = 'macos-arm64'; }, value => { value.artifacts[0].version = '0.7.0-beta'; }, value => { value.artifacts[0].version = '00.7.0'; }, value => { value.artifacts[0].file = 'bad file.exe'; }, value => { value.artifacts[0].notes = 'a'.repeat(16001); }, value => { value.artifacts[0].sha256 = 'a'.repeat(64); }, value => { value.artifacts[0].url = 'https://evil.test/file'; }];
  for (const change of changes) { const value = config(); change(value); await writeFile(f.configFile, JSON.stringify(value)); await assert.rejects(f.sign()); }
  await assert.rejects(stat(f.outputFile), { code: 'ENOENT' });
});

test('Android requires a valid versionCode and other targets cannot smuggle one', async t => {
  const f = await fixture(t), value = config();
  value.artifacts[0] = { target: 'android', file: 'app.apk', version: '0.7.0', notes: '' }; await writeFile(path.join(f.directory, 'app.apk'), bytes);
  for (const versionCode of [undefined, 0, -1, 1.2, '7', 2100000001]) {
    value.artifacts[0].versionCode = versionCode; await writeFile(f.configFile, JSON.stringify(value)); await assert.rejects(f.sign(), /versionCode/);
  }
  const windows = config(); windows.artifacts[0].versionCode = 7; await writeFile(f.configFile, JSON.stringify(windows)); await assert.rejects(f.sign(), /versionCode/);
});

test('empty, missing, directory and oversized sparse artifacts fail before any feed is written', async t => {
  const f = await fixture(t), artifact = path.join(f.directory, config().artifacts[0].file);
  await writeFile(artifact, ''); await assert.rejects(f.sign(), /2 GiB/);
  // Extending a new empty file creates a sparse fixture without hashing 2 GiB.
  await truncate(artifact, UPDATE_FILE_LIMIT + 1); await assert.rejects(f.sign(), /2 GiB/);
  await rm(artifact); await assert.rejects(f.sign(), { code: 'ENOENT' });
  await mkdir(artifact); await assert.rejects(f.sign(), /普通文件/);
  await assert.rejects(stat(f.outputFile), { code: 'ENOENT' });
});

test('CLI sign emits only public receipt and its result passes the application verifier', async t => {
  const f = await fixture(t), value = config(); value.expiresAt = new Date(Date.now() + 86400000).toISOString(); await writeFile(f.configFile, JSON.stringify(value));
  const result = await run(process.execPath, [script, 'sign', '--config', f.configFile, '--key', f.keyFile, '--out', f.outputFile]);
  const receipt = JSON.parse(result.stdout); assert.equal(receipt.releases, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /BEGIN.*PRIVATE|update-private\.pem/);
  const validated = verifyUpdateEnvelope(await readFile(f.outputFile), { repository: value.repository, publicKey: await readFile(f.keyResult.publicKeyPath, 'utf8') });
  assert.equal(validated.releases[0].bytes, bytes.length);
});
