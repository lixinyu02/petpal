import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createThemeController, effectiveTheme, nextThemeBoundary, normalizeThemePreference, THEME_CHROME_COLORS, THEME_COLORS, THEME_STORAGE_KEY } from '../src/platform/theme.mjs';

const localDate = (hour, minute = 0, second = 0, ms = 0) => new Date(2026, 9, 4, hour, minute, second, ms);
function fixture({ date = localDate(12), preference = null, getDenied = false, setDenied = false, getterDenied = false, hidden = false, transparent = false } = {}) {
  const values = new Map(preference === null ? [] : [[THEME_STORAGE_KEY, preference]]), timers = new Map(), writes = [];
  const window = new EventTarget(), document = new EventTarget();
  let clock = date, timerId = 0;
  const storage = {
    getItem(key) { if (getDenied) throw new Error('fixture storage read denied'); return values.get(key) ?? null; },
    setItem(key, value) { if (setDenied) throw new Error('fixture storage write denied'); writes.push([key, value]); values.set(key, value); },
  };
  Object.defineProperty(window, 'localStorage', { get() { if (getterDenied) throw new Error('fixture storage getter denied'); return storage; } });
  document.visibilityState = hidden ? 'hidden' : 'visible';
  document.documentElement = { dataset: transparent ? { petpalSurface: 'transparent' } : {}, style: {} };
  document.querySelector = selector => selector === 'meta[name="theme-color"]' ? { setAttribute(key, value) { document.chromeColor = value; } } : null;
  const controller = createThemeController({ window, document, now: () => new Date(clock.getTime()), setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, due: clock.getTime() + delay, delay }); return id; }, clearTimeout(id) { timers.delete(id); } });
  function storageEvent(key, value, storageArea = storage) {
    if (value === null) values.delete(key); else values.set(key, value);
    const event = new Event('storage'); Object.assign(event, { key, newValue: value, storageArea }); window.dispatchEvent(event);
  }
  return {
    controller, document, window, storage, values, writes, timers,
    setTime(next) { clock = next; },
    advanceTo(next) {
      while (true) {
        const pending = [...timers].filter(([, item]) => item.due <= next.getTime()).sort(([, left], [, right]) => left.due - right.due)[0];
        if (!pending) break;
        timers.delete(pending[0]); clock = new Date(pending[1].due); pending[1].callback();
      }
      clock = next;
    },
    focus() { window.dispatchEvent(new Event('focus')); },
    visible(next) { document.visibilityState = next ? 'visible' : 'hidden'; document.dispatchEvent(new Event('visibilitychange')); },
    storageEvent,
  };
}

test('automatic theme uses the exact local 07:00 and 19:00 boundaries', () => {
  for (const [date, expected] of [[localDate(0), 'night'], [localDate(6, 59, 59, 999), 'night'], [localDate(7), 'day'], [localDate(18, 59, 59, 999), 'day'], [localDate(19), 'night'], [localDate(23, 59), 'night']]) assert.equal(effectiveTheme('auto', date), expected);
  assert.equal(effectiveTheme('day', localDate(1)), 'day'); assert.equal(effectiveTheme('night', localDate(12)), 'night');
  for (const value of [null, undefined, '', 'dark', 'light', {}, [], 1]) assert.equal(normalizeThemePreference(value), 'auto');
});

test('next boundary follows the local calendar and does not mutate the input', () => {
  const dates = [[localDate(6), localDate(7)], [localDate(7), localDate(19)], [localDate(18, 59), localDate(19)], [localDate(19), new Date(2026, 9, 5, 7)], [new Date(2026, 11, 31, 23), new Date(2027, 0, 1, 7)]];
  for (const [date, next] of dates) { const before = date.getTime(); assert.equal(nextThemeBoundary(date).getTime(), next.getTime()); assert.equal(date.getTime(), before); }
});

