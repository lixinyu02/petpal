import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisiblePoll } from '../src/platform/visible-poll.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));
function surface(properties = {}) {
  const listeners = new Map();
  return { ...properties,
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    emit(type) { for (const callback of [...(listeners.get(type) ?? [])]) callback(); },
    listenerCount() { return [...listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); },
  };
}
function clock() {
  let now = 0, sequence = 0;
  const timers = new Map();
  return {
    setTimeoutFn(callback, delay) { const id = sequence++; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeoutFn(id) { timers.delete(id); },
    size() { return timers.size; },
    advance(milliseconds) {
      const end = now + milliseconds;
      for (;;) {
        const next = [...timers].filter(([, value]) => value.at <= end).sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
        if (!next) break;
        const [id, value] = next; now = value.at; timers.delete(id); value.callback();
      }
      now = end;
    },
  };
}
function harness({ hidden = false, online = true, run, initiallyCurrent = true } = {}) {
  const document = surface({ hidden }), window = surface({ navigator: { onLine: online } }), timers = clock();
  let current = initiallyCurrent, active = 0, maximumActive = 0;
  const calls = [];
  const cleanup = createVisiblePoll({ document, window, intervalMs: 100,
    run: run ?? (signal => {
      const pending = deferred(); calls.push({ signal, ...pending }); active++; maximumActive = Math.max(maximumActive, active);
      return pending.promise.then(value => { active--; return value; }, error => { active--; throw error; });
    }),
    isCurrent: () => current, ...timers,
  });
  return { document, window, timers, calls, cleanup,
    get maximumActive() { return maximumActive; },
    set current(value) { current = value; },
    hidden(value) { document.hidden = value; document.emit('visibilitychange'); },
    online(value) { window.navigator.onLine = value; window.emit(value ? 'online' : 'offline'); },
    async finish(index, error) { if (error) calls[index].reject(error); else calls[index].resolve(); await flush(); },
  };
}

test('visible online startup is immediate and waits a full interval after each owned run', async () => {
  const h = harness();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].signal.aborted, false); assert.equal(h.timers.size(), 0);
  await h.finish(0); assert.equal(h.timers.size(), 1);
  h.timers.advance(99); assert.equal(h.calls.length, 1);
  h.timers.advance(1); assert.equal(h.calls.length, 2); assert.equal(h.timers.size(), 0);
  h.timers.advance(10000); assert.equal(h.calls.length, 2); assert.equal(h.maximumActive, 1);
  h.cleanup(); await h.finish(1);
});

test('initial hidden or offline surfaces wait until both conditions allow polling', async () => {
  for (const options of [{ hidden: true }, { online: false }, { hidden: true, online: false }]) {
    const h = harness(options); assert.equal(h.calls.length, 0); assert.equal(h.timers.size(), 0);
    h.timers.advance(10000); assert.equal(h.calls.length, 0);
    if (options.hidden) h.hidden(false);
    assert.equal(h.calls.length, options.online === false ? 0 : 1);
    if (options.online === false) h.online(true);
    assert.equal(h.calls.length, 1); h.cleanup(); await h.finish(0);
  }
});

test('hiding aborts the active signal without freeing an ignored-abort run slot', async () => {
  const h = harness(); let aborts = 0; h.calls[0].signal.addEventListener('abort', () => aborts++);
  h.hidden(true); h.hidden(true);
  assert.equal(h.calls[0].signal.aborted, true); assert.equal(aborts, 1); assert.equal(h.timers.size(), 0);
  h.timers.advance(10000); assert.equal(h.calls.length, 1);
  await h.finish(0); assert.equal(h.timers.size(), 0); assert.equal(h.calls.length, 1);
  h.hidden(false); assert.equal(h.calls.length, 2); assert.equal(h.calls[1].signal.aborted, false);
  assert.equal(h.maximumActive, 1); h.cleanup(); await h.finish(1);
});

test('visible recovery waits for a late old run and its finally cannot schedule a second timer', async () => {
  const h = harness();
  h.hidden(true); h.hidden(false); h.hidden(false); h.online(true);
  assert.equal(h.calls.length, 1); assert.equal(h.timers.size(), 0);
  h.timers.advance(10000); assert.equal(h.calls.length, 1);
  await h.finish(0);
  assert.equal(h.calls.length, 2); assert.equal(h.timers.size(), 0); assert.equal(h.maximumActive, 1);
  await h.finish(1); assert.equal(h.timers.size(), 1);
  h.timers.advance(100); assert.equal(h.calls.length, 3); assert.equal(h.timers.size(), 0);
  h.cleanup(); await h.finish(2);
});

test('rapid hide/show transitions coalesce and a final hidden state does not resume', async () => {
  const h = harness();
  h.hidden(true); h.hidden(false); h.hidden(true); h.hidden(false); h.hidden(true);
  await h.finish(0); assert.equal(h.calls.length, 1); assert.equal(h.timers.size(), 0);
  h.hidden(false); h.hidden(false); assert.equal(h.calls.length, 2); assert.equal(h.maximumActive, 1);
  h.cleanup(); await h.finish(1);
});

