import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { reuseConversationMessages } from '../src/conversation-message-reuse.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const message = (id, overrides = {}) => ({
  id, role: 'assistant', content: `Message ${id}`, createdAt: '2026-10-07T00:00:00Z', ...overrides,
});
const conversation = (messages, overrides = {}) => ({
  id: 'conversation-1', title: 'Performance', mode: 'chat',
  createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z', messages, ...overrides,
});
const reuseCount = (before, after) => after.messages.filter(item => before.messages.includes(item)).length;

test('shared invalid records without message IDs cannot establish a reusable array', () => {
  for (const record of ['invalid-message', null, {content:'no ID'}]) {
    const before = conversation([record]), incoming = conversation([record]);
    assert.strictEqual(reuseConversationMessages(before,incoming),incoming);
    assert.notStrictEqual(incoming.messages,before.messages);
  }
});

test('unchanged JSON snapshot reuses every message and the existing messages array', () => {
  const before = conversation([message('one'), message('two')]);
  const incoming = clone(before);
  const result = reuseConversationMessages(before, incoming);
  assert.notStrictEqual(result, incoming);
  assert.notStrictEqual(result, before);
  assert.strictEqual(result.messages, before.messages);
  assert.deepEqual(result, incoming);
  assert.notStrictEqual(incoming.messages, before.messages);
  assert.notStrictEqual(incoming.messages[0], before.messages[0]);
});

test('only a changed final message gets a new reference', () => {
  const before = conversation([message('one'), message('two'), message('three')]);
  const incoming = clone(before);
  incoming.messages[2].content += ' continued';
  const result = reuseConversationMessages(before, incoming);
  assert.strictEqual(result.messages[0], before.messages[0]);
  assert.strictEqual(result.messages[1], before.messages[1]);
  assert.strictEqual(result.messages[2], incoming.messages[2]);
  assert.notStrictEqual(result.messages, before.messages);
  assert.deepEqual(result, incoming);
});

test('agent, assistant task and organization updates keep authoritative metadata and old message references', () => {
  const before = conversation([message('one'), message('two')], {
    agent: { revision: 1, paused: false, queue: [], approvals: [], run: { status: 'running' } },
    assistantTasks: [{ id: 'task-1', status: 'running' }], projectId: 'project-old',
  });
  const incoming = clone(before);
  incoming.agent.revision = 2;
  incoming.agent.run.status = 'completed';
  incoming.assistantTasks[0].status = 'completed';
  incoming.projectId = 'project-new';
  incoming.title = 'Updated title';
  incoming.archivedAt = '2026-10-07T01:00:00Z';
  incoming.updatedAt = '2026-10-07T01:00:00Z';
  const result = reuseConversationMessages(before, incoming);
  assert.strictEqual(result.messages, before.messages);
  assert.strictEqual(result.agent, incoming.agent);
  assert.strictEqual(result.assistantTasks, incoming.assistantTasks);
  assert.deepEqual(result, incoming);
});

test('object key order does not prevent reuse, including nested unknown metadata', () => {
  const before = conversation([message('one', {
    attachments: [{ id: 'image-1', name: 'photo.png', metadata: { width: 100, tags: ['a', 'b'] } }],
    metadata: { tokens: 20, nested: { first: null, second: true } },
  })]);
  const incoming = conversation([{
    metadata: { nested: { second: true, first: null }, tokens: 20 },
    attachments: [{ metadata: { tags: ['a', 'b'], width: 100 }, name: 'photo.png', id: 'image-1' }],
    createdAt: '2026-10-07T00:00:00Z', content: 'Message one', role: 'assistant', id: 'one',
  }]);
  const result = reuseConversationMessages(before, incoming);
  assert.strictEqual(result.messages, before.messages);
});

test('JSON data from another realm still reuses messages regardless of object key order', () => {
  const before = conversation([message('one', { metadata: { count: 1, flags: [true, null] } })]);
  const incoming = vm.runInNewContext(`({
    id: 'conversation-1', title: 'Performance', mode: 'chat',
    createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z',
    messages: [{ metadata: { flags: [true, null], count: 1 }, content: 'Message one',
      role: 'assistant', id: 'one', createdAt: '2026-10-07T00:00:00Z' }]
  })`);
  const result = reuseConversationMessages(before, incoming);
  assert.strictEqual(result.messages, before.messages);
  assert.strictEqual(result.title, incoming.title);
});

