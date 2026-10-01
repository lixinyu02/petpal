// Cross-package Linux artifacts without executing Linux binaries on the build host.
import { readFile, writeFile, mkdir, cp, rename, stat, open, readdir, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import extractZip from 'extract-zip';
import * as tar from 'tar';
import electronBuilder from 'electron-builder';
import builderUtil from 'builder-util';
import semver from 'semver';
import yauzl from 'yauzl';
import {filterComputerUseNative,auditComputerUsePackage} from './computer-use-package.mjs';

const { build, Platform } = electronBuilder;
const { Arch } = builderUtil;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const electronVersion = metadata.devDependencies.electron;
const codexVersion = metadata.dependencies['@openai/codex'];
const opencliVersion = metadata.dependencies['@jackwener/opencli'];
const requiredApplicationSource = ['server/updates.mjs', 'desktop/updates.mjs', 'server/app.mjs', 'server/auth.mjs', 'server/agent-permissions.mjs', 'server/agent-tasks.mjs', 'server/attachments.mjs', 'server/downloads.mjs', 'server/codex.mjs', 'server/codex-config.mjs', 'server/codex-transport.mjs', 'server/desktop-tools.mjs', 'server/music.mjs', 'server/opencli.mjs', 'server/native/music-windows.ps1', 'server/index.mjs', 'server/providers.mjs', 'server/store.mjs', 'server/voice.mjs', 'server/cosyvoice.mjs', 'server/asr.mjs', 'desktop/main.cjs', 'desktop/preload.cjs', 'desktop/window-layout.cjs', 'desktop/media-permissions.cjs', 'desktop/service-settings.cjs', 'desktop/remote-http.cjs', 'desktop/executor.mjs', 'NOTICE'];
requiredApplicationSource.push('server/executors.mjs', 'server/remote-codex.mjs', 'server/executor-relay.mjs', 'server/response-message-segments.mjs', 'server/project-directory.mjs');
requiredApplicationSource.push('server/opencli-manager.mjs', 'server/opencli-sites.mjs', 'server/opencli-worker.mjs', 'server/opencli-routes.mjs');
requiredApplicationSource.push('server/opencli-browser-policies.mjs', 'server/opencli-browser-adapters.mjs');
requiredApplicationSource.push('server/computer-use-mcp.mjs','server/computer-use-tool-names.mjs','server/computer-use-mcp-routes.mjs','server/dynamic-tool-output.mjs','server/model-request-limits.mjs');
requiredApplicationSource.push('server/native/computer-use/LICENSE','server/native/computer-use/patches/linux-x11-window-geometry.patch');
requiredApplicationSource.push('desktop/startup-diagnostics.cjs', 'server/music-mcp.mjs', 'server/music-mcp-routes.mjs',
  'server/native/music-mcp/netease/server.py', 'server/native/music-mcp/netease/LICENSE', 'server/native/music-mcp/netease/pyproject.toml', 'server/native/music-mcp/netease/PROVENANCE.json',
  'server/native/music-mcp/qqmusic/login.py', 'server/native/music-mcp/qqmusic/LICENSE', 'server/native/music-mcp/qqmusic/pyproject.toml', 'server/native/music-mcp/qqmusic/PROVENANCE.json',
  'server/native/music-mcp/qqmusic/src/mcp_qqmusic/__init__.py', 'server/native/music-mcp/qqmusic/src/mcp_qqmusic/__main__.py', 'server/native/music-mcp/qqmusic/src/mcp_qqmusic/server.py', 'server/native/music-mcp/qqmusic/src/mcp_qqmusic/format.py');
const opencliPrefix = 'node_modules/@jackwener/opencli';
const requiredOpencliFiles = ['package.json', 'LICENSE', 'cli-manifest.json', 'dist/src/main.js', 'dist/src/daemon.js', 'dist/src/browser/base-page.js',
  'dist/src/execution.js', 'dist/src/registry.js', 'dist/src/errors.js',
  'clis/36kr/news.js', 'clis/arxiv/paper.js', 'clis/arxiv/recent.js', 'clis/arxiv/search.js', 'clis/arxiv/utils.js', 'clis/bbc/news.js',
  'clis/github-trending/repos.js', 'clis/hackernews/read.js', 'clis/hackernews/search.js', 'clis/hackernews/top.js',
  'clis/juejin/hot.js', 'clis/juejin/recommend.js', 'clis/juejin/utils.js', 'clis/mdn/search.js',
  'clis/npm/package.js', 'clis/npm/search.js', 'clis/npm/utils.js', 'clis/steam/app.js', 'clis/steam/search.js', 'clis/steam/top-sellers.js', 'clis/steam/utils.js',
  'clis/toutiao/hot.js', 'clis/toutiao/utils.js', 'clis/v2ex/hot.js', 'clis/v2ex/latest.js', 'clis/v2ex/topic.js',
  'clis/wikipedia/search.js', 'clis/wikipedia/summary.js', 'clis/wikipedia/utils.js',
  'clis/tieba/hot.js', 'clis/tieba/search.js', 'clis/tieba/read.js',
  'clis/bilibili/search.js', 'clis/bilibili/hot.js', 'clis/bilibili/ranking.js', 'clis/bilibili/video.js', 'clis/bilibili/comments.js', 'clis/bilibili/history.js', 'clis/bilibili/utils.js'];
if (![electronVersion, codexVersion, opencliVersion].every(version => /^\d+\.\d+\.\d+$/.test(version))) throw new Error('Electron, Codex and OpenCLI versions must be exact.');
const requested = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const architectures = requested.length ? requested : ['x64', 'arm64'];
if (architectures.some(arch => !['x64', 'arm64'].includes(arch))) throw new Error('Architectures must be x64 or arm64.');
const outputRoot = path.join(root, 'releases', 'ubuntu');
const cache = path.join(outputRoot, '.cache');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const staging = path.join(outputRoot, '.stage', runId);
const source = path.join(staging, 'source');
const evidenceDir = path.join(root, 'evidence');
await Promise.all([mkdir(cache, { recursive: true }), mkdir(source, { recursive: true }), mkdir(evidenceDir, { recursive: true })]);
const progress = { startedAt: new Date().toISOString(), pid: process.pid, hostPlatform: process.platform, architectures, phase: 'source', artifacts: [] };
async function report(phase) {
  progress.phase = phase; progress.updatedAt = new Date().toISOString();
  await writeFile(path.join(evidenceDir, 'linux-package-progress.json'), `${JSON.stringify(progress, null, 2)}\n`);
  console.log(`[linux-package] ${phase}`);
}
async function digest(file, algorithm = 'sha256', encoding = 'hex') {
  const hash = createHash(algorithm); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest(encoding);
}
async function download(url, file, algorithm, expected, encoding = 'hex') {
  if (await stat(file).catch(() => null)) {
    if (await digest(file, algorithm, encoding) === expected) return;
    throw new Error(`Existing download checksum mismatch: ${path.basename(file)}`);
  }
  // Resume an interrupted owned download; final full-file integrity is still mandatory.
  let partial = `${file}.partial-${process.pid}`;
  let offset = 0;
  for (const candidate of await readdir(path.dirname(file))) {
    if (!candidate.startsWith(`${path.basename(file)}.partial-`)) continue;
    const absolute = path.join(path.dirname(file), candidate); const size = (await stat(absolute)).size;
    if (size > offset) { partial = absolute; offset = size; }
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(1800000), headers: offset ? { Range: `bytes=${offset}-` } : undefined });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);
  const resumed = offset && response.status === 206 && (response.headers.get('content-range') ?? '').startsWith(`bytes ${offset}-`);
  if (response.status === 206 && !resumed) throw new Error('Unexpected partial download range; preserving the existing partial file.');
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: resumed ? 'a' : 'w' }));
  if (await digest(partial, algorithm, encoding) !== expected) throw new Error(`Downloaded integrity mismatch: ${path.basename(file)}`);
  await rename(partial, file);
}
async function elf(file, arch) {
  const handle = await open(file, 'r'); const header = Buffer.alloc(64);
  try { await handle.read(header, 0, 64, 0); } finally { await handle.close(); }
  if (!header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || header[4] !== 2 || header[5] !== 1) throw new Error(`Not a 64-bit little-endian ELF: ${file}`);
  const machine = header.readUInt16LE(18);
  if (machine !== (arch === 'x64' ? 62 : 183)) throw new Error(`Wrong ELF machine ${machine}: ${file}`);
  return { path: file, elfClass: 64, machine, sha256: await digest(file), bytes: (await stat(file)).size };
}
async function allFiles(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name); const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in staged app: ${relative}`);
    if (entry.isDirectory()) result.push(...await allFiles(absolute, relative)); else result.push(relative);
  }
  return result;
}

async function auditZip(file) {
  await new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true }, (error, zip) => {
    if (error) return reject(error);
    const seen = new Set();
    zip.on('error', reject); zip.on('end', resolve);
    zip.on('entry', entry => {
      const name = entry.fileName, mode = entry.externalFileAttributes >>> 16;
      if (name.startsWith('/') || /^[A-Za-z]:/.test(name) || /[\\\x00-\x1f]/.test(name) || name.split('/').includes('..') || seen.has(name) || (mode & 0o170000) === 0o120000) {
        zip.close(); reject(new Error(`Unsafe Electron zip member: ${name}`)); return;
      }
      seen.add(name); zip.readEntry();
    });
    zip.readEntry();
  }));
}

async function auditOpencli(appRoot, expectedSource) {
  const packages = new Map(), edges = [], optionalAbsent = [];
  async function locate(from, name) {
    for (let directory = from; directory === appRoot || directory.startsWith(`${appRoot}${path.sep}`); directory = path.dirname(directory)) {
      const candidate = path.join(directory, 'node_modules', ...name.split('/'), 'package.json');
      if ((await stat(candidate).catch(() => null))?.isFile()) return candidate;
      if (directory === appRoot) break;
    }
    return null;
  }
  async function visit(file) {
    const relative = path.relative(appRoot, file).replaceAll('\\', '/');
    if (packages.has(relative)) return;
    const pkg = JSON.parse(await readFile(file, 'utf8')), directory = path.dirname(file);
    const expected = expectedSource?.packages.find(item => item.name === pkg.name && item.version === pkg.version);
    if (expectedSource && !expected) throw new Error(`Unexpected packaged OpenCLI dependency: ${pkg.name}@${pkg.version}`);
    // electron-builder may hoist a nested production dependency when the root
    // version is development-only. Preserve exact identity and bytes, not layout.
    const locked = lock.packages[(expected?.path ?? relative).replace(/\/package\.json$/, '')];
    if (!locked || pkg.version !== locked.version) throw new Error(`OpenCLI dependency lock mismatch: ${relative}`);
    const licenseFiles = [];
    for (const name of await readdir(directory)) if (/^(?:licen[cs]e|copying)(?:[._-]|$)/i.test(name) && (await stat(path.join(directory, name))).isFile()) licenseFiles.push({ path: path.posix.join(path.posix.dirname(relative), name), sha256: await digest(path.join(directory, name)) });
    const sha256 = await digest(file);
    if (expected && (sha256 !== expected.sha256 || JSON.stringify(licenseFiles.map(item => ({ file: path.posix.basename(item.path), sha256: item.sha256 }))) !== JSON.stringify(expected.licenseFiles.map(item => ({ file: path.posix.basename(item.path), sha256: item.sha256 }))))) throw new Error(`Builder changed OpenCLI dependency metadata or licenses: ${pkg.name}`);
    packages.set(relative, { path: relative, name: pkg.name, version: pkg.version, license: pkg.license ?? null, sha256, licenseFiles });
    const optional = pkg.optionalDependencies ?? {};
    const dependencies = { ...(pkg.dependencies ?? {}), ...optional };
    for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) if (!pkg.peerDependenciesMeta?.[name]?.optional) dependencies[name] ??= range;
    for (const [name, range] of Object.entries(dependencies)) {
      const dependency = await locate(directory, name);
      if (!dependency) {
        if (Object.hasOwn(optional, name)) { optionalAbsent.push({ from: relative, name, range }); continue; }
        throw new Error(`OpenCLI required dependency missing: ${pkg.name} -> ${name}`);
      }
      const resolved = JSON.parse(await readFile(dependency, 'utf8'));
      if (resolved.name !== name || !semver.satisfies(resolved.version, range)) throw new Error(`OpenCLI dependency range mismatch: ${pkg.name} -> ${name}@${range}`);
      edges.push({ from: relative, name, range, to: path.relative(appRoot, dependency).replaceAll('\\', '/'), optional: Object.hasOwn(optional, name) });
      await visit(dependency);
    }
  }
  await visit(path.join(appRoot, opencliPrefix, 'package.json'));
  const pkg = JSON.parse(await readFile(path.join(appRoot, opencliPrefix, 'package.json'), 'utf8'));
  if (pkg.version !== opencliVersion || pkg.license !== 'Apache-2.0') throw new Error('OpenCLI version/license mismatch');
  const files = [];
  for (const relative of requiredOpencliFiles) {
    const file = `${opencliPrefix}/${relative}`;
    if (!(await stat(path.join(appRoot, file))).isFile()) throw new Error(`Required OpenCLI runtime file missing: ${file}`);
    files.push({ path: file, sha256: await digest(path.join(appRoot, file)) });
  }
  if (expectedSource) {
    if (JSON.stringify(files) !== JSON.stringify(expectedSource.files)) throw new Error('Builder changed required OpenCLI runtime files');
    const identities = records => [...new Set(records.map(item => `${item.name}@${item.version}:${item.sha256}`))].sort();
    if (JSON.stringify(identities([...packages.values()])) !== JSON.stringify(identities(expectedSource.packages))) throw new Error('Packaged OpenCLI dependency identity inventory changed');
  }
  return { version: pkg.version, requiredNode: pkg.engines.node, npmIntegrity: lock.packages[opencliPrefix].integrity, files,
    packages: [...packages.values()].sort((a, b) => a.path.localeCompare(b.path)), edges: edges.sort((a, b) => `${a.from}/${a.name}`.localeCompare(`${b.from}/${b.name}`)), optionalAbsent };
}

async function preserveOpencliMetadata(appRoot, sourceAudit) {
  const preserved = [];
  // Builder intentionally removes fields such as scripts/bugs/contributors.
  // Restore the original, already-lock-validated JSON without running scripts.
  for (const relative of await allFiles(path.join(appRoot, 'node_modules'))) {
    if (!relative.endsWith('/package.json')) continue;
    const target = path.join(appRoot, 'node_modules', relative);
    const packaged = JSON.parse(await readFile(target, 'utf8'));
    const expected = sourceAudit.packages.find(item => item.name === packaged.name && item.version === packaged.version);
    if (!expected) continue;
    const before = await digest(target);
    if (before !== expected.sha256) {
      await cp(path.join(source, expected.path), target);
      preserved.push({ path: `node_modules/${relative}`, source: expected.path, beforeSha256: before, sha256: expected.sha256 });
    }
  }
  return preserved;
}

try {
  // Snapshot only application source and production package content, never user data.
  for (const name of ['dist', 'server', 'desktop']) await cp(path.join(root, name), path.join(source, name), { recursive: true });
  await cp(path.join(root, 'NOTICE'), path.join(source, 'NOTICE'));
  const manifest = { name: metadata.name, version: metadata.version, description: metadata.description, type: 'module', main: metadata.main, private: true, dependencies: metadata.dependencies };
  await writeFile(path.join(source, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [relative, item] of Object.entries(lock.packages)) {
    if (!relative || item.dev || /^node_modules\/@openai\/codex-/.test(relative)) continue;
    const installed = path.join(root, relative);
    if (!(await stat(installed).catch(() => null))) { if (item.optional) continue; throw new Error(`Production dependency missing: ${relative}`); }
    await cp(installed, path.join(source, relative), { recursive: true });
  }
  await filterComputerUseNative(source,{platform:'linux'});
  const sourceFiles = await allFiles(source);
  for (const file of requiredApplicationSource) if (!sourceFiles.includes(file)) throw new Error(`Required application source is absent: ${file}`);
  for (const file of sourceFiles.filter(file => file.startsWith('server/native/music-mcp/'))) if (!requiredApplicationSource.includes(file)) throw new Error(`Unexpected music MCP vendor member: ${file}`);
  if (sourceFiles.some(file => /(?:^|\/)(?:\.env|\.data|\.tools|\.preview|preview|evidence|private|auth\.json|token)(?:$|\/)|\.exe$|\.dll$/i.test(file))) throw new Error('Source snapshot unexpectedly contains credentials/runtime/preview data or Windows binaries.');
  const sourceReceipt = [];
  for (const file of sourceFiles.filter(file => !file.startsWith('node_modules/'))) sourceReceipt.push({ path: file, sha256: await digest(path.join(source, file)) });
  const opencliSource = await auditOpencli(source);
  const shaResponse = await fetch(`https://github.com/electron/electron/releases/download/v${electronVersion}/SHASUMS256.txt`);
  if (!shaResponse.ok) throw new Error(`Electron checksum list unavailable: ${shaResponse.status}`);
  const shaList = await shaResponse.text();
  await writeFile(path.join(cache, `electron-v${electronVersion}-SHASUMS256.txt`), shaList);
  await report('download-linux-runtimes');
  const inputs = await Promise.all(architectures.map(async arch => {
    const electronName = `electron-v${electronVersion}-linux-${arch}.zip`;
    const line = shaList.split(/\r?\n/).find(line => line.endsWith(` *${electronName}`) || line.endsWith(`  ${electronName}`));
    if (!line) throw new Error(`No official Electron checksum for ${arch}`);
    const electronSha256 = line.split(/\s+/)[0];
    const electronZip = path.join(cache, electronName);
    const registryUrl = `https://registry.npmjs.org/@openai%2fcodex/${codexVersion}-linux-${arch}`;
    const registryResponse = await fetch(registryUrl);
    if (!registryResponse.ok) throw new Error(`Codex registry metadata unavailable (${registryResponse.status})`);
    const info = await registryResponse.json();
    if (info.version !== `${codexVersion}-linux-${arch}` || !info.dist.integrity.startsWith('sha512-')) throw new Error('Unexpected Codex metadata');
    const codexTgz = path.join(cache, `codex-${info.version}.tgz`);
    const codexSha512 = info.dist.integrity.slice(7);
    await Promise.all([
      download(`https://github.com/electron/electron/releases/download/v${electronVersion}/${electronName}`, electronZip, 'sha256', electronSha256),
      download(info.dist.tarball, codexTgz, 'sha512', codexSha512, 'base64'),
    ]);
    await writeFile(path.join(cache, `codex-${info.version}-integrity.json`), `${JSON.stringify({ registryUrl, version: info.version, tarball: info.dist.tarball, integrity: info.dist.integrity, sha256: await digest(codexTgz) }, null, 2)}\n`);
    return { arch, electronZip, electronSha256, codexTgz, codexIntegrity: info.dist.integrity };
  }));
  if (process.argv.includes('--download-only')) { await report('complete-download-integrity-only'); process.exit(0); }
  for (const input of inputs) {
    const { arch } = input;
    await report(`stage-${arch}`);
    const archRoot = path.join(staging, arch); const appRoot = path.join(archRoot, 'app'); const runtime = path.join(archRoot, 'electron');
    await cp(source, appRoot, { recursive: true }); await mkdir(runtime, { recursive: true });
    await filterComputerUseNative(appRoot,{platform:'linux',arch});
    const compatibleDirectory=path.join(appRoot,'server','native','computer-use',`linux-${arch}`);
    for(const otherArch of ['x64','arm64'].filter(value=>value!==arch))await rm(path.join(appRoot,'server','native','computer-use',`linux-${otherArch}`),{recursive:true,force:true});
    const archSourceReceipt=sourceReceipt.filter(item=>!/^server\/native\/computer-use\/linux-(?:x64|arm64)\//.test(item.path)||item.path.startsWith(`server/native/computer-use/linux-${arch}/`));
    if((await stat(path.join(compatibleDirectory,'PROVENANCE.json')).catch(()=>null))?.isFile()){
      const provenance=JSON.parse(await readFile(path.join(compatibleDirectory,'PROVENANCE.json'),'utf8'));
      if(provenance.version!=='7.4.0'||provenance.platform!=='linux'||provenance.arch!==arch||provenance.sourceCommit!=='cfbb6af0e704da17c43df6c668225a2f84aca762'||provenance.nativeFile!==`computer-use-napi.linux-${arch}.node`||await digest(path.join(compatibleDirectory,provenance.nativeFile))!==provenance.sha256)throw Error('Computer Use compatible build provenance mismatch');
      await cp(path.join(compatibleDirectory,provenance.nativeFile),path.join(appRoot,'node_modules','@zavora-ai','computer-use-mcp',provenance.nativeFile));
    }
    const computerUseSource=await auditComputerUsePackage(appRoot,{platform:'linux',arch});
    await auditZip(input.electronZip);
    await extractZip(input.electronZip, { dir: runtime });
    const nativeRoot = path.join(appRoot, 'node_modules', '@openai', `codex-linux-${arch}`);
    await mkdir(nativeRoot, { recursive: true });
    const codexEntries = [];
    await tar.t({ file: input.codexTgz, onReadEntry: entry => {
      if (!entry.path.startsWith('package/') || entry.path.split('/').includes('..') || !['File', 'Directory'].includes(entry.type)) throw new Error(`Unsafe npm archive entry: ${entry.path}`);
      codexEntries.push({ path: entry.path, mode: entry.mode });
    } });
    await tar.x({ file: input.codexTgz, cwd: nativeRoot, strip: 1, strict: true });
    const nativeMetadata = JSON.parse(await readFile(path.join(nativeRoot, 'package.json'), 'utf8'));
    if (nativeMetadata.version !== `${codexVersion}-linux-${arch}` || !nativeMetadata.os?.includes('linux') || !nativeMetadata.cpu?.includes(arch)) throw new Error('Codex native package platform metadata mismatch');
    const triple = arch === 'x64' ? 'x86_64-unknown-linux-musl' : 'aarch64-unknown-linux-musl';
    const nativeCodex = path.join(nativeRoot, 'vendor', triple, 'bin', 'codex');
    const nativeAudit = await elf(nativeCodex, arch);
    const nativeHelpers = [];
    for (const relative of await allFiles(path.join(nativeRoot, 'vendor'))) {
      if (/\.(?:json|txt|md)$/i.test(relative) || /(?:^|\/)LICENSE(?:\.|$)/.test(relative)) continue;
      nativeHelpers.push(await elf(path.join(nativeRoot, 'vendor', relative), arch));
    }
    const electronAudit = await elf(path.join(runtime, 'electron'), arch);
    await report(`electron-builder-linux-dir-${arch}`);
    const builderOutput = path.join(archRoot, 'built');
    await build({ projectDir: appRoot, targets: new Map([[Platform.LINUX, new Map([[Arch[arch], ['dir']]])]]), config: {
      appId: 'com.petpal.desktop', productName: 'PetPal', asar: false, electronVersion, electronDist: runtime,
      npmRebuild: false, nodeGypRebuild: false, buildDependenciesFromSource: false,
      removePackageScripts: false, removePackageKeywords: false,
      directories: { output: builderOutput }, files: ['dist/**', 'server/**', 'desktop/main.cjs', 'desktop/preload.cjs', 'desktop/window-layout.cjs', 'desktop/media-permissions.cjs', 'desktop/service-settings.cjs', 'desktop/startup-diagnostics.cjs', 'desktop/remote-http.cjs', 'desktop/executor.mjs', 'desktop/updates.mjs', 'desktop/assets/**', 'package.json', 'NOTICE'],
      linux: { executableName: 'petpal', category: 'Utility' },
    } });
    const unpacked = path.join(builderOutput, arch === 'x64' ? 'linux-unpacked' : `linux-${arch}-unpacked`);
    const folderName = `PetPal-${metadata.version}-Ubuntu-${arch}`;
    // Keep the builder output in place: Windows scanners can briefly lock directory renames.
    const portable = unpacked;
    const finalCodex = path.join(portable, 'resources', 'app', 'node_modules', '@openai', `codex-linux-${arch}`, 'vendor', triple, 'bin', 'codex');
    const packagedCodex = await elf(finalCodex, arch);
    if (packagedCodex.sha256 !== nativeAudit.sha256) throw new Error('Builder changed native Codex binary');
    await elf(path.join(portable, 'petpal'), arch);
    const packagedApp = path.join(portable, 'resources', 'app');
    for(const file of archSourceReceipt.filter(item=>item.path.startsWith('server/native/computer-use/'))){if(await digest(path.join(packagedApp,file.path))!==file.sha256)throw Error('Computer Use native provenance payload mismatch');}
    await cp(path.join(appRoot,'node_modules','@zavora-ai','computer-use-mcp','package.json'),path.join(packagedApp,'node_modules','@zavora-ai','computer-use-mcp','package.json'));
    const computerUseAudit=await auditComputerUsePackage(packagedApp,{platform:'linux',arch,expected:computerUseSource});
    const packagedComputerNatives=(await allFiles(path.join(packagedApp,'node_modules','@zavora-ai','computer-use-mcp'))).filter(file=>file.endsWith('.node'));
    if(packagedComputerNatives.length!==1||packagedComputerNatives[0]!==`computer-use-napi.linux-${arch}.node`)throw Error('Computer Use wrong-platform native payload');
    // Native Python and attribution files must survive builder filtering with
    // exactly the bytes recorded before the build, including --dir-only runs.
    const packagedSource = await allFiles(path.join(packagedApp, 'server'));
    for (const relative of packagedSource.filter(file => file.startsWith('native/music-mcp/'))) if (!requiredApplicationSource.includes(`server/${relative}`)) throw new Error(`Unexpected packaged music MCP member: server/${relative}`);
    for (const file of requiredApplicationSource) {
      const target = path.join(packagedApp, file), expected = sourceReceipt.find(item => item.path === file);
      if (!(await stat(target).catch(() => null))?.isFile()) throw new Error(`Required packaged application source is absent: ${file}`);
      if (!expected || await digest(target) !== expected.sha256) throw new Error(`Builder changed application source: ${file}`);
    }
    const preservedMetadata = await preserveOpencliMetadata(path.join(portable, 'resources', 'app'), opencliSource);
    const opencliAudit = await auditOpencli(path.join(portable, 'resources', 'app'), opencliSource);
    opencliAudit.preservedMetadata = preservedMetadata;
    if (process.argv.includes('--dir-only')) {
      progress.artifacts.push({ arch, baselineDirectory: path.relative(root, portable).replaceAll('\\', '/'), electronMachine: electronAudit.machine, codexMachine: nativeAudit.machine, nativeHelpers: nativeHelpers.length, runtimeVerified: false });
      await report(`baseline-dir-audited-${arch}`); continue;
    }
    await writeFile(path.join(portable, 'start-petpal.sh'), '#!/bin/sh\nset -eu\nHERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$HERE/petpal" "$@"\n');
    await writeFile(path.join(portable, 'codex.sh'), '#!/bin/sh\nset -eu\nHERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexport ELECTRON_RUN_AS_NODE=1\nexec "$HERE/petpal" "$HERE/resources/app/node_modules/@openai/codex/bin/codex.js" "$@"\n');
    await writeFile(path.join(portable, 'opencli.sh'), '#!/bin/sh\nset -eu\nHERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexport ELECTRON_RUN_AS_NODE=1\nexec "$HERE/petpal" "$HERE/resources/app/node_modules/@jackwener/opencli/dist/src/main.js" "$@"\n');
    await writeFile(path.join(portable, 'README-Ubuntu.txt'), `PetPal ${metadata.version} / Ubuntu ${arch}\n\nExtract the entire folder, then run ./start-petpal.sh from a normal desktop session.\nBuilt-in Codex ${codexVersion}: ./codex.sh --version ; ./codex.sh login\nBuilt-in OpenCLI ${opencliVersion}: ./opencli.sh --version\nDesktop assistant API mode uses a Responses endpoint and a private Codex home/workspace. Host mode keeps your own Codex login/configuration.\nAgent tasks run with the access and approval mode selected for that task; the default is read-only with confirmation. Music/browser actions require full-access and follow the selected approval mode.\nUbuntu music control requires the selected player to expose a compatible MPRIS session on the current user D-Bus. No song search is supplied by MPRIS.\nBrowser control requires the official OpenCLI Chrome Browser Bridge extension and an explicitly selected profile; installation and real browser/music operation are not included in package verification.\nElectron ${electronVersion}; requires Linux GUI libraries (Ubuntu 22.04+ desktop).\nThis artifact was cross-packaged and audited on Windows; Ubuntu GUI/runtime has NOT been tested.\nThe Chromium sandbox remains enabled. Do not run this app as root or add --no-sandbox.\nX11 is recommended for transparent always-on-top pets; Wayland behavior depends on the compositor.\nLocal state is stored in your Electron userData folder. No credentials or user chat data are bundled.\nThird-party attribution: resources/app/NOTICE and resources/app/node_modules/@jackwener/opencli/LICENSE.\n`);
    const files = await allFiles(portable);
    if (files.some(file => /\.exe$|\.dll$|codex-win32-|codex-darwin-/i.test(file))) throw new Error('Portable artifact contains wrong-platform executable');
    const manifestFile = path.join(portable, 'BUILD-MANIFEST.json');
    const manifestValue = { app: metadata.version, platform: 'linux', arch, crossPackagedOn: process.platform, runtimeVerified: false, electronVersion, codexVersion, opencliVersion, opencli: opencliAudit, computerUse:computerUseAudit, sourceReceipt:archSourceReceipt, electron: { sha256: electronAudit.sha256, machine: electronAudit.machine, zipSha256: input.electronSha256 }, codex: { sha256: nativeAudit.sha256, machine: nativeAudit.machine, npmIntegrity: input.codexIntegrity, helpers: nativeHelpers.map(item => ({ ...item, path: path.relative(nativeRoot, item.path).replaceAll('\\', '/') })) }, packageMethod: 'electron-builder linux dir + portable tar.gz' };
    await writeFile(manifestFile, `${JSON.stringify(manifestValue, null, 2)}\n`);
    await report(`archive-and-audit-${arch}`);
    const archive = path.join(outputRoot, `${folderName}.tar.gz`);
    const executable = relative => /(?:^|\/)(?:petpal|chrome-sandbox|chrome_crashpad_handler|codex|codex-code-mode-host|rg)$/.test(relative) || relative.endsWith('.sh') || nativeHelpers.some(item => relative.endsWith(path.relative(appRoot, item.path).replaceAll('\\', '/')));
    await tar.c({ cwd: portable, prefix: folderName, file: `${archive}.partial`, gzip: { level: 6 }, portable: true, onWriteEntry: entry => {
      entry.stat.mode = entry.type === 'Directory' || executable(entry.path) ? 0o755 : 0o644;
    } }, ['.']);
    let entryCount = 0; const executableModes = []; let foundManifest = false;
    await tar.t({ file: `${archive}.partial`, strict: true, onReadEntry: entry => {
      entryCount++;
      if (!entry.path.startsWith(`${folderName}/`) || entry.path.split('/').includes('..') || /\.exe$|\.dll$/i.test(entry.path)) throw new Error(`Unexpected final archive entry: ${entry.path}`);
      if (entry.path.endsWith('/BUILD-MANIFEST.json')) foundManifest = true;
      if (entry.type === 'File' && executable(entry.path)) { if ((entry.mode & 0o111) !== 0o111) throw new Error(`Executable mode missing: ${entry.path}`); executableModes.push({ path: entry.path, mode: entry.mode.toString(8) }); }
    } });
    if (!foundManifest || executableModes.length < 5) throw new Error('Final archive is incomplete');
    await rename(`${archive}.partial`, archive);
    const receipt = { version: metadata.version, arch, archive: path.relative(root, archive).replaceAll('\\', '/'), stagedPayload: path.relative(root, portable).replaceAll('\\', '/'), bytes: (await stat(archive)).size, sha256: await digest(archive), entryCount, executableModes, electronVersion, codexVersion, opencliVersion, opencli: opencliAudit, computerUse:computerUseAudit, electronMachine: electronAudit.machine, codexMachine: nativeAudit.machine, codexSha256: nativeAudit.sha256, electronZipSha256: input.electronSha256, codexNpmIntegrity: input.codexIntegrity, runtimeVerified: false };
    progress.artifacts.push(receipt);
    await writeFile(path.join(evidenceDir, `linux-package-${arch}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
    await writeFile(path.join(evidenceDir, `linux-package-${arch}-${metadata.version}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
    await writeFile(`${archive}.sha256`, `${receipt.sha256}  ${path.basename(archive)}\n`);
  }
  await report(process.argv.includes('--dir-only') ? 'complete-baseline-dirs-runtime-unverified' : 'complete-cross-package-runtime-unverified');
} catch (error) {
  progress.error = error.message; await report('failed'); throw error;
}
