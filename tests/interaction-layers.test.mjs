import test from 'node:test';
import assert from 'node:assert/strict';
import { mountInteractionLayers } from '../src/platform/interaction-layers.mjs';

class KeyboardEvent extends Event {
  constructor(type, options = {}) { super(type, options); Object.assign(this, { key: options.key || '', shiftKey: !!options.shiftKey, isComposing: !!options.isComposing, keyCode: options.keyCode || 0 }); }
}
class CustomEvent extends Event {
  constructor(type, options = {}) { super(type, options); this.detail = options.detail; }
}

/** Small DOM adapter: selectors, bubbling, inert focus and asynchronous mutation delivery.
 * The production controller is imported above; no layer/focus/back decisions are copied here.
 */
function fixture() {
  const observers = new Set(), observations = [], disconnects = [];
  let pendingDelivery = false;
  const mutate = record => {
    for (const observer of observers) {
      if (!observer.root?.contains(record.target)) continue;
      if (record.type === 'attributes' && (!observer.options.attributes || observer.options.attributeFilter && !observer.options.attributeFilter.includes(record.attributeName))) continue;
      if (record.type === 'childList' && !observer.options.childList) continue;
      observer.records.push(record);
    }
    if (pendingDelivery) return;
    pendingDelivery = true;
    queueMicrotask(() => {
      pendingDelivery = false;
      for (const observer of [...observers]) {
        const records = observer.records.splice(0);
        if (records.length) observer.callback(records, observer);
      }
    });
  };
  class Node extends EventTarget {
    constructor(tagName, attrs = {}) { super(); this.tagName = tagName.toUpperCase(); this.parentNode = null; this.children = []; this.attributes = new Map(); this.style = {}; this.focusCalls = []; this.clicks = 0; for (const [name, value] of Object.entries(attrs)) this.attributes.set(name, String(value)); }
    get parentElement() { return this.parentNode instanceof Node ? this.parentNode : null; }
    get isConnected() { return this === doc.documentElement || !!this.parentNode?.isConnected; }
    get dataset() { return Object.fromEntries([...this.attributes].filter(([name]) => name.startsWith('data-')).map(([name, value]) => [name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()), value])); }
    get inert() { return this.hasAttribute('inert'); } set inert(value) { if (value) this.setAttribute('inert', ''); else this.removeAttribute('inert'); }
    get hidden() { return this.hasAttribute('hidden'); } set hidden(value) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
    get disabled() { return this.hasAttribute('disabled'); } set disabled(value) { if (value) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
    get open() { return this.hasAttribute('open'); } set open(value) { if (value) this.setAttribute('open', ''); else this.removeAttribute('open'); }
    hasAttribute(name) { return this.attributes.has(name); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { const next = String(value); if (this.attributes.get(name) === next) return; this.attributes.set(name, next); mutate({ type: 'attributes', target: this, attributeName: name }); }
    removeAttribute(name) { if (!this.attributes.delete(name)) return; mutate({ type: 'attributes', target: this, attributeName: name }); }
    append(...children) { for (const child of children) { child.remove(); child.parentNode = this; this.children.push(child); mutate({ type: 'childList', target: this }); } }
    remove() { if (!this.parentNode) return; const parent = this.parentNode; parent.children = parent.children.filter(child => child !== this); this.parentNode = null; if (this.contains(doc.activeElement)) doc.activeElement = doc.body; mutate({ type: 'childList', target: parent }); }
    contains(target) { return target === this || this.children.some(child => child.contains(target)); }
    matches(selector) {
      return selector.split(',').some(part => {
        const simple = part.trim();
        if (simple.includes('>')) { const [parent, child] = simple.split('>'); return this.matches(child) && !!this.parentElement?.matches(parent); }
        const negatives = [...simple.matchAll(/:not\(([^()]*)\)/g)].map(match => match[1]);
        if (negatives.some(value => this.matches(value))) return false;
        const positive = simple.replace(/:not\([^()]*\)/g, '');
        if (positive.includes(':disabled') && !this.disabled) return false;
        const tag = positive.match(/^[a-z][\w-]*/i)?.[0];
        if (tag && this.tagName !== tag.toUpperCase()) return false;
        const classes = (this.getAttribute('class') || '').split(/\s+/);
        if ([...positive.matchAll(/\.([\w-]+)/g)].some(match => !classes.includes(match[1]))) return false;
        if ([...positive.matchAll(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g)].some(match => !this.hasAttribute(match[1]) || match[2] !== undefined && this.getAttribute(match[1]) !== match[2])) return false;
        return true;
      });
    }
    querySelectorAll(selector) { const found = []; const walk = node => { for (const child of node.children) { if (child.matches(selector)) found.push(child); walk(child); } }; walk(this); return found; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
    getBoundingClientRect() { for (let node = this; node; node = node.parentElement) if (node.hidden || node.style.display === 'none') return { width: 0, height: 0 }; return { width: 200, height: 40 }; }
    getClientRects() { return this.getBoundingClientRect().width ? [this.getBoundingClientRect()] : []; }
    focus(options) {
      if (!this.isConnected || this.disabled || !this.getBoundingClientRect().width) return;
      for (let node = this; node; node = node.parentElement) if (node.inert || node.style.visibility === 'hidden') return;
      const previous = doc.activeElement, event = new Event('focusin', { bubbles: true });
      Object.defineProperty(event, 'relatedTarget', { value: previous });
      this.focusCalls.push(options); doc.activeElement = this; this.dispatchEvent(event);
    }
    click() { if (this.disabled || this.closest('[inert]')) return; this.clicks++; this.dispatchEvent(new Event('click', { bubbles: true, cancelable: true })); }
    dispatchEvent(event) { const accepted = super.dispatchEvent(event); if (event.bubbles && !event.cancelBubble) this.parentNode?.dispatchEvent(event); return accepted && !event.defaultPrevented; }
  }
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.records = []; }
    observe(root, options) { this.root = root; this.options = options; observers.add(this); observations.push({ root, options }); }
    disconnect() { observers.delete(this); this.records.length = 0; disconnects.push(this); }
  }
  const doc = new EventTarget(); doc.hidden = false; doc.isConnected = true;
  doc.documentElement = new Node('html'); doc.documentElement.parentNode = doc;
  doc.body = new Node('body'); doc.documentElement.children.push(doc.body); doc.body.parentNode = doc.documentElement; doc.activeElement = doc.body;
  doc.querySelectorAll = selector => doc.documentElement.querySelectorAll(selector);
  doc.querySelector = selector => doc.querySelectorAll(selector)[0] || null;
  const win = new EventTarget(); Object.assign(win, { document: doc, KeyboardEvent, CustomEvent, MutationObserver,
    getComputedStyle: node => ({ display: node.style.display || 'block', visibility: node.style.visibility || 'visible' }),
  });
  let cleanup;
  const flush = async () => { for (let tick = 0; tick < 5; tick++) await Promise.resolve(); };
  const create = (tag, attrs = {}, parent = doc.body) => { const node = new Node(tag, attrs); parent?.append(node); return node; };
  return {
    doc, win, create, flush, observations, disconnects,
    get observerCount() { return observers.size; },
    mount() { cleanup = mountInteractionLayers({ window: win, document: doc }); },
    close() { cleanup?.(); cleanup = null; },
    key(key, options = {}) { const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }); doc.activeElement.dispatchEvent(event); return event; },
    back() { const event = new CustomEvent('petpal:native-back', { cancelable: true }); win.dispatchEvent(event); return event; },
    dialog(parent = doc.body) {
      const layer = create('section', { 'data-ui-layer': 'dialog' }, parent);
      const first = create('button', { 'data-ui-dismiss': 'dialog' }, layer), middle = create('input', {}, layer), last = create('button', {}, layer);
      first.addEventListener('click', () => layer.remove());
      return { layer, first, middle, last };
    },
  };
}

