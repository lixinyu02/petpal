import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  MIHOMO_VERSION, MIHOMO_TARGETS, validateMihomoManifest, verifyMihomoArtifact,
  inspectMihomoExecutable, extractMihomoArchive, downloadMihomoArtifact,
  readMihomoManifest, prepareMihomo,
} from '../scripts/mihomo-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pinned = (bytes, name = 'fixture.gz') => ({ name, bytes: bytes.length, sha256: hash(bytes),
  url: `https://github.com/MetaCubeX/mihomo/releases/download/v${MIHOMO_VERSION}/${name}` });
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-mihomo-package-'));
  t.after(() => rm(directory, { recursive: true, force: true })); return directory;
}
function binary(platform, arch) {
  const bytes = Buffer.alloc(512);
  if (platform === 'win32') {
    bytes.write('MZ'); bytes.writeUInt32LE(64, 60); bytes.write('PE\0\0', 64);
    bytes.writeUInt16LE(arch === 'x64' ? 0x8664 : 0xaa64, 68);
    bytes.writeUInt16LE(112, 84); bytes.writeUInt16LE(2, 86); bytes.writeUInt16LE(0x20b, 88);
  } else {
    bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]); bytes.writeUInt16LE(2, 16);
    bytes.writeUInt16LE(arch === 'x64' ? 62 : 183, 18); bytes.writeBigUInt64LE(64n, 32);
    bytes.writeUInt16LE(64, 52); bytes.writeUInt16LE(56, 54); bytes.writeUInt16LE(1, 56);
  }
  return bytes;
}
// A tiny stored ZIP fixture generator keeps tests independent of archivers and
// does not execute or download an actual third-party binary.
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const { name, bytes, mode = 0x81ed, flags = 0, declaredSize = bytes.length } of entries) {
    const encoded = Buffer.from(name), header = Buffer.alloc(30), directory = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(flags, 6);
    header.writeUInt32LE(crc32(bytes), 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(declaredSize, 22);
    header.writeUInt16LE(encoded.length, 26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(0x0314, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(flags, 8); directory.writeUInt32LE(crc32(bytes), 16);
    directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(declaredSize, 24); directory.writeUInt16LE(encoded.length, 28);
    directory.writeUInt32LE((mode << 16) >>> 0, 38); directory.writeUInt32LE(offset, 42);
    local.push(header, encoded, bytes); central.push(directory, encoded); offset += header.length + encoded.length + bytes.length;
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, index, end]);
}
function target(raw, archive, { platform = 'win32', arch = 'x64', member = 'mihomo.exe', format = 'zip' } = {}) {
  return { platform, arch, archive: { ...pinned(archive), format, ...(format === 'zip' ? { member } : {}) },
    executable: { ...pinned(raw, platform === 'win32' ? 'mihomo.exe' : 'mihomo'), ...inspectMihomoExecutable(raw, { platform, arch }) } };
}

test('pinned manifest covers four exact targets, complete GPL and both offline source archives', async () => {
  const { manifest } = await readMihomoManifest(root);
  assert.equal(manifest.version, '1.19.32'); assert.deepEqual(Object.keys(manifest.targets), MIHOMO_TARGETS);
  for (const value of Object.values(manifest.targets)) {
    assert.equal(value.archive.url.includes('/latest/'), false);
    assert.equal(value.archive.name.includes('compatible'), value.arch === 'x64');
  }
  const license = await readFile(path.join(root, 'desktop/native/mihomo/LICENSE'));
  verifyMihomoArtifact(license, manifest.license); assert.match(license.toString(), /GNU GENERAL PUBLIC LICENSE/);
  assert.match(license.toString(), /END OF TERMS AND CONDITIONS/);
  assert.equal(manifest.sources.length, 2); assert.equal(manifest.sources[1].name, 'vendor.tar.gz');
  const notice = await readFile(path.join(root, 'desktop/native/mihomo/SOURCE-NOTICE.txt'), 'utf8');
  for (const source of manifest.sources) assert.ok(notice.includes(`source/${source.name}`));
  assert.match(notice, /WITHOUT ANY WARRANTY/); assert.match(notice, /Makefile/);
});

test('manifest rejects mutable URLs, missing sources, traversal, wrong architecture and unexpected fields', async () => {
  const { manifest } = await readMihomoManifest(root);
  const changes = [
    value => { value.version = 'latest'; },
    value => { value.sourceCommit = 'main'; },
    value => { delete value.targets['win32-arm64']; },
    value => { value.targets['linux-arm64'].executable.machine = 62; },
    value => { value.targets['win32-x64'].archive.member = '../mihomo.exe'; },
    value => { value.targets['win32-x64'].archive.url = 'https://github.com/MetaCubeX/mihomo/releases/latest/download/a.zip'; },
    value => { value.sources.pop(); },
    value => { value.sources[0].name = '../source.tar.gz'; },
    value => { value.sources[0].url += '?download=1'; },
    value => { value.license.name = 'COPYING'; },
    value => { value.targets['linux-x64'].archive.sha256 = '0'; },
    value => { value.targets['linux-x64'].executable.bytes = 2 ** 31; },
    value => { value.targets['linux-x64'].archive.format = 'zip'; },
    value => { value.runCommand = 'arbitrary'; },
  ];
  for (const change of changes) { const value = structuredClone(manifest); change(value); assert.throws(() => validateMihomoManifest(value)); }
});

test('PE and ELF inspectors distinguish all four native architectures without executing code', () => {
  for (const id of MIHOMO_TARGETS) {
    const [platform, arch] = id.split('-'), raw = binary(platform, arch), result = inspectMihomoExecutable(raw, { platform, arch });
    assert.equal(result.format, platform === 'win32' ? 'PE' : 'ELF'); assert.equal(result.arch, arch); assert.equal(result.sha256, hash(raw));
    assert.throws(() => inspectMihomoExecutable(raw, { platform, arch: arch === 'x64' ? 'arm64' : 'x64' }), /architecture/);
  }
  assert.throws(() => inspectMihomoExecutable(Buffer.alloc(0), { platform: 'win32', arch: 'x64' }), /PE/);
  assert.throws(() => inspectMihomoExecutable(Buffer.alloc(0), { platform: 'linux', arch: 'x64' }), /ELF/);
  assert.throws(() => inspectMihomoExecutable(binary('linux', 'x64'), { platform: 'linux', arch: 'arm' }), /Unsupported/);
});

test('inspectors reject truncated, wrong-bitness, wrong-endian and overflowing native headers', () => {
  for (const modify of [
    bytes => bytes.writeUInt32LE(0xffffffff, 60), bytes => bytes.writeUInt32LE(12, 60),
    bytes => bytes.writeUInt16LE(0x10b, 88), bytes => bytes.writeUInt16LE(0xffff, 84),
    bytes => bytes.writeUInt16LE(0, 86),
  ]) { const bytes = binary('win32', 'x64'); modify(bytes); assert.throws(() => inspectMihomoExecutable(bytes, { platform: 'win32', arch: 'x64' })); }
  for (const modify of [
    bytes => { bytes[4] = 1; }, bytes => { bytes[5] = 2; }, bytes => bytes.writeBigUInt64LE(0xffffffffffffffffn, 32),
    bytes => bytes.writeUInt16LE(0, 56), bytes => bytes.writeUInt16LE(32, 52), bytes => bytes.writeUInt16LE(1, 54),
  ]) { const bytes = binary('linux', 'arm64'); modify(bytes); assert.throws(() => inspectMihomoExecutable(bytes, { platform: 'linux', arch: 'arm64' })); }
});

test('single executable ZIP is extracted in memory only after both compressed and raw integrity pass', async () => {
  const raw = binary('win32', 'x64'), archive = zip([{ name: 'mihomo.exe', bytes: raw }]);
  const info = target(raw, archive), result = await extractMihomoArchive(archive, info);
  assert.deepEqual(result.executable, raw); assert.equal(result.native.machine, 0x8664);
  await assert.rejects(extractMihomoArchive(Buffer.from('corrupt'), info), /integrity/);
  await assert.rejects(extractMihomoArchive(archive, { ...info, executable: { ...info.executable, sha256: '0'.repeat(64) } }), /integrity/);
});

test('ZIP refuses traversal, absolute paths, extra files, links, directories and encrypted members', async () => {
  const raw = binary('win32', 'x64');
  for (const entries of [
    [{ name: '../mihomo.exe', bytes: raw }], [{ name: '/mihomo.exe', bytes: raw }], [{ name: 'C:\\mihomo.exe', bytes: raw }],
    [{ name: 'mihomo.exe', bytes: raw }, { name: 'helper.exe', bytes: raw }],
    [{ name: 'mihomo.exe', bytes: raw, mode: 0xa1ff }], [{ name: 'mihomo.exe/', bytes: raw, mode: 0x41ed }],
    [{ name: 'mihomo.exe', bytes: raw, flags: 1 }], [{ name: 'wrong.exe', bytes: raw }],
    [{ name: 'mihomo.exe', bytes: raw, declaredSize: raw.length + 1 }], [],
  ]) { const archive = zip(entries); await assert.rejects(extractMihomoArchive(archive, target(raw, archive))); }
});

test('bounded GZIP rejects expanded overflow, corruption, truncated raw output and wrong architecture', async () => {
  const raw = binary('linux', 'arm64'), archive = gzipSync(raw);
  const info = target(raw, archive, { platform: 'linux', arch: 'arm64', format: 'gzip' });
  const result = await extractMihomoArchive(archive, info); assert.deepEqual(result.executable, raw);
  await assert.rejects(extractMihomoArchive(archive, { ...info, arch: 'x64' }), /architecture/);
  await assert.rejects(extractMihomoArchive(archive, { ...info, executable: { ...info.executable, bytes: raw.length - 1 } }));
  const broken = archive.subarray(0, archive.length - 3);
  await assert.rejects(extractMihomoArchive(broken, { ...info, archive: { ...info.archive, ...pinned(broken) } }));
});

test('artifact integrity rejects changed bytes and unsafe size/hash metadata', () => {
  const bytes = Buffer.from('fixture'), expected = pinned(bytes);
  assert.deepEqual(verifyMihomoArtifact(bytes, expected), { bytes: bytes.length, sha256: hash(bytes) });
  assert.throws(() => verifyMihomoArtifact(Buffer.from('changed'), expected), /integrity/);
  for (const value of [{ ...expected, bytes: 0 }, { ...expected, bytes: 2 ** 31 }, { ...expected, sha256: 'SHA256:abc' }]) {
    assert.throws(() => verifyMihomoArtifact(bytes, value), /integrity/);
  }
});

test('pinned download is bounded, verified, published atomically and rehashed on cache reuse', async t => {
  const directory = await fixture(t), bytes = Buffer.from('tiny verified download'), expected = pinned(bytes), file = path.join(directory, expected.name);
  let calls = 0;
  const fetchImpl = async (url, options) => { calls++; assert.equal(url, expected.url); assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, 'omit'); return new Response(bytes, { headers: { 'content-length': String(bytes.length) } }); };
  assert.deepEqual(await downloadMihomoArtifact(file, expected, { fetchImpl }), bytes);
  assert.deepEqual(await downloadMihomoArtifact(file, expected, { fetchImpl }), bytes); assert.equal(calls, 1);
  assert.deepEqual(await readdir(directory), [expected.name]);
  await writeFile(file, Buffer.alloc(bytes.length, 0)); await assert.rejects(downloadMihomoArtifact(file, expected, { fetchImpl }), /integrity/);
  assert.equal(calls, 1, 'a corrupt existing cache must not be silently replaced');
});

