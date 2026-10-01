import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MusicMcpManager, MUSIC_MCP_BOOTSTRAP, MUSIC_MCP_MODULE_BOOTSTRAP, MUSIC_MCP_REQUIREMENTS, MUSIC_MCP_TOOLS, musicMcpReadOnly, validateMusicMcpCall, isolatedMusicMcpEnvironment } from '../server/music-mcp.mjs';

const fixture = fileURLToPath(new URL('./fixtures/music-mcp/stdio-server.mjs', import.meta.url));
const envSecrets = { ...process.env, OPENAI_API_KEY: 'llm-secret', PETPAL_ADMIN_TOKEN: 'central-secret', HTTP_PROXY: 'http://proxy-secret', PYTHONPATH: 'global-python', CLOUDMUSIC_EXE: 'unconfigured.exe', CLOUDMUSIC_CDP_PORT: '80', HOME: 'global-home' };
function fakeSpawn(calls, version = 'Python 3.11.9') {
  return (command, args, options) => {
    calls.push({ command, args, options }); const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { setImmediate(() => child.emit('close', 0)); return true; };
    setImmediate(() => { child.stdout.end(args[0] === '--version' ? `${version}\n` : args.includes('-c') ? 'MUSIC_MCP_DEPS_OK\n' : 'fixed dependencies ready\n'); child.stderr.end(); child.emit('close', 0); });
    return child;
  };
}
async function harness(t, { mode = 'default', platform = 'win32', scope = 'local', dataDir, version, configured = true, ...options } = {}) {
  const directory = dataDir || await mkdtemp(path.join(os.tmpdir(), 'petpal-music-mcp-'));
  const calls = [], transports = [], transportOptions = []; const events = path.join(directory, `events-${scope}.jsonl`);
  const manager = new MusicMcpManager({ dataDir: directory, scope, platform, env: envSecrets, spawn: fakeSpawn(calls, version), closeTimeoutMs: 5500, processTimeoutMs: 500, connectTimeoutMs: 5000, callTimeoutMs: 1500,
    transportFactory: params => { transportOptions.push(params); const player = params.args.includes('mcp_qqmusic') ? 'qqmusic' : 'netease'; const transport = new StdioClientTransport({ ...params, command: process.execPath, args: [fixture, '--player', player, '--events', events, '--mode', mode] }); transports.push(transport); return transport; }, ...options });
  t.after(async () => { await manager.close(); if (!dataDir) await rm(directory, { recursive: true, force: true }); });
  const config = await manager.config();
  if (configured) await manager.configure({ revision: config.revision, pythonExecutable: process.execPath, neteaseEnabled: true, qqmusicEnabled: true });
  return { manager, calls, transports, transportOptions, directory, events, readEvents: async () => { try { return (await readFile(events, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } } };
}
const command = (player, tool, args = {}) => ({ player, tool, arguments: args });

test('fixed music MCP allowlist rejects global keys, shell fields, unsupported names and bounded arguments synchronously', () => {
  assert.equal(MUSIC_MCP_TOOLS.netease.length, 14); assert.equal(MUSIC_MCP_TOOLS.qqmusic.length, 9);
  assert.deepEqual(validateMusicMcpCall(command('qqmusic', 'search', { keyword: '晴天' })), command('qqmusic', 'search', { keyword: '晴天' }));
  for (const body of [null, [], command('other', 'search'), command('netease', 'control_netease'), command('netease', 'send_netease_shortcut'), command('qqmusic', 'run_shell'), { ...command('qqmusic', 'search'), command: 'python' }, command('qqmusic', 'search', []), command('qqmusic', 'search', { keyword: 'x'.repeat(8193) }), command('qqmusic', 'search', { list: Array(101).fill('x') }), command('qqmusic', 'search', JSON.parse('{"__proto__":{"path":"secret"}}'))]) assert.throws(() => validateMusicMcpCall(body), { status: 400 });
  assert.equal(musicMcpReadOnly('netease', 'search_music'), true); assert.equal(musicMcpReadOnly('netease', 'set_netease_volume'), false); assert.equal(musicMcpReadOnly('qqmusic', 'url'), true); assert.equal(musicMcpReadOnly('qqmusic', 'unknown'), false);
});

test('config/status never spawn and defaults persist with strict CAS and file validation', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'petpal-music-config-')); let spawned = 0;
  const manager = new MusicMcpManager({ dataDir: directory, platform: 'win32', spawn: () => { spawned++; throw new Error('must not spawn'); } });
  t.after(async () => { await manager.close(); await rm(directory, { recursive: true, force: true }); });
  const initial = await manager.config(); assert.deepEqual({ ...initial, revision: 'revision' }, { revision: 'revision', pythonExecutable: '', cloudmusicExecutable: '', cdpPort: 9223, neteaseEnabled: true, qqmusicEnabled: true });
  assert.equal((await manager.status()).servers.every(server => !server.connected && server.tools.length === 0), true); assert.equal(spawned, 0);
  for (const body of [{ revision: initial.revision, command: 'cmd.exe' }, { revision: initial.revision, credential: 'secret' }, { qqmusicEnabled: true }, { revision: initial.revision, pythonExecutable: 'python' }, { revision: initial.revision, cloudmusicExecutable: fixture }, { revision: initial.revision, cdpPort: 80 }, { revision: initial.revision, qqmusicEnabled: 'true' }]) await assert.rejects(manager.configure(body), { status: 400 });
  const saved = await manager.configure({ revision: initial.revision, qqmusicEnabled: false }); assert.notEqual(saved.revision, initial.revision);
  await assert.rejects(manager.configure({ revision: initial.revision, neteaseEnabled: true }), { status: 409 });
  const [a, b] = await Promise.allSettled([manager.configure({ revision: saved.revision, cdpPort: 9224 }), manager.configure({ revision: saved.revision, cdpPort: 9225 })]);
  assert.equal([a, b].filter(value => value.status === 'fulfilled').length, 1); assert.equal([a, b].find(value => value.status === 'rejected').reason.status, 409);
  assert.equal(spawned, 0); assert.equal((await readFile(path.join(directory, 'music-mcp.json'), 'utf8')).includes('secret'), false);
  if (process.platform !== 'win32') assert.equal((await stat(path.join(directory, 'music-mcp.json'))).mode & 0o777, 0o600);
});

