import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import ts from 'typescript';
import layout from '../desktop/window-layout.cjs';

const { mainWindowLayout, petWindowLayout } = layout;
function inside(bounds, area) {
  assert.ok(bounds.width > 0 && bounds.height > 0);
  assert.ok(bounds.x >= area.x && bounds.y >= area.y);
  assert.ok(bounds.x + bounds.width <= area.x + area.width);
  assert.ok(bounds.y + bounds.height <= area.y + area.height);
}

test('main window fits 412 DIP portrait work area without a desktop-only minimum', () => {
  const area = { x: 0, y: 24, width: 412, height: 912 };
  const bounds = mainWindowLayout(area);
  inside(bounds, area);
  assert.equal(bounds.width, 412);
  assert.equal(bounds.height, 800);
  assert.equal(bounds.minWidth, 320);
  assert.equal(bounds.minHeight, 320);
  assert.equal(mainWindowLayout(area, { x: 10, y: 30, width: 360, height: 560 }).width, 360);
});

test('desktop defaults and user-sized bounds are preserved when they fit', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(mainWindowLayout(area), { x: 370, y: 120, width: 1180, height: 800, minWidth: 320, minHeight: 320 });
  const resized = { x: 90, y: 80, width: 650, height: 710 };
  assert.deepEqual(mainWindowLayout(area, resized), { ...resized, minWidth: 320, minHeight: 320 });
  assert.deepEqual(petWindowLayout(area), { x: 1600, y: 680, width: 300, height: 340 });
});

test('negative monitor origins, taskbars, small work areas and removed displays remain contained', () => {
  const areas = [
    { x: -1080, y: -90, width: 412, height: 936 },
    { x: 1920, y: 40, width: 360, height: 240 },
    { x: -800, y: 500, width: 240, height: 180 },
    { x: 0, y: 0, width: 960, height: 372 },
    { x: 0, y: 0, width: 1, height: 1 },
  ];
  for (const area of areas) {
    for (const old of [undefined, { x: -9999, y: -9999, width: 1180, height: 800 }, { x: 5000, y: 5000, width: 320, height: 340 }]) {
      const main = mainWindowLayout(area, old), pet = petWindowLayout(area, old);
      inside(main, area); inside(pet, area);
      assert.ok(main.minWidth <= area.width && main.minHeight <= area.height);
      assert.ok(pet.width <= 300 && pet.height <= 340);
      // Pixel rounding must not distort the companion's nominal 300:340 aspect.
      assert.ok(Math.abs(pet.width - pet.height * 300 / 340) <= 1);
    }
  }
});

test('pet resizes for short displays and returns to its normal size on a larger one', () => {
  const small = { x: 0, y: 20, width: 412, height: 200 };
  const pet = petWindowLayout(small);
  inside(pet, small);
  assert.ok(pet.width < 300 && pet.height < 340);
  const expanded = petWindowLayout({ x: 0, y: 0, width: 1280, height: 800 }, pet);
  assert.equal(expanded.width, 300); assert.equal(expanded.height, 340);
});

const source = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('main.cjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function nativeHarness({ pet = false } = {}) {
  const display = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  const screen = new EventEmitter();
  screen.getDisplayMatching = () => display;
  const win = new EventEmitter(), timers = new Map(), writes = [];
  let sequence = 0, destroyed = false, maximized = false;
  let bounds = pet ? { x: 1600, y: 680, width: 300, height: 340 } : { x: 900, y: 200, width: 900, height: 700 };
  let minimum = [320, 320];
  Object.assign(win, {
    isDestroyed: () => destroyed, getBounds: () => ({ ...bounds }),
    getMinimumSize: () => minimum,
    setMinimumSize: (width, height) => { minimum = [width, height]; writes.push('minimum'); },
    setBounds: next => { bounds = { ...next }; writes.push('bounds'); win.emit('move'); win.emit('resize'); },
    isMinimized: () => false, isMaximized: () => maximized, isFullScreen: () => false,
  });
  const context = vm.createContext({ ...layout, screen,
    setTimeout(callback) { const id = ++sequence; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  for (const name of ['fitWindowToDisplay', 'trackWindowDisplay']) {
    const declaration = parsed.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
    assert.ok(declaration, `Missing ${name}`);
    vm.runInContext(declaration.getText(parsed), context);
  }
  context.trackWindowDisplay(win, pet);
  return { win, display, screen, writes, timers, get bounds() { return bounds; }, get minimum() { return minimum; },
    maximize(value) { maximized = value; },
    flush() { const batch = [...timers.values()]; timers.clear(); for (const run of batch) run(); },
    close() { destroyed = true; win.emit('closed'); },
  };
}

test('display-change hooks lower minimum before shrinking, handle restore and detach on close', () => {
  const f = nativeHarness();
  f.display.workArea = { x: -240, y: 20, width: 240, height: 280 };
  f.maximize(true);
  f.screen.emit('display-metrics-changed');
  assert.deepEqual(f.minimum, [240, 280]);
  assert.equal(f.writes.includes('bounds'), false);
  f.maximize(false); f.win.emit('unmaximize'); f.flush();
  inside(f.bounds, f.display.workArea);
  assert.deepEqual(f.writes.slice(0, 2), ['minimum', 'bounds']);
  f.flush(); assert.equal(f.timers.size, 0); // No self-sustaining resize loop.
  f.win.emit('move'); assert.equal(f.timers.size, 1);
  f.close(); assert.equal(f.timers.size, 0);
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) assert.equal(f.screen.listenerCount(event), 0);
});

test('pet movement is debounced and display removal recovers it on the surviving monitor', () => {
  const f = nativeHarness({ pet: true });
  f.display.workArea = { x: -412, y: 24, width: 412, height: 536 };
  f.win.emit('move'); f.win.emit('move');
  assert.equal(f.timers.size, 1); assert.equal(f.writes.length, 0);
  f.flush(); inside(f.bounds, f.display.workArea);
  f.display.workArea = { x: 0, y: 0, width: 360, height: 240 };
  f.screen.emit('display-removed'); inside(f.bounds, f.display.workArea);
  assert.ok(f.bounds.height < 340);
  assert.equal(f.writes.includes('minimum'), false);
  f.close();
});
