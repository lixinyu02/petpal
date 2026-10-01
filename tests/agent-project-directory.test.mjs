import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { normalizeProjectDirectory, resolveProjectDirectory } from '../server/project-directory.mjs';
import { createAgentTasks, restoreAgentState } from '../server/agent-tasks.mjs';
import { createChatAssistant, normalizeChatAssistant, assistantTasksSnapshot, restoreAssistantTasks } from '../server/chat-assistant.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const until = async predicate => { for (let i = 0; i < 300; i++) { if (predicate()) return; await delay(5); } assert.fail('Agent directory state did not settle'); };
const body = (id, projectDirectory) => ({ submissionId: `submission-${id}`, content: `task ${id}`, ...(projectDirectory !== undefined ? { projectDirectory } : {}) });
const full = { access: 'full-access', approval: 'auto' };
const projectA = path.resolve('project-directory-fixture-a');
const projectB = path.resolve('project-directory-fixture-b');

async function directories(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'petpal-project-directory-'));
  const workspaceRoot = path.join(root, 'workspace'), inside = path.join(workspaceRoot, 'subproject'), outside = path.join(root, 'outside');
  await Promise.all([mkdir(inside, { recursive: true }), mkdir(outside)]);
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, workspaceRoot, inside, outside };
}

function agentFixture(t, conversation = { id: 'conversation-directory', userId: 'user-directory', mode: 'codex', messages: [] }, projectAccess = 'full') {
  const auth = { userId: conversation.userId, sessionHash: 'session-directory', bootstrap: false };
  const active = new Map(), approvals = new Map(), calls = [], steerCalls = [], saves = [];
  const store = { state: { conversations: [conversation] }, save: async () => { saves.push(structuredClone(store.state)); } };
  const bridge = {
    run(args) {
      const work = deferred(); calls.push({ args, work });
      args.onEvent('thread', { threadId: `thread-${calls.length}` });
      args.onEvent('turn', { turnId: `turn-${calls.length}` });
      args.signal.addEventListener('abort', () => work.reject(args.signal.reason), { once: true });
      return work.promise;
    },
    steer: async args => { steerCalls.push(args); return { turnId: args.expectedTurnId }; },
  };
  const manager = createAgentTasks({ store, active, approvals, getBridge: () => bridge, authorize: () => {}, resolveModel: () => ({ model: 'directory-model', effort: 'none', codexRevision: 'directory-revision' }), resolveHost: (_userId, hostId) => ({ hostId, hostName: hostId === 'central' ? 'Central' : 'Selected PC' }), resolveProject: (_userId, _hostId, value) => value ? { projectDirectory: value, projectAccess } : {} });
  t.after(async () => { for (const call of calls) call.work.resolve({ text: 'cleanup' }); await manager.stop(conversation); await manager.close(); });
  return { conversation, auth, active, calls, steerCalls, manager, store, saves,
    submit: (value, kind = 'submit') => manager.submit(conversation, value, auth, kind),
    snapshot: () => manager.snapshot(conversation),
    finish: async index => { const call = calls[index ?? calls.length - 1]; call.work.resolve({ text: 'done' }); await until(() => !active.has(conversation.id) || calls.at(-1) !== call); },
  };
}

function chatFixture(t) {
  const userId = randomUUID(), hostId = randomUUID(), revision = randomUUID();
  const chat = { id: randomUUID(), userId, mode: 'chat', messages: [] }, auth = { userId, sessionHash: 'chat-directory-session', bootstrap: false }, submitted = [];
  const store = { state: { conversations: [chat], executionHosts: [{ id: hostId, userId, name: 'Selected PC' }] }, save: async () => {} };
  const agentTasks = { submit: async (child, value) => { submitted.push({ child, value }); child.agent = { queue: [{ ...value }], run: null, submissions: [] }; }, snapshot: child => child.agent ?? { queue: [], run: null, submissions: [] }, stop: async child => { child.agent = { queue: [], run: null, submissions: [{ submissionId: child.agent?.queue[0]?.submissionId, status: 'cancelled' }] }; } };
  const manager = createChatAssistant({ store, agentTasks, authorize: () => {}, resolveHost: (_owner, id) => ({ hostId: id, hostName: 'Selected PC' }), revision: () => revision });
  t.after(() => manager.close());
  const options = normalizeChatAssistant({ enabled: true, hostId, providerId: 'directory-provider', permissions: full, projectDirectory: projectA }, randomUUID());
  return { manager, chat, auth, options, store, submitted };
}

