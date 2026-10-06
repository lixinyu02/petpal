// Link the final portable, readback, source freeze and native smoke receipts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'Usage: node scripts/windows-native-finalize.mjs [--out-dir directory --evidence-dir directory]\nBoth options are required for independent release evidence. Independent finalization refuses to overwrite receipts and never changes historical windows-final copies. No arguments retain the legacy version-series paths.';
async function exists(file) { try { await access(file); return true; } catch { return false; } }

export function parseWindowsFinalizeOptions(argv, { root = projectRoot, version } = {}) {
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'Invalid release version');
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index];
    assert.ok(['--out-dir', '--evidence-dir'].includes(option), `Unknown option: ${option}\n${usage}`);
    assert.ok(!Object.hasOwn(options, option), `Duplicate option: ${option}`);
    const value = argv[++index];
    assert.ok(value && !value.startsWith('--'), `Missing value: ${option}`);
    options[option] = value;
  }
  const independent = Boolean(options['--out-dir'] || options['--evidence-dir']);
  assert.ok(!independent || options['--out-dir'] && options['--evidence-dir'], '--out-dir and --evidence-dir must be supplied together to preserve historical release evidence');
  const series = version.split('.').slice(0, 2).join('.'), tag = `v${series.replace('.', '')}`;
  const output = path.resolve(root, options['--out-dir'] || 'releases');
  const evidence = path.resolve(root, options['--evidence-dir'] || 'evidence/native');
  const resolve = relative => path.resolve(evidence, relative);
  return {
    independent, version, root: path.resolve(root),
    executable: path.join(output, 'desktop', `PetPal-${version}-Windows-x64.exe`),
    directory: resolve(independent ? 'windows-exe-smoke' : `windows-${tag}-final`),
    generic: independent ? null : resolve('windows-final'),
    runtimeReceipt: resolve(independent ? 'windows-exe-smoke.json' : `windows-${tag}-final.json`),
    asarReceipt: resolve(independent ? 'windows-exe-readback.json' : `windows-${series}-asar-verification.json`),
    freezeReceipt: resolve(independent ? 'windows-frozen-inputs.json' : `windows-${series}-frozen-inputs.json`),
    receiptPath: resolve(independent ? 'windows-final-verification.json' : `windows-${series}-final-verification.json`),
  };
}

export function normalizeWindowsFrozenInputs(receipt, version) {
  const files = Array.isArray(receipt) ? receipt : receipt?.files;
  assert.ok(Array.isArray(files) && files.length > 0, 'Frozen source receipt must contain files');
  if (!Array.isArray(receipt) && receipt.version !== undefined) assert.equal(receipt.version, version, 'Frozen source release version differs');
  const seen = new Set();
  for (const entry of files) {
    assert.ok(entry && typeof entry.path === 'string' && entry.path && !/[\\\0]/.test(entry.path)
      && !entry.path.startsWith('/') && !/^[a-z]:/i.test(entry.path) && path.posix.normalize(entry.path) === entry.path
      && !/(?:^|\/)\.{1,2}(?:\/|$)/.test(entry.path), `Unsafe frozen source path: ${entry?.path}`);
    const key = entry.path.toLowerCase();
    assert.ok(!seen.has(key), `Duplicate frozen source path: ${entry.path}`); seen.add(key);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/i, `Invalid frozen source digest: ${entry.path}`);
  }
  return files;
}