test('new desktop music settings use upstream support defaults without preparing dependencies or connecting', async t => {
  for (const [platform, neteaseEnabled] of [['win32', true], ['linux', false], ['darwin', false]]) {
    const { manager, calls, transportOptions, readEvents } = await harness(t, { platform, configured: false });
    const config = await manager.config(), status = await manager.status();
    assert.equal(config.neteaseEnabled, neteaseEnabled); assert.equal(config.qqmusicEnabled, true); assert.deepEqual(status.config, config);
    assert.equal(status.servers.find(server => server.id === 'netease').platformSupported, neteaseEnabled); assert.equal(status.servers.find(server => server.id === 'qqmusic').platformSupported, true);
    assert.equal(status.servers.every(server => !server.connected && server.tools.length === 0), true); assert.equal(calls.length, 0); assert.equal(transportOptions.length, 0); assert.deepEqual(await readEvents(), []);
    for (const server of status.servers) await assert.rejects(stat(server.prepare.dependenciesDirectory), { code: 'ENOENT' });
  }
});

test('persisted disabled music settings retain executable paths port and revision after restart', async t => {
  const first = await harness(t, { configured: false }); const initial = await first.manager.config();
  const executable = path.join(first.directory, 'cloudmusic.exe'); await writeFile(executable, 'test-only-file');
  const saved = await first.manager.configure({ revision: initial.revision, pythonExecutable: process.execPath, cloudmusicExecutable: executable, cdpPort: 9234, neteaseEnabled: false, qqmusicEnabled: false });
  const bytes = await readFile(first.manager.configFile, 'utf8'); await first.manager.close();
  const restarted = await harness(t, { dataDir: first.directory, configured: false, platform: 'linux' });
  assert.deepEqual(await restarted.manager.config(), saved); assert.equal(await readFile(restarted.manager.configFile, 'utf8'), bytes);
  const status = await restarted.manager.status(); assert.equal(status.servers.every(server => !server.enabled && !server.connected), true);
  await assert.rejects(restarted.manager.call(command('qqmusic', 'search', { keyword: 'Synthetic' })), { code: 'disabled' });
  assert.equal(restarted.calls.length, 0); assert.equal(restarted.transportOptions.length, 0);
});

test('enabled music defaults lazily connect on the first tool call without implicit dependency preparation', async t => {
  const { manager, calls, transportOptions, readEvents } = await harness(t, { configured: false });
  const initial = await manager.config(); const configured = await manager.configure({ revision: initial.revision, pythonExecutable: process.execPath });
  assert.equal(configured.neteaseEnabled, true); assert.equal(configured.qqmusicEnabled, true); assert.equal(calls.length, 0); assert.equal(transportOptions.length, 0);
  assert.equal((await manager.call(command('netease', 'search_music', { query: 'Synthetic' }))).ok, true);
  assert.equal((await manager.call(command('qqmusic', 'search', { keyword: 'Synthetic' }))).ok, true);
  assert.equal(transportOptions.length, 2); assert.equal(calls.length, 2); assert.equal(calls.every(call => call.args.length === 1 && call.args[0] === '--version'), true);
  assert.deepEqual(await manager.config(), configured); assert.equal((await readEvents()).filter(event => event.method === 'tools/call').length, 2);
});

test('real SDK stdio initializes, lists actual tools and calls them while excluding unsafe tools', async t => {
  const { manager, transportOptions, readEvents } = await harness(t);
  const server = await manager.connect('netease'); assert.equal(server.connected, true); assert.deepEqual(server.tools.map(tool => tool.name), ['get_netease_status', 'search_music', 'set_netease_volume']);
  assert.equal((await manager.call(command('netease', 'search_music', { query: '晴天', kind: 'song', limit: 5 }))).ok, true);
  const events = await readEvents(); assert.deepEqual(events.slice(0, 3).map(value => value.method), ['initialize', 'notifications/initialized', 'tools/list']); assert.equal(events.filter(value => value.method === 'tools/call').length, 1);
  assert.ok(transportOptions[0].args.at(-1).endsWith(path.join('music-mcp', 'netease', 'server.py'))); assert.equal(transportOptions[0].args[0], '-S'); assert.equal(transportOptions[0].args[3], MUSIC_MCP_BOOTSTRAP); assert.equal(transportOptions[0].args[4], transportOptions[0].env.PYTHONPATH); assert.equal(transportOptions[0].env.CLOUDMUSIC_CDP_PORT, '9223'); assert.equal(transportOptions[0].env.CLOUDMUSIC_EXE, undefined);
});

