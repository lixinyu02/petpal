import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { createMemoryService, memobaseUserId, memobaseProjectionUserId } from '../server/memory-service.mjs';

// All accounts, facts, credentials and Memobase responses in this file are
// synthetic. Real MemoryService instances communicate through loopback HTTP;
// extraction and PC runtime startup are simulated, with separate projections.
const CENTRAL = 'sync-depth-central';
const LOCAL_OWNER = 'local-owner';
const tokens = new Map([['synthetic-alpha-token', 'alpha'], ['synthetic-beta-token', 'beta']]);
const event = (id, text) => ({ id, conversationId: `conversation-${id}`, source: 'chat', userText: text, assistantText: '已记录本次合成偏好。' });
const ok = data => Response.json({ errno: 0, errmsg: '', data });

function projection() {
  const users = new Map(), calls = [];
  const fetch = async (url, options = {}) => {
    options.signal?.throwIfAborted();
    const parsed = new URL(url), route = parsed.pathname.replace('/api/v1', ''), body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ route, method: options.method ?? 'GET', body });
    if (route === '/users' && options.method === 'POST') {
      assert.equal(users.has(body.id), false, 'ensureUser must not replace an existing projection');
      users.set(body.id, { blobs: new Map(), context: '' }); return ok({ id: body.id });
    }
    let match = route.match(/^\/users\/([a-f0-9-]+)$/);
    if (match) {
      if (options.method === 'DELETE') { users.delete(match[1]); return ok(null); }
      return users.has(match[1]) ? ok({ data: {} }) : Response.json({ errno: 404 });
    }
    match = route.match(/^\/blobs\/insert\/([a-f0-9-]+)$/);
    if (match) {
      const user = users.get(match[1]); assert.ok(user, 'insert must target an existing projection');
      const id = randomUUID(); user.blobs.set(id, body); return ok({ id });
    }
    match = route.match(/^\/users\/blobs\/([a-f0-9-]+)\/chat$/);
    if (match) {
      const page = Number(parsed.searchParams.get('page'));
      return ok({ ids: [...(users.get(match[1])?.blobs.keys() ?? [])].slice(page * 50, page * 50 + 50) });
    }
    match = route.match(/^\/blobs\/([a-f0-9-]+)\/([a-f0-9-]+)$/);
    if (match) return ok(users.get(match[1])?.blobs.get(match[2]));
    match = route.match(/^\/users\/buffer\/([a-f0-9-]+)\/chat$/);
    if (match) {
      const user = users.get(match[1]); assert.ok(user);
      user.context = [...user.blobs.values()].map(blob => blob.blob_data.messages[0].content).join('\n');
      return ok([]);
    }
    match = route.match(/^\/users\/context\/([a-f0-9-]+)$/);
    if (match) return ok({ context: users.get(match[1])?.context ?? '' });
    throw new Error(`Unhandled synthetic Memobase route: ${route}`);
  };
  return { fetch, users, calls, inserts: () => calls.filter(call => call.route.startsWith('/blobs/insert/')).length };
}

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-memory-sync-depth-'));
  const centralProjection = projection(), pcs = [], requests = [];
  const central = await createMemoryService({ dataDir: path.join(directory, 'central'), instanceId: CENTRAL, autoPoll: false, fetchImpl: centralProjection.fetch,
    scopeForUser: userId => {
      assert.ok(['alpha', 'beta'].includes(userId), 'central scope must be an authenticated synthetic account');
      return { instanceId: CENTRAL, userId };
    },
  });
  await central.configure({ baseUrl: 'http://central-memobase.test', apiKey: 'synthetic-central-memobase-key' });
  const server = createServer(async (req, res) => {
    try {
      const userId = tokens.get(req.headers.authorization?.replace('Bearer ', ''));
      if (!userId) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'synthetic unauthorized' })); return; }
      const url = new URL(req.url, 'http://127.0.0.1'); requests.push({ userId, route: url.pathname, method: req.method, query: Object.fromEntries(url.searchParams) });
      let result;
      if (url.pathname === '/api/auth/me') result = { instanceId: CENTRAL, user: { id: userId } };
      else if (url.pathname === '/api/memory/sync' && req.method === 'GET') {
        result = await central.exportSync(userId, { epoch: Number(url.searchParams.get('epoch')), cursor: Number(url.searchParams.get('cursor')), limit: Number(url.searchParams.get('limit')) });
      } else if (url.pathname === '/api/memory/sync' && req.method === 'POST') {
        let raw = ''; for await (const chunk of req) raw += chunk;
        result = await central.importSync(userId, JSON.parse(raw));
      } else if (url.pathname === '/api/memory' && req.method === 'DELETE') {
        await central.clear(userId); result = { memory: await central.status(userId) };
      } else { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(error.status ?? 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.code ?? 'SYNTHETIC_SERVER_FAILURE' }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await Promise.all(pcs.map(pc => pc.service.close())); await central.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    const resolved = path.resolve(directory), parent = path.resolve(tmpdir());
    assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith('petpal-memory-sync-depth-'));
    await rm(resolved, { recursive: true, force: true });
  });
  return {
    central, centralProjection, requests,
    async pc(label, userId = 'alpha', { autoStart = true } = {}) {
      const localProjection = projection(), runtime = { running: false, autoStart, starts: 0 }, gate = { offline: false, loseUploadResponse: false, isolatedAfterCommit: false };
      const memoryHost = `memory-${label}.test`, options = {
        dataDir: path.join(directory, label), instanceId: `sync-depth-${label}`, autoPoll: false,
        runtime: {
          status: async () => ({ running: runtime.running, autoStart: runtime.autoStart }),
          connection: async () => runtime.running ? { baseUrl: `http://${memoryHost}`, apiKey: 'synthetic-local-memobase-key' } : null,
          start: async () => { runtime.running = true; runtime.starts++; },
        },
        fetchImpl: async (url, init) => {
          if (new URL(url).hostname === memoryHost) return localProjection.fetch(url, init);
          assert.equal(new URL(url).origin, baseUrl, 'the PC must not contact any unrelated service');
          const route = new URL(url).pathname;
          if (gate.offline || gate.isolatedAfterCommit && route === '/api/memory/sync') throw new Error('synthetic central connection interruption');
          const response = await fetch(url, init);
          if (gate.loseUploadResponse && route === '/api/memory/sync' && init.method === 'POST' && response.ok) {
            gate.isolatedAfterCommit = true; await response.body.cancel();
            throw new Error('synthetic response lost after the central journal accepted the upload');
          }
          return response;
        },
      };
      const pc = { service: await createMemoryService(options), localProjection, runtime, gate,
        async reopen() { await pc.service.close(); pc.service = await createMemoryService(options); },
      };
      pcs.push(pc);
      await pc.service.bindRemote({ url: baseUrl, token: `synthetic-${userId}-token`, instanceId: CENTRAL, userId, localUserId: LOCAL_OWNER });
      await pc.service.sync(LOCAL_OWNER); return pc;
    },
  };
}

