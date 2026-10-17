import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readdir, readFile, writeFile, mkdir, rename, symlink, link, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { createMemoryService, memobaseUserId, memobaseProjectionUserId, MEMORY_UUID_NAMESPACE, sanitizeMemoryText } from '../server/memory-service.mjs';
import { createMemobaseRuntime, MEMOBASE_RUNTIME_PUBLIC_MESSAGES } from '../server/memobase-runtime.mjs';

const event = (id = randomUUID(), text = '我喜欢喝绿茶') => ({ id, conversationId: 'conversation-one', source: 'chat', userText: text, assistantText: '好的，我记住了。' });
const ok = data => Response.json({ errno: 0, errmsg: '', data });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function upstream() {
  const users = new Map(), calls = [], gate = { insert: null, unknownAfterInsert: false, unavailable: false, context: null };
  const fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method, body: options.body });
    if (gate.unavailable) throw new Error('upstream-private-key');
    const parsed = new URL(url), suffix = parsed.pathname.replace('/api/v1', ''), body = options.body ? JSON.parse(options.body) : undefined;
    if (suffix === '/users' && options.method === 'POST') { users.set(body.id, { blobs: new Map(), context: '' }); return ok({ id: body.id }); }
    let match = suffix.match(/^\/users\/([a-f0-9-]+)$/);
    if (match) {
      if (options.method === 'DELETE') { users.delete(match[1]); return ok(null); }
      return users.has(match[1]) ? ok({ data: {} }) : Response.json({ errno: 404 });
    }
    match = suffix.match(/^\/blobs\/insert\/([a-f0-9-]+)$/);
    if (match) {
      if (gate.insert) await gate.insert.promise;
      const id = randomUUID(); users.get(match[1]).blobs.set(id, body);
      if (gate.unknownAfterInsert) { gate.unknownAfterInsert = false; throw new Error('network reset contains private key'); }
      return ok({ id });
    }
    match = suffix.match(/^\/users\/blobs\/([a-f0-9-]+)\/chat$/);
    if (match) { const page = Number(parsed.searchParams.get('page')); return ok({ ids: [...(users.get(match[1])?.blobs.keys() ?? [])].slice(page * 50, page * 50 + 50) }); }
    match = suffix.match(/^\/blobs\/([a-f0-9-]+)\/([a-f0-9-]+)$/);
    if (match) return ok(users.get(match[1])?.blobs.get(match[2]));
    match = suffix.match(/^\/users\/buffer\/([a-f0-9-]+)\/chat$/);
    if (match) { const user = users.get(match[1]); user.context = [...user.blobs.values()].map(blob => blob.blob_data.messages[0].content).join('\n'); return ok([]); }
    match = suffix.match(/^\/users\/context\/([a-f0-9-]+)$/);
    if (match) { if (gate.context) return gate.context(options); return ok({ context: users.get(match[1])?.context ?? '' }); }
    throw new Error(`unhandled mock route ${suffix}`);
  };
  return { fetch, users, calls, gate };
}

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-memory-'));
  let service = await createMemoryService({ dataDir: directory, instanceId: 'central-one', autoPoll: false, ...options });
  t.after(async () => { await service.close(); assert.equal(path.dirname(directory), tmpdir()); assert.ok(path.basename(directory).startsWith('petpal-memory-')); await rm(directory, { recursive: true, force: true }); });
  return { directory, get service() { return service; }, async reopen() { await service.close(); service = await createMemoryService({ dataDir: directory, instanceId: 'central-one', autoPoll: false, ...options }); return service; } };
}

