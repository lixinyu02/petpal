// Published installer caches belong to the web download service, not the client.
import { cp, link, lstat, readFile, readdir, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { readMihomoManifest, verifyMihomoArtifact } from './mihomo-package.mjs';

export const APP_PROXY_PRODUCTION_DEPENDENCIES = Object.freeze({ 'js-yaml': '4.3.2', undici: '6.29.0', 'https-proxy-agent': '7.0.6' });
const mihomoMetadata = ['manifest.json', 'LICENSE', 'PROVENANCE.json', 'SOURCE-NOTICE.txt'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function parseLinuxPackageArguments(args, root) {
  const architectures = []; let output;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (['--download-only', '--dir-only'].includes(argument)) continue;
    if (['--out-dir', '--output-root'].includes(argument)) {
      if (output !== undefined || typeof args[index + 1] !== 'string' || !args[index + 1] || args[index + 1].startsWith('--')) throw Error('Use one --out-dir <directory> or --output-root <directory>');
      output = args[++index]; continue;
    }
    if (!['x64', 'arm64'].includes(argument) || architectures.includes(argument)) throw Error('Architectures must be unique x64 or arm64 values');
    architectures.push(argument);
  }
  const outputRoot = path.resolve(root, output || 'releases/ubuntu');
  if (outputRoot === path.parse(outputRoot).root || outputRoot === path.resolve(root) || path.resolve(root).startsWith(outputRoot + path.sep)) throw Error('Linux package output must not be the source root or its parent');
  return { architectures: architectures.length ? architectures : ['x64', 'arm64'], outputRoot, customOutput: output !== undefined };
}

export async function assertLinuxPackageTargetsAvailable(outputRoot, version, architectures) {
  for (const arch of architectures) {
    const archive = path.join(outputRoot, `PetPal-${version}-Ubuntu-${arch}.tar.gz`);
    for (const file of [archive, `${archive}.partial`, `${archive}.sha256`]) {
      try { await lstat(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      throw Error(`Refusing to overwrite existing Linux package target: ${file}`);
    }
  }
}

/** Same-directory publication is atomic and never replaces a prior artifact. */
export async function publishLinuxPackageArchive(partial, archive) {
  if (path.resolve(partial) !== `${path.resolve(archive)}.partial`) throw Error('Invalid Linux package publication paths');
  const info = await lstat(partial);
  if (!info.isFile() || info.isSymbolicLink()) throw Error('Linux package partial must be a regular file');
  await link(partial, archive); await unlink(partial);
}

/** Public, checked-in metadata only; no runtime or user configuration is read. */
export async function readMihomoClientPolicy(root) {
  const { manifest, bytes } = await readMihomoManifest(root), metadata = new Map();
  for (const name of mihomoMetadata) {
    const data = name === 'manifest.json' ? bytes : await readFile(path.join(root, 'desktop/native/mihomo', name));
    if (!data.length || data.length > 65536) throw Error('Invalid pinned Mihomo attribution metadata');
    metadata.set(name, { bytes: data.length, sha256: hash(data) });
    if (name === 'LICENSE') verifyMihomoArtifact(data, manifest.license);
  }
  return { manifest, metadata };
}

/** Verify streamed package records against the pinned source tree, not receipts alone. */
export function verifyMihomoClientRecords(records, policy, { arch } = {}) {
  const { manifest, metadata } = policy, target = manifest.targets[`linux-${arch}`];
  if (!target || !['x64', 'arm64'].includes(arch)) throw Error('Invalid Mihomo Linux package architecture');
  const expected = new Map([...metadata, [target.executable.name, target.executable],
    ...manifest.sources.map(source => [`source/${source.name}`, source])]);
  const required = [...expected.keys(), 'audit.json'].sort();
  if (!isDeepStrictEqual([...records.keys()].sort(), required)) throw Error('Mihomo payload member inventory mismatch');
  for (const [name, value] of expected) {
    const record = records.get(name);
    if (record?.bytes !== value.bytes || record.sha256 !== value.sha256) throw Error(`Mihomo payload integrity mismatch: ${name}`);
  }
  const executable = records.get(target.executable.name), header = executable.header;
  if (!Buffer.isBuffer(header) || header.length < 64 || header.subarray(0, 4).toString('hex') !== '7f454c46' ||
      header[4] !== 2 || header[5] !== 1 || header[6] !== 1 || ![2, 3].includes(header.readUInt16LE(16)) ||
      header.readUInt16LE(18) !== target.executable.machine || header.readUInt16LE(52) !== 64 ||
      header.readBigUInt64LE(32) < 64n || header.readUInt16LE(54) !== 56 || !header.readUInt16LE(56) ||
      header.readBigUInt64LE(32) + BigInt(header.readUInt16LE(54) * header.readUInt16LE(56)) > BigInt(executable.bytes)) throw Error('Mihomo ELF64 target/header mismatch');
  if (executable.mode !== undefined && (executable.mode & 0o111) !== 0o111) throw Error('Mihomo executable mode is missing');
  const expectedAudit = {
    schemaVersion: 1, version: manifest.version, platform: 'linux', arch, executable: target.executable.name,
    sha256: target.executable.sha256, bytes: target.executable.bytes, sourceCommit: manifest.sourceCommit,
    archive: { name: target.archive.name, url: target.archive.url, sha256: target.archive.sha256, bytes: target.archive.bytes },
    native: { format: 'ELF', machine: target.executable.machine },
    sources: manifest.sources.map(source => ({ name: `source/${source.name}`, bytes: source.bytes, sha256: source.sha256, url: source.url })),
    license: { name: 'LICENSE', bytes: manifest.license.bytes, sha256: manifest.license.sha256 },
  };
  let audit;
  try { audit = JSON.parse(records.get('audit.json').data.toString('utf8')); } catch { throw Error('Invalid Mihomo payload audit'); }
  if (!isDeepStrictEqual(audit, expectedAudit)) throw Error('Mihomo payload audit differs from pinned target');
  return { version: manifest.version, platform: 'linux', arch, sourceCommit: manifest.sourceCommit, executable: target.executable.name,
    native: expectedAudit.native, files: required.map(name => ({ path: `resources/mihomo/${name}`, bytes: records.get(name).bytes, sha256: records.get(name).sha256 })) };
}

/** Audit the final copied resources, including raw binary/source archive bytes. */
export async function auditMihomoClientPayload(directory, policy, { arch } = {}) {
  const records = new Map();
  async function visit(relative = '') {
    const current = path.join(directory, relative), info = await lstat(current);
    if (info.isSymbolicLink()) throw Error('Mihomo payload must not contain symbolic links');
    if (info.isDirectory()) {
      if (relative && relative !== 'source') throw Error('Unexpected Mihomo payload directory');
      for (const name of await readdir(current)) await visit(path.posix.join(relative, name));
    } else {
      if (!info.isFile()) throw Error('Mihomo payload must contain regular files');
      const digest = createHash('sha256'); let header = Buffer.alloc(0);
      for await (const chunk of createReadStream(current)) { digest.update(chunk); if (header.length < 64) header = Buffer.concat([header, chunk]).subarray(0, 64); }
      records.set(relative, { bytes: info.size, sha256: digest.digest('hex'), header,
        ...(relative === 'audit.json' && info.size <= 65536 ? { data: await readFile(current) } : {}) });
    }
  }
  await visit();
  return verifyMihomoClientRecords(records, policy, { arch });
}

export function includeClientPayload(relative) {
  const normalized = relative.replaceAll('\\', '/');
  return normalized !== 'dist/downloads' && !normalized.startsWith('dist/downloads/');
}

export async function copyClientPayload(sourceRoot, targetRoot) {
  for (const name of ['dist', 'server', 'desktop']) {
    await cp(path.join(sourceRoot, name), path.join(targetRoot, name), {
      recursive: true,
      filter: file => includeClientPayload(path.relative(sourceRoot, file)),
    });
  }
}

export async function listClientPayloadFiles(root, relative) {
  const result = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const file = path.posix.join(relative, entry.name);
    if (!includeClientPayload(file)) continue;
    if (entry.isDirectory()) result.push(...await listClientPayloadFiles(root, file));
    else result.push(file);
  }
  return result;
}