async function seed(f) {
  await f.central.remember('alpha', event('alpha-seed', '合成用户甲喜欢青苹果'));
  await f.central.remember('beta', event('beta-seed', '合成用户乙喜欢紫葡萄'));
  await f.central.sync('alpha'); await f.central.sync('beta');
}

test('two PCs converge on the same account while another account and local user remain separate', { timeout: 15000 }, async t => {
  const f = await fixture(t); await seed(f);
  const first = await f.pc('first'), second = await f.pc('second'), beta = await f.pc('beta', 'beta');
  assert.match(await first.service.getContext(LOCAL_OWNER), /青苹果/);
  assert.match(await beta.service.getContext(LOCAL_OWNER), /紫葡萄/);
  await first.service.remember(LOCAL_OWNER, event('first-pc', '合成用户甲在第一台电脑偏好晨间阅读'));
  await second.service.remember(LOCAL_OWNER, event('second-pc', '合成用户甲在第二台电脑偏好夜间散步'));
  await Promise.all([first.service.sync(LOCAL_OWNER), second.service.sync(LOCAL_OWNER)]);
  await f.central.sync('alpha');
  await Promise.all([first.service.sync(LOCAL_OWNER), second.service.sync(LOCAL_OWNER), beta.service.sync(LOCAL_OWNER)]);
  for (const pc of [first, second]) {
    const status = await pc.service.status(LOCAL_OWNER);
    assert.equal(status.scope.memobaseUserId, memobaseUserId(CENTRAL, 'alpha')); assert.equal(status.events, 3); assert.equal(status.pendingSync, 0);
    const context = await pc.service.getContext(LOCAL_OWNER);
    assert.match(context, /青苹果/); assert.match(context, /晨间阅读/); assert.match(context, /夜间散步/); assert.doesNotMatch(context, /紫葡萄/);
    assert.equal(pc.runtime.starts, 0); assert.equal(pc.localProjection.users.size, 0);
  }
  const betaSnapshot = await f.central.exportSync('beta', { epoch: 1 });
  assert.deepEqual(betaSnapshot.events.map(item => item.id), ['beta-seed']); assert.doesNotMatch(await beta.service.getContext(LOCAL_OWNER), /青苹果|晨间阅读|夜间散步/);
  assert.equal((await first.service.status('other-local')).scope.memobaseUserId, memobaseUserId('sync-depth-first', 'other-local'));
  assert.equal((await first.service.status('other-local')).events, 0);
  assert.equal(f.centralProjection.inserts(), 4, 'each synthetic reply projects once despite two-way convergence');
});