test('actual discovered JSON schema rejects unknown fields, wrong types and bounds before tools/call', async t => {
  const { manager, readEvents } = await harness(t); await manager.connect('netease');
  for (const args of [{}, { query: 2 }, { query: 'song', kind: 'mv' }, { query: 'song', limit: 11 }, { query: 'song', shell: 'cmd' }]) await assert.rejects(manager.call(command('netease', 'search_music', args)), { status: 400 });
  await assert.rejects(manager.call(command('netease', 'set_netease_volume', { percent: 101 })), { status: 400 });
  assert.equal((await readEvents()).some(value => value.method === 'tools/call'), false); assert.equal((await manager.status()).servers.find(server => server.id === 'netease').connected, true);
});

test('QQ error text and upstream errors remain failures; returned URL never implies playback', async t => {
  const { manager } = await harness(t); await manager.connect('qqmusic');
  for (const keyword of ['error', 'protocol-error', 'structured-error']) { const result = await manager.call(command('qqmusic', 'search', { keyword })); assert.equal(result.ok, false); assert.equal(result.playbackStarted, false); }
  const result = await manager.call(command('qqmusic', 'url', { mid: 'song123', quality: 'high' })); assert.equal(result.ok, true); assert.equal(result.playbackStarted, false); assert.equal(result.url, 'https://stream.example.test/song.mp3?token=public-stream');
});

test('Ubuntu rejects NetEase upstream without spawn while QQ remains supported', async t => {
  const { manager, calls, transportOptions } = await harness(t, { platform: 'linux' });
  assert.equal((await manager.status()).servers.find(server => server.id === 'netease').platformSupported, false);
  await assert.rejects(manager.connect('netease'), { code: 'unsupported_platform' }); await assert.rejects(manager.call(command('netease', 'get_netease_status')), { code: 'unsupported_platform' }); await assert.rejects(manager.prepare({ player: 'netease' }), { code: 'unsupported_platform' });
  assert.equal(calls.length, 0); assert.equal(transportOptions.length, 0); assert.equal((await manager.connect('qqmusic')).connected, true);
});

test('subprocess environment excludes LLM/central/proxy values and profiles isolate credential metadata', async t => {
  const first = await harness(t, { scope: 'account-one' }); const second = await harness(t, { scope: 'account-two', dataDir: first.directory });
  await first.manager.connect('qqmusic'); await second.manager.connect('qqmusic');
  const params = first.transportOptions[0]; assert.equal(params.env.OPENAI_API_KEY, undefined); assert.equal(params.env.PETPAL_ADMIN_TOKEN, undefined); assert.equal(params.env.HTTP_PROXY, undefined); assert.equal(params.env.PYTHONPATH.includes('global-python'), false); assert.equal(params.env.HOME, params.cwd); assert.notEqual(params.cwd, second.transportOptions[0].cwd);
  await writeFile(path.join(params.cwd, 'credential.json'), '{"secret":"private-account-one"}');
  const firstState = (await first.manager.status()).servers.find(server => server.id === 'qqmusic'); const secondState = (await second.manager.status()).servers.find(server => server.id === 'qqmusic');
  assert.equal(firstState.credentialConfigured, true); assert.equal(secondState.credentialConfigured, false); assert.equal(JSON.stringify(firstState).includes('private-account-one'), false); assert.equal(firstState.loginDirectory, params.cwd);
  const env = isolatedMusicMcpEnvironment(envSecrets, { profile: params.cwd, dependenciesDirectory: '/private/deps', qqSourceDirectory: '/fixed/qq/src', config: { cdpPort: 9224, cloudmusicExecutable: 'C:\\Music\\cloudmusic.exe' }, player: 'netease' });
  assert.equal(env.CLOUDMUSIC_CDP_PORT, '9224'); assert.equal(env.CLOUDMUSIC_EXE, 'C:\\Music\\cloudmusic.exe'); assert.equal(env.PYTHONUTF8, '0'); assert.equal(env.PYTHONIOENCODING, 'utf-8'); assert.equal(params.env.PYTHONUTF8, '1');
  await second.manager.close();
});

