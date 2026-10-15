// Build-time only. Runtime code reads the pinned payload manifest and audit;
// it must not import this module or its development-only ZIP dependency.
import { constants } from 'node:fs';
import { chmod, link, lstat, mkdir, open, readdir, realpath, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import yauzl from 'yauzl';

export const MIHOMO_VERSION = '1.19.32';
export const MIHOMO_SOURCE_COMMIT = '88dcbf7f1614a67c3b36b848ee3592dfa92ada36';
export const MIHOMO_TARGETS = Object.freeze(['win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64']);
const releasePrefix = `https://github.com/MetaCubeX/mihomo/releases/download/v${MIHOMO_VERSION}/`;
const sourceUrl = `https://codeload.github.com/MetaCubeX/mihomo/tar.gz/${MIHOMO_SOURCE_COMMIT}`;
const licenseUrl = `https://raw.githubusercontent.com/MetaCubeX/mihomo/${MIHOMO_SOURCE_COMMIT}/LICENSE`;
const MAX_ARTIFACT_BYTES = 128 * 1024 ** 2;
const MAX_METADATA_BYTES = 128 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const basename = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(value) && !value.includes('..');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validBytes = value => Number.isSafeInteger(value) && value > 0 && value <= MAX_ARTIFACT_BYTES;
const ownKeys = (value, keys) => plainObject(value) && Object.keys(value).every(key => keys.includes(key));

function artifact(value) {
  return plainObject(value) && basename(value.name) && validBytes(value.bytes) && digest(value.sha256);
}

/** Validate metadata before it can select any URL, path or executable target. */
export function validateMihomoManifest(value) {
  if (!ownKeys(value, ['schemaVersion', 'version', 'repository', 'releaseUrl', 'sourceCommit', 'license', 'sources', 'targets']) ||
      value.schemaVersion !== 1 || value.version !== MIHOMO_VERSION ||
      value.repository !== 'https://github.com/MetaCubeX/mihomo' ||
      value.releaseUrl !== `https://github.com/MetaCubeX/mihomo/releases/tag/v${MIHOMO_VERSION}` ||
      value.sourceCommit !== MIHOMO_SOURCE_COMMIT || !plainObject(value.targets) ||
      Object.keys(value.targets).sort().join() !== [...MIHOMO_TARGETS].sort().join()) throw Error('Invalid pinned Mihomo manifest identity');
  if (!ownKeys(value.license, ['name', 'spdx', 'url', 'bytes', 'sha256']) || !artifact(value.license) ||
      value.license.name !== 'LICENSE' || value.license.spdx !== 'GPL-3.0' || value.license.url !== licenseUrl ||
      value.license.bytes > MAX_METADATA_BYTES) throw Error('Invalid Mihomo license metadata');
  if (!Array.isArray(value.sources) || value.sources.length !== 2) throw Error('Mihomo corresponding source is required');
  const expectedSources = [
    { name: `mihomo-${MIHOMO_SOURCE_COMMIT}.tar.gz`, url: sourceUrl },
    { name: 'vendor.tar.gz', url: `${releasePrefix}vendor.tar.gz` },
  ];
  value.sources.forEach((entry, index) => {
    if (!ownKeys(entry, ['name', 'url', 'bytes', 'sha256']) || !artifact(entry) ||
        entry.name !== expectedSources[index].name || entry.url !== expectedSources[index].url) throw Error('Invalid Mihomo corresponding source');
  });
  for (const [target, entry] of Object.entries(value.targets)) {
    const [platform, arch] = target.split('-');
    const upstream = `mihomo-${platform === 'win32' ? 'windows' : 'linux'}-${arch === 'x64' ? 'amd64-compatible' : 'arm64'}`;
    const name = `${upstream}-v${MIHOMO_VERSION}.${platform === 'win32' ? 'zip' : 'gz'}`;
    if (!ownKeys(entry, ['platform', 'arch', 'archive', 'executable']) || entry.platform !== platform || entry.arch !== arch ||
        !ownKeys(entry.archive, ['name', 'url', 'format', 'member', 'bytes', 'sha256']) || !artifact(entry.archive) ||
        entry.archive.name !== name || entry.archive.url !== `${releasePrefix}${name}` ||
        entry.archive.format !== (platform === 'win32' ? 'zip' : 'gzip') ||
        (platform === 'win32' ? entry.archive.member !== `${upstream}.exe` : entry.archive.member !== undefined) ||
        !ownKeys(entry.executable, ['name', 'format', 'machine', 'bytes', 'sha256']) || !artifact(entry.executable) ||
        entry.executable.name !== (platform === 'win32' ? 'mihomo.exe' : 'mihomo') ||
        entry.executable.format !== (platform === 'win32' ? 'PE' : 'ELF') ||
        entry.executable.machine !== (platform === 'win32' ? arch === 'x64' ? 0x8664 : 0xaa64 : arch === 'x64' ? 62 : 183)) {
      throw Error(`Invalid Mihomo target metadata: ${target}`);
    }
  }
  return value;
}

/** The fixed compressed digest is checked before any decompression. */
export function verifyMihomoArtifact(bytes, expected) {
  if (!Buffer.isBuffer(bytes) || !validBytes(expected?.bytes) || !digest(expected?.sha256) ||
      bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) throw Error('Mihomo artifact integrity mismatch');
  return { bytes: bytes.length, sha256: expected.sha256 };
}

export function inspectMihomoExecutable(bytes, { platform, arch } = {}) {
  if (!Buffer.isBuffer(bytes) || !MIHOMO_TARGETS.includes(`${platform}-${arch}`)) throw Error('Unsupported Mihomo executable target');
  let format, machine;
  if (platform === 'win32') {
    if (bytes.length < 64 || bytes.subarray(0, 2).toString() !== 'MZ') throw Error('Mihomo executable is not PE');
    const offset = bytes.readUInt32LE(60);
    if (offset < 64 || offset + 26 > bytes.length || bytes.subarray(offset, offset + 4).toString('hex') !== '50450000') throw Error('Invalid Mihomo PE header');
    machine = bytes.readUInt16LE(offset + 4);
    const optionalSize = bytes.readUInt16LE(offset + 20);
    if (machine !== (arch === 'x64' ? 0x8664 : 0xaa64) || !(bytes.readUInt16LE(offset + 22) & 2) ||
        optionalSize < 112 || offset + 24 + optionalSize > bytes.length || bytes.readUInt16LE(offset + 24) !== 0x20b) throw Error('Mihomo PE architecture/header mismatch');
    format = 'PE';
  } else {
    if (bytes.length < 64 || bytes.subarray(0, 4).toString('hex') !== '7f454c46' ||
        bytes[4] !== 2 || bytes[5] !== 1 || bytes[6] !== 1 || ![2, 3].includes(bytes.readUInt16LE(16)) ||
        bytes.readUInt16LE(52) !== 64) throw Error('Mihomo executable is not a supported ELF64');
    machine = bytes.readUInt16LE(18);
    const offset = bytes.readBigUInt64LE(32), entrySize = bytes.readUInt16LE(54), count = bytes.readUInt16LE(56);
    if (machine !== (arch === 'x64' ? 62 : 183) || offset < 64n || !count || entrySize !== 56 ||
        offset + BigInt(entrySize * count) > BigInt(bytes.length)) throw Error('Mihomo ELF architecture/header mismatch');
    format = 'ELF';
  }
  return { format, machine, arch, bytes: bytes.length, sha256: sha256(bytes) };
}

function unzipSingle(archive, expectedMember, expectedBytes) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(archive, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(error);
      let settled = false, result, count = 0;
      const fail = error => { if (!settled) { settled = true; zip.close(); reject(error); } };
      zip.on('error', fail);
      zip.on('end', () => {
        if (settled) return;
        settled = true;
        if (count !== 1 || !result) reject(Error('Mihomo ZIP must contain exactly one executable'));
        else resolve(result);
      });
      if (zip.entryCount !== 1) return fail(Error('Mihomo ZIP must contain exactly one executable'));
      zip.on('entry', entry => {
        count++;
        const fileType = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (count !== 1 || !basename(expectedMember) || entry.fileName !== expectedMember ||
            (fileType !== 0 && fileType !== 0x8000) || entry.generalPurposeBitFlag & 1 ||
            entry.uncompressedSize !== expectedBytes || entry.compressedSize > archive.length) {
          return fail(Error('Unsafe or unexpected Mihomo ZIP member'));
        }
        zip.openReadStream(entry, (error, stream) => {
          if (error) return fail(error);
          const chunks = []; let size = 0;
          stream.on('error', fail);
          stream.on('data', chunk => {
            size += chunk.length;
            if (size > expectedBytes) { stream.destroy(); fail(Error('Mihomo ZIP exceeds expected executable size')); }
            else chunks.push(chunk);
          });
          stream.on('end', () => {
            if (settled) return;
            if (size !== expectedBytes) return fail(Error('Mihomo ZIP executable is truncated'));
            result = Buffer.concat(chunks); zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

export async function extractMihomoArchive(archive, target) {
  verifyMihomoArtifact(archive, target?.archive);
  if (!validBytes(target?.executable?.bytes)) throw Error('Invalid Mihomo executable size');
  let executable;
  if (target.archive.format === 'zip') executable = await unzipSingle(archive, target.archive.member, target.executable.bytes);
  else if (target.archive.format === 'gzip') executable = gunzipSync(archive, { maxOutputLength: target.executable.bytes });
  else throw Error('Unsupported Mihomo archive format');
  verifyMihomoArtifact(executable, target.executable);
  const native = inspectMihomoExecutable(executable, target);
  if (native.format !== target.executable.format || native.machine !== target.executable.machine) throw Error('Mihomo native identity mismatch');
  return { executable, native };
}

async function ensureDirectory(directory) {
  try { await mkdir(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Unsafe Mihomo cache directory');
}

async function ensureSubdirectory(root, relative) {
  let directory = root;
  for (const segment of relative.split('/')) {
    if (!basename(segment) && segment !== '.tools') throw Error('Unsafe Mihomo cache path');
    directory = path.join(directory, segment); await ensureDirectory(directory);
  }
  const resolved = await realpath(directory), resolvedRoot = await realpath(root);
  if (!resolved.startsWith(resolvedRoot + path.sep)) throw Error('Mihomo cache directory escapes root');
  return directory;
}

async function readRegular(file, maximum) {
  let before;
  try { before = await lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 || before.size > maximum) throw Error('Unsafe Mihomo cache file');
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino || info.size !== before.size) throw Error('Mihomo cache file changed');
    const bytes = await handle.readFile(), after = await handle.stat(), current = await lstat(file);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || current.isSymbolicLink() ||
        current.dev !== before.dev || current.ino !== before.ino || current.size !== before.size ||
        current.mtimeMs !== before.mtimeMs || bytes.length !== before.size) throw Error('Mihomo cache file changed');
    return bytes;
  } finally { await handle.close(); }
}

async function writeExact(file, bytes, mode = 0o600) {
  const existing = await readRegular(file, Math.max(bytes.length, MAX_METADATA_BYTES));
  if (existing) {
    if (!existing.equals(bytes)) throw Error(`Existing Mihomo payload differs: ${path.basename(file)}`);
    if (process.platform !== 'win32') await chmod(file, mode);
    return;
  }
  const temporary = `${file}.partial-${randomUUID()}`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode });
    // Hard-link publication is atomic and never overwrites another file/symlink.
    try { await link(temporary, file); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const concurrent = await readRegular(file, bytes.length);
      if (!concurrent?.equals(bytes)) throw Error('Mihomo cache publication conflict');
    }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

function allowedRedirect(value, original) {
  const url = new URL(value), initial = new URL(original);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) throw Error('Unsafe Mihomo download redirect');
  if (url.href === initial.href) return url.href;
  if (initial.hostname === 'github.com' && url.hostname === 'release-assets.githubusercontent.com' &&
      url.pathname.startsWith('/github-production-release-asset/')) return url.href;
  throw Error('Unexpected Mihomo download redirect');
}

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    const cleanup = () => signal.removeEventListener('abort', abort);
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
}

/** Download only a pinned upstream artifact. Useful independently in build tests. */
export async function downloadMihomoArtifact(file, expected, { fetchImpl = globalThis.fetch, signal } = {}) {
  if (!artifact(expected) || !(expected.url === sourceUrl || expected.url === `${releasePrefix}${expected.name}`)) throw Error('Unpinned Mihomo download URL');
  const cached = await readRegular(file, expected.bytes);
  if (cached) { verifyMihomoArtifact(cached, expected); return cached; }
  const active = signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000);
  let url = expected.url, response;
  for (let redirects = 0; redirects <= 4; redirects++) {
    active.throwIfAborted();
    response = await abortable(fetchImpl(url, { signal: active, redirect: 'manual', credentials: 'omit', headers: { 'User-Agent': 'PetPal-Mihomo-Package' } }), active);
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    void response.body?.cancel().catch(() => {});
    if (redirects === 4 || !response.headers.get('location')) throw Error('Too many Mihomo download redirects');
    url = allowedRedirect(new URL(response.headers.get('location'), url).href, expected.url);
  }
  if (!response?.ok || !response.body) { void response?.body?.cancel().catch(() => {}); throw Error(`Mihomo download failed (HTTP ${response?.status || 0})`); }
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) !== expected.bytes) { void response.body.cancel().catch(() => {}); throw Error('Mihomo download size mismatch'); }
  const reader = response.body.getReader(), chunks = []; let count = 0, complete = false;
  try {
    while (true) {
      active.throwIfAborted();
      const { done, value } = await abortable(reader.read(), active); active.throwIfAborted();
      if (done) break;
      count += value.byteLength;
      if (count > expected.bytes) throw Error('Mihomo download exceeds pinned size');
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks); verifyMihomoArtifact(bytes, expected); active.throwIfAborted();
    await writeExact(file, bytes); complete = true; return bytes;
  } finally { if (!complete) void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function readMihomoManifest(root) {
  const file = path.join(path.resolve(root), 'desktop/native/mihomo/manifest.json');
  const bytes = await readRegular(file, MAX_METADATA_BYTES);
  if (!bytes) throw Error('Pinned Mihomo manifest is missing');
  return { manifest: validateMihomoManifest(JSON.parse(bytes.toString('utf8'))), bytes };
}

/** Fetch/verify development cache and return a self-contained, target-only payload. */
export async function prepareMihomo(root, { platform = process.platform, arch = process.arch, fetchImpl = globalThis.fetch, signal } = {}) {
  const targetName = `${platform}-${arch}`;
  if (!MIHOMO_TARGETS.includes(targetName)) throw Error('Unsupported Mihomo target; use Windows/Linux x64 or ARM64');
  root = path.resolve(root);
  const { manifest, bytes: manifestBytes } = await readMihomoManifest(root);
  const target = manifest.targets[targetName], metadata = path.join(root, 'desktop/native/mihomo');
  const license = await readRegular(path.join(metadata, 'LICENSE'), MAX_METADATA_BYTES);
  verifyMihomoArtifact(license, manifest.license);
  const provenance = await readRegular(path.join(metadata, 'PROVENANCE.json'), MAX_METADATA_BYTES);
  const notice = await readRegular(path.join(metadata, 'SOURCE-NOTICE.txt'), MAX_METADATA_BYTES);
  if (!provenance || !notice) throw Error('Mihomo source/license notices are missing');
  const recorded = JSON.parse(provenance.toString('utf8'));
  if (recorded.version !== manifest.version || recorded.sourceCommit !== manifest.sourceCommit || recorded.upstreamModified !== false ||
      recorded.license !== manifest.license.spdx || recorded.licenseFile?.sha256 !== manifest.license.sha256) throw Error('Mihomo provenance differs from pinned manifest');
  const downloads = await ensureSubdirectory(root, `.tools/mihomo/v${MIHOMO_VERSION}/downloads`);
  const sourceCache = await ensureSubdirectory(root, `.tools/mihomo/v${MIHOMO_VERSION}/source`);
  const payloadDirectory = await ensureSubdirectory(root, `.tools/mihomo/v${MIHOMO_VERSION}/${targetName}`);
  const payloadSource = await ensureSubdirectory(root, `.tools/mihomo/v${MIHOMO_VERSION}/${targetName}/source`);
  const allowedPayload = new Set([target.executable.name, 'audit.json', 'manifest.json', 'LICENSE', 'PROVENANCE.json', 'SOURCE-NOTICE.txt', 'source']);
  if ((await readdir(payloadDirectory)).some(name => !allowedPayload.has(name)) ||
      (await readdir(payloadSource)).some(name => !manifest.sources.some(source => source.name === name))) {
    throw Error('Unexpected member in Mihomo payload cache');
  }
  const archive = await downloadMihomoArtifact(path.join(downloads, target.archive.name), target.archive, { fetchImpl, signal });
  const { executable: raw, native } = await extractMihomoArchive(archive, target);
  const sources = [];
  for (const source of manifest.sources) {
    const bytes = await downloadMihomoArtifact(path.join(sourceCache, source.name), source, { fetchImpl, signal });
    await writeExact(path.join(payloadSource, source.name), bytes);
    sources.push({ name: `source/${source.name}`, bytes: source.bytes, sha256: source.sha256, url: source.url });
  }
  const executable = path.join(payloadDirectory, target.executable.name);
  await writeExact(executable, raw, platform === 'linux' ? 0o755 : 0o600);
  const audit = {
    schemaVersion: 1, version: manifest.version, platform, arch, executable: target.executable.name,
    sha256: native.sha256, bytes: native.bytes, sourceCommit: manifest.sourceCommit,
    archive: { name: target.archive.name, url: target.archive.url, sha256: target.archive.sha256, bytes: target.archive.bytes },
    native: { format: native.format, machine: native.machine }, sources,
    license: { name: 'LICENSE', bytes: license.length, sha256: sha256(license) },
  };
  for (const [name, bytes] of [['manifest.json', manifestBytes], ['LICENSE', license], ['PROVENANCE.json', provenance],
    ['SOURCE-NOTICE.txt', notice], ['audit.json', Buffer.from(`${JSON.stringify(audit, null, 2)}\n`)]]) {
    await writeExact(path.join(payloadDirectory, name), bytes);
  }
  // Read back the final executable after publication; cached payloads are never
  // trusted on existence alone, and unexpected/symlinked files are not replaced.
  verifyMihomoArtifact(await readRegular(executable, target.executable.bytes), target.executable);
  return { payloadDirectory, executable, audit };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), args = process.argv.slice(2);
  let targets;
  if (args.length === 1 && args[0] === '--all') targets = MIHOMO_TARGETS;
  else if (!args.length) targets = [`${process.platform}-${process.arch}`];
  else if (args.length === 4 && args[0] === '--platform' && args[2] === '--arch') targets = [`${args[1]}-${args[3]}`];
  else throw Error('Usage: node scripts/mihomo-package.mjs [--all | --platform <win32|linux> --arch <x64|arm64>]');
  for (const target of targets) {
    const [platform, arch] = target.split('-'), result = await prepareMihomo(root, { platform, arch });
    console.log(JSON.stringify(result));
  }
}
