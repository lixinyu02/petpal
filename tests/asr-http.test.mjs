import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createPetServer } from '../server/app.mjs';
import { listenFixture } from './helpers/loopback.mjs';
import { asrFixtureResponse } from './fixtures/asr-upstream.mjs';

class Socket extends EventTarget {
  constructor() { super(); this.readyState = 0; this.bufferedAmount = 0; this.sent = []; queueMicrotask(() => { if (this.readyState === 0) { this.readyState = 1; this.dispatchEvent(new Event('open')); } }); }
  send(value) { assert.equal(this.readyState, 1); this.sent.push(typeof value === 'string' ? value : Buffer.from(value)); }
  message(value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
  close() { if (this.readyState === 3) return; this.readyState = 3; const event = new Event('close'); event.code = 1000; this.dispatchEvent(event); }
}
const pcm = Buffer.alloc(2400);
async function until(check) { for (let index = 0; index < 100; index++) { if (check()) return; await delay(10); } assert.ok(check(), 'condition did not settle'); }
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-asr-http-')), sockets = [];
  const app = await createPetServer({ dataDir: directory, token: 'asr-owner-fixture', codex: { async status() { return { available: false }; }, async close() {} }, asrOptions: {
    webSocketFactory(url) { assert.equal(url, 'ws://127.0.0.1:40000/ws/asr'); const socket = new Socket(); sockets.push(socket); return socket; },
    fetchImpl: async url => asrFixtureResponse(url),
  } });
  await listenFixture(app.server);
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const request = (route, { token = 'asr-owner-fixture', method = 'GET', body, raw, type = 'application/octet-stream', signal } = {}) => fetch(base + route, {
    method, signal: signal ?? AbortSignal.timeout(5000), headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(raw !== undefined ? { 'Content-Type': type } : body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  assert.equal((await request('/voice/asr', { method: 'PATCH', body: { baseUrl: 'http://127.0.0.1:40000' } })).status, 200);
  assert.equal((await request('/admin/users', { method: 'POST', body: { username: 'asr-member', password: 'fixture-pass' } })).status, 201);
  const login = async () => (await (await request('/auth/login', { token: '', method: 'POST', body: { username: 'asr-member', password: 'fixture-pass' } })).json());
  const member = await login();
  const start = async (token = member.token) => {
    const created = await request('/voice/asr/sessions', { token, method: 'POST', body: {} }); assert.equal(created.status, 201);
    const { id } = await created.json(), response = await request(`/voice/asr/sessions/${id}/events`, { token }); assert.equal(response.status, 200);
    const reader = response.body.getReader(), initial = new TextDecoder().decode((await reader.read()).value); assert.match(initial, /event: ready/);
    const text = (async () => { let output = initial; try { while (true) { const next = await reader.read(); if (next.done) break; output += new TextDecoder().decode(next.value); } } catch {} return output; })();
    return { id, route: `/voice/asr/sessions/${id}`, socket: sockets.at(-1), text, response };
  };
  return { app, base, request, sockets, member, login, start };
}

test('HTTP ASR requires login, limits shared config to owner and keeps it out of member state', async t => {
  const f = await fixture(t);
  for (const [route, method, body] of [['/voice/asr', 'GET'], ['/voice/asr/test', 'POST', {}], ['/voice/asr/sessions', 'POST', {}], ['/voice/asr/sessions/unknown/events', 'GET'], ['/voice/asr/sessions/unknown/end', 'POST', {}], ['/voice/asr/sessions/unknown', 'DELETE']]) {
    assert.equal((await f.request(route, { token: '', method, body })).status, 401);
  }
  const config = await (await f.request('/voice/asr', { token: f.member.token })).json();
  assert.equal(config.configured, true); assert.equal(config.baseUrl, ''); assert.equal(config.editable, false);
  assert.equal((await f.request('/voice/asr', { token: f.member.token, method: 'PATCH', body: { baseUrl: '' } })).status, 403);
  assert.equal((await f.request('/voice/asr/test', { token: f.member.token, method: 'POST', body: {} })).status, 200);
  assert.equal((await f.request('/voice/asr/sessions', { token: f.member.token, method: 'POST', body: { baseUrl: 'https://elsewhere.test' } })).status, 400);
  assert.equal(f.sockets.length, 0);
  assert.ok(!(await (await f.request('/state', { token: f.member.token })).text()).includes('127.0.0.1:40000'));
});

test('HTTP raw PCM survives JSON middleware, SSE streams partial and final text, and end is idempotent', async t => {
  const f = await fixture(t), s = await f.start(), token = f.member.token;
  assert.deepEqual(s.socket.sent, ['{}']);
  const sent = await f.request(`${s.route}/audio?sequence=0`, { token, method: 'POST', raw: pcm });
  assert.equal(sent.status, 200); assert.deepEqual(await sent.json(), { ok: true, nextSequence: 1, receivedSamples: 600 });
  assert.deepEqual(s.socket.sent[1], pcm);
  s.socket.message({ text: '你好', chunks: 1 });
  for (let index = 0; index < 2; index++) assert.equal((await f.request(`${s.route}/end`, { token, method: 'POST', body: {} })).status, 200);
  assert.equal(s.socket.sent.filter(value => value === 'end').length, 1);
  s.socket.message({ text: '你好，小伴。', chunks: 2, done: true });
  const output = await s.text; assert.match(output, /event: transcript/); assert.match(output, /event: done/); assert.match(output, /你好，小伴。/);
  assert.equal((await f.request(`${s.route}/audio?sequence=1`, { token, method: 'POST', raw: pcm })).status, 409);
});

test('HTTP SSE and uploads belong to one login, even when another login belongs to the same user', async t => {
  const f = await fixture(t), s = await f.start(), other = await f.login();
  for (const token of [other.token, 'asr-owner-fixture']) {
    for (const [suffix, method, options] of [['/events', 'GET', {}], ['/audio?sequence=0', 'POST', { raw: pcm }], ['/end', 'POST', { body: {} }], ['', 'DELETE', {}]]) {
      assert.equal((await f.request(s.route + suffix, { token, method, ...options })).status, 404);
    }
  }
  assert.equal(s.socket.readyState, 1);
  const busy = await f.request('/voice/asr/sessions', { token: other.token, method: 'POST', body: {} }); assert.equal(busy.status, 429); assert.equal((await busy.json()).code, 'busy');
  await f.request(s.route, { token: f.member.token, method: 'DELETE' }); assert.match(await s.text, /cancelled/);
});

test('HTTP media validation and a truncated raw upload release the active session', async t => {
  const f = await fixture(t), s = await f.start(), token = f.member.token;
  assert.equal((await f.request(`${s.route}/audio?sequence=0`, { token, method: 'POST', raw: pcm, type: 'audio/wav' })).status, 415);
  assert.equal((await f.request(`${s.route}/audio?sequence=0`, { token, method: 'POST', raw: Buffer.alloc(96004) })).status, 413);
  assert.equal(s.socket.sent.length, 1);
  const upload = http.request(f.base + `${s.route}/audio?sequence=0`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'Content-Length': '2400' } });
  upload.on('error', () => {}); upload.write(Buffer.alloc(4));
  await delay(30); upload.destroy(); await until(() => s.socket.readyState === 3);
  assert.match(await s.text, /upload_incomplete/);
  const next = await f.start(); assert.equal(next.socket.readyState, 1);
  await f.request(next.route, { token, method: 'DELETE' });
});

test('HTTP logout, account disabling and server shutdown stop ASR without delivering later transcript', async t => {
  for (const action of ['logout', 'disable', 'shutdown']) {
    const f = await fixture(t), s = await f.start(), token = f.member.token;
    if (action === 'logout') assert.equal((await f.request('/auth/logout', { token, method: 'POST', body: {} })).status, 200);
    if (action === 'disable') assert.equal((await f.request(`/admin/users/${f.member.user.id}`, { method: 'PATCH', body: { disabled: true } })).status, 200);
    if (action === 'shutdown') await f.app.close();
    assert.equal(s.socket.readyState, 3); s.socket.message({ text: '撤销后不应发布', chunks: 1 });
    assert.ok(!(await s.text).includes('撤销后不应发布'));
  }
});

test('HTTP event-stream cancellation immediately closes upstream and makes the slot available again', async t => {
  const f = await fixture(t), token = f.member.token;
  const { id } = await (await f.request('/voice/asr/sessions', { token, method: 'POST', body: {} })).json();
  const controller = new AbortController(), response = await f.request(`/voice/asr/sessions/${id}/events`, { token, signal: controller.signal });
  const reader = response.body.getReader(); await reader.read(); controller.abort();
  await assert.rejects(reader.read()); await until(() => f.sockets[0].readyState === 3);
  const next = await f.start(); await f.request(next.route, { token, method: 'DELETE' });
});
