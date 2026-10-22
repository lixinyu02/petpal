import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createPetServer } from '../server/app.mjs';
import { JsonStore } from '../server/store.mjs';
import { defaultCodexConfig } from '../server/codex-config.mjs';
import { listenFixture } from './helpers/loopback.mjs';

const answer = '请补充目标。\n\n```openui\nroot = Panel("计划", [Field("goal", "目标"), Button("加入输入框", @UseInPrompt("继续"))])\n```';
const events = source => source.split(/\r?\n\r?\n/).flatMap(block => {
  const type = block.match(/^event:\s*(.+)$/m)?.[1], data = block.match(/^data:\s*(.+)$/m)?.[1];
  return type && data ? [{type, data:JSON.parse(data)}] : [];
});
async function until(callback) { for (let index = 0; index < 250; index++) { const value = await callback(); if (value) return value; await delay(5); } assert.fail('OpenUI fixture did not settle'); }

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-openui-api-')), token = randomUUID(), upstreamRequests = [], calls = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); upstreamRequests.push(body);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url.endsWith('/responses') ? {status:'completed', output_text:answer} : {choices:[{message:{role:'assistant', content:answer}, finish_reason:'stop'}]}));
  });
  await listenFixture(upstream);
  const store = await new JsonStore(directory).init();
  const providers = ['responses','chat-completions'].map(protocol => ({id:randomUUID(), name:protocol, protocol, baseUrl:`http://127.0.0.1:${upstream.address().port}/v1`, model:'fixture-ui-model', apiKey:'synthetic-ui-key'}));
  store.state.providers = providers;
  store.state.codexConfig = {...defaultCodexConfig(), mode:'api', baseUrl:'https://ui-agent.example.test/v1', model:'fixture-ui-agent', apiKey:'synthetic-ui-agent-key'};
  await store.save();
  const codex = {
    async status() { return {available:true, authenticated:true}; },
    async run(args) { calls.push(args); const threadId = args.threadId || `ui-native-${calls.length}`; args.onEvent('thread', {threadId}); args.onEvent('turn', {turnId:`ui-turn-${calls.length}`}); args.onEvent('delta', {text:answer}); return {text:answer, threadId}; },
    async close() {},
  };
  let app;
  const start = async () => { app = await createPetServer({dataDir:directory, token, codex}); await listenFixture(app.server); };
  await start();
  const request = (route, {method='GET', body, authorization=token}={}) => fetch(`http://127.0.0.1:${app.server.address().port}/api${route}`, {method, headers:{'Content-Type':'application/json', ...(authorization ? {Authorization:`Bearer ${authorization}`} : {})}, ...(body === undefined ? {} : {body:JSON.stringify(body)})});
  const json = async (route, options) => { const response = await request(route, options); return {status:response.status, data:await response.json()}; };
  const create = async (mode='chat', providerId=providers[0].id) => { const result = await json('/conversations', {method:'POST', body:{mode, ...(mode==='chat' ? {providerId} : {})}}); assert.equal(result.status,201); return result.data; };
  const send = async (conversation, content, extra={}) => { const response = await request(`/conversations/${conversation.id}/messages`, {method:'POST', body:{content, ...extra}}); return {status:response.status, events:events(await response.text())}; };
  t.after(async () => { await app.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); assert.ok(directory.startsWith(path.join(tmpdir(),'petpal-openui-api-'))); await rm(directory,{recursive:true,force:true}); });
  return {directory, providers, upstreamRequests, calls, request, json, create, send, restart:async () => {await app.close(); await start();}};
}