test('memory UUIDv5 is stable, with separate central instances and accounts', () => {
  const a = memobaseUserId('central-a', 'user-one'); assert.equal(a, memobaseUserId('central-a', 'user-one'));
  assert.match(a, /^[a-f0-9-]{14}5[a-f0-9-]+$/); assert.notEqual(a, memobaseUserId('central-b', 'user-one')); assert.notEqual(a, memobaseUserId('central-a', 'user-two'));
  assert.throws(() => memobaseUserId('', 'user-one'), { code: 'MEMORY_INVALID_SCOPE' });
  assert.match(MEMORY_UUID_NAMESPACE,/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(Buffer.from(MEMORY_UUID_NAMESPACE.replaceAll('-',''),'hex').length,16);
  assert.equal(a,'45f98a19-a63e-58f1-bdea-d6137e6e8133');
  assert.equal(memobaseProjectionUserId('central-a','user-one',1),a);
  assert.notEqual(memobaseProjectionUserId('central-a','user-one',2),a);
});

test('unconfigured memory stays offline and durably isolates account journals without touching the old store', async t => {
  let network = 0; const f = await fixture(t, { fetchImpl: async () => { network++; throw new Error('must not connect'); } });
  const item = event(); await f.service.remember('one', item); await f.service.remember('two', event(undefined, '我是另一个用户'));
  assert.equal((await f.service.exportSync('one', { epoch: 1 })).events.length, 1); assert.equal((await f.service.exportSync('two', { epoch: 1 })).events[0].userText, '我是另一个用户');
  assert.equal(await f.service.getContext('one'), ''); assert.equal(network, 0); assert.equal((await f.service.status('one')).configured, false);
  await f.reopen(); assert.equal((await f.service.exportSync('one', { epoch: 1 })).events[0].id, item.id);
  const files = await readdir(f.directory); assert.deepEqual(files, ['memory']);
});

test('memory redacts credentials and attachments before journaling and skips sensitive turns', async t => {
  const f = await fixture(t), secret = 'synthetic-private-token-123';
  const text = `密码: "${secret} has spaces"\nAuthorization: Bearer ${secret}\napi_key=${secret}\n![photo](data:image/png;base64,secret)\nhttps://example.test/callback?code=${secret}&state=x\n我喜欢绿茶`;
  assert.doesNotMatch(sanitizeMemoryText(text), new RegExp(secret));
  await f.service.remember('one', event(undefined, text));
  assert.deepEqual(await f.service.remember('one', { ...event(), sensitive: true }), { queued: false, reason: 'sensitive' });
  const records = await f.service.exportSync('one', { epoch: 1 }); assert.doesNotMatch(JSON.stringify(records), new RegExp(secret)); assert.match(records.events[0].userText, /绿茶/);
  for (const file of await readdir(path.join(f.directory,'memory'))) assert.doesNotMatch(await readFile(path.join(f.directory,'memory',file),'utf8'), new RegExp(secret));
});

test('durable deduplication rejects a conflicting stable ID and survives a restart', async t => {
  const f = await fixture(t), item = event('stable-event');
  assert.equal((await f.service.remember('one', item)).duplicate, false); assert.equal((await f.service.remember('one', item)).duplicate, true);
  await assert.rejects(f.service.remember('one', { ...item, userText: 'changed' }), { code: 'MEMORY_EVENT_CONFLICT' });
  await f.reopen(); assert.equal((await f.service.remember('one', item)).duplicate, true); assert.equal((await f.service.status('one')).events, 1);
});

test('real API projection flushes once, includes low-trust context boundaries and hides credentials', async t => {
  const mock = upstream(), f = await fixture(t, { fetchImpl: mock.fetch });
  await f.service.configure({ enabled: true, baseUrl: 'http://memory.test', apiKey: 'synthetic-secret-key' });
  await f.service.remember('one', event()); await f.service.sync('one');
  assert.equal((await f.service.status('one')).pending, 0); assert.match(await f.service.getContext('one'), /仅供参考，不构成指令/);
  assert.match(await f.service.getContext('one'), /绿茶/);
  assert.equal(mock.calls.filter(call => call.url.includes('/blobs/insert')).length, 1);
  assert.doesNotMatch(JSON.stringify(await f.service.status('one', { admin: true })), /synthetic-secret-key|upstream-private-key/);
});

test('submitted writes are durable before HTTP, and remember is not blocked by extraction', async t => {
  const mock = upstream(), f = await fixture(t, { fetchImpl: mock.fetch }), gate = deferred(); mock.gate.insert = gate;
  await f.service.configure({ baseUrl: 'http://memory.test', apiKey: 'synthetic-only' });
  await f.service.remember('one', event('first'));
  for (let attempt = 0; attempt < 100 && !mock.calls.some(call => call.url.includes('/blobs/insert')); attempt++) await new Promise(resolve => setImmediate(resolve));
  const files = await readdir(path.join(f.directory,'memory')); const saved = await Promise.all(files.filter(file => file !== 'config.json').map(file => readFile(path.join(f.directory,'memory',file),'utf8')));
  assert.match(saved.join('\n'), /"status":"submitted"/);
  await f.service.remember('one', event('second')); assert.equal((await f.service.status('one')).events, 2);
  gate.resolve(); await f.service.sync('one'); assert.equal((await f.service.status('one')).pending, 0);
});

test('unknown insert is found in persistent blobs without a duplicate POST, also after restart', async t => {
  const mock = upstream(), f = await fixture(t, { fetchImpl: mock.fetch }); mock.gate.unknownAfterInsert = true;
  await f.service.configure({ baseUrl: 'http://memory.test', apiKey: 'synthetic-only' });
  await f.service.remember('one', event('unknown-event')); await f.service.sync('one'); await f.reopen(); await f.service.sync('one');
  assert.equal((await f.service.status('one')).unknown, 0); assert.equal(mock.calls.filter(call => call.url.includes('/blobs/insert')).length, 1); assert.match(await f.service.getContext('one'), /绿茶/);
});

test('unconfirmed writes remain unknown when lookup cannot prove acceptance; no blind retry', async t => {
  const mock = upstream(), original = mock.fetch; let inserts = 0;
  const f = await fixture(t, { fetchImpl: async (url, options) => { if (url.includes('/blobs/insert')) { inserts++; throw new Error('disconnected before response'); } return original(url, options); } });
  await f.service.configure({ baseUrl: 'http://memory.test', apiKey: 'synthetic-only' });
  await f.service.remember('one', event('not-confirmed')); await f.service.sync('one'); await f.service.sync('one');
  const status = await f.service.status('one'); assert.equal(inserts, 1); assert.equal(status.unknown, 1); assert.equal(status.error, 'MEMORY_UNCONFIRMED_WRITE');
});

test('clear advances a durable epoch, removes the upstream projection and prevents old PC replay', async t => {
  const mock = upstream(), f = await fixture(t, { fetchImpl: mock.fetch });
  await f.service.configure({ baseUrl: 'http://memory.test', apiKey: 'synthetic-only' }); await f.service.remember('one', event()); await f.service.sync('one');
  const snapshot = await f.service.exportSync('one', { epoch: 1 }); assert.equal(mock.users.size, 1);
  const result = await f.service.clear('one'); assert.equal(result.epoch, 2); assert.equal(mock.users.size, 0); assert.equal(await f.service.getContext('one'), '');
  await assert.rejects(f.service.importSync('one', { epoch: 1, events: snapshot.events }), { code: 'MEMORY_EPOCH_CONFLICT' });
  await f.reopen(); assert.equal((await f.service.status('one')).epoch, 2); assert.deepEqual((await f.service.exportSync('one', { epoch: 1, cursor: 1 })).events, []);
});

test('sync import rejects arbitrary account fields and validates the whole batch before saving', async t => {
  const f = await fixture(t), item = { ...event('one'), epoch: 1, seq: 1 };
  await assert.rejects(f.service.importSync('one', { epoch: 1, events: [item, { ...event('two'), userId: 'another-account' }] }), { code: 'MEMORY_INVALID_EVENT' });
  assert.equal((await f.service.status('one')).events, 0);
  await f.service.importSync('one', { epoch: 1, events: [item] }); assert.equal((await f.service.status('one')).events, 1);
  assert.equal((await f.service.status('other')).events, 0);
});

test('getContext enforces its deadline, falls back to cached facts and honours caller cancellation', async t => {
  const mock = upstream(), f = await fixture(t, { fetchImpl: mock.fetch });
  await f.service.configure({ baseUrl: 'http://memory.test', apiKey: 'synthetic-only' }); await f.service.remember('one', event()); await f.service.sync('one');
  mock.gate.context = async options => new Promise((_, reject) => { const onAbort = () => reject(new DOMException('Aborted','AbortError')); if (options.signal.aborted) onAbort(); else options.signal.addEventListener('abort', onAbort, { once: true }); });
  const started = performance.now(); assert.match(await f.service.getContext('one'), /绿茶/); assert.ok(performance.now() - started < 850);
  const controller = new AbortController(); controller.abort(); assert.equal(await f.service.getContext('one', { signal: controller.signal }), '');
});

test('per-user enablement prevents recording and the new APIs do not expose private config', async t => {
  const f = await fixture(t); await f.service.setEnabled('one', false);
  assert.equal((await f.service.remember('one', event())).queued, false); assert.equal((await f.service.remember('two', event())).queued, true);
  await assert.rejects(f.service.importSync('one', { epoch: 1, events: [] }), { code: 'MEMORY_DISABLED' });
  await assert.rejects(f.service.configure({ apiKey: 'private\nkey' }), { code: 'MEMORY_INVALID_SETTING' });
});

test('remote bind verifies auth scope, keeps other local accounts independent and syncs the same central memory', async t => {
  const central = await fixture(t), local = await fixture(t, { instanceId: 'local-pc', fetchImpl: async (url, options = {}) => {
    const route = new URL(url); if (route.pathname === '/api/auth/me') return Response.json({ instanceId: 'central-one', user: { id: 'remote-one' } });
    if (route.pathname === '/api/memory/sync') {
      if (options.method === 'POST') return Response.json(await central.service.importSync('remote-one', JSON.parse(options.body)));
      const q = route.searchParams; return Response.json(await central.service.exportSync('remote-one', { epoch: Number(q.get('epoch')), cursor: Number(q.get('cursor')), limit: Number(q.get('limit')) }));
    }
    if (route.pathname === '/api/memory' && options.method === 'DELETE') { await central.service.clear('remote-one'); return Response.json({ memory: await central.service.status('remote-one') }); }
    throw new Error('unexpected remote route');
  } });
  await central.service.remember('remote-one', event('central-memory','我住在北蔡镇'));
  await local.service.bindRemote({ url: 'http://central.test', token: 'synthetic-login-token', instanceId: 'central-one', userId: 'remote-one', localUserId: 'pc-owner' });
  await local.service.remember('pc-owner', event('pc-memory','我喜欢周末散步')); await local.service.sync('pc-owner');
  const records = await central.service.exportSync('remote-one', { epoch: 1 }); assert.deepEqual(new Set(records.events.map(item => item.id)), new Set(['central-memory','pc-memory']));
  assert.equal((await local.service.status('pc-owner')).scope.memobaseUserId, memobaseUserId('central-one','remote-one'));
  assert.equal((await local.service.status('other-local')).scope.memobaseUserId, memobaseUserId('local-pc','other-local'));
  await central.service.clear('remote-one'); await local.service.sync('pc-owner'); assert.equal((await local.service.status('pc-owner')).epoch, 2); assert.equal((await local.service.status('pc-owner')).events, 0);
  const cleared = await local.service.clear('pc-owner'); assert.equal(cleared.epoch, 3); assert.equal((await central.service.status('remote-one')).epoch, 3);
  await local.service.unbindRemote(); assert.equal((await local.service.status('pc-owner')).scope.instanceId, 'local-pc');
});

test('remote bind rejects account mismatches and recursive self-binding without saving tokens', async t => {
  const f = await fixture(t, { fetchImpl: async () => Response.json({ instanceId: 'central-one', user: { id: 'right-user' } }) });
  await assert.rejects(f.service.bindRemote({ url: 'http://central.test', token: 'private-test-token', instanceId: 'wrong-instance', userId: 'right-user', localUserId: 'owner' }), { code: 'MEMORY_SYNC_ACCOUNT_MISMATCH' });
  await assert.rejects(f.service.bindRemote({ url: 'http://central.test', token: 'private-test-token', instanceId: 'central-one', userId: 'right-user', localUserId: 'owner' }), { code: 'MEMORY_SELF_BINDING' });
  for (const file of await readdir(path.join(f.directory,'memory'))) assert.doesNotMatch(await readFile(path.join(f.directory,'memory',file),'utf8'), /private-test-token/);
});

test('local runtime starts only on demand and its private connection never leaves status', async t => {
  const mock = upstream(); let running = false, starts = 0;
  const f = await fixture(t, { fetchImpl: mock.fetch, runtime: { status: async () => ({ autoStart: true, available: true, running, password: 'runtime-private' }), connection: async () => running ? { baseUrl: 'http://memory.test', apiKey: 'runtime-private' } : null, start: async () => { running = true; starts++; } } });
  await f.service.status('one'); assert.equal(starts, 0); await f.service.remember('one', event()); await f.service.sync('one'); assert.equal(starts, 1);
  assert.match(await f.service.getContext('one'), /绿茶/); assert.doesNotMatch(JSON.stringify(await f.service.status('one', { admin: true })), /runtime-private/);
});

test('a full journal rejects further writes visibly and never evicts prior events', async t => {
  const f = await fixture(t);
  for (let batch = 0; batch < 10; batch++) await f.service.importSync('one', { epoch: 1, events: Array.from({ length: 200 }, (_, index) => ({ ...event(`record-${batch * 200 + index}`), epoch: 1 })) });
  await assert.rejects(f.service.remember('one', event('overflow')), { code: 'MEMORY_CAPACITY' });
  const status = await f.service.status('one'); assert.equal(status.events, 2000); assert.equal(status.error, 'MEMORY_CAPACITY');
  assert.equal((await f.service.exportSync('one', { epoch: 1, cursor: 0, limit: 1 })).events[0].id, 'record-0');
});

test('remote outage starts only this PC runtime, then central epoch tombstone purges its stale projection', async t => {
  const central = await fixture(t), mock = upstream(); let offline = false, running = false, starts = 0;
  const local = await fixture(t, { instanceId: 'fallback-pc', runtime: { status: async () => ({ running, autoStart: true }), connection: async () => running ? { baseUrl: 'http://local-memory.test', apiKey: 'local-only' } : null, start: async () => { running = true; starts++; } }, fetchImpl: async (url, options = {}) => {
    const route = new URL(url); if (route.hostname === 'local-memory.test') return mock.fetch(url, options);
    if (offline) throw new Error('central temporarily offline');
    if (route.pathname === '/api/auth/me') return Response.json({ instanceId: 'central-one', user: { id: 'remote-one' } });
    if (route.pathname === '/api/memory/sync') {
      if (options.method === 'POST') return Response.json(await central.service.importSync('remote-one', JSON.parse(options.body)));
      const q = route.searchParams; return Response.json(await central.service.exportSync('remote-one', { epoch: Number(q.get('epoch')), cursor: Number(q.get('cursor')), limit: Number(q.get('limit')) }));
    }
    throw new Error('unexpected route');
  } });
  await local.service.bindRemote({ url: 'http://central.test', token: 'synthetic-only', instanceId: 'central-one', userId: 'remote-one', localUserId: 'pc-owner' }); await local.service.sync('pc-owner'); assert.equal(starts, 0);
  offline = true; await local.service.remember('pc-owner', event('offline-fact','我喜欢临时离线散步')); await local.service.sync('pc-owner'); assert.equal(starts, 1); assert.equal(mock.users.size, 1); assert.match(await local.service.getContext('pc-owner'), /离线散步/);
  await central.service.clear('remote-one'); offline = false; await local.service.sync('pc-owner'); assert.equal((await local.service.status('pc-owner')).epoch, 2); assert.equal(mock.users.size, 0); assert.equal(await local.service.getContext('pc-owner'), '');
  assert.equal((await central.service.status('remote-one')).events, 0);
});

function remoteEndpoint() {
  const calls = [], gate = { rejected: false, offline: false, oldRead: null, oldAuth: null };
  const fetch = async (url, options = {}) => {
    const parsed = new URL(url), token = options.headers?.Authorization?.replace('Bearer ','') ?? '', userId = token === 'alpha-private-token' ? 'alpha' : 'beta';
    calls.push({ path: parsed.pathname, userId });
    if (gate.offline) throw new Error('connection unavailable');
    if (parsed.pathname === '/api/auth/me' && userId === 'alpha' && gate.oldAuth) { gate.oldAuth.started.resolve(); await gate.oldAuth.done.promise; }
    if (gate.rejected) return Response.json({ error: 'private authorization detail' }, { status: 401 });
    if (parsed.pathname === '/api/auth/me') return Response.json({ instanceId: 'remote-central', user: { id: userId } });
    if (parsed.pathname === '/api/memory/sync') {
      if (options.method === 'POST') return Response.json({ epoch: 1, accepted: 0 });
      if (userId === 'alpha' && gate.oldRead) { gate.oldRead.started.resolve(); await gate.oldRead.done.promise; }
      return Response.json({ scope: { instanceId: 'remote-central', userId, memobaseUserId: memobaseUserId('remote-central',userId) }, epoch: 1,cursor: 0,nextCursor: 0,events: [],context: `该账号是${userId}，喜欢${userId === 'alpha' ? '绿茶' : '咖啡'}`,hasMore: false });
    }
    throw new Error('unexpected remote route');
  };
  const bind = (service,userId = 'alpha') => service.bindRemote({ url: 'http://central.test',token: `${userId}-private-token`,instanceId: 'remote-central',userId,localUserId: 'owner' });
  return { calls,gate,fetch,bind };
}

test('saved remote tokens are reverified after restart; revocation removes credentials and blocks old cached facts', async t => {
  const remote = remoteEndpoint(), f = await fixture(t, { instanceId: 'local-pc',fetchImpl: remote.fetch });
  await remote.bind(f.service); await f.service.sync('owner'); assert.match(await f.service.getContext('owner'), /alpha/);
  await f.reopen(); const callsBefore = remote.calls.length; remote.gate.rejected = true;
  assert.equal(await f.service.getContext('owner'), '');
  assert.deepEqual(remote.calls.slice(callsBefore).map(item => item.path), ['/api/auth/me']);
  assert.equal((await f.service.status('owner')).mode,'remote-auth-required');
  assert.doesNotMatch(await readFile(path.join(f.directory,'memory','config.json'),'utf8'), /alpha-private-token/);
  await f.reopen(); assert.equal(await f.service.getContext('owner'),''); assert.equal((await f.service.remember('owner',event())).reason,'authentication-required');
  remote.gate.rejected = false; await remote.bind(f.service); assert.match(await f.service.getContext('owner'),/alpha/);
});

test('HTTP 401 after a verified connection immediately prevents cached context and fallback execution', async t => {
  const remote = remoteEndpoint(); let starts = 0;
  const f = await fixture(t, { instanceId: 'local-pc',fetchImpl: remote.fetch,runtime: { status: async () => ({ autoStart: true }),connection: async () => null,start: async () => { starts++; } } });
  await remote.bind(f.service); await f.service.sync('owner'); assert.match(await f.service.getContext('owner'),/绿茶/);
  remote.gate.rejected = true; await f.service.sync('owner'); assert.equal(starts,0); assert.equal(await f.service.getContext('owner'),'');
  assert.equal((await f.service.status('owner')).error,'MEMORY_REMOTE_AUTH_REQUIRED');
});

test('previously verified saved bindings retry auth first but preserve offline cache and fallback on network failure', async t => {
  const remote = remoteEndpoint(); let starts = 0;
  const f = await fixture(t, { instanceId: 'local-pc',fetchImpl: remote.fetch,runtime: { status: async () => ({ autoStart: true }),connection: async () => null,start: async () => { starts++; } } });
  await remote.bind(f.service); await f.service.sync('owner'); await f.reopen(); remote.gate.offline = true;
  assert.match(await f.service.getContext('owner'),/绿茶/); await f.service.sync('owner'); assert.equal(starts,1);
  remote.gate.offline = false; assert.match(await f.service.getContext('owner'),/绿茶/);
});

test('late context responses cannot cross an account switch or unbind', async t => {
  const remote = remoteEndpoint(), f = await fixture(t, { instanceId: 'local-pc',fetchImpl: remote.fetch });
  await remote.bind(f.service); await f.service.sync('owner');
  const read = { started: deferred(),done: deferred() }; remote.gate.oldRead = read;
  const oldContext = f.service.getContext('owner'); await read.started.promise;
  await remote.bind(f.service,'beta'); await f.service.sync('owner'); read.done.resolve(); assert.equal(await oldContext,'');
  const current = await f.service.getContext('owner'); assert.match(current,/beta/); assert.doesNotMatch(current,/alpha|绿茶/);
  await f.service.unbindRemote(); assert.equal(await f.service.getContext('owner'),'');
});

test('a late bind cannot overwrite a newer bind or undo logout', async t => {
  const remote = remoteEndpoint(), f = await fixture(t, { instanceId: 'local-pc',fetchImpl: remote.fetch });
  const auth = { started: deferred(),done: deferred() }; remote.gate.oldAuth = auth;
  const first = remote.bind(f.service).catch(error => error); await auth.started.promise;
  await remote.bind(f.service,'beta'); auth.done.resolve(); assert.equal((await first).code,'MEMORY_SYNC_BINDING_CHANGED');
  assert.equal((await f.service.status('owner')).scope.userId,'beta');
  const saved = await readFile(path.join(f.directory,'memory','config.json'),'utf8'); assert.match(saved,/beta-private-token/); assert.doesNotMatch(saved,/alpha-private-token/);
  await f.service.unbindRemote(); assert.equal((await f.service.status('owner')).scope.instanceId,'local-pc');
});

test('a preexisting memory directory junction is refused without reading or replacing its target', async t => {
  const directory = await mkdtemp(path.join(tmpdir(),'petpal-memory-unsafe-')),outside = path.join(directory,'outside'); await mkdir(outside); const marker = path.join(outside,'config.json'); await writeFile(marker,'external-private-marker');
  t.after(async () => { assert.equal(path.dirname(directory),tmpdir()); assert.ok(path.basename(directory).startsWith('petpal-memory-')); await rm(directory,{ recursive: true,force: true }); });
  await symlink(outside,path.join(directory,'memory'),process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(createMemoryService({ dataDir: directory,instanceId: 'central-one',autoPoll: false }), { code: 'MEMORY_STORAGE_UNSAFE' });
  assert.equal(await readFile(marker,'utf8'),'external-private-marker');
});

test('private config hardlinks and replacement directory junctions cannot redirect writes', async t => {
  const f = await fixture(t); await f.service.configure({ baseUrl: 'http://memory.test',apiKey: 'private-original' });
  const privateFile = path.join(f.directory,'memory','config.json'),outside = path.join(f.directory,'outside-private.json'); await writeFile(outside,'external-private-marker'); await unlink(privateFile); await link(outside,privateFile);
  await assert.rejects(f.service.configure({ apiKey: 'must-not-be-written' }), { code: 'MEMORY_STORAGE_UNSAFE' }); assert.equal(await readFile(outside,'utf8'),'external-private-marker');
  await unlink(privateFile); const oldDirectory = path.join(f.directory,'memory-original'); await rename(path.join(f.directory,'memory'),oldDirectory); const replacement = path.join(f.directory,'replacement'); await mkdir(replacement); await symlink(replacement,path.join(f.directory,'memory'),process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.service.remember('one',event()), error => ['MEMORY_STORAGE_UNSAFE','MEMORY_STORAGE_INVALID'].includes(error.code)); assert.deepEqual(await readdir(replacement),[]);
});

test('failed upstream deletion leaves a durable tombstone, visible pending deletion and no old context after restart', async t => {
  const mock = upstream(); let refuseDelete = true;
  const f = await fixture(t, { fetchImpl: async (url,options) => { if (options.method === 'DELETE' && refuseDelete) return Response.json({ errno: 503 }); return mock.fetch(url,options); } });
  await f.service.configure({ baseUrl: 'http://memory.test',apiKey: 'synthetic-only' }); await f.service.remember('one',event('old-fact','旧记忆')); await f.service.sync('one');
  const cleared = await f.service.clear('one'); assert.equal(cleared.epoch,2); assert.equal(cleared.deletionPending,true); assert.equal(cleared.upstreamDeleted,false); assert.equal(await f.service.getContext('one'),'');
  await f.reopen(); assert.equal((await f.service.status('one')).epoch,2); assert.equal((await f.service.status('one')).deletionPending,true);
  refuseDelete = false; await f.service.sync('one'); assert.equal((await f.service.status('one')).deletionPending,false); await f.service.remember('one',event('new-fact','新记忆')); await f.service.sync('one');
  const context = await f.service.getContext('one'); assert.match(context,/新记忆/); assert.doesNotMatch(context,/旧记忆/);
});

test('late old flush completion cannot contaminate the new memory generation after clear', async t => {
  const mock = upstream(), oldUid = memobaseUserId('central-one','one'), lateFlush = deferred(), started = deferred(); let hold = true;
  const f = await fixture(t, { fetchImpl: async (url,options) => { if (hold && url.includes(`/users/buffer/${oldUid}/`)) { started.resolve(); await lateFlush.promise; } return mock.fetch(url,options); } });
  await f.service.configure({ baseUrl: 'http://memory.test',apiKey: 'synthetic-only' }); await f.service.remember('one',event('old-late','旧代记忆')); await started.promise;
  const clearing = f.service.clear('one');
  for (let attempt = 0; attempt < 100 && (await f.service.status('one')).epoch === 1; attempt++) await new Promise(resolve => setTimeout(resolve,5));
  assert.equal((await f.service.status('one')).epoch,2); assert.equal(await f.service.getContext('one'),'');
  hold = false; lateFlush.resolve(); await clearing;
  await f.service.remember('one',event('new-generation','新代偏好')); await f.service.sync('one');
  // Simulate a server-side background continuation arriving after the acknowledged DELETE.
  mock.users.set(oldUid,{ blobs: new Map(),context: '旧代后台延迟结果' });
  assert.notEqual(memobaseProjectionUserId('central-one','one',2),oldUid);
  const context = await f.service.getContext('one'); assert.match(context,/新代偏好/); assert.doesNotMatch(context,/旧代/);
});

test('close aborts promptly even when an upstream ignores cancellation; no late journal mutation follows', async t => {
  const mock = upstream(), started = deferred(), release = deferred(); let hold = true;
  const f = await fixture(t, { closeGraceMs: 40,fetchImpl: async (url,options) => { if (hold && url.includes('/users/buffer/')) { started.resolve(); await release.promise; } return mock.fetch(url,options); } });
  await f.service.configure({ baseUrl: 'http://memory.test',apiKey: 'synthetic-only' }); await f.service.remember('one',event('pending-flush')); await started.promise;
  const startedAt = performance.now(); await f.service.close(); assert.ok(performance.now() - startedAt < 300);
  const files = await readdir(path.join(f.directory,'memory')); const before = await Promise.all(files.map(file => readFile(path.join(f.directory,'memory',file),'utf8')));
  hold = false; release.resolve(); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  const after = await Promise.all(files.map(file => readFile(path.join(f.directory,'memory',file),'utf8'))); assert.deepEqual(after,before);
});

test('administrator runtime status preserves the actual manager shape and ordinary users receive no runtime', async t => {
  const runtimeDirectory = await mkdtemp(path.join(tmpdir(),'petpal-memory-runtime-status-'));
  let invoked = 0;
  const manager = await createMemobaseRuntime({ directory: runtimeDirectory,platform: 'linux',arch: 'arm64',fetchImpl: async () => { invoked++; throw new Error('must not connect'); },spawnImpl: () => { invoked++; throw new Error('must not spawn'); } });
  t.after(async () => { await manager.close(); assert.equal(path.dirname(runtimeDirectory),tmpdir()); assert.ok(path.basename(runtimeDirectory).startsWith('petpal-memory-')); await rm(runtimeDirectory,{ recursive: true,force: true }); });
  const f = await fixture(t,{ runtime: manager });
  let status = await f.service.status('one',{ admin: true });
  assert.deepEqual(status.runtime,{ supported: true,prepared: false,configured: false,state: 'stopped',running: false,autoStart: true,needsModel: true,platform: 'linux',arch: 'arm64',version: '0.0.42',port: 8019,error: '' });
  await manager.configureModel({ baseUrl: 'https://provider.example.test/v1',apiKey: 'synthetic-private-provider-key',model: 'synthetic-model' });
  status = await f.service.status('one',{ admin: true }); assert.equal(status.runtime.configured,true); assert.equal(status.runtime.needsModel,false); assert.equal(status.runtime.state,'stopped');
  assert.equal(Object.hasOwn(await f.service.status('one'),'runtime'),false); assert.equal(invoked,0); assert.doesNotMatch(JSON.stringify(status),/synthetic-private-provider-key|available|installed/);
});

test('runtime status exposes only validated public metadata and fixed known errors', async t => {
  const raw = { supported: true,prepared: true,configured: true,state: 'running',running: true,autoStart: false,needsModel: false,platform: 'win32',arch: 'x64',version: '0.0.42',port: 8019,dockerAvailable: true,daemonAvailable: false,error: MEMOBASE_RUNTIME_PUBLIC_MESSAGES[0],apiKey: 'private-runtime-token',command: 'private-command',baseUrl: 'http://private.example.test',available: true,installed: true };
  const f = await fixture(t,{ runtime: { status: async () => raw,connection: async () => null } });
  const status = (await f.service.status('one',{ admin: true })).runtime;
  assert.deepEqual(Object.keys(status).sort(),['supported','prepared','configured','state','running','autoStart','needsModel','platform','arch','version','port','dockerAvailable','daemonAvailable','error'].sort());
  assert.equal(status.error,MEMOBASE_RUNTIME_PUBLIC_MESSAGES[0]); assert.equal(status.dockerAvailable,true); assert.equal(status.daemonAvailable,false); assert.equal(status.running,true);
  raw.state = 'private-runtime-token'; raw.error = 'private-runtime-token'; raw.version = 'private-runtime-token'; raw.platform = 'private-runtime-token'; raw.arch = 'private-runtime-token'; raw.port = -1;
  const sanitized = (await f.service.status('one',{ admin: true })).runtime;
  assert.equal(sanitized.state,'error'); assert.equal(sanitized.running,false); assert.match(sanitized.error,/暂不可用/); assert.doesNotMatch(JSON.stringify(sanitized),/private-runtime-token|private-command|private\.example\.test/);
});

async function httpFixture(t,handler) {
  const server = createServer(async (request,response) => {
    try {
      let body = ''; for await (const chunk of request) body += chunk;
      const result = await handler(new URL(request.url,'http://127.0.0.1'),{ method: request.method,headers: { Authorization: request.headers.authorization },...(body ? { body } : {}) });
      response.writeHead(result.status,{ 'Content-Type': 'application/json' }); response.end(await result.text());
    } catch { response.writeHead(500,{ 'Content-Type': 'application/json' }); response.end('{"error":"synthetic server error"}'); }
  });
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  let closed = false;
  const close = async () => { if (closed) return; closed = true; await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); };
  t.after(close);
  return { baseUrl: `http://127.0.0.1:${server.address().port}`,close };
}

test('a cold PC service automatically resumes its saved account and starts fallback when real HTTP central connection fails', async t => {
  const central = await fixture(t),mock = upstream(),started = deferred(); let running = false,starts = 0;
  const centralHttp = await httpFixture(t,async (url,options) => {
    if (url.pathname === '/api/auth/me') return Response.json({ instanceId: 'central-one',user: { id: 'remote-one' } });
    if (options.method === 'POST') return Response.json(await central.service.importSync('remote-one',JSON.parse(options.body)));
    return Response.json(await central.service.exportSync('remote-one',{ epoch: Number(url.searchParams.get('epoch')),cursor: Number(url.searchParams.get('cursor')),limit: Number(url.searchParams.get('limit')) }));
  });
  const localHttp = await httpFixture(t,(url,options) => mock.fetch(url.href,options));
  const runtime = { status: async () => ({ autoStart: true,running }),connection: async () => running ? { baseUrl: localHttp.baseUrl,apiKey: 'local-synthetic-only' } : null,start: async () => { running = true; starts++; started.resolve(); } };
  const local = await fixture(t,{ instanceId: 'cold-local-pc',autoPoll: true,syncIntervalMs: 1000,runtime });
  await local.service.bindRemote({ url: centralHttp.baseUrl,token: 'synthetic-account-token',instanceId: 'central-one',userId: 'remote-one',localUserId: 'owner' });
  await local.service.remember('owner',event('before-restart','重启之前的本机偏好')); await local.service.sync('owner'); assert.equal(starts,0);
  await local.service.close(); await centralHttp.close();
  const reopenedAt = performance.now(); await local.reopen(); assert.ok(performance.now() - reopenedAt < 300,'factory must not await a remote request');
  let timeout; try { await Promise.race([started.promise,new Promise((_,reject) => { timeout = setTimeout(() => reject(new Error('saved binding was never resumed')),2000); })]); } finally { clearTimeout(timeout); }
  // No bindRemote, getState, status or getContext call was made after reopening.
  assert.equal(starts,1); await local.service.sync('owner');
  assert.equal((await local.service.status('owner')).mode,'fallback'); assert.match(await local.service.getContext('owner'),/重启之前的本机偏好/);
  await local.service.remember('owner',event('after-restart','中央离线期间新增偏好')); assert.equal((await local.service.status('owner')).events,2);
});

test('autoPoll false leaves saved bindings silent until an explicit operation', async t => {
  const remote = remoteEndpoint(); let starts = 0;
  const local = await fixture(t,{ instanceId: 'silent-local-pc',autoPoll: false,fetchImpl: remote.fetch,runtime: { status: async () => ({ autoStart: true }),connection: async () => null,start: async () => { starts++; } } });
  await remote.bind(local.service); await local.service.sync('owner'); await local.service.close(); const before = remote.calls.length; remote.gate.offline = true;
  await local.reopen(); await new Promise(resolve => setTimeout(resolve,50)); assert.equal(remote.calls.length,before); assert.equal(starts,0);
});

for (const revoke of ['user-switch','global-switch','account-disabled']) test(`late context cannot survive ${revoke}`, async t => {
  const mock = upstream(),started = deferred(),release = deferred(); let active = true;
  const f = await fixture(t,{ fetchImpl: mock.fetch,scopeForUser: userId => { if (!active) throw Object.assign(new Error('account disabled'),{ status: 401 }); return { instanceId: 'central-one',userId }; } });
  await f.service.configure({ baseUrl: 'http://memory.test',apiKey: 'synthetic-only' }); await f.service.remember('one',event()); await f.service.sync('one');
  mock.gate.context = async () => { started.resolve(); await release.promise; return ok({ context: '仅在开关关闭以后才返回的旧偏好' }); };
  const context = f.service.getContext('one'); await started.promise;
  if (revoke === 'user-switch') await f.service.setEnabled('one',false);
  else if (revoke === 'global-switch') await f.service.configure({ enabled: false });
  else active = false;
  release.resolve(); assert.equal(await context,'');
  const files = await readdir(path.join(f.directory,'memory')); const journals = files.filter(file => file !== 'config.json' && file.endsWith('.json'));
  for (const file of journals) assert.doesNotMatch(await readFile(path.join(f.directory,'memory',file),'utf8'),/仅在开关关闭以后才返回/);
});

test('a pause intent immediately fences a durable mutation already queued behind an asynchronous scope check', async t => {
  const started = deferred(),release = deferred(); let calls = 0,block = false;
  const f = await fixture(t,{ scopeForUser: async userId => { if (block && ++calls === 3) { started.resolve(); await release.promise; } return { instanceId: 'central-one',userId }; } });
  await f.service.status('one'); block = true;
  const recording = f.service.remember('one',event('queued-before-pause')).catch(error => error); await started.promise;
  const paused = f.service.setEnabled('one',false);
  for (let attempt = 0; attempt < 100 && (await f.service.status('one')).enabled; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.service.status('one')).enabled,false); release.resolve();
  const result = await recording; assert.equal(result.code,'MEMORY_REVOKED'); await paused;
  assert.equal((await f.service.status('one')).events,0);
  const files = await readdir(path.join(f.directory,'memory')); assert.equal(files.some(file => file.endsWith('.tmp')),false);
});