test('offline/online events abort and coalesce without overlapping the old run', async () => {
  const h = harness();
  h.online(false); h.online(false); assert.equal(h.calls[0].signal.aborted, true);
  h.online(true); h.online(true); assert.equal(h.calls.length, 1);
  await h.finish(0); assert.equal(h.calls.length, 2); assert.equal(h.maximumActive, 1);
  await h.finish(1); assert.equal(h.timers.size(), 1);
  h.online(true); h.document.emit('visibilitychange'); assert.equal(h.calls.length, 2); assert.equal(h.timers.size(), 1);
  h.timers.advance(100); assert.equal(h.calls.length, 3);
  h.cleanup(); await h.finish(2);
});

test('hiding or going offline removes a scheduled timer, including timer token zero', async () => {
  for (const cause of ['hidden', 'offline']) {
    const h = harness(); await h.finish(0); assert.equal(h.timers.size(), 1);
    if (cause === 'hidden') h.hidden(true); else h.online(false);
    assert.equal(h.timers.size(), 0); h.timers.advance(10000); assert.equal(h.calls.length, 1);
    if (cause === 'hidden') h.hidden(false); else h.online(true);
    assert.equal(h.calls.length, 2); h.cleanup(); await h.finish(1);
  }
});

test('duplicate eligible events do not queue an immediate extra run after healthy work', async () => {
  const h = harness(); h.hidden(false); h.online(true); h.online(true);
  await h.finish(0); assert.equal(h.calls.length, 1); assert.equal(h.timers.size(), 1);
  h.timers.advance(100); assert.equal(h.calls.length, 2);
  h.cleanup(); await h.finish(1);
});

test('synchronous failures and rejected promises are consumed and retry on the normal interval', async () => {
  let calls = 0;
  const pending = deferred();
  const h = harness({ run: () => { calls++; if (calls === 1) throw new Error('sync failure'); if (calls === 2) return Promise.reject(new Error('async failure')); return pending.promise; } });
  await flush(); assert.equal(calls, 1); assert.equal(h.timers.size(), 1);
  h.timers.advance(100); await flush(); assert.equal(calls, 2); assert.equal(h.timers.size(), 1);
  h.timers.advance(100); assert.equal(calls, 3); assert.equal(h.timers.size(), 0);
  h.cleanup(); pending.resolve(); await flush(); assert.equal(h.timers.size(), 0);
});

test('cleanup releases every listener and timer, aborts work, and ignores late resolve or reject', async () => {
  for (const reject of [false, true]) {
    const h = harness(); assert.equal(h.document.listenerCount(), 1); assert.equal(h.window.listenerCount(), 2);
    h.cleanup(); h.cleanup();
    assert.equal(h.calls[0].signal.aborted, true); assert.equal(h.document.listenerCount(), 0); assert.equal(h.window.listenerCount(), 0);
    h.hidden(false); h.online(true); await h.finish(0, reject ? new Error('late reject') : undefined);
    h.timers.advance(10000); assert.equal(h.calls.length, 1); assert.equal(h.timers.size(), 0);
  }
  const h = harness(); await h.finish(0); assert.equal(h.timers.size(), 1);
  h.cleanup(); assert.equal(h.timers.size(), 0); h.timers.advance(10000); assert.equal(h.calls.length, 1);
});

test('current generation gates startup, late settlement, and a scheduled retry', async () => {
  const h = harness({ initiallyCurrent: false }); assert.equal(h.calls.length, 0);
  h.current = true; h.document.emit('visibilitychange'); assert.equal(h.calls.length, 1);
  h.current = false; await h.finish(0); assert.equal(h.calls.length, 1); assert.equal(h.timers.size(), 0); h.cleanup();
  const queued = harness(); await queued.finish(0); queued.current = false;
  queued.timers.advance(100); assert.equal(queued.calls.length, 1); assert.equal(queued.timers.size(), 0); queued.cleanup();
});

test('ownership is assigned before a run synchronously raises a lifecycle event', async () => {
  const document = surface({ hidden: false }), window = surface({ navigator: { onLine: true } }), timers = clock();
  let signal, calls = 0;
  const cleanup = createVisiblePoll({ document, window, intervalMs: 100, ...timers, run: value => {
    signal = value; calls++; document.hidden = true; document.emit('visibilitychange'); return Promise.resolve();
  } });
  assert.equal(signal.aborted, true); await flush(); assert.equal(calls, 1); assert.equal(timers.size(), 0); cleanup();
});

test('invalid intervals fail before listeners are installed', () => {
  for (const intervalMs of [0, -1, NaN, Infinity]) {
    const document = surface({ hidden: false }), window = surface({ navigator: { onLine: true } });
    assert.throws(() => createVisiblePoll({ document, window, intervalMs, run: async () => {} }), /interval/);
    assert.equal(document.listenerCount(), 0); assert.equal(window.listenerCount(), 0);
  }
});