test('directory normalization accepts explicit Windows and Linux absolute paths without shell interpretation', () => {
  assert.equal(normalizeProjectDirectory(undefined), '');
  assert.equal(normalizeProjectDirectory(''), '');
  assert.equal(normalizeProjectDirectory('/srv/projects/my app', 'linux'), '/srv/projects/my app');
  assert.equal(normalizeProjectDirectory('C:\\Users\\User\\my project', 'win32'), 'C:\\Users\\User\\my project');
  assert.equal(normalizeProjectDirectory('D:/projects/app', 'win32'), 'D:\\projects\\app');
  assert.equal(normalizeProjectDirectory('/srv/projects/$(literal)', 'linux'), '/srv/projects/$(literal)');
});

test('directory normalization rejects relative, drive-relative, invalid shape and control characters', () => {
  for (const invalid of [null, true, [], {}, 7, './project', '../project', 'project', '~', '/srv/project\nnext', '/srv/project\0next', '/srv/project\tother']) {
    assert.throws(() => normalizeProjectDirectory(invalid, 'linux'), { status: 400 });
  }
  for (const invalid of ['C:project', '\\project', 'project', '/srv/project']) assert.throws(() => normalizeProjectDirectory(invalid, 'win32'), { status: 400 });
  assert.throws(() => normalizeProjectDirectory('C:\\project', 'linux'), { status: 400 });
});

test('an omitted directory resolves the executor workspace and a real nested project resolves canonically', async t => {
  const f = await directories(t);
  assert.equal(await resolveProjectDirectory(undefined, { workspaceRoot: f.workspaceRoot, allowExternal: false }), await realpath(f.workspaceRoot));
  assert.equal(await resolveProjectDirectory(path.join(f.inside, '..', 'subproject'), { workspaceRoot: f.workspaceRoot, allowExternal: false }), await realpath(f.inside));
});

test('directory resolution rejects missing paths and ordinary files even with full access', async t => {
  const f = await directories(t), file = path.join(f.workspaceRoot, 'file.txt'); await writeFile(file, 'fixture');
  await assert.rejects(resolveProjectDirectory(path.join(f.root, 'missing'), { workspaceRoot: f.workspaceRoot, allowExternal: true }));
  await assert.rejects(resolveProjectDirectory(file, { workspaceRoot: f.workspaceRoot, allowExternal: true }));
});

test('workspace access rejects external directories, including sibling paths that share the workspace prefix', async t => {
  const f = await directories(t), sibling = `${f.workspaceRoot}-other`; await mkdir(sibling);
  for (const directory of [f.outside, sibling]) {
    await assert.rejects(resolveProjectDirectory(directory, { workspaceRoot: f.workspaceRoot, allowExternal: false }));
    assert.equal(await resolveProjectDirectory(directory, { workspaceRoot: f.workspaceRoot, allowExternal: true }), await realpath(directory));
  }
});