test('fixed prepare command uses private pip target and copies QQ login script without reading credentials', async t => {
  const { manager, calls, transportOptions } = await harness(t);
  await assert.rejects(manager.prepare({ player: 'qqmusic', requirements: ['evil'] }), { status: 400 });
  const result = await manager.prepare({ player: 'qqmusic' }); assert.equal(result.ok, true); assert.deepEqual(result.requirements, MUSIC_MCP_REQUIREMENTS); assert.equal(transportOptions.length, 0);
  const install = calls.find(value => value.args.includes('pip')), target = install.args[install.args.indexOf('--target') + 1]; assert.notEqual(target, result.dependenciesDirectory); assert.match(path.basename(target), /^dependencies\.[a-f0-9-]{36}\.preparing$/); assert.deepEqual(install.args, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--index-url', 'https://pypi.org/simple', '--timeout', '20', '--retries', '2', '--target', target, ...MUSIC_MCP_REQUIREMENTS]); assert.equal(install.options.shell, false); assert.equal(install.options.cwd, result.loginDirectory); assert.equal(install.options.env.HTTP_PROXY, undefined); assert.equal(install.options.env.PYTHONPATH.split(path.delimiter)[0], target);
  const verification = calls.find(value => value.args.includes('-c')); assert.equal(verification.args[0], '-S'); assert.match(verification.args[2], /site\.addsitedir\(sys\.argv\[1\]\)/); assert.equal(verification.args[3], target);
  assert.deepEqual(result.loginCommand, { command: process.execPath, args: ['-S', '-u', '-c', MUSIC_MCP_BOOTSTRAP, result.dependenciesDirectory, result.loginScript], cwd: result.loginDirectory });
  assert.equal(manager.prepareTimeoutMs, 600000); assert.equal((await readdir(result.loginDirectory)).some(name => name.endsWith('.preparing') || name.endsWith('.previous') || name === 'prepare.lock'), false);
  assert.match(await readFile(result.loginScript, 'utf8'), /os\.path\.dirname\(__file__\)/); await assert.rejects(stat(path.join(result.loginDirectory, 'credential.json')), { code: 'ENOENT' });
});

test('configured Python minimum version is checked before launching any server', async t => {
  const { manager, transportOptions } = await harness(t, { version: 'Python 3.9.19' }); await assert.rejects(manager.connect('qqmusic'), { code: 'python_unavailable' }); assert.equal(transportOptions.length, 0);
});

test('another instance changes persisted revision and invalidates connected clients before call', async t => {
  const first = await harness(t, { scope: 'same-pc-one' }); const second = await harness(t, { dataDir: first.directory, scope: 'same-pc-two' });
  await first.manager.connect('qqmusic'); const previous = await second.manager.config(); await second.manager.configure({ revision: previous.revision, cdpPort: 9224 });
  await assert.rejects(first.manager.call(command('qqmusic', 'search', { keyword: '晴天' })), { code: 'config_changed' }); assert.equal((await first.readEvents()).some(value => value.method === 'tools/call'), false); assert.equal((await first.manager.status()).servers.find(server => server.id === 'qqmusic').connected, false);
});

test('timeout cancels a pending stdio call and closes without automatically retrying', async t => {
  const { manager, readEvents } = await harness(t, { callTimeoutMs: 80 }); await manager.connect('qqmusic');
  await assert.rejects(manager.call(command('qqmusic', 'search', { keyword: 'hang' })), { code: 'timeout' }); assert.equal((await readEvents()).filter(value => value.method === 'tools/call').length, 1); assert.equal((await manager.status()).busy, false); assert.equal((await manager.status()).servers.find(server => server.id === 'qqmusic').connected, false);
});

test('AbortSignal and manager close terminate pending calls and clear busy state', async t => {
  const { manager, readEvents } = await harness(t); await manager.connect('qqmusic'); const controller = new AbortController();
  const running = manager.call(command('qqmusic', 'search', { keyword: 'hang' }), { signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 80)); assert.equal((await manager.status()).busy, true); controller.abort(); await assert.rejects(running, { name: 'AbortError' }); assert.equal((await readEvents()).filter(value => value.method === 'tools/call').length, 1);
  await manager.connect('qqmusic'); const closing = manager.call(command('qqmusic', 'search', { keyword: 'hang' })); const closedOutcome = closing.catch(error => error); await new Promise(resolve => setTimeout(resolve, 80)); await manager.close(); assert.equal((await closedOutcome).name, 'AbortError'); assert.equal(manager.busy, false); await assert.rejects(manager.status(), { code: 'closed' });
});

test('configuration changes cancel own pending sessions with a conflict', async t => {
  const { manager } = await harness(t); await manager.connect('qqmusic'); const config = await manager.config();
  const pending = manager.call(command('qqmusic', 'search', { keyword: 'hang' })); const outcome = pending.catch(error => error); await new Promise(resolve => setTimeout(resolve, 80));
  await manager.configure({ revision: config.revision, qqmusicEnabled: false }); assert.equal((await outcome).code, 'config_changed'); assert.equal((await manager.status()).servers.find(server => server.id === 'qqmusic').connected, false);
});

test('transport death, output limits and schema compilation failures fail safely without stderr leakage or retry', async t => {
  for (const keyword of ['die', 'large', 'stderr-large']) {
    const { manager, readEvents } = await harness(t); await manager.connect('qqmusic');
    await assert.rejects(manager.call(command('qqmusic', 'search', { keyword })), error => { assert.equal(error.message.includes('secret'), false); assert.ok([502, 504].includes(error.status)); return true; }); assert.equal((await readEvents()).filter(value => value.method === 'tools/call').length, 1);
  }
  const { manager } = await harness(t, { mode: 'bad-schema' }); await assert.rejects(manager.connect('qqmusic'), { status: 502 }); assert.equal((await manager.status()).servers.find(server => server.id === 'qqmusic').connected, false);
});

test('initialization timeout and a pre-aborted request do not create a usable session', async t => {
  const { manager, transportOptions } = await harness(t, { mode: 'initialize-hang', connectTimeoutMs: 100 });
  await assert.rejects(manager.connect('qqmusic', { signal: AbortSignal.abort() }), { name: 'AbortError' }); assert.equal(transportOptions.length, 0);
  await assert.rejects(manager.connect('qqmusic'), { code: 'timeout' }); assert.equal((await manager.status()).servers.find(server => server.id === 'qqmusic').connected, false);
});

test('cancellation during delayed Python probing waits for child exit and cannot later start stdio', async t => {
  const calls = []; let killed = 0, exited = false;
  const delayedSpawn = (command, args) => {
    calls.push({ command, args }); const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const version = setTimeout(() => { child.stdout.end('Python 3.11.9\n'); child.emit('close', 0); }, 250);
    child.kill = () => { killed++; clearTimeout(version); setTimeout(() => { exited = true; child.emit('close', 0); }, 40); return true; }; return child;
  };
  const { manager, transportOptions } = await harness(t, { spawn: delayedSpawn }); const controller = new AbortController();
  const pending = manager.connect('qqmusic', { signal: controller.signal }); const outcome = pending.catch(error => error); await new Promise(resolve => setTimeout(resolve, 50)); controller.abort();
  assert.equal((await outcome).name, 'AbortError'); assert.equal(exited, true); assert.equal(killed, 1); assert.equal(manager.children.size, 0); assert.equal(transportOptions.length, 0);
  await new Promise(resolve => setTimeout(resolve, 280)); assert.equal(calls.length, 1); assert.equal(transportOptions.length, 0);
});

test('close cancels fixed pip preparation and waits for its child before returning', async t => {
  const calls = []; let started, killed = false, exited = false; const pipStarted = new Promise(resolve => { started = resolve; });
  const spawn = (command, args) => {
    calls.push({ command, args }); const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { killed = true; setTimeout(() => { exited = true; child.emit('close', 0); }, 40); return true; };
    if (args[0] === '--version') setImmediate(() => { child.stdout.end('Python 3.11.9\n'); child.emit('close', 0); }); else started();
    return child;
  };
  const { manager, transportOptions } = await harness(t, { spawn }); const pending = manager.prepare({ player: 'qqmusic' }); const outcome = pending.catch(error => error); await pipStarted;
  await manager.close(); assert.equal((await outcome).name, 'AbortError'); assert.equal(killed, true); assert.equal(exited, true); assert.equal(manager.children.size, 0); assert.equal(manager.busy, false); assert.equal(transportOptions.length, 0); assert.equal(calls.length, 2);
});

test('QQ bootstrap uses fixed module code and argument paths without path interpolation', async t => {
  const { manager, transportOptions } = await harness(t); await manager.connect('qqmusic'); const params = transportOptions[0];
  assert.deepEqual(params.args, ['-S', '-u', '-c', MUSIC_MCP_MODULE_BOOTSTRAP, path.join(params.cwd, 'dependencies'), 'mcp_qqmusic']); assert.equal(params.args[3].includes(params.cwd), false); assert.equal(params.maxBufferSize, 262144 + 8192);
});

test('explicit disconnect cancels pending work before a late connection can appear', async t => {
  const { manager, transportOptions } = await harness(t, { mode: 'initialize-hang' }); const pending = manager.connect('qqmusic'); const outcome = pending.catch(error => error);
  await new Promise(resolve => setTimeout(resolve, 80)); const result = await manager.disconnect('qqmusic'); assert.equal(result.connected, false); assert.equal((await outcome).name, 'AbortError'); assert.equal(manager.busy, false); assert.equal(transportOptions.length, 1);
  assert.equal((await manager.status()).servers.find(server => server.id === 'qqmusic').connected, false);
});

function transactionalSpawn({ mode = 'success', calls = [], started = () => {} } = {}) {
  let generation = 0;
  return (command, args, options) => {
    calls.push({ command, args, options }); const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { setTimeout(() => child.emit('close', 0), 20); return true; };
    const finish = (output, code = 0) => { child.stdout.end(`${output}\n`); child.stderr.end(); child.emit('close', code); };
    setImmediate(async () => {
      if (args[0] === '--version') { finish('Python 3.11.9'); return; }
      if (args.includes('pip')) {
        const target = args[args.indexOf('--target') + 1]; await writeFile(path.join(target, `complete-${++generation}.txt`), 'new dependency set'); started(target);
        if (mode === 'hang') return;
        finish('dependency install', mode === 'install-failure' ? 1 : 0); return;
      }
      finish(mode === 'verification-failure' ? 'WRONG_IMPORTS' : 'MUSIC_MCP_DEPS_OK');
    });
    return child;
  };
}
async function seededDependencies(manager) {
  const server = (await manager.status()).servers.find(value => value.id === 'qqmusic'), directory = server.prepare.dependenciesDirectory;
  await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, 'old-only.txt'), 'previous valid dependency set');
  await writeFile(path.join(server.loginDirectory, 'credential.json'), '{"private":"untouched"}');
  return { directory, profile: server.loginDirectory };
}
async function cleanPreparation(profile) {
  assert.equal((await readdir(profile)).some(name => name.endsWith('.preparing') || name.endsWith('.previous') || name === 'prepare.lock' || name.endsWith('.tmp')), false);
}