test('central outage preserves cached facts, starts only the permitted PC fallback, and catches up after a cold service reopen', { timeout: 15000 }, async t => {
  const f = await fixture(t); await seed(f); const pc = await f.pc('offline', 'alpha', { autoStart: false });
  pc.gate.offline = true; await pc.service.sync(LOCAL_OWNER);
  assert.equal((await pc.service.status(LOCAL_OWNER)).mode, 'cached'); assert.match(await pc.service.getContext(LOCAL_OWNER), /青苹果/);
  assert.equal(pc.runtime.starts, 0); assert.equal(pc.localProjection.users.size, 0);
  pc.runtime.autoStart = true;
  await pc.service.remember(LOCAL_OWNER, event('offline-reply', '合成用户甲离线时偏好听雨'));
  await pc.service.sync(LOCAL_OWNER);
  assert.equal(pc.runtime.starts, 1); assert.equal((await pc.service.status(LOCAL_OWNER)).mode, 'fallback');
  assert.deepEqual([...pc.localProjection.users.keys()], [memobaseUserId(CENTRAL, 'alpha')]);
  await pc.reopen();
  assert.match(await pc.service.getContext(LOCAL_OWNER), /青苹果/); assert.match(await pc.service.getContext(LOCAL_OWNER), /听雨/);
  await pc.service.sync(LOCAL_OWNER); assert.equal(pc.runtime.starts, 1);
  pc.gate.offline = false; await pc.service.sync(LOCAL_OWNER); await f.central.sync('alpha'); await pc.service.sync(LOCAL_OWNER);
  const status = await pc.service.status(LOCAL_OWNER);
  assert.equal(status.mode, 'central-sync'); assert.equal(status.pendingSync, 0); assert.equal(status.events, 2);
  const alpha = await f.central.exportSync('alpha', { epoch: 1 }), beta = await f.central.exportSync('beta', { epoch: 1 });
  assert.deepEqual(alpha.events.map(item => item.id), ['alpha-seed', 'offline-reply']); assert.deepEqual(beta.events.map(item => item.id), ['beta-seed']);
  assert.equal(f.centralProjection.inserts(), 3); assert.equal(pc.localProjection.inserts(), 2);
  assert.doesNotMatch(await pc.service.getContext(LOCAL_OWNER), /紫葡萄/);
});