const original = message('one', {
  model: 'model-1', status: 'completed', steered: false,
  assistantTaskId: 'task-1', assistantTaskReport: 'progress',
  attachments: [{ id: 'image-1', mimeType: 'image/png', name: 'photo.png', size: 20, width: 10, height: 10,
    metadata: { caption: 'old', order: ['a', 'b'] } }],
  metadata: { nested: { count: 1 }, flags: [false, null] },
});
for (const [label, change] of [
  ['content', item => { item.content += ' changed'; }],
  ['role', item => { item.role = 'user'; }],
  ['model', item => { item.model = 'model-2'; }],
  ['status', item => { item.status = 'error'; }],
  ['steered', item => { item.steered = true; }],
  ['assistant task ID', item => { item.assistantTaskId = 'task-2'; }],
  ['assistant task report', item => { item.assistantTaskReport = 'result'; }],
  ['created timestamp', item => { item.createdAt = '2026-10-07T01:00:00Z'; }],
  ['attachment fields', item => { item.attachments[0].size++; }],
  ['nested attachment metadata', item => { item.attachments[0].metadata.caption = 'new'; }],
  ['attachment metadata array order', item => { item.attachments[0].metadata.order.reverse(); }],
  ['unknown nested metadata', item => { item.metadata.nested.count++; }],
  ['unknown metadata array', item => { item.metadata.flags[0] = true; }],
  ['new unknown field', item => { item.extra = { state: 'new' }; }],
  ['removed optional field', item => { delete item.model; }],
]) {
  test(`changed ${label} is preserved instead of reusing stale data`, () => {
    const before = conversation([message('unchanged'), clone(original)]);
    const incoming = clone(before);
    change(incoming.messages[1]);
    const result = reuseConversationMessages(before, incoming);
    assert.strictEqual(result.messages[0], before.messages[0]);
    assert.strictEqual(result.messages[1], incoming.messages[1]);
    assert.deepEqual(result, incoming);
  });
}

test('reordering retains incoming order and reuses each uniquely matching message', () => {
  const before = conversation([message('one'), message('two'), message('three')]);
  const incoming = conversation(clone([before.messages[2], before.messages[0], before.messages[1]]));
  const result = reuseConversationMessages(before, incoming);
  assert.deepEqual(result.messages.map(item => item.id), ['three', 'one', 'two']);
  assert.strictEqual(result.messages[0], before.messages[2]);
  assert.strictEqual(result.messages[1], before.messages[0]);
  assert.strictEqual(result.messages[2], before.messages[1]);
  assert.notStrictEqual(result.messages, before.messages);
});

test('insertion, authoritative deletion and changed reordered messages retain incoming data', () => {
  const before = conversation([message('one'), message('two'), message('three'), message('four')]);
  const incoming = conversation([
    clone(before.messages[2]), message('new'), message('one', { content: 'edited' }), clone(before.messages[3]),
  ]);
  const result = reuseConversationMessages(before, incoming);
  assert.deepEqual(result.messages.map(item => item.id), ['three', 'new', 'one', 'four']);
  assert.strictEqual(result.messages[0], before.messages[2]);
  assert.strictEqual(result.messages[1], incoming.messages[1]);
  assert.strictEqual(result.messages[2], incoming.messages[2]);
  assert.strictEqual(result.messages[3], before.messages[3]);
  assert.deepEqual(result, incoming);
});

test('different conversation IDs never share message references', () => {
  const before = conversation([message('shared-message-id')]);
  const incoming = conversation(clone(before.messages), { id: 'conversation-2' });
  assert.strictEqual(reuseConversationMessages(before, incoming), incoming);
});

test('missing before conversation or missing message arrays return incoming unchanged', () => {
  const incoming = conversation([message('one')]);
  for (const before of [undefined, null, { id: incoming.id }, { id: incoming.id, messages: null }]) {
    assert.strictEqual(reuseConversationMessages(before, incoming), incoming);
  }
  const before = conversation([message('one')]);
  for (const candidate of [{ id: before.id }, { id: before.id, messages: null }, { id: before.id, messages: {} }]) {
    assert.strictEqual(reuseConversationMessages(before, candidate), candidate);
  }
});