test('managed dialogs focus their first control, trap both Tab boundaries and restore pre-existing inert state', async t => {
  const f = fixture(); t.after(() => f.close());
  const background = f.create('main'), trigger = f.create('button', {}, background), untouched = f.create('aside', { inert: '' });
  trigger.focus(); f.mount(); const dialog = f.dialog(); await f.flush();
  assert.equal(f.doc.activeElement, dialog.first); assert.equal(background.inert, true); assert.equal(untouched.inert, true);
  assert.equal(f.key('Tab', { shiftKey: true }).defaultPrevented, true); assert.equal(f.doc.activeElement, dialog.last);
  assert.equal(f.key('Tab').defaultPrevented, true); assert.equal(f.doc.activeElement, dialog.first);
  dialog.middle.focus(); assert.equal(f.key('Tab').defaultPrevented, false, 'interior traversal remains native');
  f.doc.body.focus(); assert.equal(f.doc.activeElement, dialog.first, 'focus escape is redirected');
  f.key('Escape'); await f.flush();
  assert.equal(f.doc.activeElement, trigger); assert.equal(background.inert, false); assert.equal(untouched.inert, true);
});

test('nested managed dialogs dismiss only the topmost layer and restore focus through the parent to its trigger', async t => {
  const f = fixture(); t.after(() => f.close()); const main = f.create('main'), trigger = f.create('button', {}, main);
  trigger.focus(); f.mount(); const parent = f.dialog(); await f.flush(); parent.middle.focus();
  const child = f.dialog(); await f.flush();
  assert.equal(f.doc.activeElement, child.first); assert.equal(parent.layer.inert, true);
  assert.equal(f.key('Escape').defaultPrevented, true); await f.flush();
  assert.equal(parent.layer.isConnected, true); assert.equal(child.layer.isConnected, false); assert.equal(parent.layer.inert, false);
  assert.equal(f.doc.activeElement, parent.middle); assert.equal(main.inert, true);
  f.key('Escape'); await f.flush(); assert.equal(f.doc.activeElement, trigger); assert.equal(main.inert, false);
});