test('a central clear discards stale offline replies and projection, without clearing another central or local account', { timeout: 15000 }, async t => {
  const f = await fixture(t); await seed(f); const pc = await f.pc('clear');
  pc.gate.offline = true;
  await pc.service.remember(LOCAL_OWNER, event('stale-offline', '合成用户甲的旧代离线偏好'));
  await pc.service.sync(LOCAL_OWNER);
  await pc.service.remember('other-local', event('local-independent', '独立本机用户偏好棋类'));
  await pc.service.sync('other-local');
  const localOtherUid = memobaseUserId('sync-depth-clear', 'other-local'), oldAlphaUid = memobaseUserId(CENTRAL, 'alpha');
  assert.equal(pc.localProjection.users.size, 2);
  const stale = await pc.service.exportSync(LOCAL_OWNER, { epoch: 1 });
  assert.deepEqual(stale.events.map(item => item.id), ['alpha-seed', 'stale-offline']);
  const betaBefore = await f.central.exportSync('beta', { epoch: 1 });
  await f.central.clear('alpha'); pc.gate.offline = false; await pc.service.sync(LOCAL_OWNER);
  const cleared = await pc.service.status(LOCAL_OWNER);
  assert.equal(cleared.epoch, 2); assert.equal(cleared.events, 0); assert.equal(cleared.pendingSync, 0); assert.equal(await pc.service.getContext(LOCAL_OWNER), '');
  assert.equal(pc.localProjection.users.has(oldAlphaUid), false); assert.equal(pc.localProjection.users.has(localOtherUid), true);
  assert.equal(pc.localProjection.users.has(memobaseProjectionUserId(CENTRAL, 'alpha', 2)), false, 'online synchronization does not start a new local projection');
  await assert.rejects(f.central.importSync('alpha', { epoch: 1, events: stale.events }), { code: 'MEMORY_EPOCH_CONFLICT' });
  assert.deepEqual((await f.central.exportSync('beta', { epoch: 1 })).events, betaBefore.events);
  assert.match(await pc.service.getContext('other-local'), /棋类/); assert.doesNotMatch(await pc.service.getContext('other-local'), /青苹果|旧代/);
  await pc.reopen(); assert.equal((await pc.service.status(LOCAL_OWNER)).epoch, 2); assert.equal(await pc.service.getContext(LOCAL_OWNER), '');
  await pc.service.remember(LOCAL_OWNER, event('new-epoch', '合成用户甲的新代偏好')); await pc.service.sync(LOCAL_OWNER); await f.central.sync('alpha');
  const context = await pc.service.getContext(LOCAL_OWNER); assert.match(context, /新代偏好/); assert.doesNotMatch(context, /青苹果|旧代|棋类|紫葡萄/);
  assert.equal((await f.central.status('beta')).epoch, 1);
});

test('a committed upload with a lost response is reconciled after restart without duplicating either account', { timeout: 15000 }, async t => {
  const f = await fixture(t); await seed(f); const pc = await f.pc('ambiguous-upload', 'alpha', { autoStart: false });
  pc.gate.loseUploadResponse = true;
  await pc.service.remember(LOCAL_OWNER, event('commit-without-reply', '合成用户甲提交后断线的偏好'));
  await pc.service.sync(LOCAL_OWNER);
  assert.equal(pc.gate.isolatedAfterCommit, true, 'the central service accepted the actual HTTP POST before its response was discarded');
  assert.equal((await f.central.status('alpha')).events, 2); assert.equal((await pc.service.status(LOCAL_OWNER)).pendingSync, 1);
  assert.equal(pc.runtime.starts, 0);
  await f.central.sync('alpha'); await pc.reopen();
  pc.gate.loseUploadResponse = false; pc.gate.isolatedAfterCommit = false;
  await pc.service.sync(LOCAL_OWNER); await pc.service.sync(LOCAL_OWNER);
  const alpha = await f.central.exportSync('alpha', { epoch: 1 }), beta = await f.central.exportSync('beta', { epoch: 1 });
  assert.deepEqual(alpha.events.map(item => item.id), ['alpha-seed', 'commit-without-reply']); assert.deepEqual(beta.events.map(item => item.id), ['beta-seed']);
  assert.equal((await pc.service.status(LOCAL_OWNER)).pendingSync, 0); assert.equal((await pc.service.status(LOCAL_OWNER)).events, 2);
  assert.equal(f.centralProjection.inserts(), 3); assert.equal(pc.localProjection.inserts(), 0);
  assert.match(await pc.service.getContext(LOCAL_OWNER), /提交后断线/); assert.doesNotMatch(await pc.service.getContext(LOCAL_OWNER), /紫葡萄/);
});