export async function finalizeWindowsRelease({ root = projectRoot, argv = [] } = {}) {
  const load = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
  const manifest = await load(path.join(root, 'package.json'));
  const config = parseWindowsFinalizeOptions(argv, { root, version: manifest.version });
  const { version, independent, executable, directory, generic, runtimeReceipt, asarReceipt, freezeReceipt, receiptPath } = config;
  const relative = file => path.relative(root, file).split(path.sep).join('/');
  async function hash(file) { const h = createHash('sha256'); for await (const chunk of createReadStream(file)) h.update(chunk); return h.digest('hex'); }
  if (independent) {
    assert.ok(!await exists(receiptPath), `Independent final receipt already exists: ${receiptPath}`);
    assert.ok(!await exists(path.join(directory, 'README.md')), 'Independent smoke README already exists');
    const historical = path.resolve(root, 'evidence/native');
    for (const output of [receiptPath, path.join(directory, 'README.md')]) {
      assert.ok(output !== historical && !output.startsWith(historical + path.sep), 'Independent evidence must not replace historical native receipts');
    }
  }
  const [runtime, asar, freezeManifest] = await Promise.all([load(runtimeReceipt), load(asarReceipt), load(freezeReceipt)]);
  const freeze = normalizeWindowsFrozenInputs(freezeManifest, version);
  const sha256 = await hash(executable), bytes = (await stat(executable)).size;
  assert.equal(runtime.sha256.toLowerCase(), sha256); assert.equal(asar.sha256.toLowerCase(), sha256);
  assert.equal(runtime.bytes, bytes); assert.equal(asar.bytes, bytes);
  assert.equal(runtime.version, version); assert.equal(asar.version, version);
  assert.equal(runtime.ownedProcessesRemaining, 0);
  assert.ok(runtime.portableSmoke.uiReady && runtime.portableSmoke.codex.available && runtime.portableSmoke.desktopTools.opencli.available);
  assert.equal(runtime.portableSmoke.desktopTools.opencli.version, '1.8.8');
  assert.ok(asar.nativeHelperCompared);
  assert.equal(runtime.portableSmoke.executor?.available, true, 'Executor preload facade was not verified by the final portable');
  const requiredExecutionSource = ['desktop/main.cjs', 'desktop/preload.cjs', 'desktop/window-layout.cjs', 'desktop/app-preferences.cjs', 'desktop/app-preferences-ipc.cjs', 'desktop/executor.mjs', 'server/executors.mjs', 'server/remote-codex.mjs', 'server/executor-relay.mjs', 'server/response-message-segments.mjs', 'server/project-directory.mjs', 'desktop/central-server.cjs', 'desktop/central-server-ipc.cjs', 'desktop/central-server-smoke.cjs', 'server/conversation-organization.mjs', 'server/chat-assistant.mjs', 'server/automation-schema.mjs', 'server/automation-tools.mjs', 'server/automations.mjs', 'server/codex-config.mjs', 'server/approval-review.mjs', 'server/system-controls.mjs', 'server/native/system-windows.ps1', 'server/native/codex-review/models-0.143.0.json', 'server/native/codex-review/LICENSE', 'server/native/codex-review/PROVENANCE.json', 'server/native/codex-review/SHA256SUMS'];
  for (const file of requiredExecutionSource) {
    const frozen = freeze.find(item => item.path === file), packed = asar.files?.find(item => item.path === file), smoke = runtime.portableSmoke.bundleFiles?.find(item => item.path === file);
    assert.ok(frozen && packed && smoke, `Runtime source must be present in frozen inputs, final EXE readback and native smoke: ${file}`);
    assert.equal(packed.sha256.toLowerCase(), frozen.sha256.toLowerCase(), `Runtime readback differs from frozen source: ${file}`);
    assert.equal(smoke.sha256.toLowerCase(), packed.sha256.toLowerCase(), `Runtime smoke differs from final EXE readback: ${file}`);
  }
  if (independent) {
    assert.equal(runtime.electronVersion, manifest.devDependencies.electron, 'Native Electron version differs from source');
    assert.equal(asar.electron, runtime.electronVersion, 'Readback Electron version differs from native smoke');
    assert.match(asar.opencliVersion, /(?:^|\s)1\.8\.8(?:\s|$)/, 'Readback bundled OpenCLI version differs');
    assert.equal(runtime.restrictedPath, true, 'Native smoke did not restrict PATH');
    for (const property of ['freshProfile', 'credentialEnvironmentCleared', 'inheritedElectronFlagsCleared', 'inheritedPortableFlagsCleared', 'restored']) {
      assert.equal(runtime.environmentIsolation?.[property], true, `Native smoke isolation was not verified: ${property}`);
    }
    for (const record of [runtime, asar]) for (const property of ['realApiCalled', 'browserActionExecuted', 'musicActionExecuted']) {
      assert.equal(record[property], false, `Read-only native verification executed an external action: ${property}`);
    }
    const audit = asar.computerUseAudit;
    assert.equal(audit?.version, '7.4.0', 'Computer Use dependency was not audited');
    assert.equal(audit.platform, 'win32'); assert.equal(audit.arch, 'x64'); assert.equal(audit.native?.machine, 0x8664);
    assert.ok(audit.files?.length >= 7, 'Computer Use runtime/license/native closure was not audited');
    for (const file of audit.files) {
      const packed = asar.files?.find(item => item.path === file.path);
      assert.ok(packed && packed.unpacked, `Computer Use member was not read back: ${file.path}`);
      assert.equal(packed.bytes, file.bytes); assert.equal(packed.sha256.toLowerCase(), file.sha256.toLowerCase());
    }
    for (const name of ['@jackwener/opencli', '@modelcontextprotocol/sdk', '@zavora-ai/computer-use-mcp']) {
      assert.ok(asar.opencliDependencyPackages?.some(entry => entry.name === name), `Missing runtime dependency closure: ${name}`);
    }
    for (const file of ['server/opencli-manager.mjs', 'server/opencli-sites.mjs', 'server/opencli-worker.mjs', 'server/opencli-routes.mjs']) {
      assert.equal(asar.files?.find(item => item.path === file)?.unpacked, true, `OpenCLI worker was not read back unpacked: ${file}`);
    }
  }
  for (const entry of freeze) assert.equal(await hash(path.join(root, entry.path)), entry.sha256.toLowerCase(), `Frozen source changed: ${entry.path}`);
  const smokeResult = path.join(directory, 'result.json');
  assert.equal(await hash(smokeResult), createHash('sha256').update(JSON.stringify(runtime.portableSmoke, null, 2)).digest('hex'), 'Smoke result differs from the runtime receipt');
  const screenshots = [];
  for (const name of (await readdir(directory)).sort()) {
    const source = path.join(directory, name);
    if (!(await stat(source)).isFile()) continue;
    if (name.endsWith('.png')) screenshots.push({ path: relative(source), ...(generic ? { genericPath: relative(path.join(generic, name)) } : {}), bytes: (await stat(source)).size, sha256: await hash(source) });
  }
  const receipt = { version, executable: relative(executable), bytes, sha256, authenticodeStatus: runtime.authenticodeStatus,
    smokeResult: relative(smokeResult), ...(generic ? { genericResult: relative(path.join(generic, 'result.json')) } : {}),
    runtimeReceipt: relative(runtimeReceipt), asarReceipt: relative(asarReceipt), freezeReceipt: relative(freezeReceipt),
    independentEvidence: independent, frozenSourcesUnchanged: freeze.length, freezeGitHead: freezeManifest.gitHead,
    electronVersion: runtime.electronVersion, opencliVersion: asar.opencliVersion, filesCompared: asar.filesCompared,
    ownedProcessesRemaining: runtime.ownedProcessesRemaining, environmentIsolation: runtime.environmentIsolation,
    computerUseAudit: asar.computerUseAudit, screenshots, realApiCalled: false, browserActionExecuted: false,
    musicActionExecuted: false, deviceMediaRuntimeVerified: false };
  // All receipts/source/payload validation finishes before any output is written.
  const readme = `# Windows ${version} final executable evidence\n\nGenerated by the final portable executable with a fresh smoke profile and restricted PATH.\n\n- Bundled Codex CLI and OpenCLI 1.8.8 passed status/version checks.\n- Music and browser checks only read status; no playback, browser connection or model requests.\n- Cubism V12 and the explicitly enabled single-cat view rendered in both windows; default-off cat selection and preference preservation passed.\n- Optional pose, speech and app-fixture outcomes are recorded only when present in result.json; this receipt does not verify a real microphone or model request.\n- Final EXE readback, frozen source and native smoke hashes are linked in ${relative(receiptPath)}.\n${generic ? '- Historical windows-final copies match byte for byte.\n' : '- This release uses independent evidence and preserves historical windows-final receipts.\n'}\nSHA256: ${sha256}\n`;
  await writeFile(path.join(directory, 'README.md'), readme, { flag: independent ? 'wx' : 'w' });
  if (generic) {
    await mkdir(generic, { recursive: true });
    for (const name of (await readdir(directory)).sort()) {
      const source = path.join(directory, name), destination = path.join(generic, name);
      if (!(await stat(source)).isFile()) continue;
      await copyFile(source, destination); assert.equal(await hash(source), await hash(destination));
    }
    await copyFile(runtimeReceipt, path.join(root, 'evidence/native/windows-final.json'));
  }
  await mkdir(path.dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { flag: independent ? 'wx' : 'w' });
  return { ...receipt, receiptPath: relative(receiptPath) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).includes('--help')) console.log(usage);
  else { const receipt = await finalizeWindowsRelease({ argv: process.argv.slice(2) }); console.log(JSON.stringify({ ...receipt, screenshots: receipt.screenshots.length }, null, 2)); }
}
