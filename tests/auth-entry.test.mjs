import { listenFixture } from './helpers/loopback.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPetServer } from '../server/app.mjs';
import { newSession } from '../server/auth.mjs';
import { JsonStore, defaultSettings } from '../server/store.mjs';
import { defaultVoiceSettings } from '../server/voice.mjs';

const bootstrap = 'auth-entry-isolated-owner-token';

function referenceWav() {
  const samples = 16000, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) bytes.writeInt16LE(Math.round(Math.sin(index / 8) * 1000), 44 + index * 2);
  return bytes;
}

async function fixture(t, credential) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-auth-entry-'));
  const calls = { provider: 0, voice: 0, updates: 0, downloads: 0, codexStatus: 0, codexRun: 0, codexApproval: 0, desktopStatus: 0, desktopDescribe: 0, desktopExecute: 0 };
  const upstream = http.createServer((request, response) => {
    calls.provider++; request.resume();
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: 'isolated fixture response' }, finish_reason: 'stop' }] }));
  });
  let app;
  t.after(async () => {
    try { await app?.close(); }
    finally {
      upstream.closeAllConnections();
      if (upstream.listening) await new Promise(resolve => upstream.close(resolve));
      assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
      assert.ok(path.basename(directory).startsWith('petpal-auth-entry-'));
      await rm(directory, { recursive: true, force: true });
    }
  });
  await listenFixture(upstream);
  const baseUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
  const store = await new JsonStore(directory).init(), ownerId = store.state.ownerId;
  const disabledId = randomUUID(), providerId = randomUUID(), chatId = randomUUID(), codexId = randomUUID();
  const principalId = credential === 'disabled' ? disabledId : ownerId;
  const session = newSession(principalId);
  if (credential === 'expired') session.session.expiresAt = Date.now() - 1000;
  store.state.sessions.push(session.session);
  store.state.users.push({ id: disabledId, username: 'disabled-member', displayName: 'Disabled fixture member', role: 'member', disabled: true, providerIds: [providerId], password: null, settings: defaultSettings(), voice: defaultVoiceSettings(), createdAt: new Date().toISOString() });
  for (const user of store.state.users) user.voice.tts.mode = 'cosyvoice';
  store.state.settings.petName = 'private-auth-entry-pet';
  store.state.providers.push({ id: providerId, name: 'Private fixture model', protocol: 'chat-completions', baseUrl, model: 'fixture-model', apiKey: 'isolated-provider-key' });
  const timestamp = new Date().toISOString();
  store.state.conversations.push(...[[chatId, 'chat'], [codexId, 'codex']].map(([id, mode]) => ({ id, userId: principalId, title: 'private-auth-entry-history', mode, providerId: mode === 'chat' ? providerId : null, messages: [], createdAt: timestamp, updatedAt: timestamp })));
  const reference = referenceWav(), referenceName = `reference-${randomUUID()}.wav`;
  await mkdir(path.join(directory, 'cosyvoice'));
  await writeFile(path.join(directory, 'cosyvoice', referenceName), reference);
  store.state.cosyvoiceConfig = { baseUrl: 'http://127.0.0.1:50000', apiKey: 'isolated-voice-key', referenceText: 'Isolated reference audio.', revision: randomUUID(), reference: { name: referenceName, bytes: reference.length, sha256: createHash('sha256').update(reference).digest('hex') } };
  await store.save();
  app = await createPetServer({
    dataDir: directory, token: bootstrap,
    codex: {
      async status() { calls.codexStatus++; return { available: true, workspaceRoot: '/private-auth-entry-workspace' }; },
      async run() { calls.codexRun++; return { text: 'isolated Codex response', threadId: 'fixture-thread' }; },
      async approve() { calls.codexApproval++; return { ok: true }; },
      async close() {},
    },
    desktopTools: {
      async status() { calls.desktopStatus++; return {}; },
      describe() { calls.desktopDescribe++; return { description: 'Isolated desktop action' }; },
      async execute() { calls.desktopExecute++; return { ok: true }; },
      async close() {},
    },
    cosyvoiceOptions: { fetchImpl: async () => { calls.voice++; throw new Error('Unexpected voice upstream request'); } },
    updatesOptions: { fetchImpl: async () => { calls.updates++; throw new Error('Unexpected update upstream request'); } },
    downloadsOptions: { fetchImpl: async () => { calls.downloads++; throw new Error('Unexpected download catalog request'); } },
  });
  await listenFixture(app.server);
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const request = (route, { method = 'GET', token = credential === 'anonymous' ? '' : session.token, body, raw, authorization } = {}) => fetch(base + route, {
    method, signal: AbortSignal.timeout(5000),
    headers: { ...(authorization !== undefined ? { Authorization: authorization } : token ? { Authorization: `Bearer ${token}` } : {}), ...(raw ? { 'Content-Type': 'audio/wav' } : body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  if (credential === 'logged-out') {
    const authenticated = await request('/auth/me');
    assert.equal(authenticated.status, 200); assert.equal((await authenticated.json()).user.id, ownerId);
    const response = await request('/auth/logout', { method: 'POST' });
    assert.equal(response.status, 200); assert.equal((await response.json()).pairingTokenUnchanged, false);
  }
  return { request, calls, directory, providerId, chatId, codexId, ownerId, disabledId, reference, referenceName, baseUrl };
}

function protectedRequests(f) {
  return [
    ['/auth/me'], ['/auth/logout', 'POST', {}], ['/state'],
    ['/attachments', 'POST', undefined, Buffer.from('unauthorized image bytes')], ['/attachments/123e4567-e89b-42d3-a456-426614174000'], ['/downloads'],
    ['/settings', 'PATCH', { petName: 'unexpected replacement' }],
    ['/voice'], ['/voice', 'PATCH', { tts: { mode: 'system' } }],
    ['/voice/cosyvoice'], ['/voice/cosyvoice', 'PATCH', { referenceText: 'unexpected replacement' }],
    ['/voice/cosyvoice/reference', 'POST', undefined, f.reference],
    ['/voice/synthesize', 'POST', { text: 'This must never reach synthesis.' }],
    ['/updates/config'], ['/updates/config', 'PATCH', {}],
    ['/updates/check', 'POST', { target: 'android', currentVersion: '0.6.2' }],
    ['/providers', 'POST', { name: 'Unwanted model', protocol: 'chat-completions', baseUrl: f.baseUrl, model: 'fixture' }],
    [`/providers/${f.providerId}`, 'DELETE'], [`/providers/${f.providerId}/test`, 'POST', {}],
    ['/conversations', 'POST', { mode: 'chat', providerId: f.providerId }],
    ['/conversations', 'POST', { mode: 'codex' }],
    [`/conversations/${f.chatId}`], [`/conversations/${f.chatId}`, 'PATCH', { providerId: f.providerId }],
    [`/conversations/${f.chatId}`, 'DELETE'],
    [`/conversations/${f.chatId}/messages`, 'POST', { content: 'This must never reach a provider.' }],
    [`/conversations/${f.codexId}/messages`, 'POST', { content: 'This must never start Codex.' }],
    [`/conversations/${f.codexId}/agent/submit`, 'POST', { submissionId: 'entry-auth-submit', content: 'must not run' }],
    [`/conversations/${f.codexId}/agent/steer`, 'POST', { submissionId: 'entry-auth-steer', expectedTurnId: 'fixture-turn', content: 'must not steer' }],
    [`/conversations/${f.codexId}/agent/queue/fixture-entry`, 'PATCH', { revision: 1, content: 'must not edit' }],
    [`/conversations/${f.codexId}/agent/queue/fixture-entry`, 'DELETE', { revision: 1 }],
    [`/conversations/${f.codexId}/agent/queue/resume`, 'POST', {}],
    [`/conversations/${f.chatId}/stop`, 'POST', {}], [`/conversations/${f.codexId}/stop`, 'POST', {}],
    ['/codex/config'], ['/codex/config', 'PATCH', { mode: 'host' }], ['/codex/status'],
    ['/codex/approvals/fixture-approval', 'POST', { decision: 'accept' }],
    ['/desktop-tools/status'], ['/desktop-tools/action', 'POST', { tool: 'fixture-action', arguments: {} }],
    ['/admin/users'], ['/admin/users', 'POST', { username: 'unexpected-user', password: 'isolated-fixture-password' }],
    [`/admin/users/${f.disabledId}`, 'PATCH', { disabled: false }],
  ];
}

for (const credential of ['anonymous', 'expired', 'disabled', 'logged-out']) {
  test(`${credential} access is denied at every protected entry without upstream calls or persisted mutations`, { timeout: 15000 }, async t => {
    const f = await fixture(t, credential);
    const before = await readFile(path.join(f.directory, 'state.json'), 'utf8');
    const beforeCalls = { ...f.calls };
    for (const [route, method = 'GET', body, raw] of protectedRequests(f)) {
      const response = await f.request(route, { method, body, raw });
      const result = await response.json();
      assert.equal(response.status, 401, `${credential}: ${method} ${route}`);
      assert.equal(typeof result.error, 'string');
      assert.deepEqual(Object.keys(result), ['error'], 'denial must not include account, voice, model, or task data');
      assert.doesNotMatch(result.error, /private-auth-entry|isolated-provider-key|isolated-voice-key/);
      assert.deepEqual(f.calls, beforeCalls, `${method} ${route} reached a protected runtime before authentication`);
    }
    assert.equal(await readFile(path.join(f.directory, 'state.json'), 'utf8'), before, 'denied writes must not change account, configuration, or conversation state');
    assert.deepEqual(await readFile(path.join(f.directory, 'cosyvoice', f.referenceName)), f.reference, 'denied raw media upload must not replace the reference');
    const health = await f.request('/health', { token: '' });
    assert.equal(health.status, 200); assert.equal((await health.json()).ok, true);
    const owner = await f.request('/auth/me', { token: bootstrap });
    assert.equal(owner.status, 200); assert.equal((await owner.json()).user.id, f.ownerId, 'denials must not break valid owner authentication');
  });
}

test('malformed and unknown bearer credentials cannot unlock state or task entry points', async t => {
  const f = await fixture(t, 'anonymous');
  for (const authorization of ['Basic fixture', 'Bearer unknown-test-session', 'Bearer ', `Bearer ${'x'.repeat(4097)}`]) {
    for (const [route, method, body] of [['/state', 'GET'], ['/voice/synthesize', 'POST', { text: 'unauthorized' }], [`/conversations/${f.codexId}/messages`, 'POST', { content: 'unauthorized' }]]) {
      const response = await f.request(route, { authorization, method, body });
      assert.equal(response.status, 401, `${method} ${route}`); await response.arrayBuffer();
    }
  }
  assert.ok(Object.values(f.calls).every(count => count === 0));
});
