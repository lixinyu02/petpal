import test from 'node:test';
import assert from 'node:assert/strict';

let sequence = 0;
const readyCore = () => ({ Version: { csmGetVersion: () => 0x06000001, csmGetLatestMocVersion: () => 6 }, Moc: {}, Model: {}, Memory: {} });
const flush = async () => { for (let turn = 0; turn < 8; turn++) await Promise.resolve(); };

async function fixture(t) {
  // A separate module instance models each fresh browser document. Native Core
  // behavior has its own real-runtime suite; these tests exercise network timing.
  const { loadCubismCore } = await import(`../src/avatar/cubism/runtime.mjs?download-test=${++sequence}`);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const window = {}, scripts = [];
  const document = {
    createElement(type) {
      assert.equal(type, 'script');
      return { dataset: {}, removed: false, remove() { this.removed = true; } };
    },
    head: { appendChild(script) { scripts.push(script); } },
  };
  const coreUrl = 'https://petpal.test/vendor/live2d/live2dcubismcore.min.js';
  return { window, scripts, coreUrl, load: () => loadCubismCore({ document, window, coreUrl }) };
}

test('cold Core download can take five seconds and simultaneous canvases share its single script', async t => {
  const value = await fixture(t);
  let settled = 0;
  const first = value.load().then(core => { settled++; return core; });
  const second = value.load().then(core => { settled++; return core; });
  assert.equal(value.scripts.length, 1);
  const script = value.scripts[0];
  assert.equal(script.src, value.coreUrl); assert.equal(script.async, true); assert.equal(script.dataset.cubismRuntime, 'core');
  t.mock.timers.tick(5000); await flush();
  assert.equal(settled, 0, 'the previous 2500ms budget must not abandon a valid cold download');
  value.window.Live2DCubismCore = readyCore(); script.onload();
  assert.equal(await first, value.window.Live2DCubismCore); assert.equal(await second, value.window.Live2DCubismCore);
  assert.equal(settled, 2); assert.equal(script.onload, null); assert.equal(script.onerror, null); assert.equal(script.removed, false);
  t.mock.timers.tick(20000); await flush();
  assert.equal(script.removed, false, 'successful completion clears its watchdog');
  assert.equal(await value.load(), value.window.Live2DCubismCore); assert.equal(value.scripts.length, 1);
});

test('Core download has a 12-second bound, removes timed-out scripts and permits a clean retry', async t => {
  const value = await fixture(t);
  let rejected = false;
  const pending = value.load().catch(error => { rejected = true; throw error; });
  const failure = assert.rejects(pending, /Cubism Core loading timed out/u);
  const expired = value.scripts[0], staleLoad = expired.onload;
  t.mock.timers.tick(11999); await flush();
  assert.equal(rejected, false); assert.equal(expired.removed, false);
  t.mock.timers.tick(1); await failure;
  assert.equal(rejected, true); assert.equal(expired.removed, true); assert.equal(expired.onload, null); assert.equal(expired.onerror, null);
  let retryFinished = false;
  const retry = value.load().then(core => { retryFinished = true; return core; });
  assert.equal(value.scripts.length, 2); assert.notEqual(value.scripts[1], expired);
  staleLoad(); await flush();
  assert.equal(retryFinished, false, 'late completion from an expired script must not complete the new attempt');
  t.mock.timers.tick(5000);
  value.window.Live2DCubismCore = readyCore(); value.scripts[1].onload();
  assert.equal(await retry, value.window.Live2DCubismCore);
  assert.equal(value.scripts[1].removed, false);
});

test('Core network failure cleans listeners and the next attempt does not inherit a failed singleton', async t => {
  const value = await fixture(t);
  const pending = value.load(), failure = assert.rejects(pending, /Cubism Core is unavailable/u);
  const failed = value.scripts[0]; failed.onerror(); await failure;
  assert.equal(failed.removed, true); assert.equal(failed.onload, null); assert.equal(failed.onerror, null);
  const retry = value.load(); assert.equal(value.scripts.length, 2);
  value.window.Live2DCubismCore = readyCore(); value.scripts[1].onload();
  assert.equal(await retry, value.window.Live2DCubismCore);
  t.mock.timers.tick(20000); await flush();
  assert.equal(value.scripts[1].removed, false);
});
