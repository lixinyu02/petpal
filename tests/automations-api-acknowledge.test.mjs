import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { JsonStore } from '../server/store.mjs';
import { createPetServer } from '../server/app.mjs';
import { defaultCodexConfig } from '../server/codex-config.mjs';
import { listenFixture } from './helpers/loopback.mjs';

const until = async callback => { for (let i = 0; i < 100; i++) { const result = await callback(); if (result) return result; await delay(5); } assert.fail('ack fixture not settled'); };

test('unknown remote work requires scoped explicit acknowledgement, updates its real result atomically and later permits retention', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-automation-ack-')), store = await new JsonStore(directory).init(), token = 'isolated-ack-owner';
  store.state.codexConfig = { ...defaultCodexConfig(), mode: 'api', baseUrl: 'https://ack-model.example/v1', model: 'fixture-model', apiKey: 'fixture-secret' }; await store.save();
  const calls = [];
  const app = await createPetServer({ dataDir: directory, token, automationOptions: { setInterval: () => ({ unref() {} }), clearInterval() {} }, desktopTools: { specs: [], close: async () => {} }, codexFactory: () => ({ status: async () => ({ available: true, authenticated: true }), run: args => new Promise((resolve, reject) => { calls.push({ args, resolve }); args.signal.addEventListener('abort', () => reject(args.signal.reason), { once: true }); }), close: async () => {} }) });
  await listenFixture(app.server); t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const request = async (route, method = 'GET', body) => { const result = await fetch(`http://127.0.0.1:${app.server.address().port}/api${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: result.status, data: await result.json() }; };
  const registration = (await request('/agent/executors/register', 'POST', { deviceId: randomUUID(), name: 'Ack fixture PC', platform: process.platform, arch: process.arch })).data;
  const created = await request('/automations', 'POST', { title: 'Unknown task', prompt: 'Fixture only', hostId: registration.hostId, providerId: null, projectDirectory: '', permissions: { access: 'read-only', approval: 'auto' }, schedule: { kind: 'interval', minutes: 5 }, requestId: randomUUID() }); assert.equal(created.status, 201); let job = created.data.automation;
  const submitted = await request(`/automations/${job.id}/run`, 'POST', { requestId: randomUUID() }); assert.equal(submitted.status, 200);
  const command = (await request(`/agent/executors/${registration.connectionId}/poll`)).data.commands[0];
  await request(`/agent/executors/${registration.connectionId}/events`, 'POST', { runId: command.runId, event: 'started', sequence: 1, data: {} });
  await request(`/agent/executors/${registration.connectionId}`, 'DELETE');
  let record = await until(async () => { job = (await request('/automations')).data.automations[0]; const run = job.runs[0]; if (!run.conversationId) return null; const current = await request(`/conversations/${run.conversationId}`); return current.data.agent?.run?.status === 'unknown' && run; });
  await app.automations.tick(); job = (await request('/automations')).data.automations[0]; record = job.runs[0]; assert.equal(record.status, 'unknown');
  assert.equal((await request(`/automations/${job.id}/run`, 'POST', { requestId: randomUUID() })).status, 409);
  assert.equal((await request(`/automations/${job.id}`, 'PATCH', { revision: job.revision, enabled: true })).status, 409);
  assert.equal((await request(`/automations/${job.id}/acknowledge`, 'POST', { revision: randomUUID(), runId: record.id })).status, 409);
  assert.equal((await request(`/automations/${job.id}/acknowledge`, 'POST', { revision: job.revision, runId: randomUUID() })).status, 409);
  const acknowledged = await request(`/automations/${job.id}/acknowledge`, 'POST', { revision: job.revision, runId: record.id }); assert.equal(acknowledged.status, 200); job = acknowledged.data.automation;
  assert.equal(job.enabled, false); assert.equal(job.runs[0].status, 'cancelled'); assert.equal(job.runs[0].acknowledgedAt, undefined);
  const current = (await request(`/conversations/${record.conversationId}`)).data; assert.equal(current.agent.run.status, 'cancelled');
  let data = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')), result = data.conversations.find(item => item.id === record.conversationId); assert.equal(result.agent.run.status, 'cancelled'); assert.equal(result.agent.submissions[0].status, 'cancelled');
  await request('/notifications/devices', 'POST', { deviceId: randomUUID() });
  data = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')); assert.equal(data.conversations.find(item => item.id === record.conversationId).agent.run.status, 'cancelled');
  const changed = await request(`/automations/${job.id}`, 'PATCH', { revision: job.revision, hostId: 'central' }); assert.equal(changed.status, 200);
  for (let i = 0; i < 31; i++) {
    assert.equal((await request(`/automations/${job.id}/run`, 'POST', { requestId: randomUUID() })).status, 200); await until(() => calls.length > i); calls[i].resolve({ threadId: randomUUID(), text: 'Fixture done' });
    await until(async () => { const latest = (await request('/automations')).data.automations[0].runs.at(-1); if (!latest.conversationId) return false; return (await request(`/conversations/${latest.conversationId}`)).data.agent?.run?.status === 'completed'; }); await app.automations.tick();
  }
  data = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')); assert.equal(data.conversations.some(item => item.id === record.conversationId), false); assert.equal(data.conversations.filter(item => item.automationId === job.id).length, 30);
});
