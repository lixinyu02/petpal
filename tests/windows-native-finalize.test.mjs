import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import ts from 'typescript';
import { parseWindowsFinalizeOptions, normalizeWindowsFrozenInputs, finalizeWindowsRelease } from '../scripts/windows-native-finalize.mjs';
import { COMPUTER_USE_PACKAGE, COMPUTER_USE_RUNTIME_FILES } from '../scripts/computer-use-package.mjs';

const version = '0.9.8', digest = bytes => createHash('sha256').update(bytes).digest('hex');
const production = await readFile(new URL('../scripts/windows-native-finalize.mjs', import.meta.url), 'utf8');
const tree = ts.createSourceFile('windows-native-finalize.mjs', production, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let required;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'requiredExecutionSource') required = [...vm.runInNewContext(node.initializer.getText(tree))];
  ts.forEachChild(node, visit);
}
visit(tree); assert.ok(required);
const present = async file => { try { await access(file); return true; } catch { return false; } };
const fixtureRoots = [];
test.after(async () => {
  for (const directory of fixtureRoots) {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('petpal-finalize-'));
    await rm(directory, { recursive: true, force: true });
  }
});
async function fixture({ legacy = false, freezeArray = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'petpal-finalize-'));
  fixtureRoots.push(root);
  const argv = legacy ? [] : ['--out-dir', 'releases/new', '--evidence-dir', 'evidence/new'];
  const config = parseWindowsFinalizeOptions(argv, { root, version });
  const put = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, value); };
  const json = async (file, value) => put(file, JSON.stringify(value, null, 2));
  await json(path.join(root, 'package.json'), { version, devDependencies: { electron: '39.8.10' } });
  const freeze = [];
  for (const file of required) {
    const content = `// Frozen fixture: ${file}\n`;
    await put(path.join(root, file), content); freeze.push({ path: file, bytes: Buffer.byteLength(content), sha256: digest(content) });
  }
  const executable = Buffer.from('MZ fixture portable bytes');
  await put(config.executable, executable);
  const bundleFiles = [...freeze];
  const smoke = { uiReady: true, executor: { available: true }, codex: { available: true }, desktopTools: { opencli: { available: true, version: '1.8.8' } }, bundleFiles };
  const base = { version, bytes: executable.length, sha256: digest(executable), realApiCalled: false, browserActionExecuted: false, musicActionExecuted: false };
  const runtime = { ...base, electronVersion: '39.8.10', portableSmoke: smoke, ownedProcessesRemaining: 0, restrictedPath: true, authenticodeStatus: 'NotSigned',
    environmentIsolation: { freshProfile: true, credentialEnvironmentCleared: true, inheritedElectronFlagsCleared: true, inheritedPortableFlagsCleared: true, restored: true } };
  const nativeFiles = [...COMPUTER_USE_RUNTIME_FILES, 'computer-use-napi.win32-x64.node'].map(file => ({ path: `${COMPUTER_USE_PACKAGE}/${file}`, bytes: 12, sha256: digest(`native:${file}`), unpacked: true }));
  const workerFiles = ['server/opencli-manager.mjs', 'server/opencli-sites.mjs', 'server/opencli-worker.mjs', 'server/opencli-routes.mjs'].map(file => ({ path: file, bytes: 4, sha256: digest(file), unpacked: true }));
  const asar = { ...base, electron: '39.8.10', opencliVersion: '1.8.8', nativeHelperCompared: true, filesCompared: 999,
    files: [...freeze, ...nativeFiles, ...workerFiles], computerUseAudit: { version: '7.4.0', platform: 'win32', arch: 'x64', native: { machine: 0x8664 }, files: nativeFiles },
    opencliDependencyPackages: ['@jackwener/opencli', '@modelcontextprotocol/sdk', '@zavora-ai/computer-use-mcp'].map(name => ({ name })) };
  await json(config.runtimeReceipt, runtime); await json(config.asarReceipt, asar);
  await json(config.freezeReceipt, freezeArray ? freeze : { version, gitHead: 'fixture', files: freeze });
  await json(path.join(config.directory, 'result.json'), smoke);
  await put(path.join(config.directory, 'main.png'), 'fixture screenshot');
  const historical = path.join(root, 'evidence/native/windows-final.json');
  await put(historical, 'historical receipt retained');
  return { root, argv, config, runtime, asar, freeze, json, put, historical };
}

test('finalizer preserves the no-argument paths and pairs independent release output/evidence', () => {
  const root = path.resolve('fixture-root');
  const legacy = parseWindowsFinalizeOptions([], { root, version });
  assert.equal(legacy.executable, path.join(root, 'releases/desktop/PetPal-0.9.8-Windows-x64.exe'));
  assert.equal(legacy.freezeReceipt, path.join(root, 'evidence/native/windows-0.9-frozen-inputs.json'));
  assert.equal(legacy.directory, path.join(root, 'evidence/native/windows-v09-final'));
  const isolated = parseWindowsFinalizeOptions(['--out-dir', 'releases/windows-0.9.8', '--evidence-dir', 'evidence/release-098'], { root, version });
  assert.equal(isolated.executable, path.join(root, 'releases/windows-0.9.8/desktop/PetPal-0.9.8-Windows-x64.exe'));
  assert.equal(isolated.generic, null);
  assert.equal(isolated.runtimeReceipt, path.join(root, 'evidence/release-098/windows-exe-smoke.json'));
  for (const args of [['--out-dir', 'x'], ['--evidence-dir', 'x'], ['--other'], ['--out-dir'], ['--out-dir', 'x', '--out-dir', 'y']]) {
    assert.throws(() => parseWindowsFinalizeOptions(args, { root, version }), { code: 'ERR_ASSERTION' });
  }
});

