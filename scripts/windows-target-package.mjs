// Build-time target preparation only: never writes the project's node_modules.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat, readdir, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import * as tar from 'tar';

export function parseWindowsBuildOptions(args, { root, version }) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!['--arch', '--out-dir'].includes(key) || Object.hasOwn(options, key) || typeof value !== 'string' || !value || value.startsWith('--'))
      throw Error('Usage: node scripts/build-windows.mjs [--arch x64|arm64] [--out-dir <new-directory>]');
    options[key] = value;
  }
  const arch = options['--arch'] || 'x64';
  if (!['x64', 'arm64'].includes(arch)) throw Error('Windows architecture must be x64 or arm64');
  const output = path.resolve(root, options['--out-dir'] || `releases/windows-${version}${arch === 'x64' ? '' : '-arm64'}`);
  const relative = path.relative(path.resolve(root), output);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || relative === '..' || output === path.join(root, 'dist'))
    throw Error('Output must be a fresh project subdirectory.');
  return { arch, output };
}

export function inspectWindowsPe(bytes, arch) {
  if (!['x64', 'arm64'].includes(arch) || !Buffer.isBuffer(bytes) || bytes.length < 64 || bytes.subarray(0, 2).toString() !== 'MZ') throw Error('Windows target executable is not PE');
  const offset = bytes.readUInt32LE(60), machine = arch === 'x64' ? 0x8664 : 0xaa64;
  if (offset < 64 || offset + 24 > bytes.length || bytes.subarray(offset, offset + 4).toString('hex') !== '50450000' || bytes.readUInt16LE(offset + 4) !== machine)
    throw Error('Windows target executable architecture mismatch');
  return { machine, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

const archiveIdentity = (lock, version, arch) => {
  const entry = lock?.packages?.[`node_modules/@openai/codex-win32-${arch}`];
  if (version !== '0.143.0' || entry?.version !== `${version}-win32-${arch}` || entry.name !== '@openai/codex' ||
      entry.resolved !== `https://registry.npmjs.org/@openai/codex/-/codex-${version}-win32-${arch}.tgz` ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity || '') || !entry.os?.includes('win32') || !entry.cpu?.includes(arch))
    throw Error('Pinned Codex Windows lockfile identity mismatch');
  return entry;
};
const verifyArchive = (bytes, entry) => {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 256 * 1024 ** 2 || `sha512-${createHash('sha512').update(bytes).digest('base64')}` !== entry.integrity)
    throw Error('Codex Windows archive npm integrity mismatch');
};
async function archiveBytes(file, entry, fetchImpl) {
  const existing = await lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (existing) {
    if (!existing.isFile() || existing.isSymbolicLink() || existing.size > 256 * 1024 ** 2) throw Error('Unsafe Codex Windows cache file');
    const bytes = await readFile(file); verifyArchive(bytes, entry); return bytes;
  }
  const response = await fetchImpl(entry.resolved, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(180000) });
  if (response.status !== 200 || !response.body || response.redirected || response.url && response.url !== entry.resolved) throw Error('Codex Windows target download failed');
  const reader = response.body.getReader(), chunks = []; let size = 0, completed = false;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 256 * 1024 ** 2) throw Error('Codex Windows archive is too large'); chunks.push(value); }
    const bytes = Buffer.concat(chunks); verifyArchive(bytes, entry); await writeFile(file, bytes, { flag: 'wx' }); completed = true; return bytes;
  } finally { if (!completed) void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function prepareWindowsCodex(root, { arch = 'x64', stagingRoot, fetchImpl = globalThis.fetch } = {}) {
  if (!['x64', 'arm64'].includes(arch)) throw Error('Unsupported Windows Codex architecture');
  root = path.resolve(root); stagingRoot = path.resolve(stagingRoot || '');
  const relative = path.relative(root, stagingRoot);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || relative.split(path.sep).includes('node_modules'))
    throw Error('Codex target staging must be a new isolated project directory');
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const version = metadata.dependencies?.['@openai/codex'];
  const entry = archiveIdentity(JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8')), version, arch);
  const cache = path.join(root, '.tools', 'windows-codex', version);
  for (const directory of [path.join(root, '.tools'), path.join(root, '.tools', 'windows-codex'), cache]) {
    await mkdir(directory).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const info = await lstat(directory); if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Unsafe Codex target cache directory');
  }
  const archive = path.join(cache, `codex-${entry.version}.tgz`);
  await archiveBytes(archive, entry, fetchImpl);
  const seen = new Set(); let total = 0, unsafe = false;
  await tar.t({ file: archive, strict: true, onReadEntry: item => {
    const name = item.path.replace(/\/$/, ''), segments = name.split('/');
    if (!(name.startsWith('package/') || name === 'package' && item.type === 'Directory') || /[\\:\x00-\x1f\x7f]/.test(name) || segments.some(segment => !segment || segment === '..' || segment === '.') ||
        !['File', 'Directory'].includes(item.type) || seen.has(name.toLowerCase()) || seen.size >= 4096 || !Number.isSafeInteger(item.size) || item.size < 0 || (total += item.size) > 1024 ** 3)
      unsafe = true;
    seen.add(name.toLowerCase());
  } });
  if (unsafe) throw Error('Unsafe Codex Windows archive member');
  await mkdir(stagingRoot); // Never overlays an earlier staging tree.
  const packageDirectory = path.join(stagingRoot, 'node_modules', '@openai', `codex-win32-${arch}`);
  await mkdir(packageDirectory, { recursive: true });
  await tar.x({ file: archive, cwd: packageDirectory, strip: 1, strict: true });
  const packaged = JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8'));
  if (packaged.name !== '@openai/codex' || packaged.version !== entry.version || !packaged.os?.includes('win32') || !packaged.cpu?.includes(arch) || packaged.license !== 'Apache-2.0')
    throw Error('Codex Windows extracted package identity mismatch');
  const triple = `${arch === 'x64' ? 'x86_64' : 'aarch64'}-pc-windows-msvc`;
  const executable = path.join(packageDirectory, 'vendor', triple, 'bin', 'codex.exe');
  const native = inspectWindowsPe(await readFile(executable), arch);
  const files = [];
  async function visit(directory, prefix = '') {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix + item.name, absolute = path.join(directory, item.name);
      if (item.isDirectory()) await visit(absolute, `${relative}/`);
      else { if (!item.isFile() || item.isSymbolicLink()) throw Error('Unsafe Codex target staging member'); const bytes = await readFile(absolute); files.push({ path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
    }
  }
  await visit(packageDirectory);
  return { arch, version, packageDirectory, executable, native, npmIntegrity: entry.integrity, archiveSha256: createHash('sha256').update(await readFile(archive)).digest('hex'), files };
}

export async function installWindowsCodex(unpacked, prepared) {
  const parent = path.join(unpacked, 'node_modules', '@openai');
  await mkdir(parent, { recursive: true });
  for (const name of await readdir(parent)) if (/^codex-(?:win32|linux|darwin)-(?:x64|arm64)$/.test(name)) {
    const candidate = path.resolve(parent, name); if (path.dirname(candidate) !== path.resolve(parent)) throw Error('Unsafe target package directory');
    const info = await lstat(candidate); if (info.isSymbolicLink() || !info.isDirectory()) throw Error('Unsafe packaged Codex target');
    await rm(candidate, { recursive: true });
  }
  const target = path.join(parent, `codex-win32-${prepared.arch}`);
  await cp(prepared.packageDirectory, target, { recursive: true, force: false, errorOnExist: true });
  for (const expected of prepared.files) {
    const bytes = await readFile(path.join(target, expected.path));
    if (bytes.length !== expected.bytes || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw Error('Packaged Codex differs from verified target staging');
  }
  return { version: prepared.version, arch: prepared.arch, npmIntegrity: prepared.npmIntegrity, archiveSha256: prepared.archiveSha256, native: prepared.native, files: prepared.files };
}