test('bad status, declared length, oversized/truncated bodies and digest mismatch leave no cache artifact', async t => {
  const directory = await fixture(t), bytes = Buffer.from('expected'), expected = pinned(bytes);
  const responses = [
    () => new Response('error', { status: 503 }),
    () => new Response(bytes, { headers: { 'content-length': '90000000' } }),
    () => new Response(Buffer.alloc(bytes.length + 1)), () => new Response(bytes.subarray(1)),
    () => new Response(Buffer.alloc(bytes.length)),
  ];
  for (let i = 0; i < responses.length; i++) {
    const file = path.join(directory, `bad-${i}`);
    await assert.rejects(downloadMihomoArtifact(file, expected, { fetchImpl: async () => responses[i]() }));
    await assert.rejects(lstat(file), { code: 'ENOENT' });
  }
  assert.deepEqual(await readdir(directory), []);
});

test('download only follows bounded official HTTPS asset redirects and never sends credentials', async t => {
  const directory = await fixture(t), bytes = Buffer.from('redirect fixture'), expected = pinned(bytes);
  for (const [index, url] of ['http://github.com/a', 'https://evil.invalid/a', 'https://user:secret@github.com/a',
    'https://github.com/MetaCubeX/mihomo/releases/latest/download/x.gz'].entries()) {
    await assert.rejects(downloadMihomoArtifact(path.join(directory, `bad-${index}`), expected,
      { fetchImpl: async () => new Response(null, { status: 302, headers: { location: url } }) }), /redirect/);
  }
  let calls = 0;
  const official = 'https://release-assets.githubusercontent.com/github-production-release-asset/1/asset?signature=opaque';
  const result = await downloadMihomoArtifact(path.join(directory, 'good'), expected, { fetchImpl: async (url, options) => {
    assert.equal(options.credentials, 'omit'); calls++;
    if (calls === 1) return new Response(null, { status: 302, headers: { location: official } });
    assert.equal(url, official); return new Response(bytes);
  } });
  assert.deepEqual(result, bytes); assert.equal(calls, 2);
  await assert.rejects(downloadMihomoArtifact(path.join(directory, 'loop'), expected,
    { fetchImpl: async () => new Response(null, { status: 302, headers: { location: official } }) }), /redirect/);
});