test('snapshots with no reusable objects keep incoming identity', () => {
  const before = conversation([message('one'), message('two')]);
  const incoming = conversation([message('one', { content: 'changed' }), message('new')]);
  assert.strictEqual(reuseConversationMessages(before, incoming), incoming);
  assert.strictEqual(reuseConversationMessages(before, conversation([])).messages.length, 0);
});

test('already shared messages array keeps incoming identity when no replacement is needed', () => {
  const before = conversation([message('one')]);
  const incoming = conversation(before.messages, { title: 'new title' });
  assert.strictEqual(reuseConversationMessages(before, incoming), incoming);
});

test('shared message objects in a new array still reuse the existing array', () => {
  const before = conversation([message('one')]);
  const incoming = conversation([before.messages[0]], { title: 'new title' });
  const result = reuseConversationMessages(before, incoming);
  assert.notStrictEqual(result, incoming);
  assert.strictEqual(result.messages, before.messages);
  assert.equal(result.title, incoming.title);
});

test('duplicate IDs never reuse a different message based only on the ID', () => {
  const before = conversation([message('same', { content: 'first' }), message('same', { content: 'second' })]);
  const incoming = conversation(clone([before.messages[1], before.messages[0]]));
  const result = reuseConversationMessages(before, incoming);
  assert.deepEqual(result, incoming);
  assert.strictEqual(result.messages[0], incoming.messages[0]);
  assert.strictEqual(result.messages[1], incoming.messages[1]);
});

test('duplicate IDs at matching positions may safely reuse identical complete messages', () => {
  const before = conversation([message('same', { content: 'first' }), message('same', { content: 'second' })]);
  const result = reuseConversationMessages(before, clone(before));
  assert.strictEqual(result.messages, before.messages);
});

test('duplicate incoming IDs do not reuse one old object through multiple fallback matches', () => {
  const before = conversation([message('one'), message('two')]);
  const incoming = conversation([clone(before.messages[1]), clone(before.messages[1])]);
  const result = reuseConversationMessages(before, incoming);
  assert.deepEqual(result, incoming);
  assert.ok(result.messages.filter(item => item === before.messages[1]).length <= 1);
});

for (const [label, valueFactory] of [
  ['undefined', () => undefined], ['NaN', () => NaN], ['Infinity', () => Infinity],
  ['function', () => () => {}], ['BigInt', () => 1n], ['symbol', () => Symbol('invalid')],
  ['Date', () => new Date('2026-10-07T00:00:00Z')],
  ['cyclic object', () => { const value = {}; value.self = value; return value; }],
  ['sparse array', () => new Array(1)],
]) {
  test(`non-JSON ${label} metadata is not reused and does not throw`, () => {
    const before = conversation([message('one', { metadata: valueFactory() })]);
    const incoming = conversation([message('one', { metadata: valueFactory() })]);
    assert.strictEqual(reuseConversationMessages(before, incoming), incoming);
  });
}

test('invalid and empty message entries are treated conservatively', () => {
  const before = conversation([null, {}, message('one')]);
  const incoming = conversation([null, {}, message('one')]);
  const result = reuseConversationMessages(before, incoming);
  assert.strictEqual(result.messages[1], incoming.messages[1]);
  assert.strictEqual(result.messages[2], before.messages[2]);
  assert.deepEqual(result, incoming);
});

for (const size of [500, 1000]) {
  test(`${size} messages: unchanged snapshot reuses all references, appended content replaces only the final one`, () => {
    const before = conversation(Array.from({ length: size }, (_, index) => message(`message-${index}`, {
      metadata: { tokens: index, details: { complete: true } },
    })));
    const snapshot = clone(before);
    const unchanged = reuseConversationMessages(before, snapshot);
    assert.strictEqual(unchanged.messages, before.messages);
    assert.equal(reuseCount(before, unchanged), size);
    const incoming = clone(before);
    incoming.messages.at(-1).content += ' streamed continuation';
    const result = reuseConversationMessages(before, incoming);
    assert.equal(reuseCount(before, result), size - 1);
    assert.strictEqual(result.messages.at(-1), incoming.messages.at(-1));
    assert.deepEqual(result, incoming);
  });
}
