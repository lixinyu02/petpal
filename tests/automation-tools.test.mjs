import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CodexBridge } from '../server/codex.mjs';
import { automationToolSpecs, describeAutomationTool, executeAutomationTool, validateAutomationTool, withAutomationTools } from '../server/automation-tools.mjs';

const input = () => ({ title: 'Read project status', prompt: 'Report the project status without modifying files.', schedule: { kind: 'interval', minutes: 5 }, requestId: randomUUID() });
const entry = () => ({ id: randomUUID(), conversationId: randomUUID(), auth: { userId: randomUUID() }, hostId: randomUUID(), providerId: randomUUID(), model: 'assigned-model', projectDirectory: 'C:\\work\\pet', permissions: { access: 'workspace-write', approval: 'ask' } });

test('automation catalogue exposes only scheduling content and cannot accept execution identity overrides', () => {
  assert.deepEqual(automationToolSpecs.map(item => item.name), ['petpal_automation_list', 'petpal_automation_create', 'petpal_automation_pause']);
  for (const extra of [{ userId: randomUUID() }, { hostId: 'central' }, { permissions: { access: 'full-access', approval: 'auto' } }, { sourceRunId: randomUUID() }, { model: 'foreign' }, { projectDirectory: 'C:\\Windows' }]) assert.throws(() => validateAutomationTool('petpal_automation_create', { ...input(), ...extra }), { status: 400 });
  assert.throws(() => validateAutomationTool('petpal_automation_create', { ...input(), requestId: 'retry-me' }), { status: 400 });
  assert.throws(() => validateAutomationTool('petpal_automation_create', { ...input(), schedule: { kind: 'interval', minutes: 1 } }), { status: 400 });
  assert.throws(() => validateAutomationTool('petpal_automation_pause', { id: randomUUID() }), { status: 400 });
});

test('complete mutation review refuses truncation and shows inherited scope', () => {
  const current = entry(), described = describeAutomationTool('petpal_automation_create', input(), current);
  assert.equal(described.accessRequired, 'read-only'); assert.equal(described.approvalRequired, true);
  assert.ok(described.description.includes(current.projectDirectory)); assert.ok(described.description.includes(current.model));
  assert.throws(() => describeAutomationTool('petpal_automation_create', { ...input(), prompt: 'x'.repeat(8000) }), /审批长度/);
  assert.equal(describeAutomationTool('petpal_automation_list', {}).approvalRequired, false);
});

test('tools inherit actual entry and per-turn provenance; pause cannot change scope', async () => {
  const current = entry(), args = input(), calls = [];
  const service = { create: async (...values) => { calls.push(values); return { id: randomUUID() }; }, update: async (...values) => { calls.push(values); return { id: values[1] }; } };
  await executeAutomationTool(service, current, 'petpal_automation_create', args);
  assert.equal(calls[0][0], current.auth.userId); assert.deepEqual(calls[0][1], args);
  assert.equal(typeof calls[0][2].guard, 'function');
  assert.deepEqual({ ...calls[0][2], guard: undefined }, { source: 'agent', sourceConversationId: current.conversationId, context: { sourceRunId: current.id, hostId: current.hostId, providerId: current.providerId, projectDirectory: current.projectDirectory, permissions: current.permissions }, guard: undefined });
  const paused = { id: randomUUID(), revision: randomUUID() };
  await executeAutomationTool(service, current, 'petpal_automation_pause', paused);
  assert.deepEqual(calls[1].slice(0, 3), [current.auth.userId, paused.id, { revision: paused.revision, enabled: false }]);
});

test('wrapper is installed before tool caching, preserves desktop tools and fences late results', async () => {
  const current = entry(); let live = true, resolve, used = 0;
  const base = { specs: [{ type: 'function', name: 'desktop' }], describe: () => ({ description: 'desktop', approvalRequired: true }), execute: async () => ({ desktop: true }), close: async () => {} };
  const wrapped = withAutomationTools(base, { resolveContext: () => { if (!live) throw new Error('run revoked'); return current; }, execute: async () => { used++; return new Promise(done => { resolve = done; }); } });
  const bridge = new CodexBridge({ desktopTools: wrapped });
  assert.equal(bridge.toolNames.has('petpal_automation_create'), true);
  assert.deepEqual(await wrapped.execute('desktop', {}), { desktop: true });
  const pending = wrapped.execute('petpal_automation_list', {}, { conversationId: current.conversationId });
  live = false; resolve({ ok: true }); await assert.rejects(pending, /revoked/); assert.equal(used, 1);
});

function dynamicFixture(permissions, { name = 'petpal_automation_create', description, args = input() } = {}) {
  const events = [], replies = [], calls = [];
  const tools = withAutomationTools({ specs: [{ type: 'function', name: 'desktop' }], describe: () => ({ description: 'desktop action', approvalRequired: true, accessRequired: 'read-only' }), execute: async () => ({ ok: true }) }, { execute: async (...values) => { calls.push(values); return { ok: true }; } });
  if (description) tools.describe = () => description;
  const bridge = new CodexBridge({ desktopTools: tools }); bridge.child = {};
  bridge._send = message => replies.push(message);
  const run = { turnId: 'trusted-turn', conversationId: 'trusted-conversation', permissions, child: bridge.child, dynamicCalls: new Map(), toolTasks: new Set(), onEvent: (event, data) => events.push({ event, data }) };
  const request = { id: 'rpc-one', params: { turnId: run.turnId, callId: 'trusted-call', tool: name, arguments: args } };
  return { bridge, run, request, events, replies, calls, invoke() { bridge._dynamicTool(request, run); }, async settle() { await Promise.all([...run.toolTasks]); } };
}

for (const approval of ['ask', 'review', 'auto']) test(`read-only automation writes preserve ${approval} approval policy`, async () => {
  const f = dynamicFixture({ access: 'read-only', approval }); f.invoke();
  if (approval !== 'auto') { assert.equal(f.calls.length, 0); const pending = f.events.find(item => item.event === 'approval'); assert.equal(pending.data.kind, 'automation'); assert.equal(pending.data.automation.callId, 'trusted-call'); assert.equal(pending.data.automation.name, 'petpal_automation_create'); assert.deepEqual(pending.data.automation.arguments, f.request.params.arguments); f.bridge.approve(pending.data.id, 'accept'); }
  await f.settle(); assert.equal(f.calls.length, 1); assert.equal(f.replies[0].result.success, true);
  assert.equal(f.calls[0][2].callId, 'trusted-call'); assert.equal(f.calls[0][2].turnId, 'trusted-turn');
});

test('declined automation and desktop guard cannot be weakened by accessRequired metadata', async () => {
  const declined = dynamicFixture({ access: 'workspace-write', approval: 'ask' }); declined.invoke(); declined.bridge.approve(declined.events.find(item => item.event === 'approval').data.id, 'decline'); await declined.settle(); assert.equal(declined.calls.length, 0); assert.equal(declined.replies[0].result.success, false);
  const desktop = dynamicFixture({ access: 'workspace-write', approval: 'auto' }, { name: 'desktop', args: {} }); desktop.invoke(); await desktop.settle(); assert.equal(desktop.replies[0].result.success, false); assert.match(desktop.replies[0].result.contentItems[0].text, /完全访问/);
  const oversize = dynamicFixture({ access: 'full-access', approval: 'ask' }, { description: { description: 'x'.repeat(8001), approvalRequired: true, accessRequired: 'read-only' } }); oversize.invoke(); await oversize.settle(); assert.equal(oversize.events.length, 0); assert.equal(oversize.calls.length, 0);
});