test('characterization/current-device-local-policy: central memory disable does not propagate an enablement flag to a bound PC', { timeout: 15000 }, async t => {
  const f = await fixture(t); await seed(f); const pc = await f.pc('preferences');
  await f.central.setEnabled('alpha', false);
  const snapshot = await f.central.exportSync('alpha', { epoch: 1 });
  assert.equal(snapshot.context, ''); assert.equal(snapshot.events.length, 1); assert.equal(Object.hasOwn(snapshot, 'enabled'), false);
  assert.equal((await f.central.remember('alpha', event('disabled-central', '不会录入的中央偏好'))).reason, 'disabled');
  await pc.service.sync(LOCAL_OWNER);
  assert.equal((await pc.service.status(LOCAL_OWNER)).enabled, true); assert.equal(await pc.service.getContext(LOCAL_OWNER), '');
  await pc.service.remember(LOCAL_OWNER, event('pc-after-central-disable', '合成用户甲在中央关闭后仍录入本机偏好'));
  await pc.service.sync(LOCAL_OWNER);
  assert.equal((await pc.service.status(LOCAL_OWNER)).pendingSync, 1);
  assert.equal(pc.runtime.starts, 0, 'a central HTTP 409 does not itself permit fallback startup');
  assert.equal((await f.central.status('alpha')).events, 1, 'the disabled central journal rejects the PC upload');
  pc.gate.offline = true; await pc.service.sync(LOCAL_OWNER);
  assert.equal(pc.runtime.starts, 1); assert.equal((await pc.service.status(LOCAL_OWNER)).mode, 'fallback');
  assert.match(await pc.service.getContext(LOCAL_OWNER), /中央关闭后仍录入本机偏好/);
  assert.equal((await f.central.status('alpha')).enabled, false); assert.equal((await f.central.status('beta')).enabled, true);
  t.diagnostic('Observed behavior: central preference disables central context/writes, but the sync snapshot omits enabled; the PC remains enabled and can recall/project the same account offline. This is a cross-device preference policy gap, not cross-account disclosure.');
  // Characterize recovery explicitly: the cross-device setting policy still
  // needs a product decision. This observation is not a recommended permanent
  // contract or proof that a central disable protects PCs.
  pc.gate.offline = false; await f.central.setEnabled('alpha', true); await pc.service.sync(LOCAL_OWNER); await f.central.sync('alpha');
  assert.equal((await pc.service.status(LOCAL_OWNER)).pendingSync, 0); assert.equal((await f.central.status('alpha')).events, 2);
  await pc.service.setEnabled(LOCAL_OWNER, false);
  assert.equal(await pc.service.getContext(LOCAL_OWNER), ''); assert.equal((await pc.service.remember(LOCAL_OWNER, event('disabled-pc', '不会录入的本机偏好'))).reason, 'disabled');
  assert.equal((await f.central.status('alpha')).enabled, true, 'a PC preference change also remains local');
  await pc.reopen(); assert.equal((await pc.service.status(LOCAL_OWNER)).enabled, false); assert.equal(await pc.service.getContext(LOCAL_OWNER), '');
  await pc.service.setEnabled(LOCAL_OWNER, true); await pc.service.sync(LOCAL_OWNER);
  assert.match(await pc.service.getContext(LOCAL_OWNER), /中央关闭后仍录入本机偏好/); assert.doesNotMatch(await pc.service.getContext(LOCAL_OWNER), /紫葡萄/);
});

