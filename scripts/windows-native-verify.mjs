// Verify the distributed portable EXE, including its unpacked native/tool payload.
// This script reads package contents and runs only Electron/OpenCLI version checks.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { openCliEnvironment } from '../server/opencli.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url), asar = require('@electron/asar');
const { createTransformer } = require('app-builder-lib/out/fileTransformer.js');
const run = promisify(execFile), sourcePackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = sourcePackage.version, series = version.split('.').slice(0, 2).join('.');
const relative = file => path.relative(root, file).split(path.sep).join('/');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function hash(file) { const h = createHash('sha256'); for await (const chunk of createReadStream(file)) h.update(chunk); return h.digest('hex'); }
async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function walk(dir) { const files = []; for (const item of await readdir(dir, { withFileTypes: true })) { const file = path.join(dir, item.name); if (item.isDirectory()) files.push(...await walk(file)); else if (item.isFile()) files.push(file); else throw new Error(`Unsupported source entry: ${file}`); } return files.sort(); }

if (process.argv.includes('--help')) { console.log('Usage: node scripts/windows-native-verify.mjs [portable.exe] [7za.exe] [--dist-dir directory --receipt file.json]\n--receipt writes a new independent receipt and refuses to overwrite it. An isolated --dist-dir requires --receipt.\nLegacy calls retain the version-series receipt. Extraction always uses a fresh directory; PETPAL_WINDOWS_READBACK_ROOT selects its parent. No browser or music commands.'); process.exit(0); }
const positional = [], cli = {};
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  if (argument === '--dist-dir' || argument === '--receipt') {
    assert.ok(!Object.hasOwn(cli, argument), `Duplicate option: ${argument}`);
    const value = process.argv[++index];
    assert.ok(value && !value.startsWith('--'), `Missing value: ${argument}`);
    cli[argument] = value;
  } else {
    assert.ok(!argument.startsWith('--'), `Unknown option: ${argument}`);
    positional.push(argument);
  }
}
assert.ok(positional.length <= 2, 'Expected only portable.exe and 7za.exe positional arguments');
assert.ok(!cli['--dist-dir'] || cli['--receipt'], '--dist-dir requires --receipt to preserve existing release evidence');
assert.equal(process.platform, 'win32', 'Windows verification requires Windows');
const executable = path.resolve(positional[0] || path.join(root, `releases/desktop/PetPal-${version}-Windows-x64.exe`));
const distDirectory = path.resolve(cli['--dist-dir'] || path.join(root, 'dist'));
const receiptPath = path.resolve(cli['--receipt'] || path.join(root, `evidence/native/windows-${series}-asar-verification.json`));
if (cli['--receipt']) assert.ok(!await exists(receiptPath), `Independent receipt already exists: ${receiptPath}`);
assert.ok(await exists(path.join(distDirectory, 'index.html')), `Missing frontend index: ${distDirectory}`);
assert.ok(await exists(executable), `Missing final executable: ${executable}`);
let sevenZip = positional[1];
if (!sevenZip) {
  const cache = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', '7zip@1.0.0');
  if (await exists(cache)) for (const dir of (await readdir(cache)).sort()) {
    const candidate = path.join(cache, dir, 'bin', '7za.exe');
    if (await exists(candidate)) { sevenZip = candidate; break; }
  }
}
assert.ok(sevenZip && await exists(sevenZip), 'Pass the electron-builder 7za.exe path as the second argument');
const readbackRoot = process.env.PETPAL_WINDOWS_READBACK_ROOT ? path.resolve(process.env.PETPAL_WINDOWS_READBACK_ROOT) : path.join(root, '.tools');
await mkdir(readbackRoot, { recursive: true });
const extraction = await mkdtemp(path.join(readbackRoot, `windows-v${series.replace('.', '')}-readback-`));
const options = { windowsHide: true, timeout: 180000, maxBuffer: 2 * 1024 * 1024 };
// The standalone 7za build auto-detects the nested 7z stream and lacks NSIS
// support. Use full 7z for the outer layer, then 7za for its exact inner file.
const nsisExtractor = path.join(root, 'node_modules/electron-winstaller/vendor/7z.exe');
assert.ok(await exists(nsisExtractor), 'Missing full 7z NSIS extractor');
await run(nsisExtractor, ['e', executable, '$PLUGINSDIR\\app-64.7z', `-o${extraction}`, '-y'], options);
const inner = path.join(extraction, 'app-64.7z');
assert.ok(await exists(inner), 'Final portable does not contain app-64.7z');
const payload = path.join(extraction, 'payload');
await run(sevenZip, ['x', inner, `-o${payload}`, '-y'], options);
const archive = path.join(payload, 'resources', 'app.asar');
const packedPaths = asar.listPackage(archive).map(file => file.replace(/^[\\/]/, '').split(/[\\/]/).join('/'));
const files = [], compared = new Set(), transform = createTransformer(root, {}, { main: 'desktop/main.cjs' });
function packedBytes(file) { return asar.extractFile(archive, path.normalize(file)); }
async function compare(file, unpacked = false, sourceOverride) {
  if (compared.has(file)) return;
  const source = sourceOverride || path.join(root, file), packed = packedBytes(file);
  const transformed = await transform(source), expected = transformed == null ? await readFile(source) : Buffer.from(transformed);
  assert.equal(packed.length, expected.length, `${file}: length`);
  assert.equal(digest(packed), digest(expected), `${file}: content differs from frozen source`);
  if (unpacked) {
    const actual = await readFile(path.join(`${archive}.unpacked`, file));
    assert.equal(digest(actual), digest(packed), `${file}: missing or different unpacked copy`);
  }
  compared.add(file); files.push({ path: file, bytes: packed.length, sha256: digest(packed), ...(unpacked ? { unpacked: true } : {}), ...(sourceOverride ? { sourcePath: relative(source) } : {}) });
}
for (const file of packedPaths) {
  assert.ok(!/(?:^|\/)(?:\.data|\.tools|\.preview|evidence|private)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|^server\/data(?:\/|$)/i.test(file), `Private/development data in package: ${file}`);
  assert.ok(!/^node_modules\/@openai\/codex-(?:linux|darwin)-/.test(file), `Wrong platform Codex package: ${file}`);
}
for (const absolute of await walk(distDirectory)) {
  const file = `dist/${path.relative(distDirectory, absolute).split(path.sep).join('/')}`;
  await compare(file, false, absolute);
}
for (const absolute of await walk(path.join(root, 'server'))) {
  const file = relative(absolute);
  if (file.startsWith('server/data/') || /(?:^|\/)\.env|\.test\./.test(file)) continue;
  await compare(file, file.startsWith('server/native/'));
}
for (const file of ['desktop/main.cjs', 'desktop/preload.cjs', 'desktop/window-layout.cjs', 'desktop/media-permissions.cjs', 'desktop/service-settings.cjs', 'desktop/startup-diagnostics.cjs', 'desktop/app-preferences.cjs', 'desktop/app-preferences-ipc.cjs', 'desktop/remote-http.cjs', 'desktop/updates.mjs', 'desktop/executor.mjs', 'package.json']) await compare(file);
for (const file of ['desktop/executor.mjs', 'server/executors.mjs', 'server/remote-codex.mjs', 'server/executor-relay.mjs', 'server/response-message-segments.mjs', 'server/project-directory.mjs']) assert.ok(compared.has(file), `Required executor module missing: ${file}`);
for (const file of ['server/agent-permissions.mjs', 'server/agent-tasks.mjs', 'server/attachments.mjs', 'server/downloads.mjs', 'server/codex-config.mjs', 'server/desktop-tools.mjs', 'server/music.mjs', 'server/opencli.mjs', 'server/native/music-windows.ps1']) assert.ok(compared.has(file), `Required assistant module missing: ${file}`);
const metadata = JSON.parse(packedBytes('package.json'));
assert.equal(metadata.version, version);
assert.equal(metadata.dependencies['@jackwener/opencli'], '1.8.8');

