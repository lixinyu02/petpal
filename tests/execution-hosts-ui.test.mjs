import test from 'node:test';
import assert from 'node:assert/strict';
import { readExecutionHost, saveExecutionHost, executionPlatform, resolveExecutionHostId, executionHostLock } from '../src/execution-hosts.mjs';

test('execution host preference is isolated by account and central service without mutating credentials', () => {
  const disk = new Map([['petpal.connection', 'private-connection-unchanged']]);
  const storage = { getItem: key => disk.get(key) ?? null, setItem: (key, value) => disk.set(key, value) };
  saveExecutionHost(storage, 'instance-a:user-a', 'pc-a');
  saveExecutionHost(storage, 'instance-b:user-a', 'pc-b');
  assert.equal(readExecutionHost(storage, 'instance-a:user-a'), 'pc-a');
  assert.equal(readExecutionHost(storage, 'instance-b:user-a'), 'pc-b');
  assert.equal(readExecutionHost(storage, 'instance-a:user-b'), '');
  assert.equal(disk.get('petpal.connection'), 'private-connection-unchanged');
});

test('an explicit missing or offline host never falls back to another computer', () => {
  assert.equal(resolveExecutionHostId({ requestedId: 'offline-pc', localHostId: 'online-pc', defaultHostId: 'central' }), 'offline-pc');
  assert.equal(resolveExecutionHostId({ requestedId: 'removed-pc', defaultHostId: 'central' }), 'removed-pc');
  assert.equal(resolveExecutionHostId({ localHostId: 'this-pc', defaultHostId: 'central' }), 'this-pc');
  assert.equal(resolveExecutionHostId({ defaultHostId: 'central' }), 'central');
});

test('running, stopping, unknown, queued and unconfirmed tasks retain their frozen execution host', () => {
  for (const status of ['running', 'stopping', 'unknown']) {
    const lockedId = executionHostLock({ run: { status, hostId: 'running-pc' }, queue: [{ hostId: 'queued-pc' }] });
    assert.equal(resolveExecutionHostId({ lockedId, requestedId: 'new-pc' }), 'running-pc');
  }
  assert.equal(executionHostLock({ run: { status: 'completed', hostId: 'old-pc' }, queue: [{ hostId: 'queued-pc' }] }), 'queued-pc');
  assert.equal(executionHostLock({ run: { status: 'completed', hostId: 'old-pc' }, queue: [] }), '');
  assert.equal(executionHostLock({ run: { status: 'running', hostId: 'current-pc' } }, { payload: { hostId: 'original-pc' } }), 'original-pc');
  assert.equal(executionHostLock({ run: { status: 'running' } }), 'central', 'legacy tasks must stay on their original central executor');
  assert.equal(executionHostLock({ queue: [{}] }), 'central');
});

test('unavailable storage and invalid preferences do not prevent choosing a host for this page', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(readExecutionHost(broken, 'instance:user'), '');
  assert.doesNotThrow(() => saveExecutionHost(broken, 'instance:user', 'pc'));
  assert.equal(readExecutionHost({ getItem: () => 'x'.repeat(161) }, 'scope'), '');
  assert.equal(resolveExecutionHostId({ requestedId: 'x'.repeat(161), defaultHostId: 'central' }), 'central');
  assert.equal(executionPlatform('win32'), 'Windows');
  assert.equal(executionPlatform('linux'), 'Ubuntu / Linux');
});
