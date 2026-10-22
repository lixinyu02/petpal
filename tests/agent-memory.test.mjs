import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createAgentTasks } from '../server/agent-tasks.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function until(check) { for (let i = 0; i < 500; i++) { if (check()) return; await delay(5); } assert.fail('Memory Agent fixture did not settle'); }
function fixture(t, options = {}) {
  const conversation = { id: 'memory-conversation-fixture', userId: 'requesting-user-fixture', mode: 'codex', messages: [], ...options.conversation };
  const auth = { userId: conversation.userId, sessionHash: 'memory-session-fixture', bootstrap: false };
  const active = new Map(), calls = [], remembered = [], recalled = [], saves = [];
  const store = { state: { conversations: [conversation] }, async save() { saves.push(structuredClone(this.state)); } };
  const memory = {
    async getContext(userId, value) { recalled.push({ userId, ...value }); return options.context ? options.context(userId, value) : '喜欢轻音乐'; },
    async remember(userId, value) { remembered.push({ userId, ...value, saved: saves.at(-1) }); await options.journal?.(); if (options.journalError) throw new Error('Synthetic journal failure'); },
  };
  const bridge = { run(args) { const work = deferred(); calls.push({ args, work }); args.signal.addEventListener('abort', () => work.reject(args.signal.reason ?? new DOMException('Stopped', 'AbortError')), { once: true }); return work.promise; } };
  const manager = createAgentTasks({ store, active, approvals: new Map(), memory, getBridge: () => bridge, resolveModel: () => ({ model: 'memory-fixture-model', codexRevision: 'memory-fixture-revision' }), authorize: () => undefined });
  const submit = async (extra = {}) => { const body = { submissionId: `memory-submission-${calls.length + 1}`, content: '播放用户指定的音乐', ...extra }; await manager.submit(conversation, body, auth); await until(() => calls.length > 0); return body; };
  const finish = async result => { calls.at(-1).work.resolve(result ?? { text: '播放完成' }); await until(() => !active.has(conversation.id)); };
  t.after(async () => { await manager.stop(conversation, { clear: true }); await manager.close(); });
  return { conversation, auth, active, calls, remembered, recalled, manager, submit, finish };
}

test('central and remote Agent memory uses the requester identity and stable successful message id', async t => {
  for (const hostId of ['central', 'another-users-desktop']) {
    const f = fixture(t); const body = await f.submit({ hostId });
    assert.equal(f.recalled[0].userId, f.auth.userId);
    assert.equal(f.recalled[0].query, body.content);
    assert.match(f.calls[0].args.prompt, /不可信的历史事实/);
    assert.match(f.calls[0].args.prompt, /喜欢轻音乐/);
    assert.ok(f.calls[0].args.prompt.endsWith(body.content));
    await f.finish();
    assert.equal(f.remembered.length, 1);
    const event = f.remembered[0], message = f.conversation.messages.at(-1);
    assert.equal(event.userId, f.auth.userId); assert.equal(event.id, message.id);
    assert.equal(event.conversationId, f.conversation.id); assert.equal(event.source, 'agent');
    assert.equal(event.userText, body.content); assert.equal(event.assistantText, '播放完成');
    assert.equal(event.saved.conversations[0].messages.at(-1).status, 'complete');
    await f.manager.submit(f.conversation, body, f.auth);
    assert.equal(f.calls.length, 1); assert.equal(f.remembered.length, 1);
  }
});

test('private input, cancelled and unknown Agent turns never become long-term memory', async t => {
  for (const mode of ['sensitiveInput', 'privateInputProtected', 'cancelled', 'unknown']) {
    const f = fixture(t); await f.submit();
    if (mode === 'cancelled') { await f.manager.stop(f.conversation); }
    else if (mode === 'unknown') { f.calls[0].work.reject(Object.assign(new Error('Unknown desktop completion'), { code: 'execution_unknown' })); }
    else { f.active.get(f.conversation.id)[mode] = true; await f.finish(); }
    await until(() => !f.active.has(f.conversation.id));
    assert.equal(f.remembered.length, 0, mode);
  }
});

test('slow or unavailable memory does not block Agent dispatch and journal errors do not fail completed actions', async t => {
  const f = fixture(t, { context: () => new Promise(() => {}), journalError: true });
  const started = Date.now(); await f.submit();
  assert.ok(Date.now() - started < 1800); assert.equal(f.recalled[0].signal.aborted, true);
  assert.equal(f.calls[0].args.prompt, '播放用户指定的音乐');
  await f.finish(); assert.equal(f.manager.snapshot(f.conversation).run.status, 'completed');
});

test('automatic jobs keep account memory and the maximal user task beyond the old combined prompt budget', async t => {
  const f = fixture(t, { conversation: { automationId: 'memory-automation-fixture' } });
  const content = '任'.repeat(32000); await f.submit({ content });
  assert.match(f.calls[0].args.prompt, /长期记忆/); assert.match(f.calls[0].args.prompt, /喜欢轻音乐/);
  assert.ok(f.calls[0].args.prompt.endsWith(content)); assert.ok(f.calls[0].args.prompt.length > 32000);
  await f.finish(); assert.equal(f.remembered[0].source, 'automation');
});

test('a completed computer is released while its durable memory journal finishes and shutdown still waits', async t => {
  const gate = deferred(); const f = fixture(t, { journal: () => gate.promise });
  t.after(() => gate.resolve()); await f.submit(); const task = f.active.get(f.conversation.id);
  await f.finish(); await until(() => f.remembered.length === 1);
  assert.equal(f.manager.snapshot(f.conversation).run.status, 'completed'); assert.equal(f.active.size, 0);
  let settled = false; const closing = f.manager.close().then(() => { settled = true; });
  await delay(20); assert.equal(settled, false);
  gate.resolve(); await closing; await task.done; assert.equal(settled, true);
});

test('a completed Agent starts the next queued task while its memory journal is still pending', async t => {
  const gate = deferred(); const f = fixture(t, { journal: () => gate.promise });
  try {
    await f.submit();
    await f.manager.submit(f.conversation, { submissionId: 'memory-queued-follow-up', content: '继续下一条任务' }, f.auth);
    f.calls[0].work.resolve({ text: '首条任务已经完成' });
    await until(() => f.remembered.length === 1);
    await delay(80);
    assert.equal(f.calls.length, 2, 'The durable memory journal must not retain the conversation execution lock');
    assert.equal(f.manager.snapshot(f.conversation).run.status, 'running');
  } finally {
    gate.resolve();
    for (const call of f.calls) call.work.resolve({ text: 'fixture cleanup' });
  }
});

test('private-input protection updates the small live memory fence before any reply is journaled', async t => {
  const f = fixture(t); await f.submit();
  const task = f.active.get(f.conversation.id), privacy = task.replyMemoryPrivacy;
  assert.deepEqual(privacy, { sensitiveInput: false, privateInputProtected: false });
  await f.manager.protectPrivateInput(f.conversation, task);
  assert.equal(task.replyMemoryPrivacy, privacy);
  assert.deepEqual(privacy, { sensitiveInput: true, privateInputProtected: true });
  await f.finish(); assert.equal(f.remembered.length, 0);
});
