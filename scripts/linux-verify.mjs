// Independent verification of bytes and POSIX modes inside the distributed tarball.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';
import semver from 'semver';

const archive = process.argv[2];
if (!archive) throw new Error('Usage: node scripts/linux-verify.mjs <PetPal-Ubuntu.tar.gz>');
const native = []; const failures = []; const frontend = []; const applicationSource = []; const seen = new Set(); let manifest; let count = 0;
const requiredApplicationSource = ['server/app.mjs', 'server/auth.mjs', 'server/agent-permissions.mjs', 'server/agent-tasks.mjs', 'server/attachments.mjs', 'server/downloads.mjs', 'server/codex.mjs', 'server/codex-config.mjs', 'server/codex-transport.mjs', 'server/updates.mjs', 'desktop/updates.mjs', 'server/desktop-tools.mjs', 'server/music.mjs', 'server/opencli.mjs', 'server/native/music-windows.ps1', 'server/index.mjs', 'server/providers.mjs', 'server/store.mjs', 'server/voice.mjs', 'server/cosyvoice.mjs', 'server/asr.mjs', 'desktop/main.cjs', 'desktop/preload.cjs', 'desktop/window-layout.cjs', 'desktop/media-permissions.cjs', 'desktop/service-settings.cjs', 'desktop/remote-http.cjs', 'NOTICE'];
requiredApplicationSource.push('desktop/executor.mjs', 'server/executors.mjs', 'server/remote-codex.mjs', 'server/executor-relay.mjs');
requiredApplicationSource.push('desktop/startup-diagnostics.cjs', 'server/music-mcp.mjs', 'server/music-mcp-routes.mjs',
  'server/native/music-mcp/netease/server.py', 'server/native/music-mcp/netease/LICENSE', 'server/native/music-mcp/netease/pyproject.toml', 'server/native/music-mcp/netease/PROVENANCE.json',
  'server/native/music-mcp/qqmusic/login.py', 'server/native/music-mcp/qqmusic/LICENSE', 'server/native/music-mcp/qqmusic/pyproject.toml', 'server/native/music-mcp/qqmusic/PROVENANCE.json',
  'server/native/music-mcp/qqmusic/src/mcp_qqmusic/__init__.py', 'server/native/music-mcp/qqmusic/src/mcp_qqmusic/__main__.py', 'server/native/music-mcp/qqmusic/src/mcp_qqmusic/server.py', 'server/native/music-mcp/qqmusic/src/mcp_qqmusic/format.py');
