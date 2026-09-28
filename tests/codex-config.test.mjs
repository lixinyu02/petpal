import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultCodexConfig, patchCodexConfig, publicCodexConfig, codexToml, isolatedCodexEnvironment, prepareCodexRuntime } from '../server/codex-config.mjs';
import { createPetServer } from '../server/app.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const api = { mode: 'api', baseUrl: 'https://models.example/v1', model: 'fixture-model', apiKey: 'nonstandard-provider-secret' };
const stubTools = () => ({ specs: [], describe(name, args) { if (name !== 'fixed' || Object.keys(args).length) throw new Error('invalid tool'); return { description: 'fixture', approvalRequired: true }; }, async execute() { return { ok: true }; }, async status() { return { fixture: true }; }, async close() {} });
const stubBridge = () => ({ async status() { return { available: true }; }, async run({ prompt, onEvent, threadId }) { onEvent('thread', { threadId: threadId || 'fixture-thread' }); return { threadId: threadId || 'fixture-thread', text: prompt }; }, async close() {} });
async function setup(t, overrides = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-codex-config-'));
  const bridges = [];
  const app = await createPetServer({ dataDir: directory, token: 'config-owner-token', desktopTools: stubTools(), codexFactory: () => { const bridge = stubBridge(); bridges.push(bridge); return bridge; }, ...overrides });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const request = (route, { method = 'GET', body, token = app.token, signal } = {}) => fetch(`http://127.0.0.1:${app.server.address().port}/api${route}`, { method, signal, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  t.after(async () => { await app.close(); assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-codex-config-'))); await rm(directory, { recursive: true, force: true }); });
  return { request, directory, app, bridges };
}

test('Codex config validates endpoint, secret replacement, CAS and fixed protocol', () => {
  const original = defaultCodexConfig();
  const saved = patchCodexConfig(original, api);
  assert.notEqual(saved.revision, original.revision);
  assert.equal(patchCodexConfig(saved, { apiKey: '' }).apiKey, api.apiKey);
  assert.equal(patchCodexConfig(saved, { apiKey: '' }).revision, saved.revision);
  assert.equal(publicCodexConfig(saved).apiKey, undefined);
  assert.throws(() => patchCodexConfig(saved, { revision: original.revision, model: 'other' }), error => error.status === 409);
  assert.throws(() => patchCodexConfig(saved, { baseUrl: 'https://elsewhere.example' }), /重新填写/);
  assert.equal(patchCodexConfig(saved, { baseUrl: 'https://elsewhere.example', clearApiKey: true }).apiKey, '');
  for (const baseUrl of ['http://public.example/v1', 'https://user:pass@example.com', 'https://example.com?key=x', 'https://example.com/#hash', 'https://example.com/\nunsafe']) assert.throws(() => patchCodexConfig(original, { ...api, baseUrl }));
  assert.equal(patchCodexConfig(original, { ...api, baseUrl: 'http://127.0.0.1:9988/v1/responses' }).baseUrl, 'http://127.0.0.1:9988/v1');
  assert.throws(() => patchCodexConfig(saved, { sandbox: 'danger-full-access' }), /不支持/);
  assert.throws(() => patchCodexConfig(saved, { apiKey: 'x', clearApiKey: true }), /同时/);
});

test('isolated Codex TOML contains no key and environment cannot inherit global auth', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-codex-isolation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = patchCodexConfig(defaultCodexConfig(), { ...api, model: 'quoted"model' });
  const env = isolatedCodexEnvironment(config, path.join(directory, 'private'), { PATH: '/tools', SystemRoot: 'C:\\Windows', CODEX_HOME: '/global', OPENAI_API_KEY: 'global', CODEX_CONFIG_OVERRIDES: 'unsafe', OTHER_SECRET: 'hidden' });
  assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.CODEX_CONFIG_OVERRIDES, undefined); assert.equal(env.OTHER_SECRET, undefined);
  assert.equal(env.PETPAL_CODEX_API_KEY, api.apiKey); assert.equal(env.PATH, '/tools');
  assert.equal(env.HOME, path.join(directory, 'private', 'profile')); assert.equal(env.USERPROFILE, env.HOME);
  const runtime = await prepareCodexRuntime(config, directory);
  assert.ok(runtime.workspaceRoot.startsWith(path.join(directory, 'codex', config.revision)));
  const contents = await readFile(path.join(runtime.env.CODEX_HOME, 'config.toml'), 'utf8');
  assert.equal(contents, codexToml(config)); assert.ok(!contents.includes(api.apiKey));
  assert.match(contents, /wire_api = "responses"/); assert.match(contents, /shell_tool = false/);
  assert.match(contents, /exclude = \["PETPAL_CODEX_API_KEY"/);
});

test('configuration persists privately, preserves key, and blocks cross-config thread resume', async t => {
  const { request, directory, bridges } = await setup(t);
  const first = await (await request('/codex/config')).json();
  assert.equal(first.mode, 'host');
  const conversation = await (await request('/conversations', { method: 'POST', body: { mode: 'codex' } })).json();
  await (await request(`/conversations/${conversation.id}/messages`, { method: 'POST', body: { content: 'before' } })).text();
  const update = await request('/codex/config', { method: 'PATCH', body: { ...api, revision: first.revision } });
  assert.equal(update.status, 200); const saved = await update.json();
  assert.equal(saved.hasApiKey, true); assert.equal(saved.apiKey, undefined); assert.equal(bridges.length, 2);
  assert.equal((await request(`/conversations/${conversation.id}/messages`, { method: 'POST', body: { content: 'after' } })).status, 409);
  assert.equal((await request('/codex/config', { method: 'PATCH', body: { ...api, revision: first.revision } })).status, 409);
  assert.ok(!(await (await request('/state')).text()).includes(api.apiKey));
  assert.equal(JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')).codexConfig.apiKey, api.apiKey);
  const newChat = await (await request('/conversations', { method: 'POST', body: { mode: 'codex' } })).json();
  assert.equal(newChat.codexRevision, saved.revision);
  assert.match(await (await request(`/conversations/${newChat.id}/messages`, { method: 'POST', body: { content: 'new' } })).text(), /event: done/);
});

test('config replacement waits for child close and excludes concurrent status, patch and run', async t => {
  const closing = deferred(), release = deferred(); let built = 0;
  const { request } = await setup(t, { codexFactory: () => { built++; const bridge = stubBridge(); if (built === 1) bridge.close = async () => { closing.resolve(); await release.promise; }; return bridge; } });
  const chat = await (await request('/conversations', { method: 'POST', body: { mode: 'codex' } })).json();
  const changing = request('/codex/config', { method: 'PATCH', body: api });
  await closing.promise;
  try {
    assert.equal(built, 1);
    assert.equal((await request('/codex/config', { method: 'PATCH', body: api })).status, 409);
    assert.equal((await request('/codex/status')).status, 409);
    assert.equal((await request(`/conversations/${chat.id}/messages`, { method: 'POST', body: { content: 'unsafe resume' } })).status, 409);
  } finally { release.resolve(); }
  assert.equal((await changing).status, 200); assert.equal(built, 2);
});

test('running Codex blocks config changes until its cancellation finishes', async t => {
  const started = deferred(), cancelled = deferred(), released = deferred();
  const { request } = await setup(t, { codexFactory: () => ({ ...stubBridge(), run: ({ signal }) => new Promise((resolve, reject) => { started.resolve(); signal.addEventListener('abort', () => { cancelled.resolve(); released.promise.then(() => reject(signal.reason)); }, { once: true }); }) }) });
  const chat = await (await request('/conversations', { method: 'POST', body: { mode: 'codex' } })).json();
  const stream = await request(`/conversations/${chat.id}/messages`, { method: 'POST', body: { content: 'wait' } });
  const output = stream.text(); await started.promise;
  assert.equal((await request('/codex/config', { method: 'PATCH', body: api })).status, 409);
  const stopping = request(`/conversations/${chat.id}/stop`, { method: 'POST' }); await cancelled.promise;
  assert.equal((await request('/codex/config', { method: 'PATCH', body: api })).status, 409);
  released.resolve(); await stopping; await output;
  assert.equal((await request('/codex/config', { method: 'PATCH', body: api })).status, 200);
});

test('member cannot inspect/configure/operate host tools; owner click uses shared registry', async t => {
  const tools = stubTools(); let statuses = 0, actions = 0;
  tools.status = async () => { statuses++; return { fixture: true }; };
  tools.execute = async () => { actions++; return { ok: true, action: 'fixture' }; };
  const { request } = await setup(t, { desktopTools: tools });
  await request('/admin/users', { method: 'POST', body: { username: 'member', displayName: 'Member', password: 'test-password-123' } });
  const session = await (await request('/auth/login', { method: 'POST', body: { username: 'member', password: 'test-password-123' } })).json();
  for (const [route, method, body] of [['/codex/config', 'GET'], ['/codex/config', 'PATCH', api], ['/desktop-tools/status', 'GET'], ['/desktop-tools/action', 'POST', { tool: 'fixed', arguments: {} }]]) assert.equal((await request(route, { method, body, token: session.token })).status, 403);
  assert.equal(statuses, 0); assert.equal(actions, 0);
  assert.deepEqual(await (await request('/desktop-tools/action', { method: 'POST', body: { tool: 'fixed', arguments: {} } })).json(), { ok: true, action: 'fixture' });
  assert.equal(actions, 1);
  assert.equal((await request('/desktop-tools/action', { method: 'POST', body: { tool: 'shell', arguments: {} } })).status, 400);
});

test('logout cancels direct desktop action and waits for its owned cleanup', async t => {
  const started = deferred(), aborted = deferred(), release = deferred();
  const tools = stubTools();
  tools.execute = async (name, args, { signal }) => { started.resolve(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); aborted.resolve(); await release.promise; signal.throwIfAborted(); };
  const { request } = await setup(t, { desktopTools: tools });
  const action = request('/desktop-tools/action', { method: 'POST', body: { tool: 'fixed', arguments: {} } });
  await started.promise; let loggedOut = false;
  const logout = request('/auth/logout', { method: 'POST' }).then(value => { loggedOut = true; return value; });
  await aborted.promise; assert.equal(loggedOut, false); release.resolve();
  assert.equal((await action).status, 502); assert.equal((await logout).status, 200);
});