for (const revoke of ['user-switch','global-switch','account-disabled']) test(`projection stops before the next event after ${revoke}`, async t => {
  const mock = upstream(),started = deferred(),release = deferred(); let active = true,firstInsert = true;
  const f = await fixture(t,{ scopeForUser: userId => { if (!active) throw Object.assign(new Error('account disabled'),{ status: 401 }); return { instanceId: 'central-one',userId }; },fetchImpl: async (url,options) => {
    if (firstInsert && url.includes('/blobs/insert/')) { firstInsert = false; started.resolve(); await release.promise; }
    return mock.fetch(url,options);
  } });
  await f.service.remember('one',event('first-before-revocation')); await f.service.remember('one',event('must-not-submit-after-revocation')); await f.service.sync('one');
  await f.service.configure({ baseUrl: 'http://memory.test',apiKey: 'synthetic-only' }); const synchronization = f.service.sync('one').catch(error => error); await started.promise;
  if (revoke === 'user-switch') await f.service.setEnabled('one',false);
  else if (revoke === 'global-switch') await f.service.configure({ enabled: false });
  else active = false;
  release.resolve(); await synchronization;
  assert.equal(mock.calls.filter(call => call.url.includes('/blobs/insert/')).length,1); assert.equal(mock.calls.filter(call => call.url.includes('/users/buffer/')).length,0); assert.equal(await f.service.getContext('one'),'');
  const files = await readdir(path.join(f.directory,'memory')); const journalFile = files.find(file => file !== 'config.json' && file.endsWith('.json')); const stored = JSON.parse(await readFile(path.join(f.directory,'memory',journalFile),'utf8'));
  assert.equal(stored.events.length,2); assert.equal(stored.events[1].projection.status,'pending');
});