test('initial state and manual preferences apply document appearance and persist only the local theme key', () => {
  const f = fixture({ date: localDate(22) });
  assert.deepEqual(f.controller.snapshot(), { preference: 'auto', theme: 'night', saved: true });
  assert.equal(f.document.documentElement.dataset.theme, 'night'); assert.equal(f.document.documentElement.style.colorScheme, 'dark');
  assert.equal(f.document.documentElement.style.backgroundColor, THEME_COLORS.night); assert.equal(f.document.chromeColor, THEME_CHROME_COLORS.night);
  f.controller.setPreference('day');
  assert.deepEqual(f.writes, [[THEME_STORAGE_KEY, 'day']]); assert.equal(f.document.documentElement.dataset.themePreference, 'day');
  assert.equal(f.document.documentElement.style.colorScheme, 'light');
  assert.throws(() => f.controller.setPreference('dark'), /Unknown theme/); assert.equal(f.controller.snapshot().preference, 'day');
});

test('auto mode switches at the boundary, while unchanged clock checks retain a stable snapshot', () => {
  const f = fixture({ date: localDate(6, 59, 59, 500) }), stop = f.controller.mount();
  let notices = 0; const unsubscribe = f.controller.subscribe(() => notices++), initial = f.controller.snapshot();
  assert.equal([...f.timers.values()][0].delay, 500);
  f.advanceTo(localDate(7)); assert.equal(f.controller.snapshot().theme, 'day'); assert.equal(notices, 1);
  const day = f.controller.snapshot(); f.advanceTo(localDate(7, 2)); assert.equal(f.controller.snapshot(), day); assert.notEqual(day, initial); assert.equal(notices, 1);
  f.setTime(localDate(18, 59, 59, 750)); f.focus(); assert.equal([...f.timers.values()][0].delay, 250);
  f.advanceTo(localDate(19)); assert.equal(f.controller.snapshot().theme, 'night'); assert.equal(notices, 2);
  unsubscribe(); stop(); assert.equal(f.timers.size, 0);
});

test('visibility and focus recalculate skipped boundaries and changed local clocks', () => {
  const f = fixture({ date: localDate(12) }), stop = f.controller.mount();
  f.visible(false); assert.equal(f.timers.size, 0);
  f.setTime(localDate(21)); f.visible(true); assert.equal(f.controller.snapshot().theme, 'night'); assert.equal(f.timers.size, 1);
  f.setTime(localDate(8)); f.focus(); assert.equal(f.controller.snapshot().theme, 'day');
  stop(); f.setTime(localDate(23)); f.focus(); assert.equal(f.controller.snapshot().theme, 'day', 'unmounted lifecycle must release its event listeners');
});

test('manual mode cancels clock timers and auto mode restores them', () => {
  const f = fixture(), stop = f.controller.mount(); assert.equal(f.timers.size, 1);
  f.controller.setPreference('night'); assert.equal(f.timers.size, 0);
  f.setTime(localDate(9)); f.focus(); assert.equal(f.controller.snapshot().theme, 'night');
  f.controller.setPreference('auto'); assert.equal(f.controller.snapshot().theme, 'day'); assert.equal(f.timers.size, 1);
  stop();
});

test('storage events synchronize same-origin windows, clear returns to auto, and other stores are ignored', () => {
  const f = fixture({ date: localDate(12) }), stop = f.controller.mount();
  f.storageEvent(THEME_STORAGE_KEY, 'night'); assert.equal(f.controller.snapshot().preference, 'night'); assert.equal(f.timers.size, 0);
  f.storageEvent('unrelated-private-key', 'day'); assert.equal(f.controller.snapshot().preference, 'night');
  f.storageEvent(THEME_STORAGE_KEY, 'day', {}); assert.equal(f.controller.snapshot().preference, 'night');
  f.storageEvent(THEME_STORAGE_KEY, null); assert.equal(f.controller.snapshot().preference, 'auto'); assert.equal(f.controller.snapshot().theme, 'day');
  f.storageEvent(THEME_STORAGE_KEY, 'invalid'); assert.equal(f.controller.snapshot().preference, 'auto');
  stop();
});

