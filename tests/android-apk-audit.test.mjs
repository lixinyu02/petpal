import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { packageIdentity, signerCertificates, verifyIdentity, manifestNumber, dexClassNames, readApkArchive, verifyFrozenWeb, verifyAndroidApk } from '../scripts/verify-android-apk.mjs';

const crc32 = createRequire(import.meta.url)('buffer-crc32');
const signer = 'a'.repeat(64), otherSigner = 'b'.repeat(64);
const identity = { name: 'com.petpal.app', version: '1.2.3', versionCode: 42, minSdk: 23, targetSdk: 35 };
const expected = { applicationId: identity.name, version: identity.version, versionCode: 42, minSdk: 23, targetSdk: 35 };

async function directory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'petpal-apk-audit-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true })); return directory;
}

// Small stored ZIP fixtures exercise the actual ZIP reader and CRC gate.
async function zipFile(t, entries) {
  const directoryPath = await directory(t), filename = path.join(directoryPath, 'fixture.apk');
  const parts = [], central = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), bytes = Buffer.from(entry.bytes ?? 'fixture'), checksum = entry.badCrc ? 0 : crc32.unsigned(bytes);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50); record.writeUInt16LE(0x0314, 4); record.writeUInt16LE(20, 6);
    record.writeUInt32LE(checksum, 16); record.writeUInt32LE(bytes.length, 20); record.writeUInt32LE(bytes.length, 24); record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(entry.symlink ? 0xa1ff0000 : 0, 38); record.writeUInt32LE(offset, 42);
    parts.push(header, name, bytes); central.push(record, name); offset += header.length + name.length + bytes.length;
  }
  const centralBytes = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  await fs.writeFile(filename, Buffer.concat([...parts, centralBytes, end])); return filename;
}

test('version and complete signer set prevent downgrade and incompatible APK upgrades', () => {
  const previous = { ...identity, version: '1.2.2', versionCode: 41 };
  const signers = signerCertificates(`Signer #2 certificate SHA-256 digest: ${otherSigner}\nSigner #1 certificate SHA-256 digest: ${signer}\n`);
  verifyIdentity(identity, expected, signers, previous, signerCertificates(`Signer #1 certificate SHA-256 digest: ${signer}\nSigner #2 certificate SHA-256 digest: ${otherSigner}\n`));
  assert.throws(() => verifyIdentity(identity, expected, signers, previous, [signer]), /signer set differs/);
  assert.throws(() => verifyIdentity(identity, expected, signers, identity, signers), /older version/);
  assert.throws(() => verifyIdentity({ ...identity, versionCode: 41 }, expected, signers), /package\/version\/code/);
  assert.throws(() => verifyIdentity({ ...identity, name: 'other.app' }, expected, signers), /package\/version\/code/);
});

test('package parsing is independent of a release number and refuses missing code/signers', () => {
  assert.deepEqual(packageIdentity("package: name='com.petpal.app' versionCode='42' versionName='1.2.3'\nminSdkVersion:'23'\ntargetSdkVersion:'35'"), identity);
  assert.throws(() => packageIdentity("package: name='com.petpal.app' versionName='1.2.3'"), /identity/);
  assert.throws(() => signerCertificates('Signer #1 certificate DN: not-a-fingerprint'), /missing/);
  assert.throws(() => signerCertificates(`Signer #1 certificate SHA-256 digest: ${signer}\nSigner #2 certificate SHA-256 digest: ${signer}\n`), /duplicated/);
});

test('real aapt decimal and padded hexadecimal activity flags are read without permissive substring matches', () => {
  const block = 'A: android:launchMode(0x0101001d)=2\nA: android:windowSoftInputMode(0x0101022b)=0x00000010\n';
  assert.equal(manifestNumber(block, 'launchMode'), 2); assert.equal(manifestNumber(block, 'windowSoftInputMode'), 16);
  assert.equal(manifestNumber('A: android:launchMode(0x0101001d)=0x20', 'launchMode'), 32);
  assert.ok(Number.isNaN(manifestNumber('', 'launchMode')));
});

test('native closure uses actual DEX class definitions rather than a referenced class string', () => {
  const descriptor = Buffer.from('Lcom/petpal/app/MainActivity;'), bytes = Buffer.alloc(152 + descriptor.length + 2);
  bytes.write('dex\n035\0', 0, 'latin1'); bytes.writeUInt32LE(bytes.length, 32); bytes.writeUInt32LE(112, 36); bytes.writeUInt32LE(0x12345678, 40);
  bytes.writeUInt32LE(1, 56); bytes.writeUInt32LE(112, 60); bytes.writeUInt32LE(1, 64); bytes.writeUInt32LE(116, 68);
  bytes.writeUInt32LE(1, 96); bytes.writeUInt32LE(120, 100); bytes.writeUInt32LE(152, 112); bytes[152] = descriptor.length; descriptor.copy(bytes, 153);
  assert.deepEqual([...dexClassNames(bytes)], ['Lcom/petpal/app/MainActivity;']);
  const referenceOnly = Buffer.from(bytes); referenceOnly.writeUInt32LE(0, 96); assert.equal(dexClassNames(referenceOnly).size, 0);
  const corruptIndex = Buffer.from(bytes); corruptIndex.writeUInt32LE(2, 120); assert.throws(() => dexClassNames(corruptIndex), /type index/);
  const corruptOffset = Buffer.from(bytes); corruptOffset.writeUInt32LE(999999, 100); assert.throws(() => dexClassNames(corruptOffset), /file bounds/);
});