test('autofocus before mutation delivery still restores the external trigger after closing a model dialog', async t => {
  const f = fixture(); t.after(() => f.close()); const trigger = f.create('button'); trigger.focus(); f.mount();
  const dialog = f.dialog(); dialog.middle.focus(); await f.flush();
  assert.equal(f.doc.activeElement, dialog.middle);
  f.key('Escape'); await f.flush(); assert.equal(f.doc.activeElement, trigger);
});

test('a nested model popup retains the modal background mask and consumes Escape before its parent', async t => {
  const f = fixture(); t.after(() => f.close()); const main = f.create('main'); f.create('button', {}, main).focus(); f.mount();
  const parent = f.dialog(); await f.flush();
  const popup = f.create('div', { class: 'workspace-model-popup' }, parent.layer), search = f.create('input', {}, popup);
  popup.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); popup.remove(); parent.middle.focus(); } });
  search.focus(); await f.flush();
  assert.equal(main.inert, true, 'a child selector must not release its parent modal mask');
  assert.equal(f.key('Escape').defaultPrevented, true); await f.flush();
  assert.equal(parent.layer.isConnected, true); assert.equal(popup.isConnected, false); assert.equal(f.doc.activeElement, parent.middle);
});

test('a portalled model selector keeps its own branch reachable while parent modal siblings remain inert', async t => {
  const f = fixture(); t.after(() => f.close()); const main = f.create('main'); f.create('button', {}, main).focus(); f.mount();
  const parent = f.dialog(); await f.flush();
  const portal = f.create('div'), popup = f.create('div', { class: 'workspace-model-popup' }, portal), search = f.create('input', {}, popup);
  search.focus(); await f.flush();
  assert.equal(main.inert, true); assert.equal(portal.inert, false); assert.equal(popup.inert, false); assert.equal(f.doc.activeElement, search);
  let popupKeys = 0;
  popup.addEventListener('keydown', event => { if (event.key === 'Escape') { popupKeys++; event.preventDefault(); portal.remove(); parent.middle.focus(); } });
  assert.equal(f.back().defaultPrevented, true); await f.flush();
  assert.equal(popupKeys, 1); assert.equal(parent.first.clicks, 0); assert.equal(parent.layer.isConnected, true); assert.equal(main.inert, true);
});