test('237 ordered replies cross both sync page boundaries, retain the cursor after restart, and merge incremental replies once', { timeout: 30000 }, async t => {
  const f = await fixture(t), initial = Array.from({ length: 237 }, (_, index) => event(`paged-${String(index).padStart(3, '0')}`, `合成用户甲的分页记录${index}`));
  await f.central.remember('beta', event('beta-page-independent', '合成用户乙的独立分页标记'));
  for (let offset = 0; offset < initial.length; offset += 100) {
    const batch = initial.slice(offset, offset + 100); assert.ok(batch.length <= 100);
    const imported = await f.central.importSync('alpha', { epoch: 1, events: batch }); assert.equal(imported.accepted, batch.length);
  }
  await f.central.sync('alpha'); await f.central.sync('beta');
  const pc = await f.pc('pagination'), expectedIds = initial.map(item => item.id);
  const reads = () => f.requests.filter(item => item.userId === 'alpha' && item.route === '/api/memory/sync' && item.method === 'GET');
  for (const cursor of ['0', '100', '200']) assert.ok(reads().some(item => item.query.cursor === cursor && item.query.limit === '100'), `the actual PC HTTP requests must cross cursor ${cursor}`);
  const collect = async () => {
    const events = []; let cursor = 0, snapshot;
    do {
      snapshot = await pc.service.exportSync(LOCAL_OWNER, { epoch: 1, cursor, limit: 100 });
      assert.equal(snapshot.cursor, cursor); events.push(...snapshot.events); cursor = snapshot.nextCursor;
    } while (snapshot.hasMore);
    assert.equal(cursor, events.length); return events;
  };
  let records = await collect();
  assert.deepEqual(records.map(item => item.id), expectedIds); assert.deepEqual(records.map(item => item.seq), Array.from({ length: 237 }, (_, index) => index + 1));
  assert.equal(new Set(records.map(item => item.id)).size, 237); assert.doesNotMatch(JSON.stringify(records), /独立分页标记/);
  assert.equal((await pc.service.status(LOCAL_OWNER)).pendingSync, 0); assert.equal(pc.runtime.starts, 0);
  const beforeRestartReads = reads().length; await pc.reopen(); await pc.service.sync(LOCAL_OWNER);
  assert.equal(reads()[beforeRestartReads].query.cursor, '237', 'the persisted remote cursor must resume at 237 rather than replaying from zero');
  records = await collect(); assert.deepEqual(records.map(item => item.id), expectedIds);
  const incremental = Array.from({ length: 5 }, (_, index) => event(`paged-${index + 237}`, `合成用户甲的增量分页记录${index + 237}`));
  await f.central.importSync('alpha', { epoch: 1, events: incremental }); await f.central.sync('alpha');
  const beforeIncrementalReads = reads().length;
  await pc.service.sync(LOCAL_OWNER); await pc.service.sync(LOCAL_OWNER); await pc.service.sync(LOCAL_OWNER);
  const incrementalReads = reads().slice(beforeIncrementalReads);
  assert.equal(incrementalReads[0].query.cursor, '237'); assert.ok(incrementalReads.some(item => item.query.cursor === '242'));
  records = await collect();
  assert.deepEqual(records.map(item => item.id), [...expectedIds, ...incremental.map(item => item.id)]);
  assert.equal(new Set(records.map(item => item.id)).size, 242); assert.deepEqual(records.map(item => item.seq), Array.from({ length: 242 }, (_, index) => index + 1));
  const alpha = await f.central.status('alpha'), beta = await f.central.exportSync('beta', { epoch: 1 });
  assert.equal(alpha.events, 242); assert.equal((await pc.service.status(LOCAL_OWNER)).events, 242); assert.equal((await pc.service.status(LOCAL_OWNER)).pendingSync, 0);
  assert.deepEqual(beta.events.map(item => item.id), ['beta-page-independent']); assert.equal(f.centralProjection.inserts(), 243);
  assert.equal(pc.localProjection.users.size, 0, 'online pagination must not start or populate the PC fallback');
});
