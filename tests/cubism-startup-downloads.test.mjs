import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createCubismResourceLoader } from '../src/avatar/cubism/resources.mjs';
import { waitForCubismCore } from '../src/avatar/cubism/runtime.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const until = async predicate => { for (let attempt = 0; attempt < 200; attempt++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('Fixture gate was not reached'); };
const modelDirectory = new URL('../public/avatars/akari-cubism-v12/', import.meta.url);
let fixtureId = 0;

/** Real runtime/model/motions; only browser/GPU and module transport are gated. */
async function actualFixture(t, { readControl, manifestOverride, waitShaders = false, manualImages = false } = {}) {
  const coreSource = await fs.readFile(new URL('../public/vendor/live2d/live2dcubismcore.min.js', import.meta.url), 'utf8');
  const sandbox = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, TextDecoder, TextEncoder, atob, btoa, window: {}, document: { currentScript: { src: 'https://petpal.test/vendor/live2d/live2dcubismcore.min.js' } } };
  vm.runInNewContext(coreSource, sandbox, { timeout: 2000 });
  const core = await waitForCubismCore(() => sandbox.Live2DCubismCore);
  const previousCore = globalThis.Live2DCubismCore; globalThis.Live2DCubismCore = core;
  t.after(() => { if (previousCore === undefined) delete globalThis.Live2DCubismCore; else globalThis.Live2DCubismCore = previousCore; });
  const actualFramework = await import('../public/avatars/cubism-runtime/framework.mjs');
  const manifest = manifestOverride || JSON.parse(await fs.readFile(new URL('akari.model3.json', modelDirectory), 'utf8'));
  const reads = [], motions = [], uploads = [], images = [], scripts = [], events = [];
  let active = 0, maximumReads = 0, liveImages = 0, maximumImages = 0, releases = 0, model, rendererCreated = false;
  const shader = { _isShaderLoaded: !waitShaders, _isShaderLoading: waitShaders, _shaderSets: Array.from({ length: 11 }, () => ({ shaderProgram: {} })) };
  const renderer = { startUp() {}, setIsPremultipliedAlpha() {}, bindTexture(index) { uploads.push(index); }, loadShaders() {}, setMvpMatrix() {}, setRenderState() {}, drawModel() {} };
  const framework = { ...actualFramework,
    CubismUserModel: class extends actualFramework.CubismUserModel {
      loadModel(...args) { super.loadModel(...args); model = this.getModel(); events.push('model'); }
      loadMotion(...args) { const motion = super.loadMotion(...args); motions.push(args[2]); return motion; }
      createRenderer() { rendererCreated = true; events.push('renderer'); }
      getRenderer() { return renderer; }
    },
    CubismShaderManager_WebGL: { getInstance: () => ({ getShader: () => shader }) },
    releaseCubismContext() {},
  };
  const key = `__petpalCubismStartupFixture${++fixtureId}`; globalThis[key] = framework; t.after(() => { delete globalThis[key]; });
  let source = await fs.readFile(new URL('../src/avatar/cubism/runtime.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes('import(/* @vite-ignore */ url)'), 'Gate only the existing Framework import transport');
  source = source.replace('import(/* @vite-ignore */ url)', `Promise.resolve(globalThis[${JSON.stringify(key)}])`)
    .replace("'./resources.mjs'", JSON.stringify(new URL('../src/avatar/cubism/resources.mjs', import.meta.url).href))
    .replace("'./parameters.mjs'", JSON.stringify(new URL('../src/avatar/cubism/parameters.mjs', import.meta.url).href));
  const runtime = await import(`data:text/javascript;base64,${Buffer.from(source + `\n// fixture ${fixtureId}`).toString('base64')}`);
  const window = { location: { href: 'https://petpal.test/', origin: 'https://petpal.test' } };
  const document = { defaultView: window, createElement: () => ({ dataset: {}, removed: false, remove() { this.removed = true; } }), head: { appendChild(script) { scripts.push(script); } } };
  const gl = { MAX_TEXTURE_SIZE: 1, getParameter: () => 4096, createTexture: () => ({}), bindTexture() {}, pixelStorei() {}, texImage2D() { events.push('upload'); }, texParameteri() {}, deleteTexture() { events.push('delete-texture'); }, getExtension: () => ({ loseContext() { releases++; events.push('release'); } }) };
  const canvas = { width: 640, height: 960, ownerDocument: document, getContext: () => gl };
  t.mock.method(globalThis, 'fetch', async (url, { signal }) => {
    assert.ok(String(url).startsWith('https://petpal.test/avatars/akari-cubism-v12/'), 'fixture must never request real upstreams');
    reads.push({ url, signal }); active++; maximumReads = Math.max(active, maximumReads);
    const path = new URL(url).pathname.split('/').slice(3).join('/');
    const proceed = async () => new Response(path === 'akari.model3.json' ? JSON.stringify(manifest) : await fs.readFile(new URL(path === 'second.png' ? 'akari.2048/texture_00.png' : path, modelDirectory)));
    try { return await (readControl ? readControl(path, signal, proceed) : proceed()); }
    finally { active--; }
  });
  const previousImage = globalThis.Image;
  globalThis.Image = class {
    naturalWidth = 2048; naturalHeight = 2048;
    set src(value) { if (!value) return; liveImages++; maximumImages = Math.max(maximumImages, liveImages); images.push(this); if (!manualImages) queueMicrotask(() => this.finish()); }
    finish() { liveImages--; this.onload?.(); }
  };
  t.after(() => { if (previousImage === undefined) delete globalThis.Image; else globalThis.Image = previousImage; });
  return { runtime, core, shader, manifest, reads, motions, uploads, images, scripts, events, canvas,
    activateCore() { window.Live2DCubismCore = core; scripts[0].onload(); },
    get rendererCreated() { return rendererCreated; }, get model() { return model; }, get releases() { return releases; }, get maximumReads() { return maximumReads; }, get maximumImages() { return maximumImages; },
  };
}

test('owned Cubism downloads bound concurrency to four and reject invalid byte budgets', async () => {
  const gates = [], started = [], parent = new AbortController();
  const scope = createCubismResourceLoader({ signal: parent.signal, fetchBytes: (url, options) => { const gate = deferred(); gates.push(gate); started.push({ url, options }); return gate.promise; } });
  try {
    const tasks = Array.from({ length: 9 }, (_, index) => scope.read(String(index), { maxBytes: 12 }));
    await flush(); assert.equal(started.length, 4);
    assert.ok(started.every(item => item.options.maxBytes === 12));
    gates[0].resolve(new ArrayBuffer(4)); await tasks[0]; await flush(); assert.equal(started.length, 5);
    for (let index = 1; index < 9; index++) { await flush(); gates[index].resolve(new ArrayBuffer(4)); await tasks[index]; }
    await scope.drain();
    for (const maxBytes of [0, -1, NaN, Infinity, 25 * 1024 * 1024, 1.5]) await assert.rejects(scope.read('invalid', { maxBytes }), /limit is invalid/u);
    assert.equal(started.length, 9, 'invalid budgets never start network reads');
  } finally { scope.dispose(); }
  assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
});

test('owned read failure cancels siblings, skips queued work and drains late network completion', async () => {
  const gates = [], signals = [], parent = new AbortController();
  const scope = createCubismResourceLoader({ signal: parent.signal, fetchBytes: (url, options) => { const gate = deferred(); gates.push(gate); signals.push(options.signal); return gate.promise; } });
  const tasks = Array.from({ length: 6 }, (_, index) => scope.read(String(index), { maxBytes: 12 }));
  const outcomes = Promise.allSettled(tasks);
  await flush(); const failure = new Error('texture read broke'); gates[0].reject(failure); await flush();
  assert.ok(signals.every(signal => signal.aborted && signal.reason === failure));
  assert.equal(gates.length, 4, 'queued reads never start after failure');
  let drained = false; const draining = scope.drain().then(() => { drained = true; });
  await flush(); assert.equal(drained, false, 'abort acknowledgement does not mean a read has settled');
  for (const gate of gates.slice(1)) gate.resolve(new ArrayBuffer(4));
  await draining; const results = await outcomes;
  assert.ok(results.every(result => result.status === 'rejected' && result.reason === failure));
  scope.dispose(); assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
});

test('owned reads reject oversized returned bytes, preserve first error and handle pre-cancellation', async () => {
  const scope = createCubismResourceLoader({ fetchBytes: async () => new ArrayBuffer(13) });
  await assert.rejects(scope.read('oversize', { maxBytes: 12 }), /size is invalid/u);
  const first = scope.signal.reason; scope.cancel(new Error('later')); assert.equal(scope.signal.reason, first);
  await scope.drain(); scope.dispose();
  const parent = new AbortController(), reason = new Error('unmounted'); parent.abort(reason);
  let calls = 0; const cancelled = createCubismResourceLoader({ signal: parent.signal, fetchBytes: async () => { calls++; } });
  await assert.rejects(cancelled.read('model', { maxBytes: 12 }), error => error === reason);
  await cancelled.drain(); cancelled.dispose(); assert.equal(calls, 0);
});

test('real startup overlaps manifest/Core and texture/MOC, retains every V12 motion and waits for shaders', async t => {
  const moc = deferred(), texture = deferred();
  const f = await actualFixture(t, { waitShaders: true, readControl: async (path, signal, proceed) => { if (path === 'akari.moc3') await moc.promise; if (path.endsWith('.png')) await texture.promise; return proceed(); } });
  const parent = new AbortController(); let settled = false;
  const loading = f.runtime.createCubismAvatar({ canvas: f.canvas, signal: parent.signal }).then(value => { settled = true; return value; });
  await until(() => f.reads.length === 3);
  assert.equal(f.scripts.length, 1); assert.equal(f.motions.length, 0);
  assert.ok(f.reads.some(read => read.url.endsWith('akari.moc3')) && f.reads.some(read => read.url.endsWith('.png')), 'validated MOC and raw texture start before Core finishes');
  f.activateCore(); moc.resolve(); await until(() => f.rendererCreated);
  assert.equal(f.motions.length, 16); assert.equal(new Set(f.motions).size, 16);
  assert.equal(f.images.length, 0, 'raw texture prefetch does not decode or allocate GPU texture before complete motion initialization');
  assert.equal(settled, false); texture.resolve(); await until(() => f.uploads.length === 1);
  assert.equal(settled, false, 'complete model and uploaded texture still wait for actual shader readiness');
  f.shader._isShaderLoaded = true;
  const avatar = await loading;
  assert.ok(f.maximumReads <= 4); assert.equal(f.maximumImages, 1);
  const expected = Object.entries(f.manifest.FileReferences.Motions).flatMap(([group, entries]) => entries.map((_, index) => `${group}_${index}`));
  assert.deepEqual(f.motions, expected, 'authored order and all real motion assets survive prefetch');
  avatar.react('pet'); avatar.update(1 / 30, {}, {}); assert.equal(avatar.motionGroup, 'TapHead');
  assert.ok(Array.from(f.model.getModel().drawables.vertexPositions).flatMap(vertices => Array.from(vertices)).every(Number.isFinite));
  avatar.release(); assert.equal(f.releases, 1); avatar.release(); assert.equal(f.releases, 1);
  assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
});

test('real startup prefetches only first texture and decodes/uploads multiple textures in order', async t => {
  const manifest = JSON.parse(await fs.readFile(new URL('akari.model3.json', modelDirectory), 'utf8'));
  manifest.FileReferences.Textures.push('second.png'); const moc = deferred();
  const f = await actualFixture(t, { manualImages: true, manifestOverride: manifest, readControl: async (path, signal, proceed) => { if (path === 'akari.moc3') await moc.promise; return proceed(); } });
  const loading = f.runtime.createCubismAvatar({ canvas: f.canvas });
  await until(() => f.reads.length === 3);
  assert.equal(f.reads.some(read => read.url.endsWith('second.png')), false, 'second raw texture is not held alongside first');
  f.activateCore(); moc.resolve(); await until(() => f.images.length === 1);
  assert.equal(f.reads.some(read => read.url.endsWith('second.png')), false, 'first image completes decode/upload before requesting next');
  f.images[0].finish(); await until(() => f.images.length === 2);
  assert.deepEqual(f.uploads, [0]); f.images[1].finish(); const avatar = await loading;
  assert.deepEqual(f.uploads, [0, 1]); assert.equal(f.maximumImages, 1); avatar.release();
});

test('real startup cancels and drains a late speculative texture before releasing GPU', async t => {
  const moc = deferred(), texture = deferred(); let textureSignal;
  const f = await actualFixture(t, { readControl: async (path, signal, proceed) => {
    if (path === 'akari.moc3') { await moc.promise; throw new Error('MOC transport failed'); }
    if (path.endsWith('.png')) { textureSignal = signal; await texture.promise; }
    return proceed();
  } });
  const parent = new AbortController(), loading = f.runtime.createCubismAvatar({ canvas: f.canvas, signal: parent.signal });
  const failed = assert.rejects(loading, /MOC transport failed/u);
  await until(() => f.reads.length === 3); moc.resolve(); await until(() => textureSignal.aborted);
  assert.equal(f.releases, 0, 'an abort flag alone does not authorize GPU release while owned read is unsettled');
  assert.equal(f.scripts[0].removed, false, 'failed canvas does not cancel shared Core');
  texture.resolve(); await failed; assert.equal(f.releases, 1); assert.equal(f.images.length, 0);
  f.activateCore(); await flush(); assert.equal(f.releases, 1, 'late Core readiness cannot revive or release canvas twice');
  assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
});

test('unmount during real model initialization waits for late raw texture, never decodes it and preserves abort reason', async t => {
  const texture = deferred(); let textureSignal;
  const f = await actualFixture(t, { readControl: async (path, signal, proceed) => { if (path.endsWith('.png')) { textureSignal = signal; await texture.promise; } return proceed(); } });
  const parent = new AbortController(), reason = new Error('avatar unmounted');
  const loading = f.runtime.createCubismAvatar({ canvas: f.canvas, signal: parent.signal });
  const failed = assert.rejects(loading, error => error === reason);
  await until(() => f.reads.length === 3); f.activateCore(); await until(() => f.rendererCreated);
  parent.abort(reason); await flush();
  assert.equal(textureSignal.aborted, true); assert.equal(f.releases, 0);
  texture.resolve(); await failed;
  assert.equal(f.images.length, 0); assert.equal(f.releases, 1); assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
});

test('failed actual shader validation releases all uploaded textures and the model exactly once', async t => {
  const f = await actualFixture(t); f.shader._shaderSets[4].shaderProgram = null;
  const failed = assert.rejects(f.runtime.createCubismAvatar({ canvas: f.canvas }), /shaders could not compile/u);
  await until(() => f.reads.length >= 3); f.activateCore(); await failed;
  assert.deepEqual(f.uploads, [0]); assert.equal(f.events.filter(event => event === 'delete-texture').length, 1);
  assert.equal(f.releases, 1); assert.equal(f.model.getModel(), null, 'official Core model allocation was released');
});

test('real startup rejects unsafe manifest before speculative references reach fetch', async t => {
  const manifest = JSON.parse(await fs.readFile(new URL('akari.model3.json', modelDirectory), 'utf8'));
  manifest.FileReferences.Textures = ['https://other.test/texture.png'];
  const f = await actualFixture(t, { manifestOverride: manifest });
  await assert.rejects(f.runtime.createCubismAvatar({ canvas: f.canvas }), /finite, local files/u);
  assert.equal(f.reads.length, 1); assert.equal(f.releases, 1); f.activateCore(); await flush();
});
