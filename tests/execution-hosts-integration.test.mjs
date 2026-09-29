import { listenFixture } from './helpers/loopback.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createPetServer } from '../server/app.mjs';
import { JsonStore } from '../server/store.mjs';
import { defaultCodexConfig } from '../server/codex-config.mjs';
import { DesktopExecutor } from '../desktop/executor.mjs';

async function until(fn) {
  for (let attempt = 0; attempt < 300; attempt++) { const result = await fn(); if (result) return result; await delay(20); }
  assert.fail('Integrated executor state did not settle');
}
const tools = () => ({ specs: [], async close() {}, async status() { return {}; } });

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-host-integration-'));
  const centralKey = 'central-upstream-secret-never-to-worker';
  const store = await new JsonStore(path.join(directory, 'central')).init();
  store.state.codexConfig = { ...defaultCodexConfig(), mode: 'api', baseUrl: 'https://model.example.test/v1', model: 'integration-model', apiKey: centralKey };
  const provider = { id: randomUUID(), name: 'integration', protocol: 'responses', baseUrl: 'https://model.example.test/v1', model: 'integration-model', apiKey: 'provider-secret' };
  store.state.providers = [provider]; await store.save();
  const centralCalls = [], calls = [], workers = [];
  const centralBridge = { async status() { return { available: true, authenticated: true }; }, async close() {}, async run(args) { centralCalls.push(args); return { text: 'central', threadId: 'central-thread' }; } };
  const app = await createPetServer({ dataDir: path.join(directory, 'central'), token: 'integration-owner', codex: centralBridge, desktopTools: tools() });
  await listenFixture(app.server);
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (route, { method = 'GET', body, token = app.token } = {}) => {
    const response = await fetch(`${url}/api${route}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const login = async username => {
    const result = await request('/auth/login', { method: 'POST', token: '', body: { username, password: 'integration-password' } });
    assert.equal(result.status, 200); return result.data.token;
  };
  const member = async username => {
    const result = await request('/admin/users', { method: 'POST', body: { username, password: 'integration-password', agentAccess: 'full', providerIds: [provider.id] } });
    assert.equal(result.status, 201); return { user: result.data.user, token: await login(username) };
  };
  const addWorker = async (name, member, token = member.token, options = {}) => {
    const worker = new DesktopExecutor({ dataDir: path.join(directory, name), name, resolveCommand: async () => ({ file: 'fixture-codex', args: [] }), toolsFactory: tools,
      bridgeFactory(options) {
        assert.notEqual(options.config.apiKey, centralKey); assert.notEqual(options.config.apiKey, provider.apiKey);
        assert.ok(options.dataDir.startsWith(path.join(directory, name)));
        let active;
        return {
          async status() { return { available: true, authenticated: true }; },
          async run(args) {
            const call = { name, args, options, steers: [], approvals: [] }; calls.push(call); active = call;
            const threadId = args.threadId || `${name}-thread-${calls.length}`;
            args.onEvent('thread', { threadId }); args.onEvent('turn', { turnId: `${name}-turn-${calls.length}` });
            if (args.prompt.includes('HOLD')) {
              args.onEvent('approval', { id: `${name}-approval`, kind: 'command', description: 'Confirm isolated fixture' });
              return new Promise((resolve, reject) => { call.finish = () => resolve({ text: `${name} completed`, threadId }); call.reject = reject; args.signal.addEventListener('abort', () => reject(args.signal.reason), { once: true }); });
            }
            args.onEvent('delta', { text: `${name} completed` }); return { text: `${name} completed`, threadId };
          },
          async steer(value) { active.steers.push(value); return { turnId: value.expectedTurnId }; },
          async approve(...args) { active.approvals.push(args); return { ok: true }; },
          async close() { active?.reject?.(new Error('fixture stopped')); },
        };
      }, ...options,
    });
    workers.push(worker);
    const status = await worker.connect({ url, token, instanceId: store.state.instanceId, userId: member.user.id });
    assert.equal(status.state, 'online'); return worker;
  };
  t.after(async () => { await Promise.allSettled(workers.map(worker => worker.close())); await app.close(); assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-host-integration-'))); await rm(directory, { recursive: true, force: true }); });
  return { request, login, member, addWorker, calls, centralCalls, provider };
}

test('two logged-in desktops execute selected tasks while central conversation and history remain unchanged', { timeout: 25000 }, async t => {
  const f = await fixture(t), user = await f.member('shareduser');
  const a = await f.addWorker('PC-A', user, await f.login('shareduser'));
  const b = await f.addWorker('PC-B', user, await f.login('shareduser'));
  const hosts = await f.request('/agent/hosts', { token: user.token });
  assert.equal(hosts.status, 200); assert.equal(hosts.data.hosts.filter(host => host.kind === 'desktop' && host.online).length, 2);
  const created = await f.request('/conversations', { token: user.token, method: 'POST', body: { mode: 'codex' } });
  assert.equal(created.status, 201); const id = created.data.id;
  const conversation = async () => (await f.request('/state', { token: user.token })).data.conversations.find(item => item.id === id);
  const submit = async (worker, text, submissionId = randomUUID()) => {
    const body = { submissionId, content: text, providerId: f.provider.id, hostId: worker.status().hostId };
    const route = `/conversations/${id}/agent/submit`;
    assert.equal((await f.request(route, { token: user.token, method: 'POST', body })).status, 200);
    const done = await until(async () => { const chat = await conversation(); return chat.agent.run?.submissionId === submissionId && chat.agent.run.status === 'completed' ? chat : null; });
    assert.equal((await f.request(route, { token: user.token, method: 'POST', body })).status, 200);
    return done;
  };
  const first = await submit(a, 'first computer');
  const originalMessages = first.messages.map(item => ({ id: item.id, content: item.content }));
  const second = await submit(b, 'switch computer');
  assert.deepEqual(second.messages.slice(0, 2).map(item => ({ id: item.id, content: item.content })), originalMessages);
  assert.deepEqual(f.calls.map(call => call.name), ['PC-A', 'PC-B']); assert.equal(f.centralCalls.length, 0);
  assert.equal(f.calls[1].args.threadId, undefined); assert.match(f.calls[1].args.prompt, /first computer/);
  await submit(b, 'continue on second computer');
  assert.match(f.calls[2].args.threadId, /^PC-B-thread/);
  await a.disconnect();
  const offline = await until(async () => { const list = (await f.request('/agent/hosts', { token: user.token })).data.hosts; return list.find(host => host.name === 'PC-A' && !host.online); });
  const denied = await f.request(`/conversations/${id}/agent/submit`, { token: user.token, method: 'POST', body: { submissionId: randomUUID(), content: 'offline must not fall back', hostId: offline.id, providerId: f.provider.id } });
  assert.ok(denied.status >= 400); assert.equal(f.calls.length, 3); assert.equal(f.centralCalls.length, 0);
  const other = await f.member('otheruser');
  assert.equal((await f.request('/agent/hosts', { token: other.token })).data.hosts.filter(host => host.kind === 'desktop').length, 0);
  const otherChat = (await f.request('/conversations', { token: other.token, method: 'POST', body: { mode: 'codex' } })).data;
  const foreign = await f.request(`/conversations/${otherChat.id}/agent/submit`, { token: other.token, method: 'POST', body: { submissionId: randomUUID(), content: 'forbidden', providerId: f.provider.id, hostId: b.status().hostId } });
  assert.ok(foreign.status >= 400); assert.equal(f.calls.length, 3);
});

test('a recovered desktop comes online while its interrupted run stays unknown and queued work stays paused', {timeout:25000}, async t => {
  const f=await fixture(t),user=await f.member('recoveryuser');let triggerFailure=false,releaseRetry;
  const worker=await f.addWorker('Recover-PC',user,user.token,{
    fetchImpl:async(url,options)=>{
      if(triggerFailure && url.endsWith('/events')){triggerFailure=false;throw new TypeError('simulated connection reset');}
      return fetch(url,options);
    },
    retryWait:(_ms,signal)=>new Promise(resolve=>{releaseRetry=resolve;signal.addEventListener('abort',resolve,{once:true});}),
  });
  const original=worker.current,hostId=worker.status().hostId;
  const chat=(await f.request('/conversations',{token:user.token,method:'POST',body:{mode:'codex'}})).data;
  const route=`/conversations/${chat.id}`, request=(suffix,body)=>f.request(route+suffix,{token:user.token,method:'POST',body});
  const body=content=>({submissionId:randomUUID(),content,providerId:f.provider.id,hostId});
  await request('/agent/submit',body('HOLD for disconnection'));
  await until(()=>f.calls[0]?.finish);
  assert.equal((await request('/agent/submit',body('must remain queued'))).status,200);
  triggerFailure=true;f.calls[0].args.onEvent('delta',{text:'delivery cannot be confirmed'});
  await until(()=>worker.status().state==='reconnecting' && releaseRetry);
  const interrupted=await until(async()=>{const result=await f.request(route,{token:user.token});return result.data.agent.run?.status==='unknown'?result.data:null;});
  assert.equal(interrupted.agent.paused,true);assert.equal(interrupted.agent.queue.length,1);
  releaseRetry();await until(()=>worker.status().state==='online');
  assert.equal(worker.status().hostId,hostId);assert.notEqual(worker.current.connectionId,original.connectionId);
  const restored=(await f.request(route,{token:user.token})).data;
  assert.equal(restored.agent.run.status,'unknown');assert.equal(restored.agent.paused,true);assert.equal(restored.agent.queue.length,1);
  assert.equal(f.calls.length,1);assert.equal(f.centralCalls.length,0);
  assert.ok((await request('/agent/queue/resume',{})).status>=400);assert.equal(f.calls.length,1);
});

test('remote approvals, steer and stop stay on the captured desktop and leave its queue paused', { timeout: 25000 }, async t => {
  const f = await fixture(t), user = await f.member('taskuser');
  const a = await f.addWorker('Control-PC', user, await f.login('taskuser'));
  await f.addWorker('Untouched-PC', user, await f.login('taskuser'));
  const chat = (await f.request('/conversations', { token: user.token, method: 'POST', body: { mode: 'codex' } })).data;
  const route = `/conversations/${chat.id}`, hostId = a.status().hostId;
  const request = (suffix, body) => f.request(route + suffix, { token: user.token, method: 'POST', body });
  const body = content => ({ submissionId: randomUUID(), content, providerId: f.provider.id, hostId });
  assert.equal((await request('/agent/submit', body('HOLD for controlled task'))).status, 200);
  const running = await until(async () => { const result = await f.request(route, { token: user.token }); return result.data.agent?.approvals.length ? result.data : null; });
  const remoteId = running.agent.approvals[0].id;
  assert.notEqual(remoteId, 'Control-PC-approval');
  assert.equal((await f.request(`/codex/approvals/${remoteId}`, { token: user.token, method: 'POST', body: { decision: 'accept' } })).status, 200);
  assert.deepEqual(f.calls[0].approvals, [['Control-PC-approval', 'accept']]);
  assert.equal((await request('/agent/steer', { ...body('additional instruction'), expectedTurnId: running.agent.run.turnId })).status, 200);
  assert.equal(f.calls[0].steers.length, 1); assert.equal(f.calls[0].steers[0].content, 'additional instruction');
  assert.equal((await request('/agent/submit', body('queued task'))).status, 200);
  assert.equal((await request('/stop', {})).status, 200);
  const stopped = (await f.request(route, { token: user.token })).data;
  assert.equal(stopped.agent.run.status, 'cancelled'); assert.equal(stopped.agent.paused, true);
  assert.equal(stopped.agent.queue.length, 1); assert.equal(stopped.agent.queue[0].hostId, hostId);
  assert.deepEqual(f.calls.map(call => call.name), ['Control-PC']); assert.equal(f.centralCalls.length, 0);
  await a.disconnect();
  const resume = await request('/agent/queue/resume', {});
  assert.ok(resume.status >= 400); assert.equal(f.calls.length, 1);
  const preserved = (await f.request(route, { token: user.token })).data;
  assert.equal(preserved.agent.queue.length, 1); assert.equal(preserved.agent.paused, true);
});