test('fresh verified dependency staging atomically replaces old packages on repeated prepare', async t => {
  const calls = [], { manager } = await harness(t, { spawn: transactionalSpawn({ calls }) }); const { directory, profile } = await seededDependencies(manager);
  await manager.prepare({ player: 'qqmusic' }); assert.deepEqual(await readdir(directory), ['complete-1.txt']); await cleanPreparation(profile);
  await manager.prepare({ player: 'qqmusic' }); assert.deepEqual(await readdir(directory), ['complete-2.txt']); await cleanPreparation(profile);
  assert.equal(await readFile(path.join(profile, 'credential.json'), 'utf8'), '{"private":"untouched"}');
  const targets = calls.filter(value => value.args.includes('pip')).map(value => value.args[value.args.indexOf('--target') + 1]); assert.equal(targets.length, 2); assert.notEqual(targets[0], targets[1]); assert.ok(targets.every(target => target !== directory));
});

test('failed install or import verification preserves old dependency set and removes staging', async t => {
  for (const mode of ['install-failure', 'verification-failure']) {
    const { manager } = await harness(t, { spawn: transactionalSpawn({ mode }) }); const { directory, profile } = await seededDependencies(manager);
    await assert.rejects(manager.prepare({ player: 'qqmusic' }), { code: mode === 'install-failure' ? 'runtime_error' : 'dependencies_unavailable' });
    assert.deepEqual(await readdir(directory), ['old-only.txt']); assert.equal(await readFile(path.join(directory, 'old-only.txt'), 'utf8'), 'previous valid dependency set'); assert.equal(await readFile(path.join(profile, 'credential.json'), 'utf8'), '{"private":"untouched"}'); await cleanPreparation(profile);
  }
});

