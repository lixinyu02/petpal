import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ComputerUseMcpManager, COMPUTER_USE_TOOL_NAMES, COMPUTER_USE_PROFILE_TOOLS, validateComputerUseCall, validateComputerUseTools, isolatedComputerUseEnvironment, linuxInputPreflight } from '../server/computer-use-mcp.mjs';

const command = (tool, args = {}) => ({ tool, arguments: args });
const runtime = { node: '22.20.0', napi: '10' };
const sourceEnv = { ...process.env, HOME: '/actual/home', USERPROFILE: 'C:\\Users\\actual', APPDATA: 'C:\\Users\\actual\\AppData\\Roaming', DISPLAY: ':0', XAUTHORITY: '/actual/home/.Xauthority', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus', XDG_RUNTIME_DIR: '/run/user/1000', OPENAI_API_KEY: 'llm-secret', PETPAL_TOKEN: 'account-secret', HTTP_PROXY: 'http://proxy-secret', NODE_OPTIONS: '--require=hostile.cjs', COMPUTER_USE_NATIVE_PATH: '/malicious.so', COMPUTER_USE_PROFILE: 'malicious', COMPUTER_USE_APPROVAL_TOKEN: 'authority-secret' };
const fixtureTools = [
  { name: 'discover_applications', description: 'Discover installed applications.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, additionalProperties: true } },
  { name: 'screenshot', description: 'Capture image.', inputSchema: { type: 'object', properties: { width: { type: 'integer', minimum: 1 }, quality: { type: 'integer', minimum: 0, maximum: 100 }, target_app: { type: 'string' }, target_window_id: { type: 'integer' }, show_agent_pointer: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'zoom', description: 'Capture a region.', inputSchema: { type: 'object', properties: { region: { type: 'array', items: { type: 'integer' }, minItems: 4, maxItems: 4 }, quality: { type: 'integer' } }, required: ['region'] } },
  { name: 'type', description: 'Type text.', inputSchema: { type: 'object', properties: { text: { type: 'string' }, target_window_id: { type: 'integer' }, focus_strategy: { type: 'string', enum: ['strict', 'best_effort', 'none', 'prepare_display'] }, approval_token: { type: 'string' } }, required: ['text'] } },
  { name: 'fill_form', description: 'Fill fields.', inputSchema: { type: 'object', properties: { fields: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' } }, required: ['label', 'value'] } } }, required: ['fields'] } },
  { name: 'run_script', description: 'Run a script.', inputSchema: { type: 'object', properties: { language: { type: 'string', enum: ['powershell', 'bash'] }, script: { type: 'string' }, approval_token: { type: 'string' } }, required: ['language', 'script'] } },
  { name: 'openai_computer', description: 'OpenAI compatibility action envelope.', inputSchema: { type: 'object', properties: { action: { type: 'object', properties: { type: { type: 'string' }, action: { type: 'string' } }, additionalProperties: {} }, actions: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, action: { type: 'string' } }, additionalProperties: {} } }, width: { type: 'integer', minimum: 1 }, quality: { type: 'integer', minimum: 0, maximum: 100 }, target_window_id: { type: 'integer' }, target_app: { type: 'string' }, focus_strategy: { type: 'string' }, return_screenshot: { type: 'boolean' }, use_virtual_pointer: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'untrusted_custom_tool', description: 'Unknown tool.', inputSchema: { type: 'object' } },
];
// A real stdio JSON-RPC peer, deliberately independent from the SDK server.
// It records only synthetic test arguments, never accesses native desktop state.
const fixture = `
import readline from 'node:readline';
import {appendFileSync} from 'node:fs';
const [events, mode, serialized] = process.argv.slice(1);
const tools = JSON.parse(serialized);
for await (const line of readline.createInterface({input:process.stdin})) {
 let message; try {message=JSON.parse(line)} catch {continue}
 appendFileSync(events,JSON.stringify({method:message.method,params:message.params})+'\\n');
 const send=(result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result})+'\\n');
 if(message.method==='initialize') {if(mode==='init-exit') process.exit(4); send({protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'test-only',version:'1'}})}
 else if(message.method==='tools/list') send({tools});
 else if(message.method==='tools/call') {
   if(mode==='hang') continue;
   if(mode==='exit') process.exit(7);
   if(mode==='invalid-output') {send({content:[{type:'image',mimeType:'image/png',data:'bm90LWFuLWltYWdl'}]});continue}
   if(mode==='output-limit') {send({content:[{type:'text',text:'x'.repeat(65537)}]});continue}
   if(mode==='protocol-error') {process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-32603,message:'DO_NOT_EXPOSE_SECRET'}})+'\\n');continue}
   send({isError:mode==='tool-error',content:[{type:'text',text:JSON.stringify({name:message.params.name,arguments:message.params.arguments})}]});
 }
}`;
async function harness(t, { directory, scope = 'account-one', mode = 'normal', tools = fixtureTools, enabled = true, withoutCompatibleNative = false, ...options } = {}) {
  const ownDirectory = !directory; directory ||= await mkdtemp(path.join(os.tmpdir(), 'petpal-computer-mcp-'));
  const transports = [], parameters = [], events = path.join(directory, `${scope}.events.jsonl`);
  const manager = new ComputerUseMcpManager({ dataDir: directory, scope, platform: 'win32', arch: 'x64', versions: runtime, env: sourceEnv, connectTimeoutMs: 3000, callTimeoutMs: 2500, closeTimeoutMs: 5500,
    transportFactory: params => { parameters.push(params); const transport = new StdioClientTransport({ ...params, command: process.execPath, args: ['--input-type=module', '-e', fixture, events, mode, JSON.stringify(tools)] }); transports.push(transport); return transport; }, ...options });
  // Exercise upstream requirements independently of verified compatibility
  // artifacts present in the developer/package checkout. Other tests retain
  // the real native receipt and ELF/hash discovery path.
  if (withoutCompatibleNative) manager._compatibleNative = async () => null;
  t.after(async () => { await manager.close(); if (ownDirectory) await rm(directory, { recursive: true, force: true }); });
  const initial = await manager.config(); if (typeof enabled === 'boolean') await manager.configure({ revision: initial.revision, enabled });
  const readEvents = async () => { try { return (await readFile(events, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } };
  return { manager, parameters, transports, events, readEvents, directory };
}
async function nativeFixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'petpal-native-receipt-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'computer-use-napi.linux-x64.node'), binary = Buffer.alloc(64); binary.set(Buffer.from('7f454c46', 'hex')); binary[4] = 2; binary[5] = 1; binary.writeUInt16LE(62, 18); await writeFile(file, binary);
  const receipt = { version: '7.4.0', platform: 'linux', arch: 'x64', sourceCommit: 'cfbb6af0e704da17c43df6c668225a2f84aca762', nativeFile: path.basename(file), bytes: binary.length, sha256: createHash('sha256').update(binary).digest('hex'), minimumGlibc: '2.35', requiredGlibc: '2.34', source: { repository: 'https://github.com/zavora-ai/computer-use-mcp', commit: 'cfbb6af0e704da17c43df6c668225a2f84aca762', cargoLocked: true, modifiedTrackedSource: false } };
  await writeFile(path.join(directory, 'PROVENANCE.json'), JSON.stringify(receipt)); return { file, directory, receipt, binary };
}

test('fixed 70 tools and five profiles reject model-selected commands, policies and unbounded values', () => {
  assert.equal(COMPUTER_USE_TOOL_NAMES.length, 70); assert.equal(new Set(COMPUTER_USE_TOOL_NAMES).size, 70);
  assert.deepEqual(Object.fromEntries(Object.entries(COMPUTER_USE_PROFILE_TOOLS).map(([profile, names]) => [profile, names.length])), { core: 28, ax: 48, scripting: 31, 'windows-admin': 40, full: 70 });
  assert.deepEqual(validateComputerUseCall(command('type', { text: '你好' })), command('type', { text: '你好' }));
  for (const body of [null, [], command('discoverApplications'), command('custom'), { ...command('type'), command: 'npx' }, { ...command('type'), env: {} }, command('type', []), command('type', { text: 'x'.repeat(8193) }), command('type', { text: '猫'.repeat(2731) }), command('type', { nested: { approval_token: 'value' } }), command('type', JSON.parse('{"__proto__":{}}')), command('type', { value: NaN }), command('type', { value: Infinity }), command('type', { list: Array(101).fill('x') }), command('type', { a: 'x'.repeat(8192), b: 'x'.repeat(8192) })]) assert.throws(() => validateComputerUseCall(body), { status: 400 });
  assert.deepEqual(validateComputerUseTools(), {}); assert.deepEqual(validateComputerUseTools({ tool: 'screenshot' }), { tool: 'screenshot' });
  for (const body of [[], null, { tool: 'unknown' }, { tool: 'type', env: {} }]) assert.throws(() => validateComputerUseTools(body), { status: 400 });
});

test('status and config are passive, default enabled, CAS private, and reject executable/native/environment configuration', async t => {
  const { manager, parameters, directory } = await harness(t, { enabled: null }); const initial = await manager.config();
  assert.deepEqual({ ...initial, revision: 'UUID' }, { revision: 'UUID', enabled: true, profile: 'full' });
  const status = await manager.status(); assert.equal(status.connected, false); assert.equal(status.toolsCount, 0); assert.equal(status.version, '7.4.0'); assert.equal(parameters.length, 0);
  for (const body of [{ enabled: true }, { revision: initial.revision, enabled: 'true' }, { revision: initial.revision, profile: 'all' }, { revision: initial.revision, command: 'npx' }, { revision: initial.revision, nativeModulePath: '/anything' }, { revision: initial.revision, approval_token: 'private' }, { revision: initial.revision, env: {} }]) await assert.rejects(manager.configure(body), { status: 400 });
  const saved = await manager.configure({ revision: initial.revision, enabled: false }); assert.notEqual(saved.revision, initial.revision);
  assert.equal((await manager.status()).message, '电脑操作已关闭。'); await assert.rejects(manager.connect(), { code: 'disabled' }); assert.equal(parameters.length, 0);
  await assert.rejects(manager.configure({ revision: initial.revision, profile: 'core' }), { code: 'config_changed' });
  const settled = await Promise.allSettled([manager.configure({ revision: saved.revision, profile: 'core' }), manager.configure({ revision: saved.revision, profile: 'ax' })]);
  assert.equal(settled.filter(value => value.status === 'fulfilled').length, 1); assert.ok(['busy', 'config_changed'].includes(settled.find(value => value.status === 'rejected').reason.code));
  assert.equal((await readFile(manager.configFile, 'utf8')).includes('secret'), false); assert.equal((await readdir(directory)).includes('config.json'), false);
  if (process.platform !== 'win32') assert.equal((await stat(manager.configFile)).mode & 0o777, 0o600);
});

test('new desktop configurations enable only supported native platforms and architectures without connecting', async t => {
  for (const [platform, arch, enabled] of [['win32', 'x64', true], ['linux', 'arm64', true], ['darwin', 'arm64', true], ['freebsd', 'x64', false], ['win32', 'ia32', false], ['linux', 'arm', false]]) {
    const { manager, parameters, readEvents } = await harness(t, { enabled: null, platform, arch });
    const initial = await manager.config(), status = await manager.status();
    assert.equal(initial.enabled, enabled); assert.equal(status.readiness.supported, enabled); assert.deepEqual(status.config, initial);
    assert.equal(status.connected, false); assert.equal(status.toolsCount, 0); assert.equal(parameters.length, 0); assert.deepEqual(await readEvents(), []);
  }
});

test('persisted disabled computer configuration and profile survive manager restart unchanged', async t => {
  const first = await harness(t, { enabled: null }); const initial = await first.manager.config();
  const saved = await first.manager.configure({ revision: initial.revision, enabled: false, profile: 'ax' });
  const bytes = await readFile(first.manager.configFile, 'utf8'); await first.manager.close();
  const restarted = await harness(t, { directory: first.directory, enabled: null });
  assert.deepEqual(await restarted.manager.config(), saved); assert.equal(restarted.manager.configFile, first.manager.configFile);
  assert.equal(await readFile(restarted.manager.configFile, 'utf8'), bytes); assert.equal((await restarted.manager.status()).message, '电脑操作已关闭。');
  await assert.rejects(restarted.manager.call(command('discover_applications')), { code: 'disabled' }); assert.equal(restarted.parameters.length, 0);
});

test('new enabled computer configuration lazily connects on the first tool call and preserves revision', async t => {
  const { manager, parameters, readEvents } = await harness(t, { enabled: null }); const initial = await manager.config();
  assert.equal(parameters.length, 0); assert.equal((await manager.status()).connected, false);
  const result = await manager.call(command('discover_applications', { query: 'Synthetic' }));
  assert.equal(result.ok, true); assert.equal(parameters.length, 1); assert.deepEqual(await manager.config(), initial);
  assert.deepEqual((await readEvents()).map(event => event.method), ['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
});

test('concurrent first config/status requests share initialization instead of contending for own live lock', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'petpal-computer-initial-')); let spawned = 0;
  const manager = new ComputerUseMcpManager({ dataDir: directory, scope: 'first-browser-load', platform: 'win32', arch: 'x64', transportFactory: () => { spawned++; throw new Error('status is passive'); } });
  t.after(async () => { await manager.close(); await rm(directory, { recursive: true, force: true }); });
  const [a, b, c, d] = await Promise.all([manager.status(), manager.config(), manager.status(), manager.config()]);
  assert.deepEqual(a.config, b); assert.deepEqual(c.config, d); assert.deepEqual(b, d); assert.equal(b.enabled, true); assert.equal(spawned, 0); assert.equal(manager.busy, false);
  assert.equal(await readFile(manager.configFile, 'utf8'), `${JSON.stringify(b)}\n`);
});

test('accounts sharing one data directory retain separate config and child audit paths', async t => {
  const a = await harness(t, { enabled: false }); const b = await harness(t, { directory: a.directory, scope: 'account-two', enabled: false });
  const initialA = await a.manager.config(), initialB = await b.manager.config();
  await a.manager.configure({ revision: initialA.revision, enabled: true, profile: 'core' });
  assert.deepEqual(await b.manager.config(), initialB); assert.notEqual(a.manager.configFile, b.manager.configFile);
  await b.manager.configure({ revision: initialB.revision, enabled: true }); await a.manager.connect(); await b.manager.connect();
  assert.notEqual(a.parameters[0].cwd, b.parameters[0].cwd); assert.notEqual(a.parameters[0].env.COMPUTER_USE_AUDIT_LOG, b.parameters[0].env.COMPUTER_USE_AUDIT_LOG);
  assert.ok(a.parameters[0].env.COMPUTER_USE_AUDIT_LOG.startsWith(a.manager.privateDir));
  await b.manager.close();
});

test('environment retains actual GUI context and OS app discovery while removing host credentials and override policies', () => {
  const env = isolatedComputerUseEnvironment(sourceEnv, { profile: 'full', auditLog: '/private/account/audit.jsonl', nativeModulePath: '/fixed/native.node', electron: true });
  for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR']) assert.equal(env[key], sourceEnv[key]);
  for (const key of ['OPENAI_API_KEY', 'PETPAL_TOKEN', 'HTTP_PROXY', 'NODE_OPTIONS', 'COMPUTER_USE_APPROVAL_TOKEN']) assert.equal(env[key], undefined);
  assert.equal(env.COMPUTER_USE_PROFILE, 'full'); assert.equal(env.COMPUTER_USE_NATIVE_PATH, '/fixed/native.node'); assert.equal(env.ELECTRON_RUN_AS_NODE, '1'); assert.equal(env.COMPUTER_USE_BROWSER_DOM, 'false');
  assert.equal(env.COMPUTER_USE_REQUIRE_APPROVAL, 'false'); assert.equal(env.COMPUTER_USE_AUDIT_LOG, '/private/account/audit.jsonl');
});

test('real SDK stdio initializes/list/call, uses fixed package entry, and never runs doctor during status or discovery', async t => {
  const { manager, parameters, readEvents } = await harness(t);
  const status = await manager.connect(); assert.equal(status.connected, true); assert.equal(status.toolsCount, 7);
  const list = await manager.tools(); assert.deepEqual(list.tools.map(tool => tool.name), fixtureTools.slice(0, 7).map(tool => tool.name)); assert.ok(list.tools.every(tool => !Object.hasOwn(tool, 'inputSchema')));
  const named = await manager.tools({ tool: 'type' }); assert.equal(named.tool.inputSchema.additionalProperties, false); assert.equal(named.tool.inputSchema.properties.approval_token, undefined);
  const result = await manager.call(command('discover_applications', { query: 'Synthetic' })); assert.equal(result.kind, 'computer-use-mcp'); assert.equal(result.ok, true); assert.equal(result.tool, 'discover_applications');
  await manager.status(); const events = await readEvents(); assert.deepEqual(events.slice(0, 3).map(value => value.method), ['initialize', 'notifications/initialized', 'tools/list']); assert.equal(events.filter(value => value.method === 'tools/call').length, 1); assert.equal(events.some(value => value.params?.name === 'doctor'), false);
  assert.equal(parameters[0].command, process.execPath); assert.equal(parameters[0].args.length, 1); assert.ok(parameters[0].args[0].endsWith(path.join('@zavora-ai', 'computer-use-mcp', 'dist', 'server.js'))); assert.equal(parameters[0].env.OPENAI_API_KEY, undefined); assert.equal(parameters[0].env.HTTP_PROXY, undefined);
});

test('strict real schemas reject types, unknown nested fields and policy tokens before sending any native call', async t => {
  const { manager, readEvents } = await harness(t); await manager.connect();
  for (const args of [{}, { text: 2 }, { text: 'x', custom: true }]) await assert.rejects(manager.call(command('type', args)), { code: 'invalid_arguments' });
  await assert.rejects(manager.call(command('fill_form', { fields: [{ label: 'Name', value: 'test', secret: 'x' }] })), { code: 'invalid_arguments' });
  await assert.rejects(manager.call(command('type', { text: 'x', approval_token: 'model-token' })), { code: 'invalid_arguments' });
  assert.equal((await readEvents()).filter(value => value.method === 'tools/call').length, 0);
});

test('pointer/keyboard tools cannot request weaker focus and forwarded text remains exact', async t => {
  const { manager, readEvents } = await harness(t);
  const result = await manager.call(command('type', { text: '小伴\n新行', target_window_id: 123, focus_strategy: 'prepare_display' })); assert.equal(result.ok, true);
  const call = (await readEvents()).find(value => value.method === 'tools/call'); assert.deepEqual(call.params.arguments, { text: '小伴\n新行', target_window_id: 123, focus_strategy: 'strict' });
});

test('screenshots use bounded defaults; width, quality and zoom regions cannot exceed capture budget', async t => {
  const { manager, readEvents } = await harness(t);
  for (const args of [{ width: 1281 }, { width: 0 }, { quality: 81 }, { quality: -1 }]) await assert.rejects(manager.call(command('screenshot', args)), { code: 'invalid_arguments' });
  for (const args of [{ region: [0, 0, 1281, 10] }, { region: [0, 0, 10, 1281] }, { region: [20, 20, 10, 10] }, { region: [0, 0, 10.5, 10] }, { region: [0, 0, 10, 10], quality: 81 }]) await assert.rejects(manager.call(command('zoom', args)), { code: 'invalid_arguments' });
  await manager.call(command('screenshot', { target_window_id: 100 }));
  const call = (await readEvents()).find(value => value.method === 'tools/call'); assert.deepEqual(call.params.arguments, { target_window_id: 100, width: 1024, quality: 80 });
});

test('Linux upstream glibc 2.39 gate and missing interactive session are truthful without spawning', async t => {
  const incompatible = await harness(t, { platform: 'linux', arch: 'arm64', glibcVersion: '2.35', withoutCompatibleNative: true });
  const status = await incompatible.manager.status(); assert.equal(status.readiness.nativeCompatible, false); assert.equal(status.readiness.minimumGlibc, '2.39'); assert.match(status.message, /glibc 2\.39/);
  await assert.rejects(incompatible.manager.connect(), { code: 'native_incompatible' }); assert.equal(incompatible.parameters.length, 0);
  const headless = await harness(t, { platform: 'linux', arch: 'arm64', glibcVersion: '2.39', env: {}, withoutCompatibleNative: true });
  assert.equal((await headless.manager.status()).readiness.interactiveDesktop, false); await assert.rejects(headless.manager.connect(), { code: 'desktop_unavailable' }); assert.equal(headless.parameters.length, 0);
});

test('trusted compatible native can lower Linux baseline; untrusted source environment cannot', async t => {
  const native = await nativeFixture(t);
  const { manager, parameters } = await harness(t, { platform: 'linux', glibcVersion: '2.35', nativeModulePath: native.file, nativeCompatibility: { version: '7.4.0', minimumGlibc: '2.35' } });
  assert.equal((await manager.status()).readiness.nativeCompatible, true); await manager.connect(); assert.equal(parameters[0].env.COMPUTER_USE_NATIVE_PATH, native.file);
  const mismatch = await harness(t, { platform: 'linux', glibcVersion: '2.35', nativeModulePath: native.file, nativeCompatibility: { version: '7.3.0', minimumGlibc: '2.35' } }); await assert.rejects(mismatch.manager.connect(), { code: 'native_incompatible' });
});

test('compatible native requires matching fixed source, version, architecture, ELF and SHA receipt before launch', async t => {
  const native = await nativeFixture(t);
  for (const change of [{ sourceCommit: 'other' }, { sha256: '0'.repeat(64) }, { arch: 'arm64' }, { requiredGlibc: '2.39' }, { version: '7.5.0' }]) {
    await writeFile(path.join(native.directory, 'PROVENANCE.json'), JSON.stringify({ ...native.receipt, ...change }));
    const { manager, parameters } = await harness(t, { platform: 'linux', glibcVersion: '2.39', nativeModulePath: native.file }); await assert.rejects(manager.connect(), { code: 'native_incompatible' }); assert.equal(parameters.length, 0);
  }
  await writeFile(path.join(native.directory, 'PROVENANCE.json'), JSON.stringify(native.receipt)); const wrong = Buffer.from(native.binary); wrong.writeUInt16LE(183, 18); await writeFile(native.file, wrong);
  const { manager, parameters } = await harness(t, { platform: 'linux', glibcVersion: '2.39', nativeModulePath: native.file }); await assert.rejects(manager.connect(), { code: 'native_incompatible' }); assert.equal(parameters.length, 0);
});

test('patched native only accepts the audited patch hash, basename and frozen base commit', async t => {
  const native = await nativeFixture(t), patch = { file: 'linux-x11-window-geometry.patch', sha256: 'ad05d1b466c94d2ca90f009630ece9d8dcc0d52aa2b571a09a974d4b6f51ad71', baseCommit: native.receipt.sourceCommit };
  for (const change of [{ file: 'arbitrary.patch' }, { sha256: '0'.repeat(64) }, { baseCommit: 'other' }, { extra: true }]) {
    await writeFile(path.join(native.directory, 'PROVENANCE.json'), JSON.stringify({ ...native.receipt, source: { ...native.receipt.source, modifiedTrackedSource: true, patch: { ...patch, ...change } } }));
    const { manager, parameters } = await harness(t, { platform: 'linux', glibcVersion: '2.39', nativeModulePath: native.file }); await assert.rejects(manager.connect(), { code: 'native_incompatible' }); assert.equal(parameters.length, 0);
  }
  await writeFile(path.join(native.directory, 'PROVENANCE.json'), JSON.stringify({ ...native.receipt, source: { ...native.receipt.source, modifiedTrackedSource: true, patch } }));
  const { manager } = await harness(t, { platform: 'linux', glibcVersion: '2.35', nativeModulePath: native.file }); assert.equal((await manager.status()).readiness.nativeCompatible, true);
});

test('Linux input dependency checks are passive, session-specific, and never invoke an input binary', async () => {
  const checked = [], env = { DISPLAY: ':0', PATH: '/test/bin:/usr/bin' }, probe = async file => { checked.push(file); return file === '/test/bin/xdotool'; };
  await linuxInputPreflight('type', { text: 'short' }, env, { isExecutable: probe }); assert.deepEqual(checked, ['/test/bin/xdotool']);
  await assert.rejects(linuxInputPreflight('type', { text: 'short' }, env, { isExecutable: async () => false }), { code: 'linux_dependency_missing' });
  await assert.rejects(linuxInputPreflight('multi_edit', {}, env, { isExecutable: async () => false }), { code: 'linux_dependency_missing' });
  await assert.rejects(linuxInputPreflight('type', { text: 'x'.repeat(101) }, env, { isExecutable: probe }), { code: 'linux_dependency_missing' });
  const wayland = { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0', PATH: '/test/bin' };
  for (const tool of ['type', 'key', 'hold_key']) await assert.rejects(linuxInputPreflight(tool, { text: 'short' }, wayland, { isExecutable: async () => false }), { code: 'linux_dependency_missing' });
  await linuxInputPreflight('key', { text: 'ctrl+a' }, env, { isExecutable: () => { throw new Error('X11 key uses native XTest'); } });
  await assert.rejects(linuxInputPreflight('type', { text: 'short' }, { ...wayland, XDG_SESSION_TYPE: undefined }, { isExecutable: probe }), { code: 'desktop_unavailable' });
});

test('missing Linux typing executable rejects before any MCP tools/call instead of returning false Typed success', async t => {
  const { manager, readEvents } = await harness(t, { platform: 'linux', glibcVersion: '2.39', env: { DISPLAY: ':0', PATH: '/missing' }, executableProbe: async () => false });
  await assert.rejects(manager.call(command('type', { text: 'must-not-type' })), { code: 'linux_dependency_missing' }); assert.equal((await readEvents()).filter(event => event.method === 'tools/call').length, 0);
});

test('compatibility adapter supports documented action fields with strict focus and validates canonical input before dispatch', async t => {
  const { manager, readEvents } = await harness(t);
  const result = await manager.call(command('openai_computer', { action: { type: 'type', text: 'synthetic text' }, target_window_id: 123, focus_strategy: 'none' })); assert.equal(result.ok, true);
  const call = (await readEvents()).find(event => event.method === 'tools/call'); assert.equal(call.params.name, 'openai_computer'); assert.deepEqual(call.params.arguments.action, { type: 'type', text: 'synthetic text' }); assert.equal(call.params.arguments.focus_strategy, 'strict'); assert.equal(call.params.arguments.width, 1024); assert.equal(call.params.arguments.quality, 80);
  const schema = (await manager.tools({ tool: 'openai_computer' })).tool.inputSchema; assert.equal(schema.properties.action.properties.text.type, 'string'); assert.equal(schema.properties.action.additionalProperties, false); assert.equal(schema.properties.actions.maxItems, 20);
});

test('compatibility batch rejects unknown fields, invalid mapped input, unsupported actions and conflicting envelopes before any action', async t => {
  const { manager, readEvents } = await harness(t);
  for (const args of [{}, { action: { type: 'type', text: 42 } }, { action: { type: 'type', text: 'synthetic', arbitrary: 'hidden' } }, { action: { type: 'run_script', script: 'unapproved' } }, { action: { type: 'type' } }, { action: { type: 'type', text: 'synthetic' }, actions: [{ type: 'screenshot' }] }, { actions: [] }, { actions: [{ type: 'type', text: 'must-not-type' }, { type: 'unsupported' }] }]) await assert.rejects(manager.call(command('openai_computer', args)), { code: 'invalid_arguments' });
  assert.equal((await readEvents()).filter(event => event.method === 'tools/call').length, 0);
});

test('compatibility screenshots cannot bypass width/quality/image count or Wayland window-scope guards', async t => {
  const { manager, readEvents } = await harness(t);
  for (const args of [{ action: { type: 'screenshot' }, width: 1281 }, { action: { type: 'screenshot' }, quality: 81 }, { actions: [{ type: 'screenshot' }, { type: 'screenshot' }, { type: 'screenshot' }] }, { actions: [{ type: 'screenshot' }, { type: 'screenshot' }], return_screenshot: true }]) await assert.rejects(manager.call(command('openai_computer', args)), { code: 'invalid_arguments' });
  assert.equal((await readEvents()).filter(event => event.method === 'tools/call').length, 0);
  const wayland = await harness(t, { platform: 'linux', glibcVersion: '2.39', env: { ...sourceEnv, XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0' } });
  for (const args of [{ action: { type: 'screenshot' }, target_window_id: 1 }, { action: { type: 'type', text: 'must-not-type' }, return_screenshot: true, target_app: 'synthetic' }]) await assert.rejects(wayland.manager.call(command('openai_computer', args)), { code: 'wayland_window_capture_unavailable' });
  assert.equal((await wayland.readEvents()).filter(event => event.method === 'tools/call').length, 0);
});

test('compatibility adapter preflights every mapped Linux input before forwarding even an otherwise valid batch', async t => {
  const { manager, readEvents } = await harness(t, { platform: 'linux', glibcVersion: '2.39', env: { DISPLAY: ':0', PATH: '/missing' }, executableProbe: async () => false });
  await assert.rejects(manager.call(command('openai_computer', { actions: [{ type: 'screenshot' }, { type: 'type', text: 'must-not-type' }] })), { code: 'linux_dependency_missing' });
  assert.equal((await readEvents()).filter(event => event.method === 'tools/call').length, 0);
});

test('Wayland window capture is rejected because upstream would silently capture whole display', async t => {
  const { manager, readEvents } = await harness(t, { platform: 'linux', glibcVersion: '2.39', env: { ...sourceEnv, XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0' } });
  for (const args of [{ target_window_id: 100 }, { target_app: 'synthetic' }]) await assert.rejects(manager.call(command('screenshot', args)), { code: 'wayland_window_capture_unavailable' });
  assert.equal((await readEvents()).filter(value => value.method === 'tools/call').length, 0);
});

test('unsupported architecture and Node/N-API fail passively rather than trying native load', async t => {
  for (const options of [{ platform: 'freebsd' }, { arch: 'ia32' }, { versions: { node: '22.20.0', napi: '8' } }, { versions: { node: '18.20.0', napi: '9' } }]) {
    const { manager, parameters } = await harness(t, options); assert.equal((await manager.status()).readiness.ready, false); await assert.rejects(manager.connect(), { status: 400 }); assert.equal(parameters.length, 0);
  }
});

test('profile change disconnects previous process and excludes tools above selected profile', async t => {
  const { manager, readEvents } = await harness(t); await manager.connect(); const config = await manager.config();
  await manager.configure({ revision: config.revision, profile: 'core' }); assert.equal((await manager.status()).connected, false);
  await assert.rejects(manager.tools({ tool: 'run_script' }), { code: 'unknown_tool' }); await assert.rejects(manager.call(command('run_script', { language: 'powershell', script: 'Get-Date' })), { code: 'unknown_tool' });
  assert.equal((await readEvents()).some(value => value.params?.name === 'run_script'), false);
});

test('tool error stays false, protocol errors stay failures and diagnostics do not expose upstream secrets', async t => {
  const failed = await harness(t, { mode: 'tool-error' }); const result = await failed.manager.call(command('type', { text: 'synthetic' })); assert.equal(result.ok, false);
  const protocol = await harness(t, { mode: 'protocol-error' }); await assert.rejects(protocol.manager.call(command('type', { text: 'synthetic' })), error => error.status === 502 && !error.message.includes('SECRET'));
  assert.equal((await protocol.manager.status()).connected, false); assert.equal(JSON.stringify(await protocol.manager.status()).includes('SECRET'), false);
});

test('child exit at initialize and call leaves disconnected state, with no automatic action retry', async t => {
  const initial = await harness(t, { mode: 'init-exit' }); await assert.rejects(initial.manager.connect(), { status: 502 }); assert.equal((await initial.manager.status()).connected, false);
  const exited = await harness(t, { mode: 'exit' }); await assert.rejects(exited.manager.call(command('type', { text: 'synthetic' })), { status: 502 }); assert.equal((await exited.readEvents()).filter(value => value.method === 'tools/call').length, 1); assert.equal((await exited.manager.status()).connected, false);
});

test('MCP output is bounded and unsupported content metadata does not leak through wrapper', async t => {
  for (const [mode, code] of [['output-limit', 'output_limit'], ['invalid-output', 'invalid_output']]) { const { manager } = await harness(t, { mode }); await assert.rejects(manager.call(command('type', { text: 'synthetic' })), { code }); assert.equal((await manager.status()).connected, false); }
});

test('active operation owns busy before await; concurrent call/config reject and cancellation closes actual child', async t => {
  const { manager, transports, readEvents } = await harness(t, { mode: 'hang', callTimeoutMs: 10000 }); await manager.connect(); const config = await manager.config();
  const controller = new AbortController(); const pending = manager.call(command('type', { text: 'synthetic' }), { signal: controller.signal }); const rejection = assert.rejects(pending, { code: 'cancelled' });
  await assert.rejects(manager.call(command('type', { text: 'second' })), { code: 'busy' }); await assert.rejects(manager.configure({ revision: config.revision, enabled: false }), { code: 'busy' });
  controller.abort(); await rejection; assert.equal(manager.busy, false); assert.equal((await manager.status()).connected, false); assert.equal(transports[0].pid, null);
  assert.ok((await readEvents()).filter(value => value.method === 'tools/call').length <= 1);
});

test('disconnect/close cancel unfinished requests and await process cleanup without modifying config', async t => {
  const { manager, transports } = await harness(t, { mode: 'hang' }); await manager.connect(); const config = await manager.config();
  const pending = manager.call(command('type', { text: 'synthetic' })); const stopped = assert.rejects(pending, { code: 'cancelled' });
  await manager.disconnect(); await stopped; assert.equal(transports[0].pid, null); assert.deepEqual(await manager.config(), config);
  const pending2 = manager.call(command('type', { text: 'synthetic' })); const closed = assert.rejects(pending2, error => ['cancelled', 'closed'].includes(error.code)); await manager.close(); await closed; assert.equal(manager.busy, false);
  await assert.rejects(manager.status(), { code: 'closed' });
});

test('foreign revision closes active connection and malformed private config is preserved without defaults fallback', async t => {
  const { manager } = await harness(t); await manager.connect(); const initial = await manager.config(); const updated = { ...initial, revision: '00000000-0000-4000-8000-000000000001', enabled: false }; await writeFile(manager.configFile, JSON.stringify(updated));
  assert.deepEqual(await manager.config(), updated); assert.equal((await manager.status()).connected, false);
  await writeFile(manager.configFile, '{broken-private-config'); await assert.rejects(manager.config(), { code: 'invalid_config' }); assert.equal(await readFile(manager.configFile, 'utf8'), '{broken-private-config');
});

test('unknown configuration lock remains for explicit recovery and stale valid owner lock is recovered', async t => {
  const { manager } = await harness(t); const config = await manager.config(); await writeFile(manager.lockFile, '{broken');
  await assert.rejects(manager.configure({ revision: config.revision, profile: 'core' }), { code: 'unknown_lock' }); assert.equal(await readFile(manager.lockFile, 'utf8'), '{broken'); await rm(manager.lockFile);
  manager.processExists = () => false; await writeFile(manager.lockFile, JSON.stringify({ version: 1, ownerPid: 999999, nonce: '00000000-0000-4000-8000-000000000001', scope: manager.scopeHash }));
  const saved = await manager.configure({ revision: config.revision, profile: 'core' }); assert.equal(saved.profile, 'core'); await assert.rejects(stat(manager.lockFile), { code: 'ENOENT' });
});
