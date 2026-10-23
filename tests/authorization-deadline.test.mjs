import test from 'node:test';
import assert from 'node:assert/strict';
import { watchAuthorizationDeadline, AUTHORIZATION_CHECK_INTERVAL } from '../server/authorization-deadline.mjs';

function scheduler() {
  let now = 0, next = 0; const pending = new Map(), delays = [];
  const schedule = (callback, delay) => { assert.ok(delay <= 0x7fffffff); assert.ok(delay > 0); delays.push(delay); const id = ++next; pending.set(id, { callback, at: now + delay }); return id; };
  const advance = until => { while (true) { const due = [...pending].sort((a, b) => a[1].at - b[1].at)[0]; if (!due || due[1].at > until) break; now = due[1].at; pending.delete(due[0]); due[1].callback(); } now = until; };
  return { clock: () => now, schedule, cancel: id => pending.delete(id), advance, pending, delays };
}

test('90-day authorization uses bounded timers and expires without an HTTP request', () => {
  const s = scheduler(); let expires = 0, reads = 0; const deadline = 90 * AUTHORIZATION_CHECK_INTERVAL;
  watchAuthorizationDeadline({ ...s, expiresAt: deadline, authorize: () => { reads++; return deadline; }, onExpire: () => { expires++; } });
  s.advance(deadline - 1); assert.equal(expires, 0); s.advance(deadline); assert.equal(expires, 1); assert.equal(reads, 90); assert.equal(s.pending.size, 0);
  assert.ok(s.delays.every(delay => delay <= AUTHORIZATION_CHECK_INTERVAL));
});

test('a renewed deadline is read at the old expiry instead of revoking the current session', () => {
  const s = scheduler(); let deadline = 100, expires = 0;
  watchAuthorizationDeadline({ ...s, expiresAt: deadline, authorize: () => deadline, onExpire: () => { expires++; } });
  deadline = AUTHORIZATION_CHECK_INTERVAL * 90; s.advance(100); assert.equal(expires, 0);
  s.advance(deadline - 1); assert.equal(expires, 0); s.advance(deadline); assert.equal(expires, 1);
});

test('revocation on a bounded recheck expires once and cancellation clears future callbacks', () => {
  const s = scheduler(); let expires = 0;
  const stop = watchAuthorizationDeadline({ ...s, expiresAt: AUTHORIZATION_CHECK_INTERVAL * 90, authorize: () => { throw new Error('revoked'); }, onExpire: () => { expires++; } });
  s.advance(AUTHORIZATION_CHECK_INTERVAL); assert.equal(expires, 1); stop(); s.advance(AUTHORIZATION_CHECK_INTERVAL * 100); assert.equal(expires, 1); assert.equal(s.pending.size, 0);
  const other = watchAuthorizationDeadline({ ...s, expiresAt: s.clock() + 50, authorize: () => { throw new Error('must not run'); }, onExpire: () => { expires++; } });
  other(); s.advance(s.clock() + 100); assert.equal(expires, 1);
});

test('bootstrap authorization needs no deadline timer', () => {
  const s = scheduler(), stop = watchAuthorizationDeadline({ ...s, expiresAt: undefined, authorize: () => undefined, onExpire: () => assert.fail('bootstrap cannot expire') });
  assert.equal(s.pending.size, 0); stop();
});