test('storage-denied manual choices work in memory and survive focus/visibility recalculation', () => {
  for (const options of [{ getterDenied: true }, { getDenied: true }, { setDenied: true }]) {
    const f = fixture({ date: localDate(12), ...options }), stop = f.controller.mount();
    f.controller.setPreference('night'); assert.deepEqual(f.controller.snapshot(), { preference: 'night', theme: 'night', saved: false });
    f.focus(); f.visible(false); f.visible(true);
    assert.equal(f.controller.snapshot().preference, 'night'); assert.equal(f.document.documentElement.dataset.theme, 'night');
    f.controller.setPreference('auto'); f.setTime(localDate(23)); f.focus(); assert.equal(f.controller.snapshot().theme, 'night');
    stop();
  }
});

test('multiple mounts share one lifecycle and StrictMode cleanup is idempotent', () => {
  const f = fixture(), first = f.controller.mount(), second = f.controller.mount();
  assert.equal(f.timers.size, 1); first(); first(); assert.equal(f.timers.size, 1);
  second(); assert.equal(f.timers.size, 0);
  const third = f.controller.mount(); assert.equal(f.timers.size, 1); third(); assert.equal(f.timers.size, 0);
});

test('transparent native overlays remain transparent through theme changes and normal web entries can reset it', () => {
  const f = fixture({ transparent: true, date: localDate(23) }), stop = f.controller.mount({ transparent: true });
  for (const preference of ['day', 'night', 'auto']) {
    f.controller.setPreference(preference); assert.equal(f.document.documentElement.style.backgroundColor, 'transparent');
    assert.equal(f.document.documentElement.dataset.petpalSurface, 'transparent');
  }
  stop(); const normal = f.controller.mount({ transparent: false });
  assert.equal(f.document.documentElement.style.backgroundColor, THEME_COLORS.night); assert.equal(f.document.documentElement.dataset.petpalSurface, undefined); normal();
});

test('first-paint inline policy matches the module for every boundary, preference, storage denial and overlay', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8'), script = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]; assert.ok(script);
  for (const hour of [0, 6, 7, 12, 18, 19, 23]) for (const preference of [null, 'auto', 'day', 'night', 'invalid']) for (const denied of [false, true]) for (const transparent of [false, true]) {
    const date = localDate(hour), f = fixture({ date, preference, getDenied: denied, transparent });
    const document = { documentElement: { dataset: {}, style: {} }, querySelector: () => ({ setAttribute: (_key, value) => { document.chromeColor = value; } }) };
    class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [date.getTime()])); } }
    vm.runInNewContext(script, { Date: ClockDate, localStorage: f.storage, document, location: { search: transparent ? '?overlay=1' : '' }, URLSearchParams });
    assert.equal(document.documentElement.dataset.theme, f.controller.snapshot().theme);
    assert.equal(document.documentElement.dataset.themePreference, f.controller.snapshot().preference);
    assert.equal(document.documentElement.style.colorScheme, f.document.documentElement.style.colorScheme);
    assert.equal(document.documentElement.style.backgroundColor, f.document.documentElement.style.backgroundColor);
    assert.equal(document.chromeColor, f.document.chromeColor);
  }
});

test('night palette keeps readable text and button contrast without recoloring character pixels', async () => {
  const css = await readFile(new URL('../src/theme.css', import.meta.url), 'utf8');
  const luminance = hex => { const channels = hex.replace('#', '').match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4); return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722; };
  const contrast = (left, right) => { const a = luminance(left), b = luminance(right); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
  for (const surface of ['#181d1b', '#222a25', '#2b352e']) { assert.ok(contrast('#e0e7e1', surface) >= 7); assert.ok(contrast('#a9b8ae', surface) >= 4.5); }
  assert.ok(contrast('#f4f8f3', '#3c7158') >= 4.5);
  assert.doesNotMatch(css, /(?:filter|backdrop-filter)\s*:\s*(?:invert|brightness|contrast)/i);
  assert.match(css, /data-petpal-surface="transparent"/); assert.match(css, /prefers-reduced-motion:reduce/);
});
