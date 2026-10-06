import test from 'node:test';
import assert from 'node:assert/strict';
import { automationInstant, nextAutomationRun, normalizeAutomationSchedule, normalizeAutomationSpec, validateStoredAutomations } from '../server/automation-schema.mjs';

test('schedule normalization rejects extra identity fields, bad calendars, clocks and intervals', () => {
  for (const value of [null, {}, { kind: 'interval', minutes: 4 }, { kind: 'interval', minutes: 10081 }, { kind: 'interval', minutes: 5.1 }, { kind: 'daily', time: '9:05', timezone: 'UTC' }, { kind: 'daily', time: '24:00', timezone: 'UTC' }, { kind: 'daily', time: '09:00', timezone: 'Missing/Zone' }, { kind: 'daily', time: '09:00', timezone: '+08:00' }, { kind: 'weekly', time: '09:00', timezone: 'UTC', weekdays: [1, 1] }, { kind: 'weekly', time: '09:00', timezone: 'UTC', weekdays: [] }, { kind: 'weekly', time: '09:00', timezone: 'UTC', weekdays: [7] }, { kind: 'once', at: '2026-02-30T10:00:00Z' }, { kind: 'once', at: '2026-10-05T10:00:00' }, { kind: 'once', at: '2026-10-05T10:00:00Z', userId: 'spoof' }]) assert.throws(() => normalizeAutomationSchedule(value), { status: 400 });
  assert.deepEqual(normalizeAutomationSchedule({ kind: 'weekly', time: '09:05', timezone: 'Asia/Shanghai', weekdays: [5, 1, 3] }), { kind: 'weekly', time: '09:05', timezone: 'Asia/Shanghai', weekdays: [1, 3, 5] });
  assert.deepEqual(normalizeAutomationSchedule({ kind: 'once', at: '2026-10-05T09:00:00+08:00' }), { kind: 'once', at: '2026-10-05T01:00:00.000Z' });
});

test('instant parser handles offset and millisecond precision without accepting normalization', () => {
  assert.equal(automationInstant('2026-10-05T01:00:00.1Z'), Date.parse('2026-10-05T01:00:00.100Z'));
  assert.equal(automationInstant('2024-02-29T09:00:00+08:00'), Date.parse('2024-02-29T01:00:00Z'));
  for (const value of ['2023-02-29T00:00:00Z', '2026-13-01T00:00:00Z', '2026-01-00T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T00:00:60Z', '2026-01-01T00:00:00+24:00']) assert.throws(() => automationInstant(value));
});

test('once, interval and weekday schedules calculate strict next instants', () => {
  const once = { kind: 'once', at: '2026-10-05T09:00:00+08:00' };
  assert.equal(nextAutomationRun(once, '2026-10-05T00:59:59Z'), '2026-10-05T01:00:00.000Z');
  assert.equal(nextAutomationRun(once, '2026-10-05T01:00:00Z'), null);
  assert.equal(nextAutomationRun({ kind: 'interval', minutes: 5 }, '2026-10-05T01:12:00Z', '2026-10-05T01:00:00Z'), '2026-10-05T01:15:00.000Z');
  assert.equal(nextAutomationRun({ kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' }, '2026-10-05T01:00:00Z'), '2026-10-06T01:00:00.000Z');
  assert.equal(nextAutomationRun({ kind: 'weekly', time: '09:00', timezone: 'Asia/Shanghai', weekdays: [1, 2, 3, 4, 5] }, '2026-10-09T01:00:00Z'), '2026-10-12T01:00:00.000Z');
});

test('DST missing local times are skipped and repeated local minutes execute only once', () => {
  const spring = { kind: 'daily', time: '02:30', timezone: 'America/New_York' };
  assert.equal(nextAutomationRun(spring, '2026-03-07T08:00:00Z'), '2026-03-09T06:30:00.000Z');
  const autumn = { kind: 'daily', time: '01:30', timezone: 'America/New_York' };
  assert.equal(nextAutomationRun(autumn, '2026-11-01T04:00:00Z'), '2026-11-01T05:30:00.000Z');
  assert.equal(nextAutomationRun(autumn, '2026-11-01T05:30:00Z'), '2026-11-02T06:30:00.000Z');
  assert.equal(nextAutomationRun(autumn, '2026-11-01T06:00:00Z'), '2026-11-02T06:30:00.000Z');
});

test('DST resolution covers half-hour transitions and a skipped civil date', () => {
  assert.equal(nextAutomationRun({ kind: 'daily', time: '02:15', timezone: 'Australia/Lord_Howe' }, '2026-10-03T00:00:00Z'), '2026-10-04T15:15:00.000Z');
  assert.equal(nextAutomationRun({ kind: 'daily', time: '12:00', timezone: 'Pacific/Apia' }, '2011-12-29T23:00:00Z'), '2011-12-30T22:00:00.000Z');
});

test('execution scope requires a model, valid absolute project and strict permissions', () => {
  const base = { prompt: '  work  ', hostId: 'central', providerId: 'model-id', projectDirectory: '/workspace', permissions: { access: 'read-only', approval: 'ask' } };
  assert.equal(normalizeAutomationSpec(base).prompt, 'work');
  assert.equal(normalizeAutomationSpec({ ...base, providerId: null }).providerId, null);
  const review = { access: 'read-only', approval: 'review', reviewProviderId: 'independent-review' };
  assert.deepEqual(normalizeAutomationSpec({ ...base, permissions: review }).permissions, review);
  for (const patch of [{ providerId: '' }, { hostId: 'fallback' }, { projectDirectory: 'relative' }, { projectDirectory: null }, { permissions: { access: 'root' } }, { userId: 'spoof' }]) assert.throws(() => normalizeAutomationSpec({ ...base, ...patch }));
});

test('missing automation data migrates once while invalid stored versions fail closed', () => {
  const state = { users: [] };
  assert.equal(validateStoredAutomations(state), true);
  assert.deepEqual(state.automations, { version: 1, accounts: [], jobs: [], requests: [] });
  assert.equal(validateStoredAutomations(state), false);
  for (const invalid of [{ version: 2, accounts: [], jobs: [], requests: [] }, { version: 1, accounts: [], jobs: [], requests: [], passed: true }, { version: 1, accounts: [{ userId: 'foreign', allowAgentCreate: true }], jobs: [], requests: [] }]) assert.throws(() => validateStoredAutomations({ users: [], automations: invalid }), /本地自动化/);
});

test('execution scope canonicalizes supported Windows and POSIX paths without widening path contracts', () => {
  const base = { prompt: 'work', hostId: 'central', providerId: null, permissions: { access: 'read-only', approval: 'ask' } };
  for (const [input, expected] of [['e:/Parent/../Repo//src', 'e:\\Repo\\src'], ['E:\\Repo\\.\\src\\..', 'E:\\Repo'], ['/work/../repo//src', '/repo/src']]) {
    assert.equal(normalizeAutomationSpec({ ...base, projectDirectory: input }).projectDirectory, expected);
  }
  for (const projectDirectory of ['\\\\server\\share', 'E:relative', '../repo']) assert.throws(() => normalizeAutomationSpec({ ...base, projectDirectory }));
});
