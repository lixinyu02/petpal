import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { waitForCubismDependency } from '../src/avatar/cubism/runtime.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));
let sequence = 0;

async function fixture() {
  const runtime = await import(`../src/avatar/cubism/runtime.mjs?lifecycle-test=${++sequence}`);
  const scripts = [], contexts = [];
  const window = { location: { href: 'https://petpal.test/', origin: 'https://petpal.test' } };
  const document = {
    defaultView: window,
    createElement(type) {
      assert.equal(type, 'script');
      return { dataset: {}, removed: false, remove() { this.removed = true; } };
    },
    head: { appendChild(script) { scripts.push(script); } },
  };
  const canvas = () => {
    const context = { released: 0, allocated: 0 };
    contexts.push(context);
    return {
      ownerDocument: document,
      getContext(name) {
        assert.equal(name, 'webgl2'); context.allocated++;
        return { getExtension(name) {
          assert.equal(name, 'WEBGL_lose_context');
          return { loseContext() { context.released++; } };
        } };
      },
    };
  };
  return { runtime, window, scripts, contexts, canvas };
}

test('an aborted canvas immediately releases its WebGL context while another Core load stays active', async () => {
  const value = await fixture(), stopped = new AbortController(), survivor = new AbortController();
  const cancelled = value.runtime.createCubismAvatar({ canvas: value.canvas(), signal: stopped.signal });
  const active = value.runtime.createCubismAvatar({ canvas: value.canvas(), signal: survivor.signal });
  const activeFailure = assert.rejects(active, /Cubism Core is unavailable/u);
  assert.equal(value.scripts.length, 1, 'both canvases share the Core download');
  const reason = new Error('canvas unmounted');
  stopped.abort(reason);
  await assert.rejects(cancelled, error => error === reason);
  assert.equal(value.contexts[0].released, 1, 'cancelled load releases before the network completes');
  assert.equal(value.contexts[1].released, 0, 'the live canvas retains its context');
  assert.equal(value.scripts[0].removed, false, 'cancellation must not remove the shared script');
  assert.equal(typeof value.scripts[0].onerror, 'function');
  value.scripts[0].onerror();
  await activeFailure;
  assert.equal(value.contexts[0].released, 1, 'late failure never releases the discarded context twice');
  assert.equal(value.contexts[1].released, 1);
});

test('an already aborted load does not allocate a canvas context or initiate shared downloads', async () => {
  const value = await fixture(), stopped = new AbortController();
  stopped.abort();
  await assert.rejects(value.runtime.createCubismAvatar({ canvas: value.canvas(), signal: stopped.signal }), { name: 'AbortError' });
  assert.equal(value.contexts[0].allocated, 0);
  assert.equal(value.contexts[0].released, 0);
  assert.equal(value.scripts.length, 0);
});

test('late Core readiness stays available after its original canvas has been cancelled', async () => {
  const value = await fixture(), stopped = new AbortController();
  const cancelled = value.runtime.createCubismAvatar({ canvas: value.canvas(), signal: stopped.signal });
  stopped.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  const core = { Version: { csmGetVersion: () => 0x06000001, csmGetLatestMocVersion: () => 6 }, Moc: {}, Model: {}, Memory: {} };
  value.window.Live2DCubismCore = core;
  value.scripts[0].onload();
  await flush();
  assert.equal(value.contexts[0].released, 1);
  assert.equal(value.scripts[0].removed, false);
  assert.equal(await value.runtime.loadCubismCore({ document: {}, window: value.window }), core);
});

test('one cancelled dependency wait does not reject a surviving canvas on the same Framework promise', async () => {
  const dependency = deferred(), stopped = new AbortController(), survivor = new AbortController();
  const first = waitForCubismDependency(dependency.promise, stopped.signal);
  const second = waitForCubismDependency(dependency.promise, survivor.signal);
  stopped.abort();
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(getEventListeners(stopped.signal, 'abort').length, 0);
  assert.equal(getEventListeners(survivor.signal, 'abort').length, 1);
  const framework = { marker: 'shared framework' };
  dependency.resolve(framework);
  assert.equal(await second, framework);
  assert.equal(getEventListeners(survivor.signal, 'abort').length, 0);
});

test('a cancelled dependency wait handles a later shared rejection and removes its listener', async () => {
  const dependency = deferred(), stopped = new AbortController();
  const pending = waitForCubismDependency(dependency.promise, stopped.signal);
  stopped.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(getEventListeners(stopped.signal, 'abort').length, 0);
  dependency.reject(new Error('late shared network failure'));
  await flush();
});

test('pre-cancelled dependency waits still observe late rejection, and successful waits detach before later aborts', async () => {
  const dependency = deferred(), stopped = new AbortController();
  stopped.abort();
  await assert.rejects(waitForCubismDependency(dependency.promise, stopped.signal), { name: 'AbortError' });
  dependency.reject(new Error('late dependency failure'));
  await flush();
  const active = new AbortController(), value = {};
  assert.equal(await waitForCubismDependency(Promise.resolve(value), active.signal), value);
  assert.equal(getEventListeners(active.signal, 'abort').length, 0);
  active.abort();
  assert.equal(await waitForCubismDependency(value), value);
});
