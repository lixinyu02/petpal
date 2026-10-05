import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JsonStore } from '../server/store.mjs';
import { organizationPatch, organizationText } from '../server/conversation-organization.mjs';

const at = () => new Date().toISOString();
const conversation = userId => ({ id: randomUUID(), userId, mode: 'chat', title: '自动名称', providerId: null, messages: [], createdAt: at(), updatedAt: at(), projectId: null, archivedAt: null });
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-conversation-org-store-'));
  const store = await new JsonStore(directory).init(), userId = store.state.ownerId;
  const act = input => store.save({ organization: { userId, authorize() {}, ...input } });
  const create = async () => { const item = conversation(userId); await act({ kind: 'conversation-create', conversation: item }); return store.state.conversations.find(live => live.id === item.id); };
  t.after(async () => { await store.queue.catch(() => {}); assert.ok(directory.startsWith(path.join(tmpdir(), 'petpal-conversation-org-store-'))); await rm(directory, { recursive: true, force: true }); });
  return { store, directory, userId, act, create };
}

test('old JSON stores migrate nullable metadata and retain all original bodies', async t => {
  const f = await fixture(t), item = await f.create();
  const raw = JSON.parse(await readFile(f.store.file, 'utf8')); delete raw.projects;
  delete raw.conversations[0].projectId; delete raw.conversations[0].archivedAt;
  raw.conversations[0].messages.push({ id: randomUUID(), role: 'user', content: '旧版正文', status: 'complete', createdAt: at() });
  await writeFile(f.store.file, JSON.stringify(raw));
  const migrated = await new JsonStore(f.directory).init();
  assert.deepEqual(migrated.state.projects, []);
  const loaded = migrated.state.conversations.find(c => c.id === item.id);
  assert.equal(loaded.projectId, null); assert.equal(loaded.archivedAt, null); assert.equal(loaded.messages[0].content, '旧版正文');
});

test('committed names, projects and archive survive saves captured before updates', async t => {
  const f = await fixture(t), item = await f.create(), projectId = randomUUID();
  let release; f.store.queue = new Promise(resolve => { release = resolve; });
  const createProject = f.act({ kind: 'project-create', id: projectId, name: '音乐' });
  const rename = f.act({ kind: 'conversation-update', id: item.id, patch: organizationPatch({ title: '我的音乐', projectId, archived: true }) });
  item.messages.push({ id: randomUUID(), role: 'user', content: '保存期间的新正文', status: 'complete', createdAt: at() });
  item.title = '另一个自动摘要';
  const stale = f.store.save(); release(); await Promise.all([createProject, rename, stale]);
  const disk = JSON.parse(await readFile(f.store.file, 'utf8'));
  assert.equal(disk.projects[0].name, '音乐'); assert.equal(disk.conversations[0].customTitle, '我的音乐');
  assert.equal(disk.conversations[0].projectId, projectId); assert.ok(disk.conversations[0].archivedAt);
  assert.equal(disk.conversations[0].messages[0].content, '保存期间的新正文');
  assert.equal(item.customTitle, '我的音乐');
  const reload = await new JsonStore(f.directory).init(); assert.equal(reload.state.conversations[0].customTitle, '我的音乐');
});

test('organization saves preserve capture ordering without publishing later unsaved body edits', async t => {
  const f = await fixture(t), item = await f.create();
  item.messages.push({ id: randomUUID(), role: 'user', content: 'A', status: 'complete', createdAt: at() }); await f.store.save();
  let release; f.store.queue = new Promise(resolve => { release = resolve; });
  const changing = f.act({ kind: 'conversation-update', id: item.id, patch: organizationPatch({ title: '不会跳过队列' }) }), stale = f.store.save();
  item.messages.push({ id: randomUUID(), role: 'user', content: 'B 尚未保存', status: 'complete', createdAt: at() });
  release(); await changing;
  const firstDisk = JSON.parse(await readFile(f.store.file, 'utf8')); assert.equal(firstDisk.conversations[0].messages.length, 1);
  await stale; assert.equal(JSON.parse(await readFile(f.store.file, 'utf8')).conversations[0].messages.length, 1);
  assert.equal(item.messages.length, 2); await f.store.save(); assert.equal(JSON.parse(await readFile(f.store.file, 'utf8')).conversations[0].messages.length, 2);
});

test('project deletion preserves conversations, archive and custom titles through old snapshots', async t => {
  const f = await fixture(t), item = await f.create(), projectId = randomUUID();
  await f.act({ kind: 'project-create', id: projectId, name: '旧项目' });
  await f.act({ kind: 'conversation-update', id: item.id, patch: organizationPatch({ title: '保留我', projectId, archived: true }) });
  const archivedAt = item.archivedAt;
  let release; f.store.queue = new Promise(resolve => { release = resolve; });
  const remove = f.act({ kind: 'project-delete', id: projectId }), stale = f.store.save(); release(); await Promise.all([remove, stale]);
  assert.deepEqual(f.store.state.projects, []); assert.equal(item.projectId, null);
  assert.equal(item.archivedAt, archivedAt); assert.equal(item.customTitle, '保留我');
  const disk = JSON.parse(await readFile(f.store.file, 'utf8')); assert.deepEqual(disk.projects, []); assert.equal(disk.conversations[0].projectId, null);
});