test('cancelled dependency preparation leaves the old set intact and removes partial staging', async t => {
  let started; const begin = new Promise(resolve => { started = resolve; }); const calls = [];
  const { manager } = await harness(t, { spawn: transactionalSpawn({ mode: 'hang', calls, started }) }); const { directory, profile } = await seededDependencies(manager);
  const controller = new AbortController(), pending = manager.prepare({ player: 'qqmusic' }, { signal: controller.signal }), outcome = pending.catch(error => error);
  const staging = await begin; assert.notEqual(staging, directory); controller.abort(); assert.equal((await outcome).name, 'AbortError'); assert.deepEqual(await readdir(directory), ['old-only.txt']); await cleanPreparation(profile); assert.equal(calls.filter(value => value.args.includes('pip')).length, 1);
});

test('same-profile manager instances cannot prepare the dependency directory concurrently', async t => {
  let started; const begin = new Promise(resolve => { started = resolve; });
  const first = await harness(t, { scope: 'shared-profile', spawn: transactionalSpawn({ mode: 'hang', started }) }); const second = await harness(t, { scope: 'shared-profile', dataDir: first.directory });
  const controller = new AbortController(), pending = first.manager.prepare({ player: 'qqmusic' }, { signal: controller.signal }), outcome = pending.catch(error => error); await begin;
  await assert.rejects(second.manager.prepare({ player: 'qqmusic' }), { code: 'prepare_busy' }); controller.abort(); assert.equal((await outcome).name, 'AbortError'); await second.manager.close();
  const server = (await first.manager.status()).servers.find(value => value.id === 'qqmusic'); await cleanPreparation(server.loginDirectory);
});

test('Windows transient directory locks retry promotion only and retain one installation', async t => {
  const calls = []; let attempts = 0;
  const renameDirectory = async (source, target) => {
    if (source.endsWith('.preparing') && ++attempts <= 2) throw Object.assign(new Error('temporary Windows handle'), { code: attempts === 1 ? 'EPERM' : 'EBUSY' });
    return rename(source, target);
  };
  const { manager } = await harness(t, { renameDirectory, spawn: transactionalSpawn({ calls }) }); const { directory, profile } = await seededDependencies(manager);
  assert.equal((await manager.prepare({ player: 'qqmusic' })).ok, true); assert.equal(attempts, 3); assert.deepEqual(await readdir(directory), ['complete-1.txt']); assert.equal(calls.filter(value => value.args.includes('pip')).length, 1); await cleanPreparation(profile);
});

test('Windows persistent promotion lock exhausts bounded retries and restores previous dependencies', async t => {
  const calls = []; let attempts = 0;
  const renameDirectory = async (source, target) => { if (source.endsWith('.preparing')) { attempts++; throw Object.assign(new Error('persistent Windows handle'), { code: 'EPERM' }); } return rename(source, target); };
  const { manager } = await harness(t, { renameDirectory, spawn: transactionalSpawn({ calls }) }); const { directory, profile } = await seededDependencies(manager);
  await assert.rejects(manager.prepare({ player: 'qqmusic' }), { code: 'upstream_error' }); assert.equal(attempts, 8); assert.deepEqual(await readdir(directory), ['old-only.txt']); assert.equal(calls.filter(value => value.args.includes('pip')).length, 1); await cleanPreparation(profile);
});

test('another same-profile connection cannot recreate dependencies during preparation', async t => {
  let started; const begin = new Promise(resolve => { started = resolve; });
  const first = await harness(t, { scope: 'connection-during-prepare', spawn: transactionalSpawn({ mode: 'hang', started }) }); const second = await harness(t, { scope: 'connection-during-prepare', dataDir: first.directory });
  const { prepare: recipe } = (await first.manager.status()).servers.find(server => server.id === 'qqmusic'); await first.manager._directories('qqmusic'); await assert.rejects(stat(recipe.dependenciesDirectory), { code: 'ENOENT' });
  const controller = new AbortController(), pending = first.manager.prepare({ player: 'qqmusic' }, { signal: controller.signal }), outcome = pending.catch(error => error); await begin;
  await assert.rejects(second.manager.connect('qqmusic'), { code: 'prepare_busy' }); await assert.rejects(stat(recipe.dependenciesDirectory), { code: 'ENOENT' }); assert.equal(second.transportOptions.length, 0);
  controller.abort(); assert.equal((await outcome).name, 'AbortError'); await second.manager.close();
});

const deadOwnerPid = 2147483000;
const knownProcessState = pid => pid === deadOwnerPid ? false : true;
async function writeRecoveryReceipt(manager, kind, patch = {}) {
  const player = kind === 'prepare' ? 'qqmusic' : undefined;
  if (player) await manager._directories(player);
  const info = manager._lockInfo(kind, player), receipt = { ...manager._newLockReceipt(kind, player), ownerPid: deadOwnerPid, ...patch };
  const bytes = `${JSON.stringify(receipt)}\n`; await writeFile(info.file, bytes);
  return { info, receipt, bytes };
}

