import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { configureCubismShaderProfile } from '../src/avatar/cubism/shader-profile.mjs';
import { acquireCubismFramework, waitForCubismCore, waitForCubismShaders } from '../src/avatar/cubism/runtime.mjs';

let core, framework, lease, avatar, model, previousCore;
test.before(async () => {
  const source = await fs.readFile(new URL('../public/vendor/live2d/live2dcubismcore.min.js', import.meta.url), 'utf8');
  const sandbox = { console, setTimeout, clearTimeout, TextDecoder, TextEncoder, atob, btoa, window: {}, document: { currentScript: { src: 'https://petpal.test/vendor/live2d/live2dcubismcore.min.js' } } };
  vm.runInNewContext(source, sandbox, { timeout: 2000 });
  core = await waitForCubismCore(() => sandbox.Live2DCubismCore);
  previousCore = globalThis.Live2DCubismCore; globalThis.Live2DCubismCore = core;
  framework = await import('../public/avatars/cubism-runtime/framework.mjs');
  lease = acquireCubismFramework(framework, core);
  const bytes = await fs.readFile(new URL('../public/avatars/akari-cubism-v12/akari.moc3', import.meta.url));
  const moc = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  assert.equal(framework.CubismMoc.hasMocConsistency(moc), true);
  avatar = new framework.CubismUserModel(); avatar.loadModel(moc, true); model = avatar.getModel();
});
test.after(() => { avatar?.release(); lease?.release(); if (previousCore === undefined) delete globalThis.Live2DCubismCore; else globalThis.Live2DCubismCore = previousCore; });

function context(t, options = {}) {
  const programs = [], compiled = [], deleted = new Set();
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    createProgram() { const program = { shaders: [] }; programs.push(program); return program; },
    createShader(type) { return { type }; }, shaderSource(shader, source) { shader.source = source; },
    compileShader(shader) { compiled.push(shader); }, getShaderParameter() { return !options.failCompile; },
    getShaderInfoLog() { return 'controlled compile failure'; }, deleteShader() {},
    attachShader(program, shader) { program.shaders.push(shader); }, linkProgram() {},
    getProgramParameter() { return !options.failLink; },
    getAttribLocation() { if (options.failAttribute) throw new Error('controlled attribute failure'); return 0; },
    getUniformLocation() { return {}; }, deleteProgram(program) { if (program) deleted.add(program); },
  };
  const manager = framework.CubismShaderManager_WebGL.getInstance(); manager.setGlContext(gl);
  const shader = manager.getShader(gl);
  let released = false;
  const release = () => { if (!released) { released = true; framework.releaseCubismContext(gl); } };
  t.after(release);
  return { gl, shader, programs, compiled, deleted, release };
}
function shaderFetch(t, beforeRead = async () => {}) {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    assert.ok(String(url).startsWith('/shader-profile-fixture/'), 'No live resource requests'); count++;
    await beforeRead();
    const name = String(url).slice('/shader-profile-fixture/'.length);
    assert.match(name, /^[a-z]+\.(?:vert|frag)$/);
    return new Response(await fs.readFile(new URL(`../public/avatars/cubism-runtime/Shaders/WebGL/${name}`, import.meta.url)));
  });
  return () => count;
}
async function generate(shader) { shader.setShaderPath('/shader-profile-fixture/'); shader.generateShaders(); await waitForCubismShaders(shader); }
const baseSources = shader => shader._shaderSets.slice(0, 11).map(set => set.shaderProgram.shaders.map(item => ({ type: item.type, source: item.source })));
const standardModel = { isBlendModeEnabled: () => false, getOffscreenCount: () => 0 };

test('licensed V12 model uses only normal blending and has no offscreen surfaces', t => {
  assert.equal(core.Version.csmGetVersion(), 100663297); // 6.0.1, separate from SDK 5-r.5.
  assert.equal(model.isBlendModeEnabled(), false);
  assert.equal(model.getOffscreenCount(), 0);
  assert.ok(model.getDrawableCount() > 0);
  for (let i = 0; i < model.getDrawableCount(); i++) {
    assert.equal(model.getDrawableColorBlend(i), core.ColorBlendType_Normal);
    assert.equal(model.getDrawableAlphaBlend(i), 0);
  }
  t.diagnostic(JSON.stringify({ coreVersion: core.Version.csmGetVersion(), drawableCount: model.getDrawableCount(), offscreenCount: model.getOffscreenCount(), extendedBlendEnabled: model.isBlendModeEnabled() }));
});