test('frozen receipts support legacy arrays and reject path escapes, case duplicates and invalid digests', () => {
  const entries = [{ path: 'desktop/main.cjs', sha256: 'a'.repeat(64) }];
  assert.equal(normalizeWindowsFrozenInputs(entries, version), entries);
  assert.equal(normalizeWindowsFrozenInputs({ version, files: entries }, version), entries);
  for (const unsafe of ['../secret', '/secret', 'C:/secret', 'desktop\\main.cjs', 'desktop/../secret', './desktop/main.cjs', 'desktop//main.cjs', 'desktop/./main.cjs', 'secret\0file']) {
    assert.throws(() => normalizeWindowsFrozenInputs([{ ...entries[0], path: unsafe }], version), /Unsafe frozen source/);
  }
  assert.throws(() => normalizeWindowsFrozenInputs([...entries, { ...entries[0], path: 'DESKTOP/main.cjs' }], version), /Duplicate/);
  assert.throws(() => normalizeWindowsFrozenInputs([{ ...entries[0], sha256: 'bad' }], version), /Invalid frozen/);
  assert.throws(() => normalizeWindowsFrozenInputs({ version: '0.9.7', files: entries }, version), /release version differs/);
});

test('independent finalization joins actual source/executable/smoke bytes and preserves historical receipts', async () => {
  const f = await fixture();
  const receipt = await finalizeWindowsRelease({ root: f.root, argv: f.argv });
  assert.equal(receipt.frozenSourcesUnchanged, f.freeze.length);
  assert.equal(receipt.sha256, f.runtime.sha256);
  assert.equal(receipt.independentEvidence, true);
  assert.equal(receipt.screenshots.length, 1);
  assert.equal(receipt.authenticodeStatus, 'NotSigned');
  assert.equal(await readFile(f.historical, 'utf8'), 'historical receipt retained');
  assert.equal(await present(path.join(f.root, 'evidence/native/windows-final/result.json')), false);
  assert.equal(JSON.parse(await readFile(f.config.receiptPath, 'utf8')).smokeResult, 'evidence/new/windows-exe-smoke/result.json');
  await assert.rejects(finalizeWindowsRelease({ root: f.root, argv: f.argv }), /Independent final receipt already exists/);
});

test('legacy finalization accepts the array freeze and keeps byte-identical generic copies', async () => {
  const f = await fixture({ legacy: true, freezeArray: true });
  const receipt = await finalizeWindowsRelease({ root: f.root });
  assert.equal(receipt.independentEvidence, false);
  assert.equal(await readFile(path.join(f.config.generic, 'result.json'), 'utf8'), await readFile(path.join(f.config.directory, 'result.json'), 'utf8'));
  assert.equal(await readFile(f.historical, 'utf8'), await readFile(f.config.runtimeReceipt, 'utf8'));
});

test('finalization refuses corrupted and missing lifecycle receipts before writing output', async () => {
  for (const group of ['freeze', 'packed', 'smoke']) for (const mode of ['missing', 'corrupt']) {
    const f = await fixture();
    const file = 'desktop/main.cjs';
    const change = rows => mode === 'missing' ? rows.filter(item => item.path !== file) : rows.map(item => item.path === file ? { ...item, sha256: '0'.repeat(64) } : item);
    if (group === 'freeze') await f.json(f.config.freezeReceipt, { version, files: change(f.freeze) });
    if (group === 'packed') { f.asar.files = change(f.asar.files); await f.json(f.config.asarReceipt, f.asar); }
    if (group === 'smoke') { f.runtime.portableSmoke.bundleFiles = change(f.runtime.portableSmoke.bundleFiles); await f.json(f.config.runtimeReceipt, f.runtime); }
    await assert.rejects(finalizeWindowsRelease({ root: f.root, argv: f.argv }), /desktop\/main.cjs/);
    assert.equal(await present(f.config.receiptPath), false);
    assert.equal(await present(path.join(f.config.directory, 'README.md')), false);
    assert.equal(await readFile(f.historical, 'utf8'), 'historical receipt retained');
  }
});

test('finalization rejects changed source, stale executable, smoke bytes, missing MCP and wrong native architecture', async () => {
  for (const mutation of ['source', 'exe', 'smoke', 'mcp', 'native', 'worker', 'isolation']) {
    const f = await fixture();
    if (mutation === 'source') await f.put(path.join(f.root, 'desktop/main.cjs'), 'changed source');
    if (mutation === 'exe') await f.put(f.config.executable, 'different portable');
    if (mutation === 'smoke') await f.put(path.join(f.config.directory, 'result.json'), '{}');
    if (mutation === 'mcp') f.asar.opencliDependencyPackages = f.asar.opencliDependencyPackages.filter(item => item.name !== '@modelcontextprotocol/sdk');
    if (mutation === 'native') f.asar.computerUseAudit.native.machine = 0xaa64;
    if (mutation === 'worker') f.asar.files = f.asar.files.filter(item => item.path !== 'server/opencli-worker.mjs');
    if (mutation === 'isolation') f.runtime.environmentIsolation.credentialEnvironmentCleared = false;
    await f.json(f.config.asarReceipt, f.asar); await f.json(f.config.runtimeReceipt, f.runtime);
    await assert.rejects(finalizeWindowsRelease({ root: f.root, argv: f.argv }));
    assert.equal(await present(f.config.receiptPath), false);
    assert.equal(await present(path.join(f.config.directory, 'README.md')), false);
  }
});