test('config lock with a certainly dead owner recovers without running Python or changing unrelated fields', async t => {
  const { manager, calls } = await harness(t, { processExists: knownProcessState }); const config = await manager.config();
  const { info } = await writeRecoveryReceipt(manager, 'config'); const saved = await manager.configure({ revision: config.revision, cdpPort: 9230 });
  assert.equal(saved.cdpPort, 9230); assert.equal(saved.pythonExecutable, config.pythonExecutable); assert.notEqual(saved.revision, config.revision); await assert.rejects(stat(info.file), { code: 'ENOENT' }); assert.equal(calls.length, 0);
  assert.equal((await readdir(manager.dataDir)).some(name => name.endsWith('.recovering')), false);
});

test('active or indeterminate owner and reused live PID leave lock and dependencies intact', async t => {
  for (const processExists of [() => true, () => undefined]) {
    const { manager, calls } = await harness(t, { processExists }); const { directory } = await seededDependencies(manager);
    const { info, bytes } = await writeRecoveryReceipt(manager, 'prepare', { ownerPid: process.pid, phase: 'installing', hadPrevious: true });
    await assert.rejects(manager._acquireLock('prepare', 'qqmusic'), { code: 'prepare_busy' }); assert.equal(await readFile(info.file, 'utf8'), bytes); assert.deepEqual(await readdir(directory), ['old-only.txt']); assert.equal(calls.length, 0);
  }
});

test('dead prepare journal restores previous dependencies after the rename gap and never promotes staging', async t => {
  const { manager, calls } = await harness(t, { processExists: knownProcessState }); const { directory, profile } = await seededDependencies(manager); await writeFile(path.join(profile, 'login.py'), 'existing login script');
  const { info, receipt } = await writeRecoveryReceipt(manager, 'prepare', { phase: 'promoting', hadPrevious: true }), transaction = manager._dependencyTransactionPaths('qqmusic', receipt.nonce);
  await rename(directory, transaction.previous); await mkdir(transaction.staging); await writeFile(path.join(transaction.staging, 'never-promote.txt'), 'unverified pending installation');
  const acquired = await manager._acquireLock('prepare', 'qqmusic'); assert.deepEqual(await readdir(directory), ['old-only.txt']); await assert.rejects(stat(transaction.staging), { code: 'ENOENT' }); await assert.rejects(stat(transaction.previous), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(profile, 'credential.json'), 'utf8'), '{"private":"untouched"}'); assert.equal(await readFile(path.join(profile, 'login.py'), 'utf8'), 'existing login script'); assert.equal(calls.length, 0);
  assert.equal((await manager._readLock(info)).ownerPid, process.pid); await manager._releaseLock(acquired.info, acquired.receipt); await cleanPreparation(profile);
});

test('dead pre-commit journal rolls back a promoted candidate to known previous dependencies', async t => {
  const { manager } = await harness(t, { processExists: knownProcessState }); const { directory, profile } = await seededDependencies(manager);
  const { receipt } = await writeRecoveryReceipt(manager, 'prepare', { phase: 'promoting', hadPrevious: true }), transaction = manager._dependencyTransactionPaths('qqmusic', receipt.nonce);
  await rename(directory, transaction.previous); await mkdir(directory); await writeFile(path.join(directory, 'new-candidate.txt'), 'candidate already promoted before crash');
  const acquired = await manager._acquireLock('prepare', 'qqmusic'); assert.deepEqual(await readdir(directory), ['old-only.txt']); await manager._releaseLock(acquired.info, acquired.receipt); await cleanPreparation(profile);
});

test('dead installing journal discards only its fixed partial directory and preserves credentials', async t => {
  const { manager } = await harness(t, { processExists: knownProcessState }); const { directory, profile } = await seededDependencies(manager);
  const { receipt } = await writeRecoveryReceipt(manager, 'prepare', { phase: 'installing', hadPrevious: true }), transaction = manager._dependencyTransactionPaths('qqmusic', receipt.nonce);
  await mkdir(transaction.staging); await writeFile(path.join(transaction.staging, 'partial.txt'), 'incomplete'); await writeFile(path.join(profile, 'unrelated.txt'), 'keep');
  const acquired = await manager._acquireLock('prepare', 'qqmusic'); assert.deepEqual(await readdir(directory), ['old-only.txt']); assert.equal(await readFile(path.join(profile, 'unrelated.txt'), 'utf8'), 'keep'); assert.equal(await readFile(path.join(profile, 'credential.json'), 'utf8'), '{"private":"untouched"}'); await manager._releaseLock(acquired.info, acquired.receipt); await cleanPreparation(profile);
});

test('committed dead journal keeps the new active set and cleans only the known previous directory', async t => {
  const { manager } = await harness(t, { processExists: knownProcessState }); const { directory, profile } = await seededDependencies(manager);
  const { receipt } = await writeRecoveryReceipt(manager, 'prepare', { phase: 'committed', hadPrevious: true }), transaction = manager._dependencyTransactionPaths('qqmusic', receipt.nonce);
  await rename(directory, transaction.previous); await mkdir(directory); await writeFile(path.join(directory, 'committed.txt'), 'verified active set');
  const acquired = await manager._acquireLock('prepare', 'qqmusic'); assert.deepEqual(await readdir(directory), ['committed.txt']); await assert.rejects(stat(transaction.previous), { code: 'ENOENT' }); await manager._releaseLock(acquired.info, acquired.receipt); await cleanPreparation(profile);
});