test('full archive reader accepts exact resources and counts directories separately', async t => {
  const apk = await zipFile(t, [{ name: 'assets/', bytes: '' }, { name: 'assets/public/index.html', bytes: 'page' }, { name: 'classes.dex', bytes: 'native' }]);
  const result = await readApkArchive(apk); assert.equal(result.archiveEntries, 3); assert.equal(result.files.size, 2); assert.equal(result.bytesRead, 10);
  assert.equal(result.files.get('assets/public/index.html').toString(), 'page');
});

test('full archive reader rejects corruption, duplicate entries, links and excess data', async t => {
  for (const entries of [
    [{ name: 'bad.txt', bytes: 'CRC must be read', badCrc: true }],
    [{ name: 'duplicate', bytes: 'one' }, { name: 'duplicate', bytes: 'two' }],
    [{ name: 'linked.txt', symlink: true }],
    [{ name: 'folder/', bytes: 'unexpected directory data' }],
    [{ name: '../outside.txt' }],
  ]) await assert.rejects(readApkArchive(await zipFile(t, entries)));
  await assert.rejects(readApkArchive(await zipFile(t, [{ name: 'large.txt', bytes: 'larger than allowance' }]), { maxBytes: 4 }), /size limit/);
});

test('isolated frozen web comparison accepts only exact files and synchronized bridges', async t => {
  const root = await directory(t), web = path.join(root, 'frozen web'), bridges = path.join(root, 'bridges');
  await fs.mkdir(web); await fs.mkdir(bridges); await fs.writeFile(path.join(web, 'index.html'), 'page'); await fs.writeFile(path.join(web, 'version.json'), '{"version":"1.2.3"}');
  for (const name of ['cordova.js', 'cordova_plugins.js']) await fs.writeFile(path.join(bridges, name), `generated ${name}`);
  const files = new Map();
  for (const [directoryPath, names] of [[web, ['index.html', 'version.json']], [bridges, ['cordova.js', 'cordova_plugins.js']]]) {
    for (const name of names) files.set(`assets/public/${name}`, await fs.readFile(path.join(directoryPath, name)));
  }
  const result = await verifyFrozenWeb(files, web, bridges); assert.equal(result.assets.length, 2); assert.equal(result.bridges.length, 2);
  const stale = new Map(files); stale.set('assets/public/index.html', Buffer.from('outdated page'));
  await assert.rejects(verifyFrozenWeb(stale, web, bridges), /differs from the frozen/);
  const omitted = new Map(files); omitted.delete('assets/public/version.json'); await assert.rejects(verifyFrozenWeb(omitted, web, bridges), /omits frozen/);
  const extra = new Map(files); extra.set('assets/public/unexpected.txt', Buffer.from('extra')); await assert.rejects(verifyFrozenWeb(extra, web, bridges), /outside the frozen/);
  const staleBridge = new Map(files); staleBridge.set('assets/public/cordova.js', Buffer.from('old bridge')); await assert.rejects(verifyFrozenWeb(staleBridge, web, bridges), /bridge differs/);
});

test('a failed new audit invalidates an earlier passed receipt before native tools run', async t => {
  const root = await directory(t), evidence = path.join(root, 'audit'), android = path.join(root, 'android');
  await fs.mkdir(path.join(android, 'app'), { recursive: true }); await fs.mkdir(evidence);
  await fs.writeFile(path.join(root, 'package.json'), '{"version":"1.2.3"}');
  await fs.writeFile(path.join(android, 'app/build.gradle'), 'applicationId "com.petpal.app"\nversionCode 42\n');
  await fs.writeFile(path.join(android, 'variables.gradle'), 'minSdkVersion = 23\ntargetSdkVersion = 35\n');
  await fs.writeFile(path.join(evidence, 'android-apk-audit.json'), '{"passed":true}');
  await assert.rejects(verifyAndroidApk({ root, evidenceDirectory: evidence, sdk: path.join(root, 'missing-sdk'), jdk: path.join(root, 'missing-jdk') }), /audit command failed/);
  const result = JSON.parse(await fs.readFile(path.join(evidence, 'android-apk-audit.json'), 'utf8'));
  assert.equal(result.passed, false); assert.equal(result.deviceRuntimeVerified, false);
});