test('actual pinned shader registration preserves every base shader while omitting unused expanded combinations', async t => {
  shaderFetch(t);
  const full = context(t), limited = context(t), colors = limited.shader._colorBlendValues;
  const profile = configureCubismShaderProfile(limited.shader, model); assert.equal(profile?.profile, 'standard');
  await Promise.all([generate(full.shader), generate(limited.shader)]);
  assert.equal(full.programs.length, 242); assert.equal(full.compiled.length, 484);
  assert.equal(full.shader._blendShaderSetMap.size, 79);
  assert.equal(limited.programs.length, 5); assert.equal(limited.compiled.length, 10);
  assert.equal(limited.shader._blendShaderSetMap.size, 0);
  assert.equal(limited.shader._colorBlendValues, colors);
  assert.deepEqual(baseSources(limited.shader), baseSources(full.shader));
  for (let i = 1; i < 4; i++) {
    assert.equal(limited.shader._shaderSets[i].shaderProgram, limited.shader._shaderSets[i + 3].shaderProgram);
    assert.equal(limited.shader._shaderSets[i].shaderProgram, limited.shader._shaderSets[i + 6].shaderProgram);
  }
  profile.dispose(); limited.release(); full.release();
  assert.equal(limited.deleted.size, 5); assert.equal(full.deleted.size, 242);
});

test('extended, offscreen, unknown and throwing model classifications keep the upstream full compiler', async t => {
  shaderFetch(t);
  for (const candidate of [
    { isBlendModeEnabled: () => true, getOffscreenCount: () => 0 },
    { isBlendModeEnabled: () => false, getOffscreenCount: () => 1 },
    {}, { isBlendModeEnabled() { throw Error('unknown classifier'); } },
  ]) {
    const instance = context(t), original = instance.shader.registerBlendShader;
    assert.equal(configureCubismShaderProfile(instance.shader, candidate), null);
    assert.equal(instance.shader.registerBlendShader, original);
    await generate(instance.shader); assert.equal(instance.programs.length, 242);
  }
});

test('fresh standard context guards cancellation and a late upstream callback after release', async t => {
  let resolve; const gate = new Promise(yes => { resolve = yes; }); const reads = shaderFetch(t, () => gate);
  const instance = context(t), abort = new AbortController();
  const profile = configureCubismShaderProfile(instance.shader, model, { signal: abort.signal });
  instance.shader.setShaderPath('/shader-profile-fixture/'); instance.shader.generateShaders();
  assert.equal(reads(), 13); assert.equal(instance.programs.length, 0);
  abort.abort(); profile.dispose(); profile.dispose(); instance.release(); resolve();
  await assert.rejects(waitForCubismShaders(instance.shader), /could not compile/);
  assert.equal(instance.shader._isShaderLoading, false);
  assert.equal(instance.programs.length, 0); assert.equal(instance.compiled.length, 0);
});

test('aborting without releasing also prevents delayed compiler allocation', async t => {
  shaderFetch(t); const instance = context(t), abort = new AbortController();
  configureCubismShaderProfile(instance.shader, model, { signal: abort.signal }); abort.abort();
  instance.shader.setShaderPath('/shader-profile-fixture/'); instance.shader.generateShaders();
  await assert.rejects(waitForCubismShaders(instance.shader), /could not compile/);
  assert.equal(instance.programs.length, 0); assert.equal(instance.shader._isShaderLoading, false);
});

test('shader errors still fail readiness and restore the original enum array', async t => {
  shaderFetch(t);
  const instance = context(t, { failLink: true }), colors = instance.shader._colorBlendValues;
  configureCubismShaderProfile(instance.shader, standardModel);
  await assert.rejects(generate(instance.shader), /could not compile/);
  assert.equal(instance.shader._colorBlendValues, colors);
  const throwing = context(t, { failAttribute: true }), originalColors = throwing.shader._colorBlendValues;
  configureCubismShaderProfile(throwing.shader, standardModel);
  // Reach the exact registerBlendShader failure path without running generate's
  // Promise catch so that the original exception and finally are observable.
  throwing.shader._shaderSets = Array.from({ length: 251 }, () => ({}));
  assert.throws(() => throwing.shader.registerBlendShader(), /attribute failure/);
  assert.equal(throwing.shader._colorBlendValues, originalColors);
});

test('unexpected API shape, already loading/loaded or already adapted instances remain untouched', t => {
  const changes = [
    shader => { shader._colorBlendValues = []; }, shader => { shader._alphaBlendValues = []; },
    shader => { shader._shaderCount = 252; }, shader => { shader._blendShaderSetMap.set('unknown', 11); },
    shader => { shader._isShaderLoading = true; }, shader => { shader._isShaderLoaded = true; },
    shader => { shader.registerBlendShader = () => {}; }, shader => Object.preventExtensions(shader),
  ];
  for (const change of changes) {
    const { shader } = context(t); change(shader); const method = shader.registerBlendShader;
    assert.equal(configureCubismShaderProfile(shader, standardModel), null); assert.equal(shader.registerBlendShader, method);
  }
  const { shader } = context(t); assert.ok(configureCubismShaderProfile(shader, standardModel));
  const method = shader.registerBlendShader; assert.equal(configureCubismShaderProfile(shader, standardModel), null);
  assert.equal(shader.registerBlendShader, method);
});