test('aborted hanging body cancels promptly without publishing partial artifacts', async t => {
  const directory = await fixture(t), expected = pinned(Buffer.from('cancel me')), controller = new AbortController();
  let cancelled = false, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const body = { getReader() { const reader = stream.getReader(); started(); return reader; }, cancel() { return stream.cancel(); } };
  const operation = downloadMihomoArtifact(path.join(directory, 'cancel'), expected,
    { signal: controller.signal, fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers(), body }) });
  await waiting; controller.abort(new Error('cancelled by test'));
  await assert.rejects(operation, /cancelled/); await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, true); assert.deepEqual(await readdir(directory), []);
});

test('download refuses mutable/unpinned initial URLs before invoking fetch', async t => {
  const directory = await fixture(t), expected = pinned(Buffer.from('fixture')); let called = false;
  for (const url of ['https://evil.invalid/fixture.gz', 'https://github.com/MetaCubeX/mihomo/releases/latest/download/fixture.gz',
    `${expected.url}?token=private`, 'http://github.com/MetaCubeX/mihomo/releases/download/v1.19.32/fixture.gz']) {
    await assert.rejects(downloadMihomoArtifact(path.join(directory, 'bad'), { ...expected, url },
      { fetchImpl: async () => { called = true; } }), /Unpinned/);
  }
  assert.equal(called, false);
});