test('both Chat protocols use one original model call, publish trusted SSE metadata and retain it after restart', async t => {
  const f = await fixture(t);
  for (const provider of f.providers) {
    const conversation = await f.create('chat', provider.id), content = '请做一个可填写的计划，不要执行任何操作。';
    const sent = await f.send(conversation, content, {outputRendering:'markdown'});
    assert.equal(sent.status,200); const meta = sent.events.find(event => event.type==='meta').data;
    assert.equal(meta.outputRendering,'auto');
    const done = sent.events.find(event => event.type==='done').data.conversation;
    assert.equal(done.messages.at(-1).outputRendering,'auto'); assert.equal(done.messages.at(-1).content,answer);
    assert.equal(done.messages[0].content,content); assert.equal(done.messages[0].outputRendering,undefined);
    const upstream = f.upstreamRequests.at(-1);
    const guide = upstream.instructions ?? upstream.messages.find(message=>message.role==='system').content;
    assert.match(guide,/Output presentation for this turn: Automatic/); assert.match(guide,/Panel\(title: string, children:/);
    assert.equal(upstream.model,'fixture-ui-model'); assert.equal(upstream.tools,undefined);
    await f.restart();
    const history = (await f.json(`/conversations/${conversation.id}`)).data;
    assert.equal(history.messages.at(-1).id,meta.assistantMessageId); assert.equal(history.messages.at(-1).outputRendering,'auto');
  }
  assert.equal(f.upstreamRequests.length,2); assert.equal(f.calls.length,0);
});

test('direct Agent submit and legacy Codex SSE persist automatic output without changing permissions or user text', async t => {
  const f = await fixture(t), direct = await f.create('codex'), body = {submissionId:randomUUID(), content:'规划一个表单', permissions:{access:'read-only',approval:'ask'}};
  const route = `/conversations/${direct.id}/agent/submit`;
  assert.equal((await f.json(route,{method:'POST',body,authorization:''})).status,401);
  assert.equal((await f.json(route,{method:'POST',body:{...body,outputRendering:'auto'}})).status,400);
  const submitted = await f.json(route,{method:'POST',body}); assert.equal(submitted.status,200);
  const completed = await until(async () => { const current=(await f.json(`/conversations/${direct.id}`)).data; return current.agent.run?.status==='completed' && current; });
  assert.equal(completed.agent.run.outputRendering,'auto'); assert.equal(completed.messages.at(-1).outputRendering,'auto');
  assert.equal(completed.messages[0].content,body.content); assert.match(f.calls[0].prompt,/Output presentation for this turn: Automatic/);
  assert.ok(f.calls[0].prompt.endsWith(body.content)); assert.equal(f.calls[0].permissions.access,'read-only');
  assert.equal((await f.json(route,{method:'POST',body})).data.submission.entryId,submitted.data.submission.entryId); assert.equal(f.calls.length,1);
  const legacy = await f.create('codex'), sent = await f.send(legacy,'旧入口任务');
  assert.equal(sent.events.find(event=>event.type==='meta').data.outputRendering,'auto');
  assert.equal(sent.events.find(event=>event.type==='done').data.conversation.messages.at(-1).outputRendering,'auto');
  const disk = JSON.parse(await readFile(path.join(f.directory,'state.json'),'utf8'));
  assert.equal(disk.conversations.find(item=>item.id===legacy.id).threadHasOpenUIGuide,true);
  assert.equal(f.calls.length,2); assert.equal(f.upstreamRequests.length,0);
});

test('legacy inherited native guide is disabled on long input and full-length input starts fresh without cutting the task', async t => {
  const f = await fixture(t), conversation = await f.create('codex');
  await f.send(conversation,'先构建表单');
  const large = '长'.repeat(26000), fallback = await f.send(conversation,large);
  assert.equal(fallback.events.find(event=>event.type==='meta').data.outputRendering,'markdown');
  assert.match(f.calls[1].prompt,/Previous OpenUI output instructions do not apply/); assert.ok(f.calls[1].prompt.endsWith(large));
  assert.equal(f.calls[1].threadId,'ui-native-1'); assert.ok(f.calls[1].prompt.length<=32000);
  const full = '全'.repeat(32000), last = await f.send(conversation,full);
  assert.equal(last.events.find(event=>event.type==='meta').data.outputRendering,'markdown');
  assert.equal(f.calls[2].prompt,full); assert.equal(f.calls[2].threadId,undefined);
});