test('navigation dismisses through its external scrim without making that control inert', async t => {
  const f = fixture(); t.after(() => f.close()); const scrim = f.create('button', { 'data-ui-dismiss': 'navigation' }), main = f.create('main'), trigger = f.create('button', {}, main);
  trigger.focus(); f.mount(); const nav = f.create('aside', { 'data-ui-layer': 'navigation' }), entry = f.create('button', {}, nav);
  scrim.addEventListener('click', () => nav.remove()); await f.flush();
  assert.equal(f.doc.activeElement, entry); assert.equal(scrim.inert, false); assert.equal(main.inert, true);
  assert.equal(f.key('Escape').defaultPrevented, true); await f.flush();
  assert.equal(nav.isConnected, false); assert.equal(f.doc.activeElement, trigger); assert.equal(main.inert, false);
});

test('native back honors nested keyboard handling, then closes its parent before workspace navigation', async t => {
  const f = fixture(); t.after(() => f.close()); let workspaceBack = 0;
  f.win.addEventListener('petpal:workspace-back', event => { workspaceBack++; event.preventDefault(); });
  f.create('button').focus(); f.mount(); const parent = f.dialog(); await f.flush();
  const popup = f.create('div', { class: 'workspace-model-popup' }, parent.layer), close = f.create('button', { class: 'workspace-model-close' }, popup);
  close.addEventListener('click', () => popup.remove()); close.focus(); await f.flush();
  assert.equal(f.back().defaultPrevented, true); await f.flush();
  assert.equal(popup.isConnected, false); assert.equal(parent.layer.isConnected, true); assert.equal(workspaceBack, 0);
  assert.equal(f.back().defaultPrevented, true); await f.flush();
  assert.equal(parent.layer.isConnected, false); assert.equal(workspaceBack, 0);
  assert.equal(f.back().defaultPrevented, true); assert.equal(workspaceBack, 1);
});

test('native back closes open disclosures first and never consumes events while the document is hidden', async t => {
  const f = fixture(); t.after(() => f.close()); let workspaceBack = 0;
  f.win.addEventListener('petpal:workspace-back', event => { workspaceBack++; event.preventDefault(); }); f.mount();
  const details = f.create('details', { class: 'workspace-disclosure', open: '' }), summary = f.create('summary', {}, details);
  assert.equal(f.back().defaultPrevented, true); assert.equal(details.open, false); assert.equal(f.doc.activeElement, summary); assert.equal(workspaceBack, 0);
  const dialog = f.dialog(); await f.flush(); f.doc.hidden = true;
  assert.equal(f.back().defaultPrevented, false); assert.equal(dialog.layer.isConnected, true); assert.equal(workspaceBack, 0);
  f.doc.hidden = false; f.back(); await f.flush(); assert.equal(dialog.layer.isConnected, false); assert.equal(workspaceBack, 0);
});

test('no layer leaves native back unconsumed unless the workspace accepts it, and prevented/composing keys stay untouched', async t => {
  const f = fixture(); t.after(() => f.close()); f.mount(); assert.equal(f.back().defaultPrevented, false);
  const dialog = f.dialog(); await f.flush();
  assert.equal(f.key('Escape', { isComposing: true }).defaultPrevented, false); assert.equal(dialog.layer.isConnected, true);
  assert.equal(f.key('Escape', { keyCode: 229 }).defaultPrevented, false); assert.equal(dialog.layer.isConnected, true);
  const key = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); key.preventDefault(); dialog.first.dispatchEvent(key);
  assert.equal(dialog.layer.isConnected, true);
});