// Follow declared runtime dependencies from the packed layout, then compare
// every shipped file in that closure (including builder-normalized manifests).
const packages = new Map();
function dependencyRoot(name, parent = '') {
  let directory = parent;
  while (true) {
    const candidate = path.posix.join(directory, 'node_modules', name);
    if (packedPaths.includes(`${candidate}/package.json`)) return candidate;
    if (!directory) throw new Error(`Missing runtime dependency: ${name} from ${parent}`);
    directory = path.posix.dirname(directory); if (directory === '.') directory = '';
  }
}
async function sourceDependencyRoot(name, parent) {
  let directory = parent;
  while (true) {
    const candidate = path.join(directory, 'node_modules', name);
    if (await exists(path.join(candidate, 'package.json'))) return candidate;
    const next = path.dirname(directory);
    if (next === directory) throw new Error(`Source runtime dependency missing: ${name}`);
    directory = next;
  }
}
async function collect(directory, sourceDirectory) {
  const pkg = JSON.parse(packedBytes(`${directory}/package.json`));
  const source = JSON.parse(await readFile(path.join(sourceDirectory, 'package.json'), 'utf8'));
  assert.equal(pkg.name, source.name, `${directory}: resolved package name`);
  assert.equal(pkg.version, source.version, `${directory}: resolved package version`);
  if (packages.has(directory)) return;
  packages.set(directory, { sourceDirectory, name: pkg.name, version: pkg.version });
  for (const name of Object.keys(pkg.dependencies || {})) await collect(dependencyRoot(name, directory), await sourceDependencyRoot(name, sourceDirectory));
}
await collect(dependencyRoot('@jackwener/opencli'), await sourceDependencyRoot('@jackwener/opencli', root));
const packageRoots = [...packages.keys()].sort((a, b) => b.length - a.length);
for (const file of packedPaths) {
  const directory = packageRoots.find(directory => file.startsWith(`${directory}/`));
  if (!directory) continue;
  const info = asar.statFile(archive, path.normalize(file));
  if (!info.files) await compare(file, true, path.join(packages.get(directory).sourceDirectory, file.slice(directory.length + 1)));
}
for (const absolute of await walk(path.join(root, 'node_modules/@jackwener/opencli/dist/src'))) if (/\.(?:[cm]?js|json|ya?ml)$/.test(absolute) && !/\.test\./.test(absolute)) assert.ok(compared.has(relative(absolute)), `OpenCLI runtime source absent from final package: ${relative(absolute)}`);
for (const file of ['node_modules/@jackwener/opencli/LICENSE', 'node_modules/@jackwener/opencli/dist/src/main.js', 'node_modules/@jackwener/opencli/dist/src/daemon.js', 'node_modules/@jackwener/opencli/dist/src/browser/base-page.js']) assert.ok(compared.has(file), `OpenCLI member missing: ${file}`);
await compare('node_modules/@openai/codex-win32-x64/package.json', true);
for (const absolute of await walk(path.join(root, 'node_modules/@openai/codex-win32-x64/vendor'))) await compare(relative(absolute), true);