test('cache symlinks and linked .tools directory are refused without touching their targets', async t => {
  const directory = await fixture(t), destination = path.join(directory, 'actual'), alias = path.join(directory, 'alias');
  const bytes = Buffer.from('preserve target'), expected = pinned(bytes); await writeFile(destination, bytes);
  try { await symlink(destination, alias, 'file'); } catch (error) {
    if (error.code !== 'EPERM') throw error;
    // Windows can still validate a directory junction without symlink privilege.
  }
  if (await lstat(alias).catch(() => null)) await assert.rejects(downloadMihomoArtifact(alias, expected), /Unsafe/);
  const application = path.join(directory, 'application'), outside = path.join(directory, 'outside');
  await mkdir(application); await mkdir(outside);
  await cp(path.join(root, 'desktop/native/mihomo'), path.join(application, 'desktop/native/mihomo'), { recursive: true });
  await symlink(outside, path.join(application, '.tools'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareMihomo(application, { platform: 'linux', arch: 'x64', fetchImpl: async () => { throw Error('must not fetch'); } }), /Unsafe/);
  assert.deepEqual(await readdir(outside), []); assert.deepEqual(await readFile(destination), bytes);
});

test('unsupported targets and contaminated payload fail closed before downloads or binary writes', async t => {
  const directory = await fixture(t);
  await assert.rejects(prepareMihomo(directory, { platform: 'linux', arch: 'arm' }), /Unsupported/);
  await cp(path.join(root, 'desktop/native/mihomo'), path.join(directory, 'desktop/native/mihomo'), { recursive: true });
  const payload = path.join(directory, `.tools/mihomo/v${MIHOMO_VERSION}/linux-x64`);
  await mkdir(payload, { recursive: true }); await writeFile(path.join(payload, 'unexpected.exe'), 'never package this');
  await assert.rejects(prepareMihomo(directory, { platform: 'linux', arch: 'x64', fetchImpl: async () => { throw Error('must not fetch'); } }), /Unexpected member/);
  await assert.rejects(lstat(path.join(payload, 'mihomo')), { code: 'ENOENT' });
});