test('successful deletion tombstones parent and background children against stale writes', async t => {
  const f = await fixture(t), item = await f.create(), child = { ...conversation(f.userId), mode: 'codex', backgroundParentId: item.id };
  f.store.state.conversations.push(child); await f.store.save();
  let release; f.store.queue = new Promise(resolve => { release = resolve; });
  const remove = f.act({ kind: 'conversation-delete', id: item.id }), stale = f.store.save(); release(); await Promise.all([remove, stale]);
  assert.deepEqual(f.store.state.conversations, []); assert.deepEqual(JSON.parse(await readFile(f.store.file, 'utf8')).conversations, []);
  await assert.rejects(f.act({ kind: 'conversation-update', id: item.id, patch: organizationPatch({ title: '复活' }) }), { status: 404 });
});

test('new conversations committed before an older captured save remain durable', async t => {
  const f = await fixture(t), item = conversation(f.userId);
  let release; f.store.queue = new Promise(resolve => { release = resolve; });
  const create = f.act({ kind: 'conversation-create', conversation: item }), stale = f.store.save(); release(); await Promise.all([create, stale]);
  assert.equal(f.store.state.conversations[0].id, item.id); assert.equal(JSON.parse(await readFile(f.store.file, 'utf8')).conversations[0].id, item.id);
});

test('failed writes publish no partial project, archive, title or delete state and can retry', async t => {
  const f = await fixture(t), item = await f.create(), original = await readFile(f.store.file, 'utf8'), oldFile = f.store.file;
  f.store.file = path.join(f.directory, 'missing', 'state.json');
  await assert.rejects(f.act({ kind: 'project-create', id: randomUUID(), name: '未落盘' }));
  await assert.rejects(f.act({ kind: 'conversation-update', id: item.id, patch: organizationPatch({ title: '未落盘', archived: true }) }));
  await assert.rejects(f.act({ kind: 'conversation-delete', id: item.id }));
  assert.deepEqual(f.store.state.projects, []); assert.equal(item.customTitle, undefined); assert.equal(item.archivedAt, null); assert.ok(f.store.state.conversations.includes(item));
  assert.equal(await readFile(oldFile, 'utf8'), original);
  f.store.file = oldFile; await f.act({ kind: 'conversation-update', id: item.id, patch: organizationPatch({ title: '重试成功' }) }); assert.equal(item.customTitle, '重试成功');
});

test('organization authorization rechecks queue entry and immediately before atomic publication', async t => {
  const f = await fixture(t), item = await f.create(), original = await readFile(f.store.file, 'utf8');
  let attempts = 0;
  await assert.rejects(f.act({ kind: 'conversation-update', id: item.id, patch: organizationPatch({ archived: true }), authorize() { if (++attempts === 2) throw Object.assign(new Error('revoked'), { status: 401 }); } }), { status: 401 });
  assert.equal(attempts, 2); assert.equal(item.archivedAt, null); assert.equal(await readFile(f.store.file, 'utf8'), original);
  let release, authorized = true; f.store.queue = new Promise(resolve => { release = resolve; });
  const pending = f.act({ kind: 'project-create', id: randomUUID(), name: '撤销之后', authorize() { if (!authorized) throw Object.assign(new Error('revoked'), { status: 401 }); } });
  authorized = false; release(); await assert.rejects(pending, { status: 401 }); assert.deepEqual(f.store.state.projects, []);
});

test('queued concurrent project creations enforce the account limit without partial rows', async t => {
  const f = await fixture(t);
  const results = await Promise.allSettled(Array.from({ length: 55 }, (_, index) => f.act({ kind: 'project-create', id: randomUUID(), name: `项目${index}` })));
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 50); assert.equal(results.filter(item => item.status === 'rejected').length, 5);
  assert.equal(f.store.state.projects.length, 50); assert.equal(JSON.parse(await readFile(f.store.file, 'utf8')).projects.length, 50);
});

test('schema rejects foreign project membership rather than silently leaking metadata', async t => {
  const f = await fixture(t), item = await f.create(), raw = JSON.parse(await readFile(f.store.file, 'utf8'));
  raw.conversations[0].projectId = randomUUID(); await writeFile(f.store.file, JSON.stringify(raw));
  await assert.rejects(new JsonStore(f.directory).init(), /项目归属/);
  assert.equal(raw.conversations[0].id, item.id);
});

test('organization field validation rejects malformed and unsupported values', () => {
  for (const value of ['', ' '.repeat(5), 'x'.repeat(101), 'line\nline', null, {}]) assert.throws(() => organizationPatch({ title: value }), { status: 400 });
  for (const input of [{}, { providerId: 'other' }, { projectId: '' }, { projectId: 3 }, { archived: 'true' }, { archived: null }]) assert.throws(() => organizationPatch(input), { status: 400 });
  assert.equal(organizationText('  工作  ', '项目名称', 60), '工作');
});