const nativeExe = path.join(payload, 'PetPal.exe'), isolated = path.join(extraction, 'version-only-profile');
await mkdir(isolated, { recursive: true });
const env = openCliEnvironment(isolated, process.env);
env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
const runtime = JSON.parse((await run(nativeExe, ['-p', 'JSON.stringify(process.versions)'], { ...options, timeout: 15000, env })).stdout.trim());
assert.equal(runtime.electron, sourcePackage.devDependencies.electron, 'Final Electron version');
const opencliEntry = path.join(`${archive}.unpacked`, 'node_modules/@jackwener/opencli/dist/src/main.js');
const opencliVersion = (await run(nativeExe, [opencliEntry, '--version'], { ...options, timeout: 15000, env })).stdout.trim();
assert.match(opencliVersion, /(?:^|\s)1\.8\.8(?:\s|$)/, 'Final bundled OpenCLI version');
const receipt = { executable: relative(executable), version, bytes: (await stat(executable)).size, sha256: await hash(executable), distDirectory: relative(distDirectory), extraction: 'Final portable EXE -> NSIS app-64.7z -> payload/resources/app.asar and unpacked members', extractionDirectory: relative(extraction), asarSha256: await hash(archive), electron: runtime.electron, node: runtime.node, opencliVersion, opencliDependencyPackages: [...packages].map(([packedRoot, entry]) => ({ packedRoot, sourceRoot: relative(entry.sourceDirectory), name: entry.name, version: entry.version })), filesCompared: files.length, webFilesCompared: files.filter(file => file.path.startsWith('dist/')).length, nativeHelperCompared: compared.has('server/native/music-windows.ps1'), startupDiagnosticsCompared: compared.has('desktop/startup-diagnostics.cjs'), files, realApiCalled: false, browserActionExecuted: false, musicActionExecuted: false, deviceMediaRuntimeVerified: false };
await mkdir(path.dirname(receiptPath), { recursive: true });
await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { flag: cli['--receipt'] ? 'wx' : 'w' });
console.log(JSON.stringify({ ...receipt, files: undefined, receiptPath: relative(receiptPath) }, null, 2));