test('workspace access follows symlinks before checking containment and full access keeps the canonical target', async t => {
  const f = await directories(t), link = path.join(f.workspaceRoot, 'outside-link');
  await symlink(f.outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(resolveProjectDirectory(link, { workspaceRoot: f.workspaceRoot, allowExternal: false }));
  assert.equal(await resolveProjectDirectory(link, { workspaceRoot: f.workspaceRoot, allowExternal: true }), await realpath(f.outside));
});

test('custom Agent directory is frozen in a paused queue, persistence and its public snapshot', async t => {
  const f = agentFixture(t); await f.manager.stop(f.conversation);
  const request = { ...body('freeze', projectA), permissions: { ...full } }; await f.submit(request); request.projectDirectory = projectB;
  assert.equal(f.snapshot().queue[0].projectDirectory, projectA);
  assert.equal(f.saves.at(-1).conversations[0].agent.queue[0].projectDirectory, projectA);
  assert.doesNotMatch(JSON.stringify(f.snapshot()), /session-directory|sessionHash|fingerprint|bootstrap/);
  await f.manager.resume(f.conversation, f.auth); await until(() => f.calls.length === 1);
  assert.equal(f.calls[0].args.projectDirectory, projectA);
  assert.equal(f.calls[0].args.projectAccess, 'full');
  assert.equal(f.snapshot().run.projectDirectory, projectA);
});

test('a workspace directory grant remains frozen through persistence, restart and explicit queue resume', async t => {
  const f = agentFixture(t, undefined, 'workspace'); await f.manager.stop(f.conversation); await f.submit(body('workspace-grant', projectA));
  const recovered = structuredClone(f.saves.at(-1).conversations[0]); assert.equal(restoreAgentState(recovered), false);
  assert.equal(recovered.agent.queue[0].projectAccess, 'workspace');
  const restarted = agentFixture(t, recovered, 'workspace'); await restarted.manager.resume(recovered, restarted.auth); await until(() => restarted.calls.length === 1);
  assert.equal(restarted.calls[0].args.projectDirectory, projectA); assert.equal(restarted.calls[0].args.projectAccess, 'workspace');
  assert.equal(restarted.snapshot().run.projectAccess, undefined);
});

test('two queued tasks keep separate directory snapshots and run in FIFO order', async t => {
  const f = agentFixture(t); await f.submit({ ...body('first', projectA), permissions: full }); await until(() => f.calls.length === 1);
  await f.submit({ ...body('second', projectB), permissions: full });
  assert.equal(f.snapshot().queue[0].projectDirectory, projectB);
  await f.finish(0); await until(() => f.calls.length === 2);
  assert.equal(f.calls[0].args.projectDirectory, projectA); assert.equal(f.calls[1].args.projectDirectory, projectB);
});

test('steering inherits the running directory and rejects an explicit directory change before any delivery', async t => {
  const f = agentFixture(t); await f.submit({ ...body('running', projectA), permissions: full }); await until(() => f.calls.length === 1);
  await assert.rejects(f.submit({ ...body('changed', projectB), expectedTurnId: 'turn-1' }, 'steer'), { status: 409 });
  assert.equal(f.steerCalls.length, 0); assert.equal(f.snapshot().submissions.length, 1);
  assert.equal((await f.submit({ ...body('inherited'), expectedTurnId: 'turn-1' }, 'steer')).status, 'steered');
  assert.equal(f.steerCalls.length, 1); assert.equal(f.calls.length, 1);
});

test('steering cannot add a custom directory to a turn started with the default workspace', async t => {
  const f = agentFixture(t); await f.submit(body('default')); await until(() => f.calls.length === 1);
  await assert.rejects(f.submit({ ...body('directory-added', projectA), expectedTurnId: 'turn-1' }, 'steer'), { status: 409 });
  assert.equal(f.steerCalls.length, 0); assert.equal(f.calls.length, 1);
});

test('a stable computer and project resume the native thread, while changing project starts a fresh thread', async t => {
  const f = agentFixture(t);
  await f.submit({ ...body('first', projectA), permissions: full }); await until(() => f.calls.length === 1); await f.finish();
  await f.submit({ ...body('same', projectA), permissions: full }); await until(() => f.calls.length === 2);
  assert.equal(f.calls[1].args.threadId, 'thread-1'); await f.finish();
  await f.submit({ ...body('different', projectB), permissions: full }); await until(() => f.calls.length === 3);
  assert.equal(f.calls[2].args.threadId, undefined);
  assert.match(f.calls[2].args.prompt, /task first/); assert.match(f.calls[2].args.prompt, /task different/);
});

test('changing computer starts a new native thread even when its project directory text matches', async t => {
  const f = agentFixture(t);
  await f.submit({ ...body('central', projectA), permissions: full }); await until(() => f.calls.length === 1); await f.finish();
  await f.submit({ ...body('remote', projectA), permissions: full, hostId: 'desktop-directory' }); await until(() => f.calls.length === 2);
  assert.equal(f.calls[1].args.threadId, undefined); assert.equal(f.calls[1].args.projectDirectory, projectA);
});

test('returning from a custom project to the default workspace starts a fresh native thread', async t => {
  const f = agentFixture(t);
  await f.submit({ ...body('custom-before-default', projectA), permissions: full }); await until(() => f.calls.length === 1); await f.finish();
  await f.submit(body('default-after-custom')); await until(() => f.calls.length === 2);
  assert.equal(f.calls[1].args.threadId, undefined); assert.equal(f.calls[1].args.projectDirectory, undefined);
  assert.equal(f.conversation.threadProjectDirectory, undefined);
});

test('request bodies cannot grant themselves internal full directory access', async t => {
  const f = agentFixture(t);
  await assert.rejects(f.submit({ ...body('forged-access', projectA), projectAccess: 'full' }), { status: 400 });
  assert.equal(f.snapshot().queue.length, 0); assert.equal(f.snapshot().submissions.length, 0); assert.equal(f.calls.length, 0);
});

test('legacy native threads continue using the unchanged default workspace and old idempotency receipts', async t => {
  const conversation = { id: 'conversation-directory', userId: 'user-directory', mode: 'codex', messages: [], threadId: 'legacy-thread' };
  const f = agentFixture(t, conversation), request = body('legacy');
  const fingerprint = createHash('sha256').update(JSON.stringify({ kind: 'submit', content: request.content, attachmentIds: [], permissions: null, providerId: null })).digest('hex');
  f.conversation.agent = { revision: 1, paused: true, queue: [], run: null, submissions: [{ submissionId: request.submissionId, entryId: 'legacy-entry', fingerprint, status: 'completed', content: request.content, attachmentIds: [], createdAt: new Date().toISOString() }] };
  assert.equal(restoreAgentState(f.conversation), false);
  assert.equal((await f.submit(request)).status, 'completed'); assert.equal(f.calls.length, 0);
  await f.submit(body('fresh-default')); await f.manager.resume(f.conversation, f.auth); await until(() => f.calls.length === 1);
  assert.equal(f.calls[0].args.threadId, 'legacy-thread'); assert.equal(f.calls[0].args.projectDirectory, undefined);
});

test('directory is part of the idempotency identity without allowing one receipt to execute twice', async t => {
  const f = agentFixture(t); await f.manager.stop(f.conversation); const request = { ...body('identity', projectA), permissions: full };
  const first = await f.submit(request), duplicate = await f.submit({ ...request }); assert.equal(first.entryId, duplicate.entryId);
  await assert.rejects(f.submit({ ...request, projectDirectory: projectB }), { status: 409 }); assert.equal(f.snapshot().queue.length, 1);
});

test('queue edits cannot replace the frozen project and restore rejects malformed persisted directory fields', async t => {
  const f = agentFixture(t); await f.manager.stop(f.conversation); await f.submit({ ...body('edit', projectA), permissions: full }); const entry = f.snapshot().queue[0];
  await assert.rejects(f.manager.edit(f.conversation, entry.id, { revision: entry.revision, content: 'changed', projectDirectory: projectB }, f.auth), { status: 400 });
  const corrupt = structuredClone(f.conversation); corrupt.agent.queue[0].projectDirectory = 3;
  assert.throws(() => restoreAgentState(corrupt));
  assert.equal(f.snapshot().queue[0].projectDirectory, projectA);
});

test('Chat assistant freezes and persists the preselected project before deciding to dispatch', async t => {
  const f = chatFixture(t); assert.equal(f.options.projectDirectory, projectA); assert.ok(Object.isFrozen(f.options));
  const { record } = await f.manager.prepare(f.chat, f.auth, f.options, '处理项目', []);
  assert.equal(record.projectDirectory, projectA); assert.equal(f.submitted.length, 0);
  await f.manager.dispatch(record, '检查这个项目');
  assert.equal(f.submitted[0].value.projectDirectory, projectA);
  assert.equal(assistantTasksSnapshot(f.chat)[0].projectDirectory, projectA);
  assert.doesNotMatch(JSON.stringify(assistantTasksSnapshot(f.chat)), /chat-directory-session|fingerprint/);
});

test('Chat assistant duplicate identity includes the project and rejects changing it after preparation', async t => {
  const f = chatFixture(t); const first = await f.manager.prepare(f.chat, f.auth, f.options, '处理项目', []);
  assert.equal((await f.manager.prepare(f.chat, f.auth, f.options, '处理项目', [])).record, first.record);
  const changed = normalizeChatAssistant({ enabled: true, hostId: f.options.hostId, providerId: f.options.providerId, permissions: full, projectDirectory: projectB }, f.options.submissionId);
  await assert.rejects(f.manager.prepare(f.chat, f.auth, changed, '处理项目', []), { status: 409 });
  assert.equal(f.chat.assistantTasks.length, 1); assert.equal(f.submitted.length, 0);
});

test('Chat assistant restore rejects malformed persisted project fields before late dispatch', async t => {
  const f = chatFixture(t); await f.manager.prepare(f.chat, f.auth, f.options, '处理项目', []);
  const corrupt = structuredClone(f.chat); corrupt.assistantTasks[0].projectDirectory = { cwd: projectB };
  assert.throws(() => restoreAssistantTasks(corrupt, f.store.state.executionHosts, f.store.state.conversations));
  assert.equal(f.submitted.length, 0);
});
