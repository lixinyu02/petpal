'use strict';

const { createHash } = require('node:crypto');
const { cp, mkdir, lstat, readFile, readdir } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const sourceRoot = path.resolve(__dirname, '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function installMihomo(context, { prepare, root = sourceRoot } = {}) {
  const platform = context.electronPlatformName;
  const arch = typeof context.arch === 'string' ? context.arch : ({ 1: 'x64', 3: 'arm64' })[context.arch];
  if (!['win32', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw Error('Unsupported packaged Mihomo target');
  const runtime = prepare || (await import(pathToFileURL(path.join(sourceRoot, 'scripts', 'mihomo-package.mjs')).href)).prepareMihomo;
  const prepared = await runtime(root, { platform, arch });
  if (prepared.audit?.platform !== platform || prepared.audit?.arch !== arch || prepared.audit?.version !== '1.19.32' || prepared.audit.sources?.length !== 2)
    throw Error('Mihomo payload target/source mismatch');
  const members = ['audit.json', 'manifest.json', 'LICENSE', 'PROVENANCE.json', 'SOURCE-NOTICE.txt', prepared.audit.executable,
    ...prepared.audit.sources.map(item => item.name)];
  if (!['mihomo', 'mihomo.exe'].includes(prepared.audit.executable) || members.some(name => name.includes('..') || name.includes('\\') || name.startsWith('/') || name.includes(':')))
    throw Error('Unsafe Mihomo payload member');
  const payload = path.resolve(prepared.payloadDirectory), allowed = new Set(members);
  const sourceBytes = new Map();
  async function inspect(directory, prefix = '') {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const name = `${prefix}${item.name}`, file = path.join(directory, item.name);
      const info = await lstat(file);
      if (info.isSymbolicLink()) throw Error('Symlink in packaged Mihomo payload');
      if (info.isDirectory()) { if (name !== 'source') throw Error('Unexpected Mihomo payload directory'); await inspect(file, `${name}/`); }
      else { if (!info.isFile() || !allowed.has(name)) throw Error('Unexpected Mihomo payload member'); sourceBytes.set(name, await readFile(file)); }
    }
  }
  await inspect(payload);
  if (sourceBytes.size !== members.length || members.some(name => !sourceBytes.has(name))) throw Error('Incomplete Mihomo executable/license/source payload');
  for (const expected of [{ name: prepared.audit.executable, ...prepared.audit }, prepared.audit.license, ...prepared.audit.sources]) {
    const bytes = sourceBytes.get(expected.name);
    if (!bytes || bytes.length !== expected.bytes || digest(bytes) !== expected.sha256) throw Error('Mihomo payload digest mismatch before packaging');
  }
  const resources = path.join(context.appOutDir, 'resources');
  await mkdir(resources, { recursive: true });
  const target = path.join(resources, 'mihomo');
  await mkdir(target); // Never silently merge a stale or another-architecture payload.
  await mkdir(path.join(target, 'source'));
  for (const name of members) await cp(path.join(payload, name), path.join(target, name), { force: false, errorOnExist: true });
  for (const [name, bytes] of sourceBytes) if (!(await readFile(path.join(target, name))).equals(bytes)) throw Error('Mihomo package readback differs from verified source');
  return { ...prepared.audit, packagedMembers: [...sourceBytes.keys()] };
}

module.exports = installMihomo;
module.exports.installMihomo = installMihomo;
