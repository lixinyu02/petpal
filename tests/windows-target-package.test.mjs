import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import * as tar from 'tar';
import { createRequire } from 'node:module';
import { parseWindowsBuildOptions, prepareWindowsCodex, installWindowsCodex, inspectWindowsPe } from '../scripts/windows-target-package.mjs';
const installMihomo = createRequire(import.meta.url)('../scripts/mihomo-after-pack.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const version = '0.143.0';
const pe = arch => { const bytes = Buffer.alloc(256); bytes.write('MZ'); bytes.writeUInt32LE(64, 60); bytes.write('PE\0\0', 64); bytes.writeUInt16LE(arch === 'x64' ? 0x8664 : 0xaa64, 68); return bytes; };
async function fixture(t, arch = 'arm64', customArchive) {
  const root = await mkdtemp(path.join(tmpdir(), 'petpal-windows-target-')); t.after(async () => { assert.equal(path.dirname(root), tmpdir()); assert.ok(path.basename(root).startsWith('petpal-windows-target-')); await rm(root, { recursive: true, force: true }); });
  const source = path.join(root, 'npm-source'), triple = `${arch === 'x64' ? 'x86_64' : 'aarch64'}-pc-windows-msvc`;
  const metadata = { name: '@openai/codex', version: `${version}-win32-${arch}`, os: ['win32'], cpu: [arch], license: 'Apache-2.0' };
  await mkdir(path.join(source, 'package', 'vendor', triple, 'bin'), { recursive: true });
  await writeFile(path.join(source, 'package', 'package.json'), JSON.stringify(metadata)); await writeFile(path.join(source, 'package', 'vendor', triple, 'bin', 'codex.exe'), pe(arch));
  const archiveFile = path.join(root, 'fixture.tgz'); await tar.c({ cwd: source, file: archiveFile, gzip: true, portable: true }, ['package']);
  const bytes = customArchive || await readFile(archiveFile), url = `https://registry.npmjs.org/@openai/codex/-/codex-${version}-win32-${arch}.tgz`;
  const entry = { ...metadata, resolved: url, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` };
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { '@openai/codex': version } }));
  await writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ packages: { [`node_modules/@openai/codex-win32-${arch}`]: entry } }));
  const requests = [];
  return { root, arch, bytes, requests, prepare: (overrides = {}) => prepareWindowsCodex(root, { arch, stagingRoot: path.join(root, 'target-staging'), fetchImpl: async (target, init) => { requests.push(target); assert.equal(target, url); assert.equal(init.redirect, 'error'); return new Response(bytes); }, ...overrides }) };
}

test('Windows build options retain x64 defaults and isolate explicit ARM64 outputs', () => {
  const root = path.resolve('fixture-project');
  assert.deepEqual(parseWindowsBuildOptions([], { root, version: '0.9.11' }), { arch: 'x64', output: path.join(root, 'releases', 'windows-0.9.11') });
  assert.deepEqual(parseWindowsBuildOptions(['--out-dir', 'evidence/new', '--arch', 'arm64'], { root, version: '0.9.11' }), { arch: 'arm64', output: path.join(root, 'evidence', 'new') });
  assert.match(parseWindowsBuildOptions(['--arch', 'arm64'], { root, version: '0.9.11' }).output, /windows-0\.9\.11-arm64$/);
  for (const args of [['--arch'], ['--arch', 'ia32'], ['--arch', 'arm64', '--arch', 'x64'], ['--unknown', 'x'], ['--out-dir', '../outside'], ['--out-dir', 'dist'], ['--out-dir', '.']])
    assert.throws(() => parseWindowsBuildOptions(args, { root, version: '0.9.11' }));
});

test('Windows target preparation verifies npm integrity and PE architecture without modifying source dependencies', async t => {
  for (const arch of ['x64', 'arm64']) {
    const f = await fixture(t, arch), prepared = await f.prepare();
    assert.equal(prepared.arch, arch); assert.equal(prepared.native.machine, arch === 'x64' ? 0x8664 : 0xaa64); assert.match(prepared.npmIntegrity, /^sha512-/);
    await assert.rejects(readFile(path.join(f.root, 'node_modules', '@openai', `codex-win32-${arch}`, 'package.json')), { code: 'ENOENT' });
    assert.equal(f.requests.length, 1); await assert.rejects(f.prepare(), { code: 'EEXIST' }); assert.equal(f.requests.length, 1, 'verified immutable cache is reused');
    const unpacked = path.join(f.root, 'package-output'), wrong = path.join(unpacked, 'node_modules', '@openai', `codex-win32-${arch === 'x64' ? 'arm64' : 'x64'}`);
    await mkdir(wrong, { recursive: true }); await writeFile(path.join(wrong, 'stale'), 'wrong architecture');
    const result = await installWindowsCodex(unpacked, prepared); assert.equal(result.arch, arch); await assert.rejects(readFile(path.join(wrong, 'stale')), { code: 'ENOENT' });
    const native = path.join(unpacked, 'node_modules', '@openai', `codex-win32-${arch}`, 'vendor', `${arch === 'x64' ? 'x86_64' : 'aarch64'}-pc-windows-msvc`, 'bin', 'codex.exe');
    assert.deepEqual(inspectWindowsPe(await readFile(native), arch), prepared.native);
  }
});

test('corrupt npm archives and incompatible binary targets fail before package staging', async t => {
  const f = await fixture(t);
  await assert.rejects(f.prepare({ fetchImpl: async () => new Response(Buffer.from('tampered archive')) }), /integrity/);
  await assert.rejects(readFile(path.join(f.root, 'target-staging', 'node_modules', '@openai', 'codex-win32-arm64', 'package.json')), { code: 'ENOENT' });
  assert.throws(() => inspectWindowsPe(pe('x64'), 'arm64'), /architecture/);
  await assert.rejects(f.prepare({ stagingRoot: path.join(f.root, 'node_modules', 'target') }), /isolated/);
});

test('npm tar traversal is rejected before extraction despite a matching fixture integrity', async t => {
  const header = new tar.Header({ path: 'package/../escape', size: 1, type: 'File', mode: 0o644 }); header.encode();
  const archive = gzipSync(Buffer.concat([header.block, Buffer.from('x'), Buffer.alloc(511 + 1024)]));
  const f = await fixture(t, 'arm64', archive); await assert.rejects(f.prepare(), /Unsafe Codex Windows archive/);
  await assert.rejects(readFile(path.join(f.root, 'escape')), { code: 'ENOENT' });
});

test('generic afterPack ships exactly one native Mihomo with complete source and license readback', async t => {
  const f = await fixture(t), payload = path.join(f.root, 'mihomo-source'); await mkdir(path.join(payload, 'source'), { recursive: true });
  const executable = pe('arm64'), license = Buffer.from('GPL-3.0 license fixture'), source = Buffer.from('corresponding source fixture'), vendor = Buffer.from('vendor source fixture');
  const audit = { version: '1.19.32', platform: 'win32', arch: 'arm64', executable: 'mihomo.exe', bytes: executable.length, sha256: hash(executable),
    license: { name: 'LICENSE', bytes: license.length, sha256: hash(license) }, sources: [{ name: 'source/mihomo-fixture.tar.gz', bytes: source.length, sha256: hash(source) }, { name: 'source/vendor.tar.gz', bytes: vendor.length, sha256: hash(vendor) }] };
  const members = { 'mihomo.exe': executable, LICENSE: license, 'source/mihomo-fixture.tar.gz': source, 'source/vendor.tar.gz': vendor, 'audit.json': Buffer.from(JSON.stringify(audit)), 'manifest.json': Buffer.from('{}'), 'PROVENANCE.json': Buffer.from('{}'), 'SOURCE-NOTICE.txt': Buffer.from('source notice') };
  for (const [name, bytes] of Object.entries(members)) await writeFile(path.join(payload, name), bytes);
  const appOutDir = path.join(f.root, 'packaged-app'), prepare = async (_root, options) => { assert.deepEqual(options, { platform: 'win32', arch: 'arm64' }); return { payloadDirectory: payload, audit }; };
  const result = await installMihomo({ appOutDir, electronPlatformName: 'win32', arch: 3 }, { root: f.root, prepare });
  assert.equal(result.arch, 'arm64'); assert.equal(result.packagedMembers.length, Object.keys(members).length);
  for (const [name, bytes] of Object.entries(members)) assert.deepEqual(await readFile(path.join(appOutDir, 'resources', 'mihomo', name)), bytes);
  await assert.rejects(installMihomo({ appOutDir, electronPlatformName: 'win32', arch: 3 }, { root: f.root, prepare }), { code: 'EEXIST' });
  await writeFile(path.join(payload, 'unexpected.exe'), 'not allowed');
  await assert.rejects(installMihomo({ appOutDir: path.join(f.root, 'different-output'), electronPlatformName: 'win32', arch: 3 }, { root: f.root, prepare }), /Unexpected/);
});

test('production Windows builder chains the generic hook and packages private transport outside asar', async () => {
  const require = createRequire(import.meta.url), yaml = require('js-yaml');
  const config = yaml.load(await readFile(new URL('../desktop/electron-builder.yml', import.meta.url), 'utf8'));
  assert.equal(config.afterPack, 'scripts/mihomo-after-pack.cjs'); assert.ok(config.asarUnpack.includes('server/app-proxy*.mjs'));
  for (const value of ['desktop/app-proxy*.mjs', 'desktop/app-proxy*.cjs', 'desktop/native/mihomo/**']) assert.ok(config.files.includes(value));
  assert.deepEqual(config.win.target[0].arch, ['x64'], 'generic builds retain their host-default x64 behavior; the audited Windows script selects ARM64 explicitly');
  const source = await readFile(new URL('../scripts/build-windows.mjs', import.meta.url), 'utf8');
  assert.match(source, /await installMihomo\(context\)/); assert.match(source, /createTarget\(\['portable'\], Arch\[arch\]\)/);
});