test('turning memory off still permits a durable clear tombstone to finish deleting its old projection', async t => {
  const mock = upstream(); let refuseDelete = true;
  const f = await fixture(t,{ fetchImpl: async (url,options) => options.method === 'DELETE' && refuseDelete ? Response.json({ errno: 503 }) : mock.fetch(url,options) });
  await f.service.configure({ baseUrl: 'http://memory.test',apiKey: 'synthetic-only' }); await f.service.remember('one',event()); await f.service.sync('one');
  assert.equal((await f.service.clear('one')).pendingReset,true); await f.service.setEnabled('one',false); refuseDelete = false;
  await f.service.sync('one'); const status = await f.service.status('one'); assert.equal(status.enabled,false); assert.equal(status.pendingReset,false); assert.equal(mock.users.size,0);
  assert.equal((await f.service.clear('one')).upstreamDeleted,true); assert.equal(await f.service.getContext('one'),'');
});

test('background cleanup can delete an already-cleared projection after the account itself is disabled', async t => {
  const mock = upstream(),deleted = deferred(); let active = true,refuseDelete = true;
  const f = await fixture(t,{ autoPoll: true,syncIntervalMs: 1000,scopeForUser: userId => { if (!active) throw Object.assign(new Error('account disabled'),{ status: 401 }); return { instanceId: 'central-one',userId }; },fetchImpl: async (url,options) => {
    if (options.method === 'DELETE') { if (refuseDelete) return Response.json({ errno: 503 }); const result = await mock.fetch(url,options); deleted.resolve(); return result; }
    return mock.fetch(url,options);
  } });
  await f.service.configure({ baseUrl: 'http://memory.test',apiKey: 'synthetic-only' }); await f.service.remember('one',event()); await f.service.sync('one'); await f.service.clear('one');
  active = false; refuseDelete = false;
  let timeout; try { await Promise.race([deleted.promise,new Promise((_,reject) => { timeout = setTimeout(() => reject(new Error('disabled cleanup did not resume')),2500); })]); } finally { clearTimeout(timeout); }
  assert.equal(mock.users.size,0); assert.equal(await f.service.getContext('one'),'');
});
