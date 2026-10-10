import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { createVisiblePoll } from '../src/platform/visible-poll.mjs';
import * as preferences from '../src/chat-assistant-preferences.mjs';
import * as directories from '../src/project-directory-preferences.mjs';
import * as reviewUi from '../src/approval-review-ui.mjs';
import * as messageReuse from '../src/conversation-message-reuse.mjs';

const source = ts.transpileModule(await readFile(new URL('../src/ChatAssistant.tsx', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
class Surface extends EventTarget {
  listeners = new Map();
  addEventListener(type, callback, options) { super.addEventListener(type, callback, options); const entries = this.listeners.get(type) || new Set(); entries.add(callback); this.listeners.set(type, entries); }
  removeEventListener(type, callback, options) { super.removeEventListener(type, callback, options); this.listeners.get(type)?.delete(callback); }
  get listenerCount() { return [...this.listeners.values()].reduce((sum, entries) => sum + entries.size, 0); }
}

/** Execute the shipped hook and visible-poll lifecycle; isolate React, HTTP and
 * the clock. The transport deliberately ignores abort to expose stale writes. */
function fixture(context, initial = {}) {
  const hooks = [], effects = [], requests = [], timers = new Map(), window = new Surface(), document = new Surface(), commits = [];
  let cursor = 0, dirty = false, mounted = true, epoch = 1, clock = 0, timerId = 0, lateUpdates = 0, result;
  document.hidden = initial.hidden || false; window.navigator = { onLine: initial.online !== false };
  const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const react = {
    useState(initial) { const index = cursor++; hooks[index] ??= { value: typeof initial === 'function' ? initial() : initial }; return [hooks[index].value, next => { if (!mounted) { lateUpdates++; return; } const value = typeof next === 'function' ? next(hooks[index].value) : next; if (!Object.is(value, hooks[index].value)) { hooks[index].value = value; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; hooks[index] ??= { ref: { current: initial } }; return hooks[index].ref; },
    useEffect(callback, deps) { const index = cursor++, previous = hooks[index]; if (!same(previous?.deps, deps)) effects.push(() => { previous?.cleanup?.(); hooks[index] = { deps, cleanup: callback() }; }); },
    useCallback: callback => callback, memo: component => component,
  };
  const schedule = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, due: clock + delay }); return id; }, unschedule = id => timers.delete(id);
  const local = { getItem: () => null, setItem() {} };
  const modules = {
    react, 'react/jsx-runtime': {}, 'react-dom': {}, 'lucide-react': {},
    './api': { getSessionEpoch: () => epoch, isSessionChanged: error => error?.name === 'SessionChangedError', api(path, options = {}) { assert.equal(path, '/agent/hosts'); assert.equal(options.method, undefined, 'host polling cannot mutate or launch an Agent task'); const pending = deferred(); requests.push({ path, options, epoch, ...pending }); return pending.promise; } },
    './platform/visible-poll.mjs': { createVisiblePoll: options => createVisiblePoll({ ...options, setTimeoutFn: schedule, clearTimeoutFn: unschedule }) },
    './chat-assistant-preferences.mjs': preferences, './project-directory-preferences.mjs': directories, './approval-review-ui.mjs': reviewUi, './conversation-message-reuse.mjs': messageReuse,
    './AgentPermissions': { __esModule: true, default: Symbol('AgentPermissions'), defaultAgentPermissions: { access: 'read-only', approval: 'ask' } },
    './WorkspaceControls': {}, './ProjectDirectory': {}, './platform/ui-motion.ts': {},
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, window, document, localStorage: local, AbortController, setTimeout: schedule, clearTimeout: unschedule, require: name => { if (name.endsWith('.css')) return {}; assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`); return modules[name]; } });
  const props = { scope: 'service:alice', allowed: true, ...initial }; delete props.hidden; delete props.online;
  function render(next = {}) {
    Object.assign(props, next);
    for (let pass = 0; pass < 8; pass++) {
      cursor = 0; dirty = false; effects.length = 0; result = module.exports.useChatAssistant(props); commits.push({ loading: result.loading, hosts: result.hosts });
      for (const effect of effects) effect();
      if (!dirty) return result;
    }
    assert.fail('Host polling hook did not settle');
  }
  async function flush() { for (let tick = 0; tick < 20; tick++) await Promise.resolve(); if (mounted) render(); }
  function close() { if (!mounted) return; mounted = false; for (const hook of hooks) hook?.cleanup?.(); assert.equal(timers.size, 0); assert.equal(window.listenerCount + document.listenerCount, 0); }
  context.after(() => { close(); assert.equal(lateUpdates, 0); });
  render();
  return {
    props, requests, timers, commits, document, window, render, flush, close,
    get result() { return result; }, get lateUpdates() { return lateUpdates; },
    async resolve(index, hosts = [{ id: 'alice-pc', name: 'Alice PC', online: true }]) { requests[index].resolve({ hosts }); await flush(); },
    async advance(milliseconds) {
      const end = clock + milliseconds;
      for (;;) {
        const entry = [...timers].filter(([, timer]) => timer.due <= end).sort((left, right) => left[1].due - right[1].due)[0];
        if (!entry) break;
        timers.delete(entry[0]); clock = entry[1].due; entry[1].callback(); await flush();
      }
      clock = end; await flush();
    },
    hide(value) { document.hidden = value; document.dispatchEvent(new Event('visibilitychange')); render(); },
    online(value) { window.navigator.onLine = value; window.dispatchEvent(new Event(value ? 'online' : 'offline')); render(); },
    changeAccount(scope = 'service:bob') { epoch++; window.dispatchEvent(new Event('petpal:session-change')); render({ scope }); },
  };
}

test('real Chat + Agent hook loads hosts while autonomy is off and retains unchanged list identity without periodic loading flashes', async context => {
  const f = fixture(context); assert.equal(f.result.value.enabled, false); assert.equal(f.requests.length, 1); assert.equal(f.result.loading, true);
  await f.resolve(0); assert.equal(f.result.loading, false); const hosts = f.result.hosts, afterInitial = f.commits.length;
  await f.advance(10000); assert.equal(f.requests.length, 2); assert.equal(f.result.loading, false); assert.strictEqual(f.result.hosts, hosts);
  await f.resolve(1, structuredClone(hosts)); assert.strictEqual(f.result.hosts, hosts, 'identical transport payload must not invalidate the host list');
  assert.ok(f.commits.slice(afterInitial).every(commit => !commit.loading), 'background refresh must keep the current host UI usable');
  await f.advance(10000); assert.equal(f.requests.length, 3);
  await f.resolve(2, [{ ...hosts[0], online: false }]); assert.notStrictEqual(f.result.hosts, hosts); assert.equal(f.result.hosts[0].online, false);
});

test('hidden Chat + Agent host polling stops and visibility restoration refreshes once without overlapping an ignored-abort request', async context => {
  const f = fixture(context); await f.resolve(0); await f.advance(10000); const pending = f.requests[1];
  f.hide(true); assert.equal(pending.options.signal.aborted, true); assert.equal(f.timers.size, 0);
  await f.advance(30000); assert.equal(f.requests.length, 2);
  f.hide(false); f.hide(false); f.online(true); assert.equal(f.requests.length, 2, 'restoration must wait for the old transport promise to settle');
  await f.resolve(1, [{ id: 'stale-pc', online: false }]); assert.equal(f.requests.length, 3); assert.equal(f.result.hosts[0].id, 'alice-pc');
  f.hide(false); f.online(true); assert.equal(f.requests.length, 3);
  await f.resolve(2); assert.equal(f.timers.size, 1); assert.equal(f.result.loading, false);
});

test('offline Chat + Agent page makes no host reads until online and maintains the same single-flight resume boundary', async context => {
  const f = fixture(context, { online: false }); assert.equal(f.requests.length, 0); assert.equal(f.result.loading, false);
  f.online(true); assert.equal(f.requests.length, 1); assert.equal(f.result.loading, true);
  f.online(false); assert.equal(f.requests[0].options.signal.aborted, true); f.online(true); f.online(true); assert.equal(f.requests.length, 1);
  await f.resolve(0, [{ id: 'old-pc' }]); assert.equal(f.requests.length, 2); assert.equal(f.result.hosts.length, 0);
  await f.resolve(1); assert.equal(f.result.hosts[0].id, 'alice-pc'); assert.equal(f.result.loading, false);
});

test('Chat + Agent account replacement ignores the former account host response even if HTTP ignores cancellation', async context => {
  const f = fixture(context); const old = f.requests[0]; f.changeAccount(); assert.equal(old.options.signal.aborted, true); assert.equal(f.requests.length, 2);
  await f.resolve(1, [{ id: 'bob-pc', online: true }]); const bobHosts = f.result.hosts;
  await f.resolve(0, [{ id: 'alice-stale-pc', online: true }]); assert.strictEqual(f.result.hosts, bobHosts); assert.equal(f.result.hosts[0].id, 'bob-pc');
  assert.equal(f.result.loading, false); assert.equal(f.result.error, ''); assert.equal(f.result.value.enabled, false);
});

test('changing Chat + Agent account scope without an epoch update still fences the prior host response', async context => {
  const f = fixture(context); f.render({ scope: 'service:another-account' });
  assert.equal(f.requests[0].options.signal.aborted, true); assert.equal(f.requests.length, 2);
  await f.resolve(1, [{ id: 'new-scope-pc' }]); const current = f.result.hosts;
  await f.resolve(0, [{ id: 'old-scope-pc' }]); assert.strictEqual(f.result.hosts, current); assert.equal(f.result.loading, false);
});

test('unmounted Chat + Agent hook aborts its request, detaches lifecycle listeners and ignores late resolution', async context => {
  const f = fixture(context); f.close(); assert.equal(f.requests[0].options.signal.aborted, true);
  await f.resolve(0, [{ id: 'late-pc' }]); assert.equal(f.lateUpdates, 0); assert.equal(f.requests.length, 1);
});

for (const [name, props] of [['denied account', { allowed: false }], ['empty account scope', { scope: '' }], ['workspace-owned host list', { hostState: { hosts: [{ id: 'workspace-pc' }], loading: false, error: '', refresh() {} } }]]) {
  test(`Chat + Agent ${name} does not start independent host polling`, async context => {
    const f = fixture(context, props); await f.advance(30000); f.hide(true); f.hide(false); f.online(false); f.online(true);
    assert.equal(f.requests.length, 0); assert.equal(f.timers.size, 0);
    if (props.hostState) assert.strictEqual(f.result.hosts, props.hostState.hosts);
  });
}

test('providing workspace-owned hosts during a pending request cancels local polling and cannot overwrite shared host state', async context => {
  const f = fixture(context), hostState = { hosts: [{ id: 'workspace-pc' }], loading: false, error: '', refresh() {} };
  f.render({ hostState }); assert.equal(f.requests[0].options.signal.aborted, true);
  await f.resolve(0, [{ id: 'late-local-pc' }]); await f.advance(30000);
  assert.equal(f.requests.length, 1); assert.strictEqual(f.result.hosts, hostState.hosts); assert.equal(f.result.loading, false);
});

test('revoking Agent permission cancels local polling and ignores late host response', async context => {
  const f = fixture(context); f.render({ allowed: false }); assert.equal(f.requests[0].options.signal.aborted, true);
  await f.resolve(0, [{ id: 'late-pc' }]); await f.advance(30000);
  assert.equal(f.requests.length, 1); assert.equal(f.result.hosts.length, 0); assert.equal(f.result.loading, false); assert.equal(f.timers.size, 0);
});