test('disabled modal and selector dismiss controls consume Escape/back without falling through to the workspace', async t => {
  const f = fixture(); t.after(() => f.close()); let workspaceBack = 0;
  f.win.addEventListener('petpal:workspace-back', event => { workspaceBack++; event.preventDefault(); }); f.mount();
  const dialog = f.dialog(); dialog.first.disabled = true; await f.flush();
  assert.equal(f.doc.activeElement, dialog.middle);
  assert.equal(f.key('Escape').defaultPrevented, true); assert.equal(f.back().defaultPrevented, true);
  assert.equal(dialog.layer.isConnected, true); assert.equal(dialog.first.clicks, 0); assert.equal(workspaceBack, 0);
  const popup = f.create('div', { class: 'workspace-model-popup' }, dialog.layer), close = f.create('button', { class: 'workspace-model-close', disabled: '' }, popup), search = f.create('input', {}, popup);
  search.focus(); await f.flush();
  assert.equal(f.back().defaultPrevented, true); assert.equal(popup.isConnected, true); assert.equal(close.clicks, 0); assert.equal(workspaceBack, 0);
});

test('focus traversal excludes controls inside an already inert branch of the dialog', async t => {
  const f = fixture(); t.after(() => f.close()); f.create('button').focus(); f.mount();
  const layer = f.create('section', { 'data-ui-layer': 'dialog' }), inactive = f.create('div', { inert: '' }, layer);
  const unavailable = f.create('input', {}, inactive), close = f.create('button', { 'data-ui-dismiss': 'dialog' }, layer), last = f.create('button', {}, layer);
  await f.flush(); assert.equal(f.doc.activeElement, close);
  assert.equal(f.key('Tab', { shiftKey: true }).defaultPrevented, true); assert.equal(f.doc.activeElement, last);
  assert.equal(f.key('Tab').defaultPrevented, true); assert.equal(f.doc.activeElement, close); assert.equal(unavailable.focusCalls.length, 0);
});

test('the controller safely declines environments without a document body or MutationObserver', () => {
  for (const options of [{ window: null }, { window: {}, document: null }, { window: {}, document: { body: {} } }]) {
    assert.equal(typeof mountInteractionLayers(options), 'function'); assert.doesNotThrow(() => mountInteractionLayers(options)());
  }
});

test('hiding a layer releases its mask and focus without requiring removal from the DOM', async t => {
  const f = fixture(); t.after(() => f.close()); const main = f.create('main'), trigger = f.create('button', {}, main); trigger.focus(); f.mount();
  const dialog = f.dialog(); await f.flush(); dialog.layer.hidden = true; await f.flush();
  assert.equal(main.inert, false); assert.equal(f.doc.activeElement, trigger); assert.equal(f.back().defaultPrevented, false);
});

test('unmount disconnects observation and all event handlers, restores masks and ignores already queued mutations', async () => {
  const f = fixture(); const main = f.create('main'); f.create('button', {}, main).focus(); f.mount(); const dialog = f.dialog(); await f.flush();
  assert.equal(main.inert, true); assert.equal(f.observerCount, 1); assert.equal(f.observations[0].root, f.doc.body);
  const queued = f.dialog(); f.close(); await f.flush();
  assert.equal(f.observerCount, 0); assert.equal(f.disconnects.length, 1); assert.equal(main.inert, false);
  assert.equal(f.key('Escape').defaultPrevented, false); assert.equal(f.back().defaultPrevented, false);
  assert.equal(dialog.layer.isConnected, true); assert.equal(queued.layer.isConnected, true);
});