const isApplicationSource = relative => /^(?:server\/[^/]+\.mjs|server\/native\/[^/]+\.ps1|server\/native\/computer-use\/(?:LICENSE|patches\/linux-x11-window-geometry\.patch|linux-(?:x64|arm64)\/(?:PROVENANCE\.json|computer-use-napi\.linux-(?:x64|arm64)\.node))|server\/native\/music-mcp\/(?:netease\/(?:server\.py|LICENSE|pyproject\.toml|PROVENANCE\.json)|qqmusic\/(?:login\.py|LICENSE|pyproject\.toml|PROVENANCE\.json|src\/mcp_qqmusic\/(?:__init__|__main__|server|format)\.py))|desktop\/(?:main|preload|window-layout|media-permissions|service-settings|startup-diagnostics|remote-http)\.cjs|desktop\/(?:updates|executor)\.mjs|NOTICE)$/.test(relative);
const packageMetadata = new Map(), dependencyHashes = new Map(), launchers = new Map();
requiredApplicationSource.push('server/computer-use-mcp.mjs','server/computer-use-tool-names.mjs','server/computer-use-mcp-routes.mjs','server/dynamic-tool-output.mjs','server/model-request-limits.mjs');
requiredApplicationSource.push('server/native/computer-use/LICENSE','server/native/computer-use/patches/linux-x11-window-geometry.patch');
const computerPrefix='node_modules/@zavora-ai/computer-use-mcp/';
const requiredOpencliFiles = ['package.json', 'LICENSE', 'cli-manifest.json', 'dist/src/main.js', 'dist/src/daemon.js', 'dist/src/browser/base-page.js'].map(name => `node_modules/@jackwener/opencli/${name}`);
const archivePrefix = path.basename(archive).replace(/\.tar\.gz$/, '');
await tar.t({ file: archive, strict: true, onReadEntry(entry) {
  count++;
  if (!entry.path.startsWith(`${archivePrefix}/`)) failures.push(`Unexpected archive root: ${entry.path}`);
  if (seen.has(entry.path)) failures.push(`Duplicate entry: ${entry.path}`); seen.add(entry.path);
  if (!['File', 'Directory'].includes(entry.type)) failures.push(`Unsupported entry type: ${entry.path}`);
  if (/\.exe$|\.dll$|codex-win32-|codex-darwin-/i.test(entry.path) || entry.path.split('/').includes('..')) failures.push(`Wrong platform or unsafe entry: ${entry.path}`);
  if (/(?:^|\/)(?:\.data|\.tools|\.preview|preview|evidence|private|auth\.json|token)(?:$|\/)/i.test(entry.path)) failures.push(`Runtime/preview/private data must not be distributed: ${entry.path}`);
  if (entry.path.endsWith('/BUILD-MANIFEST.json')) {
    let text = ''; entry.on('data', chunk => { text += chunk; }); entry.on('end', () => { manifest = JSON.parse(text); });
  }
  if (entry.type === 'File' && entry.path.includes('/resources/app/dist/')) {
    const hash = createHash('sha256'); entry.on('data', chunk => hash.update(chunk));
    entry.on('end', () => frontend.push({ path: `dist/${entry.path.split('/resources/app/dist/')[1]}`, sha256: hash.digest('hex') }));
  }
  const appRelative = entry.path.split('/resources/app/')[1];
  if (entry.type === 'File' && appRelative?.startsWith('server/native/music-mcp/') && !requiredApplicationSource.includes(appRelative)) failures.push(`Unexpected packaged music MCP member: ${appRelative}`);
  if (entry.type === 'File' && appRelative && isApplicationSource(appRelative)) {
    const hash = createHash('sha256'); entry.on('data', chunk => hash.update(chunk));
    entry.on('end', () => applicationSource.push({ path: entry.path.split('/resources/app/')[1], sha256: hash.digest('hex') }));
  }
  if (entry.type === 'File' && appRelative?.startsWith('node_modules/') && (/\/package\.json$/.test(appRelative) || /\/(?:licen[cs]e|copying)(?:[._-][^/]*)?$/i.test(appRelative) || requiredOpencliFiles.includes(appRelative) || appRelative.startsWith(computerPrefix))) {
    const hash = createHash('sha256'); let text = '';
    entry.on('data', chunk => { hash.update(chunk); if (appRelative.endsWith('/package.json')) text += chunk; });
    entry.on('end', () => {
      dependencyHashes.set(appRelative, hash.digest('hex'));
      if (text) { try { packageMetadata.set(appRelative, JSON.parse(text)); } catch { failures.push(`Invalid dependency metadata: ${appRelative}`); } }
    });
  }
  if (entry.type === 'File' && ['start-petpal.sh', 'codex.sh', 'opencli.sh'].some(name => entry.path === `${archivePrefix}/${name}`)) {
    let text = ''; entry.on('data', chunk => { text += chunk; });
    entry.on('end', () => { launchers.set(path.posix.basename(entry.path), { mode: entry.mode, text }); if ((entry.mode & 0o111) !== 0o111) failures.push(`Missing launcher executable bits: ${entry.path}`); });
  }
  const isComputerNative=entry.type==='File'&&appRelative?.startsWith(computerPrefix)&&appRelative.endsWith('.node');
  if(isComputerNative&&!/computer-use-napi\.linux-(?:x64|arm64)\.node$/.test(entry.path))failures.push(`Wrong Computer Use platform: ${entry.path}`);
  const isNative = entry.type === 'File' && (isComputerNative || entry.path.endsWith('/petpal') || /\/node_modules\/@openai\/codex-linux-(?:x64|arm64)\/vendor\//.test(entry.path) && !/\.(?:json|txt|md)$/i.test(entry.path));
  if (isNative) {
    const hash = createHash('sha256'); let header = Buffer.alloc(0);
    entry.on('data', chunk => { hash.update(chunk); if (header.length < 64) header = Buffer.concat([header, chunk]).subarray(0, 64); });
    entry.on('end', () => {
      if (header.length < 64 || !header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || header[4] !== 2 || header[5] !== 1) failures.push(`Missing ELF64 little-endian header: ${entry.path}`);
      if (!isComputerNative && (entry.mode & 0o111) !== 0o111) failures.push(`Missing executable bits: ${entry.path}`);
      native.push({ path: entry.path, mode: entry.mode.toString(8), machine: header.length >= 64 ? header.readUInt16LE(18) : null, sha256: hash.digest('hex') });
    });
  }
} });
if (!manifest) failures.push('Missing manifest');
else {
  if (manifest.platform !== 'linux' || !['x64', 'arm64'].includes(manifest.arch)) failures.push('Invalid Linux manifest platform/architecture');
  const expectedMachine = manifest.arch === 'x64' ? 62 : 183;
  for (const file of native) if (file.machine !== expectedMachine) failures.push(`Wrong ELF architecture: ${file.path}`);
  if (!native.find(item => item.path.endsWith('/petpal') && item.sha256 === manifest.electron.sha256)) failures.push('Electron payload hash mismatch');
  if (!native.find(item => item.path.endsWith('/bin/codex') && item.sha256 === manifest.codex.sha256)) failures.push('Codex payload hash mismatch');
  if (native.length < 6) failures.push('Required Linux native helpers missing');
  for (const helper of manifest.codex.helpers ?? []) if (!native.find(item => item.path.endsWith(helper.path) && item.sha256 === helper.sha256)) failures.push(`Helper payload hash mismatch: ${helper.path}`);
  for (const file of [...frontend, ...applicationSource]) if (!manifest.sourceReceipt.find(item => item.path === file.path && item.sha256 === file.sha256)) failures.push(`App payload hash mismatch: ${file.path}`);
  for (const file of manifest.sourceReceipt.filter(item => item.path.startsWith('dist/') || isApplicationSource(item.path))) {
    if (![...frontend, ...applicationSource].some(item => item.path === file.path && item.sha256 === file.sha256)) failures.push(`Manifest app member missing: ${file.path}`);
  }
  for (const file of requiredApplicationSource) if (!applicationSource.some(item => item.path === file)) failures.push(`Required application source missing: ${file}`);
  const computerMetadata=packageMetadata.get(computerPrefix+'package.json');
  if(!manifest.computerUse||computerMetadata?.version!=='7.4.0'||computerMetadata.license!=='MIT'||manifest.computerUse.arch!==manifest.arch)failures.push('Computer Use package/version manifest mismatch');
  for(const file of manifest.computerUse?.files??[])if(dependencyHashes.get(file.path)!==file.sha256)failures.push(`Computer Use runtime/attribution mismatch: ${file.path}`);
  const computerNatives=native.filter(file=>file.path.includes(computerPrefix));
  if(computerNatives.length!==1||!computerNatives[0].path.endsWith(`computer-use-napi.linux-${manifest.arch}.node`)||computerNatives[0].sha256!==manifest.computerUse?.native?.sha256)failures.push('Computer Use native target/hash mismatch');
}
const closure = new Map(), edges = [], optionalAbsent = [];
function locateDependency(directory, name) {
  while (true) {
    const candidate = path.posix.join(directory, 'node_modules', name, 'package.json');
    if (packageMetadata.has(candidate)) return candidate;
    if (!directory || directory === '.') return null;
    directory = path.posix.dirname(directory);
  }
}
function verifyDependency(file) {
  if (closure.has(file)) return;
  const pkg = packageMetadata.get(file);
  if (!pkg) { failures.push(`Dependency package.json missing: ${file}`); return; }
  closure.set(file, { path: file, name: pkg.name, version: pkg.version, sha256: dependencyHashes.get(file), license: pkg.license ?? null });
  const optional = pkg.optionalDependencies ?? {}, dependencies = { ...(pkg.dependencies ?? {}), ...optional };
  for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) if (!pkg.peerDependenciesMeta?.[name]?.optional) dependencies[name] ??= range;
  for (const [name, range] of Object.entries(dependencies)) {
    const target = locateDependency(path.posix.dirname(file), name);
    if (!target) {
      if (Object.hasOwn(optional, name)) optionalAbsent.push({ from: file, name, range });
      else failures.push(`Required dependency absent: ${pkg.name} -> ${name}`);
      continue;
    }
    const metadata = packageMetadata.get(target);
    if (metadata.name !== name || !semver.satisfies(metadata.version, range)) failures.push(`Dependency range mismatch: ${pkg.name} -> ${name}@${range}`);
    edges.push({ from: file, name, range, to: target, optional: Object.hasOwn(optional, name) });
    verifyDependency(target);
  }
}
verifyDependency('node_modules/@jackwener/opencli/package.json');
for (const file of requiredOpencliFiles) if (!dependencyHashes.has(file)) failures.push(`OpenCLI required runtime/license absent: ${file}`);
const opencliMetadata = packageMetadata.get('node_modules/@jackwener/opencli/package.json');
if (!manifest?.opencli || opencliMetadata?.version !== manifest.opencliVersion || opencliMetadata?.version !== manifest.opencli.version || opencliMetadata?.license !== 'Apache-2.0') failures.push('OpenCLI version/license manifest mismatch');
for (const file of [...(manifest?.opencli?.files ?? []), ...(manifest?.opencli?.packages ?? []).flatMap(item => [item, ...(item.licenseFiles ?? [])])]) if (dependencyHashes.get(file.path) !== file.sha256) failures.push(`OpenCLI closure payload hash mismatch: ${file.path}`);
if (closure.size !== manifest?.opencli?.packages?.length) failures.push('OpenCLI dependency closure inventory mismatch');
for (const item of closure.values()) if (!manifest?.opencli?.packages?.some(expected => expected.path === item.path && expected.name === item.name && expected.version === item.version && expected.sha256 === item.sha256)) failures.push(`OpenCLI dependency not in manifest: ${item.path}`);
edges.sort((a, b) => `${a.from}/${a.name}`.localeCompare(`${b.from}/${b.name}`));
if (JSON.stringify(edges) !== JSON.stringify(manifest?.opencli?.edges)) failures.push('OpenCLI dependency resolution differs from manifest');
for (const name of ['start-petpal.sh', 'codex.sh', 'opencli.sh']) if (!launchers.has(name)) failures.push(`Missing launcher: ${name}`);
if (!launchers.get('opencli.sh')?.text.includes('ELECTRON_RUN_AS_NODE=1') || !launchers.get('opencli.sh')?.text.includes('node_modules/@jackwener/opencli/dist/src/main.js')) failures.push('OpenCLI launcher does not use the bundled runtime');
if (process.argv.includes('--compare-current-dist')) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (manifest?.app !== metadata.version) failures.push('Current application version mismatch');
  if (manifest?.electronVersion !== metadata.devDependencies.electron || manifest?.codexVersion !== metadata.dependencies['@openai/codex'] || manifest?.opencliVersion !== metadata.dependencies['@jackwener/opencli']) failures.push('Current bundled runtime versions mismatch');
  for (const file of [...frontend, ...applicationSource]) {
    try { const hash = createHash('sha256'); for await (const chunk of createReadStream(path.join(root, file.path))) hash.update(chunk); if (hash.digest('hex') !== file.sha256) failures.push(`Current application member mismatch: ${file.path}`); }
    catch { failures.push(`Current application member missing: ${file.path}`); }
  }
  const expectedFiles = async relative => {
    const result = [];
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const file = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) result.push(...await expectedFiles(file)); else result.push(file);
    }
    return result;
  };
  for (const file of await expectedFiles('dist')) if (!frontend.some(item => item.path === file)) failures.push(`Current frontend member absent from archive: ${file}`);
}
const companionAssets = frontend.filter(file => file.path.startsWith('dist/avatars/'));
for (const name of ['idle', 'blink', 'talk', 'round', 'curious', 'warm', 'sad', 'pout']) {
  if (!companionAssets.some(file => file.path === `dist/avatars/akari/${name}.webp`)) failures.push(`Required anime texture missing: ${name}`);
}
const hash = createHash('sha256'); for await (const chunk of createReadStream(archive)) hash.update(chunk);
console.log(JSON.stringify({ archive: path.resolve(archive), bytes: (await stat(archive)).size, sha256: hash.digest('hex'), version: manifest?.app, arch: manifest?.arch, entries: count, native, frontend, companionAssets, applicationSource,
  opencli: { version: opencliMetadata?.version, requiredNode: opencliMetadata?.engines?.node, packages: [...closure.values()], edges, optionalAbsent, runtimeFilesVerified: requiredOpencliFiles.length, licenseVerified: dependencyHashes.has('node_modules/@jackwener/opencli/LICENSE') },
  runtimeVerified: false, ok: !failures.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
