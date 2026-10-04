import test from 'node:test';
import assert from 'node:assert/strict';
import { beginUiEntrance, createUiMotionController } from '../src/platform/ui-motion.mjs';

class Surface {
  events = new Map(); attributes = new Map(); isConnected = true;
  addEventListener(type, callback) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(callback); }
  removeEventListener(type, callback) { this.events.get(type)?.delete(callback); }
  dispatchEvent(event) { for (const callback of [...(this.events.get(event.type) || [])]) callback(event); }
  fire(type, target = this) { this.dispatchEvent({ type, target }); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  count() { return [...this.events.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); }
}
function fixture({ reduced = false, hidden = false, legacy = false } = {}) {
  const root = new Surface(), doc = new Surface(), win = new Surface(), media = new Surface();
  doc.documentElement = root; doc.visibilityState = hidden ? 'hidden' : 'visible'; win.document = doc; media.matches = reduced;
  if (legacy) {
    media.addListener = callback => Surface.prototype.addEventListener.call(media, 'change', callback);
    media.removeListener = callback => Surface.prototype.removeEventListener.call(media, 'change', callback);
    media.addEventListener = media.removeEventListener = undefined;
  }
  win.matchMedia = query => { assert.equal(query, '(prefers-reduced-motion: reduce)'); return media; };
  const controller = createUiMotionController({ window: win, document: doc });
  return { root, doc, win, media, controller,
    reduced(value) { media.matches = value; media.fire('change'); },
    hidden(value) { doc.visibilityState = value ? 'hidden' : 'visible'; doc.fire('visibilitychange'); },
  };
}

test('motion uses one lifecycle for full, reduced, hidden and restored visibility without timers', () => {
  const f = fixture(), changes = [];
  const unsubscribe = f.controller.subscribe(() => changes.push(f.controller.snapshot()));
  const close = f.controller.mount();
  assert.equal(f.root.getAttribute('data-ui-motion'), 'full');
  f.reduced(true); assert.equal(f.root.getAttribute('data-ui-motion'), 'reduced');
  f.hidden(true); assert.equal(f.root.getAttribute('data-ui-motion'), 'off');
  f.hidden(false); assert.equal(f.root.getAttribute('data-ui-motion'), 'reduced');
  f.reduced(false); assert.equal(f.root.getAttribute('data-ui-motion'), 'full');
  assert.deepEqual(changes, ['reduced', 'off', 'reduced', 'full']);
  f.doc.fire('visibilitychange'); assert.equal(changes.length, 4);
  close(); unsubscribe();
  assert.equal(f.root.getAttribute('data-ui-motion'), null);
  assert.equal(f.doc.count() + f.win.count() + f.media.count(), 0);
});

test('page lifecycle cancels a finite entry and restoration never replays it', () => {
  const f = fixture(), close = f.controller.mount(), node = new Surface();
  const finish = beginUiEntrance(node, f.controller);
  assert.equal(node.getAttribute('data-ui-enter'), 'true');
  f.win.fire('pagehide');
  assert.equal(f.controller.snapshot(), 'off'); assert.equal(node.getAttribute('data-ui-enter'), null);
  f.win.fire('pageshow');
  assert.equal(f.controller.snapshot(), 'full'); assert.equal(node.getAttribute('data-ui-enter'), null);
  assert.equal(node.count(), 0); finish(); close();
});

for (const cause of ['hidden', 'reduced', 'animationend', 'animationcancel', 'unmount']) test(`finite entry removes markers and subscriptions after ${cause}`, () => {
  const f = fixture(), close = f.controller.mount(), node = new Surface();
  const finish = beginUiEntrance(node, f.controller);
  node.fire('animationend', new Surface()); assert.equal(node.getAttribute('data-ui-enter'), 'true', 'a child animation must not consume the root entry');
  if (cause === 'hidden') f.hidden(true);
  else if (cause === 'reduced') f.reduced(true);
  else if (cause === 'unmount') finish();
  else node.fire(cause);
  assert.equal(node.getAttribute('data-ui-enter'), null); assert.equal(node.count(), 0);
  f.hidden(false); f.reduced(false); assert.equal(node.getAttribute('data-ui-enter'), null);
  finish(); finish(); close();
});

test('Strict Mode mount cleanup and multiple mounts do not duplicate media or visibility listeners', () => {
  const f = fixture(); f.root.setAttribute('data-ui-motion', 'previous');
  const first = f.controller.mount(), second = f.controller.mount();
  assert.equal(f.doc.count(), 1); assert.equal(f.win.count(), 2); assert.equal(f.media.count(), 1);
  first(); first(); assert.equal(f.root.getAttribute('data-ui-motion'), 'full');
  second(); assert.equal(f.root.getAttribute('data-ui-motion'), 'previous');
  const restored = f.controller.mount(); assert.equal(f.doc.count(), 1); assert.equal(f.media.count(), 1);
  restored(); assert.equal(f.doc.count() + f.win.count() + f.media.count(), 0);
});

test('a passive overlay suppresses only new UI decoration and restores the active mount', () => {
  const f = fixture(), active = f.controller.mount(), passive = f.controller.mount({ disabled: true });
  assert.equal(f.controller.snapshot(), 'off'); assert.equal(f.controller.allows(), false);
  passive(); assert.equal(f.controller.snapshot(), 'full'); active();
});

test('legacy media listeners and initial hidden/reduced state fail closed for entries', () => {
  for (const options of [{ reduced: true, legacy: true }, { hidden: true, legacy: true }]) {
    const f = fixture(options), node = new Surface(), close = f.controller.mount();
    beginUiEntrance(node, f.controller); assert.equal(node.getAttribute('data-ui-enter'), null); assert.equal(node.count(), 0);
    f.hidden(false); f.reduced(false); assert.equal(node.getAttribute('data-ui-enter'), null);
    close(); assert.equal(f.media.count(), 0);
  }
});

test('unavailable media, non-browser rendering and disconnected nodes cannot start decoration', () => {
  for (const options of [{ window: {}, document: {} }, { window: { matchMedia() { throw new Error('unavailable'); } }, document: {} }]) {
    const controller = createUiMotionController(options), node = new Surface();
    const close = controller.mount(); assert.equal(controller.snapshot(), 'off');
    beginUiEntrance(node, controller); assert.equal(node.count(), 0); close();
  }
  const f = fixture(), node = new Surface(); node.isConnected = false;
  beginUiEntrance(node, f.controller); assert.equal(node.count(), 0);
  assert.doesNotThrow(() => beginUiEntrance(null, f.controller)());
});