test('empty, damaged, oversized and cross-scope lock receipts fail closed without mutation', async t => {
  const { manager, calls } = await harness(t, { processExists: knownProcessState }); const { directory, profile } = await seededDependencies(manager), info = manager._lockInfo('prepare', 'qqmusic');
  const valid = { ...manager._newLockReceipt('prepare', 'qqmusic'), ownerPid: deadOwnerPid, phase: 'installing', hadPrevious: true };
  for (const bytes of ['', '{broken', 'x'.repeat(4097), JSON.stringify({ ...valid, scope: 'other-account' }), JSON.stringify({ ...valid, staging: 'C:\\unrelated' }), JSON.stringify({ ...valid, nonce: '../../outside' })]) {
    await writeFile(info.file, bytes); await assert.rejects(manager._acquireLock('prepare', 'qqmusic'), error => { assert.equal(error.code, 'unknown_lock'); assert.match(error.message, /改名备份/); assert.match(error.message, /credential\.json/); return true; });
    assert.equal(await readFile(info.file, 'utf8'), bytes); assert.deepEqual(await readdir(directory), ['old-only.txt']); assert.equal(await readFile(path.join(profile, 'credential.json'), 'utf8'), '{"private":"untouched"}');
  }
  assert.equal(calls.length, 0);
});

test('empty legacy config lock remains unchanged and gives a specific manual recovery path', async t => {
  const { manager } = await harness(t, { processExists: knownProcessState }); const config = await manager.config(), info = manager._lockInfo('config'); await writeFile(info.file, '');
  await assert.rejects(manager.configure({ revision: config.revision, cdpPort: 9231 }), error => { assert.equal(error.code, 'unknown_lock'); assert.ok(error.message.includes(info.file)); assert.match(error.message, /停止/); assert.match(error.message, /改名备份/); return true; }); assert.equal((await stat(info.file)).size, 0); assert.equal((await manager.config()).revision, config.revision);
});

test('ambiguous prepare journal preserves all directories and never chooses an unknown active candidate', async t => {
  const { manager } = await harness(t, { processExists: knownProcessState }); const { directory, profile } = await seededDependencies(manager);
  const { info, receipt, bytes } = await writeRecoveryReceipt(manager, 'prepare', { phase: 'promoting', hadPrevious: true }), transaction = manager._dependencyTransactionPaths('qqmusic', receipt.nonce);
  await mkdir(transaction.previous); await writeFile(path.join(transaction.previous, 'known-backup.txt'), 'preserve'); await mkdir(transaction.staging); await writeFile(path.join(transaction.staging, 'pending.txt'), 'preserve');
  await assert.rejects(manager._acquireLock('prepare', 'qqmusic'), { code: 'unknown_lock' }); assert.equal(await readFile(info.file, 'utf8'), bytes); assert.deepEqual(await readdir(directory), ['old-only.txt']); assert.equal(await readFile(path.join(transaction.previous, 'known-backup.txt'), 'utf8'), 'preserve'); assert.equal(await readFile(path.join(transaction.staging, 'pending.txt'), 'utf8'), 'preserve'); assert.equal(await readFile(path.join(profile, 'credential.json'), 'utf8'), '{"private":"untouched"}');
});

test('recovery contenders cannot remove a newly acquired active owner lock', async t => {
  const first = await harness(t, { scope: 'recovery-contenders', processExists: knownProcessState }); const second = await harness(t, { scope: 'recovery-contenders', dataDir: first.directory, processExists: knownProcessState });
  await writeRecoveryReceipt(first.manager, 'prepare', { phase: 'claimed' });
  const outcomes = await Promise.allSettled([first.manager._acquireLock('prepare', 'qqmusic'), second.manager._acquireLock('prepare', 'qqmusic')]); assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1);
  const index = outcomes.findIndex(value => value.status === 'fulfilled'), owner = index === 0 ? first.manager : second.manager, acquired = outcomes[index].value;
  assert.equal((await owner._readLock(acquired.info)).nonce, acquired.receipt.nonce); assert.equal((await owner._readLock(acquired.info)).ownerPid, process.pid); await owner._releaseLock(acquired.info, acquired.receipt); await second.manager.close();
});

test('delayed connect recovery rejects a replacement live prepare lock without starting Python or stdio', async t => {
  const { manager, calls, transportOptions } = await harness(t, { processExists: knownProcessState }); await seededDependencies(manager); const { info } = await writeRecoveryReceipt(manager, 'prepare', { phase: 'installing', hadPrevious: true });
  const recover = manager._recoverDeadLock; let entered, resume; const paused = new Promise(resolve => { entered = resolve; }), released = new Promise(resolve => { resume = resolve; });
  manager._recoverDeadLock = async function(currentInfo, receipt) { entered(); await released; return recover.call(this, currentInfo, receipt); };
  const pending = manager.connect('qqmusic'), outcome = pending.catch(error => error); await paused;
  const replacement = { ...manager._newLockReceipt('prepare', 'qqmusic'), phase: 'installing', hadPrevious: true }, bytes = `${JSON.stringify(replacement)}\n`; await writeFile(info.file, bytes); resume();
  assert.equal((await outcome).code, 'prepare_busy'); assert.equal(calls.length, 0); assert.equal(transportOptions.length, 0); assert.equal(await readFile(info.file, 'utf8'), bytes);
});
