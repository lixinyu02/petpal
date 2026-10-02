import test from 'node:test';
import assert from 'node:assert/strict';
import { createCubismParameterBridge, cubismParameterTargets } from '../src/avatar/cubism/parameters.mjs';
import { cubismLocalUrl, fetchCubismBytes, validateCubismModel } from '../src/avatar/cubism/resources.mjs';
import { acquireCubismFramework, waitForCubismShaders, waitForCubismCore } from '../src/avatar/cubism/runtime.mjs';

const root = 'https://example.test/avatars/akari-cubism/akari.model3.json';
const manifest = () => ({ Version: 3, FileReferences: { Moc: 'akari.moc3', Textures: ['textures/texture_00.png'], Physics: 'akari.physics3.json', Expressions: [{ Name: 'happy', File: 'expressions/happy.exp3.json' }], Motions: { Idle: [{ File: 'motions/idle.motion3.json' }] } } });

test('Cubism parameter bridge ignores Framework virtual indices and clamps real parameters', () => {
  const changes = [], indices = new Map([['ParamMouthOpenY', 0], ['ParamAngleX', 1]]);
  const bridge = createCubismParameterBridge({
    getParameterCount: () => 2,
    getParameterIndex: id => indices.get(id) ?? 12,
    getParameterMinimumValue: index => index ? -5 : 0,
    getParameterMaximumValue: index => index ? 5 : .8,
    setParameterValueByIndex: (index, value) => changes.push([index, value]),
  }, { getId: name => name });
  assert.deepEqual(new Set(bridge.supported), new Set(indices.keys()));
  bridge.apply({ ParamAngleX: 14, ParamMouthOpenY: 1, ParamEyeLOpen: .2 });
  bridge.apply({ ParamAngleX: 14, ParamMouthOpenY: 1 }, { mouthOnly: true });
  assert.deepEqual(changes, [[1, 5], [0, .8]]);
});

test('Cubism speech cancellation absolutely closes the mouth despite an existing model motion', () => {
  const speaking = { speaking: true, mouthOpen: .7, mouthShape: 'O' };
  assert.equal(cubismParameterTargets(speaking).ParamMouthOpenY, .7);
  assert.equal(cubismParameterTargets({ ...speaking, speaking: false }).ParamMouthOpenY, 0);
  assert.equal(cubismParameterTargets(speaking, {}, { hidden: true }).ParamMouthOpenY, 0);
  assert.equal(cubismParameterTargets(speaking, {}, { sleeping: true }).ParamMouthOpenY, 0);
  assert.equal(cubismParameterTargets(speaking, {}, { reducedMotion: true }).ParamMouthOpenY, .7);
});

test('Cubism reference mouth patches follow gated articulation without blending A/O or reopening silence', () => {
  const speaking = { speaking: true, mouthOpen: .7, mouthShape: 'A', voiceEnergy: 1 };
  for (const [shape, expectedA, expectedO] of [['A', .7, 0], ['E', .7, 0], ['O', 0, .7], ['M', 0, 0], ['rest', 0, 0], [undefined, .7, 0]]) {
    const targets = cubismParameterTargets({ ...speaking, mouthShape: shape });
    assert.equal(targets.ParamMouthA, expectedA, String(shape));
    assert.equal(targets.ParamMouthO, expectedO, String(shape));
    assert.equal(targets.ParamMouthOpenY, .7, 'legacy opening remains unchanged');
  }
  for (const mouthOpen of [0, .04, -1, NaN, Infinity]) {
    const targets = cubismParameterTargets({ ...speaking, mouthOpen });
    assert.equal(targets.ParamMouthA, 0); assert.equal(targets.ParamMouthO, 0);
  }
  const loud = cubismParameterTargets({ ...speaking, mouthOpen: 2 });
  assert.equal(loud.ParamMouthA, 1); assert.equal(loud.ParamMouthO, 0);
  for (const options of [{ hidden: true }, { sleeping: true }]) {
    const targets = cubismParameterTargets(speaking, {}, options);
    assert.equal(targets.ParamMouthA, 0); assert.equal(targets.ParamMouthO, 0);
  }
  const cancelled = cubismParameterTargets({ ...speaking, speaking: false });
  assert.equal(cancelled.ParamMouthA, 0); assert.equal(cancelled.ParamMouthO, 0);
  assert.equal(cubismParameterTargets(speaking, {}, { reducedMotion: true }).ParamMouthA, .7);
});

test('Cubism optional local expression layers bind only real parameters and reset while hidden or asleep', () => {
  const pose = { warmAmount: .6, sadAmount: .2, downcastAmount: .8, poutAmount: 2 };
  const targets = cubismParameterTargets(pose);
  assert.equal(targets.ParamWarm, .6); assert.equal(targets.ParamSad, .8); assert.equal(targets.ParamPout, 1);
  for (const options of [{ hidden: true }, { sleeping: true }]) {
    const quiet = cubismParameterTargets(pose, {}, options);
    assert.equal(quiet.ParamWarm, 0); assert.equal(quiet.ParamSad, 0); assert.equal(quiet.ParamPout, 0);
  }
  const invalid = cubismParameterTargets({ warmAmount: NaN, sadAmount: Infinity, poutAmount: -1 });
  assert.equal(invalid.ParamWarm, 0); assert.equal(invalid.ParamSad, 0); assert.equal(invalid.ParamPout, 0);
  const names = ['ParamWarm', 'ParamMouthA', 'ParamMouthO'], changes = [];
  const bridge = createCubismParameterBridge({
    getParameterCount: () => names.length,
    getParameterIndex: name => names.includes(name) ? names.indexOf(name) : names.length,
    getParameterMinimumValue: () => 0,
    getParameterMaximumValue: () => 1,
    setParameterValueByIndex: (index, value) => changes.push([names[index], value]),
  }, { getId: name => name });
  assert.deepEqual(new Set(bridge.supported), new Set(names));
  bridge.apply({ ...targets, ParamMouthA: .8, ParamMouthO: 0 });
  bridge.apply({ ...targets, ParamMouthA: .8, ParamMouthO: 0 }, { mouthOnly: true });
  assert.deepEqual(changes, [['ParamWarm', .6], ['ParamMouthA', .8], ['ParamMouthO', 0]]);
  assert.equal(bridge.read('ParamSad'), undefined); assert.equal(bridge.read('ParamPout'), undefined);
});

test('Cubism reference-layered expression patches choose one dominant channel without changing legacy Sad', () => {
  const options = { deformationProfile: 'reference-layered' };
  const expressions = targets => [targets.ParamWarm, targets.ParamSad, targets.ParamPout];
  assert.deepEqual(expressions(cubismParameterTargets({ warmAmount: .7, sadAmount: .4, poutAmount: .2 }, {}, options)), [.7, 0, 0]);
  assert.deepEqual(expressions(cubismParameterTargets({ warmAmount: .4, downcastAmount: .8, poutAmount: .2 }, {}, options)), [0, .8, 0]);
  assert.deepEqual(expressions(cubismParameterTargets({ warmAmount: .1, sadAmount: .4, poutAmount: .6 }, {}, options)), [0, 0, .6]);
  assert.deepEqual(expressions(cubismParameterTargets({ warmAmount: .4, sadAmount: .4, poutAmount: .4 }, {}, options)), [.4, 0, 0]);
  assert.deepEqual(expressions(cubismParameterTargets({}, {}, options)), [0, 0, 0]);
  assert.deepEqual(expressions(cubismParameterTargets({ warmAmount: .9, sadAmount: .6, poutAmount: .4 }, {}, { ...options, supportedParameters: ['ParamSad', 'ParamPout'] })), [0, .6, 0]);
  assert.deepEqual(expressions(cubismParameterTargets({ warmAmount: .7, sadAmount: .4, poutAmount: .2 })), [.7, .4, .2]);
  for (const state of [{ hidden: true }, { sleeping: true }]) {
    assert.deepEqual(expressions(cubismParameterTargets({ warmAmount: 1, sadAmount: 1, poutAmount: 1 }, {}, { ...options, ...state })), [0, 0, 0]);
  }
});

test('Cubism reference-layered mouth fully covers closed lips while keeping energy on local OpenY geometry', () => {
  const options = { deformationProfile: 'reference-layered' };
  const mouth = pose => {
    const targets = cubismParameterTargets(pose, {}, options);
    return [targets.ParamMouthA, targets.ParamMouthO, targets.ParamMouthOpenY];
  };
  const speaking = { speaking: true, mouthOpen: .06, mouthShape: 'A' };
  assert.deepEqual(mouth(speaking), [1, 0, .06]);
  assert.deepEqual(mouth({ ...speaking, mouthOpen: .8, mouthShape: 'O' }), [1, 1, .8]);
  assert.deepEqual(mouth({ ...speaking, mouthShape: 'E' }), [1, 0, .06]);
  assert.deepEqual(mouth({ ...speaking, mouthOpen: .04 }), [0, 0, .04]);
  assert.deepEqual(mouth({ ...speaking, mouthShape: 'M' }), [0, 0, .06]);
  assert.deepEqual(mouth({ ...speaking, mouthShape: 'rest' }), [0, 0, .06]);
  assert.deepEqual(mouth({ ...speaking, speaking: false, voiceEnergy: 1 }), [0, 0, 0]);
  for (const state of [{ hidden: true }, { sleeping: true }]) {
    const targets = cubismParameterTargets(speaking, {}, { ...options, ...state });
    assert.deepEqual([targets.ParamMouthA, targets.ParamMouthO, targets.ParamMouthOpenY], [0, 0, 0]);
  }
  const reduced = cubismParameterTargets(speaking, {}, { ...options, reducedMotion: true });
  assert.deepEqual([reduced.ParamMouthA, reduced.ParamMouthO, reduced.ParamMouthOpenY], [1, 0, .06]);
});

test('Cubism preserves world gaze axes, independent eye blinks and neutral reduced motion', () => {
  const pose = { speaking: false, blinkLeft: 1, blinkRight: 0, headNod: .5 };
  const follow = { headX: .5, headY: -.5, headTilt: .25, gazeX: .8, gazeY: -.8, breath: 1, breathScale: 1.12 };
  const targets = cubismParameterTargets(pose, follow);
  assert.equal(targets.ParamAngleX, 6); assert.equal(targets.ParamAngleY, -7);
  assert.equal(targets.ParamEyeBallY, -.8); assert.equal(targets.ParamEyeLOpen, 0); assert.equal(targets.ParamEyeROpen, 1);
  assert.equal(targets.ParamBreath, .6);
  const still = cubismParameterTargets(pose, follow, { reducedMotion: true });
  assert.equal(still.ParamAngleX, 0); assert.equal(still.ParamAngleY, 0); assert.equal(still.ParamEyeBallY, 0); assert.equal(still.ParamBreath, 0);
  assert.equal(cubismParameterTargets(pose, follow, { sleeping: true }).ParamEyeROpen, 0);
});

test('Cubism authored Nod/Shake own semantic pose while retaining independent gaze', () => {
  const pose = { headNod: .8, headShake: .7 }, follow = { headX: .3, headY: -.2 };
  assert.equal(cubismParameterTargets(pose, follow, { nativeMotion: 'Nod' }).ParamAngleY, -1.8);
  assert.ok(Math.abs(cubismParameterTargets(pose, follow, { nativeMotion: 'Shake' }).ParamAngleX - 3.6) < 1e-8);
});

test('Cubism built-in model accepts finite contained file references', () => {
  const resources = validateCubismModel(manifest(), root);
  assert.equal(resources.moc, 'https://example.test/avatars/akari-cubism/akari.moc3');
  assert.equal(resources.motions[0].group, 'Idle'); assert.equal(resources.expressions[0].name, 'happy');
});

test('Cubism blocks external, encoded and traversal model references', () => {
  for (const bad of ['../secret.moc3', '/secret.moc3', 'https://other.test/model.moc3', 'file:///model.moc3', '%2e%2e/model.moc3', 'model.moc3?token=1', 'model.moc3#x', 'dir\\model.moc3']) {
    assert.throws(() => cubismLocalUrl(bad, root));
    const model = manifest(); model.FileReferences.Moc = bad;
    assert.throws(() => validateCubismModel(model, root));
  }
  const sound = manifest(); sound.FileReferences.Motions.Idle[0].Sound = 'music.wav';
  assert.throws(() => validateCubismModel(sound, root), /independent audio/u);
});

test('Cubism rejects ambiguous and unbounded model packages', () => {
  const duplicate = manifest(); duplicate.FileReferences.Textures.push(duplicate.FileReferences.Textures[0]);
  assert.throws(() => validateCubismModel(duplicate, root));
  const duplicateExpression = manifest(); duplicateExpression.FileReferences.Expressions.push(duplicateExpression.FileReferences.Expressions[0]);
  assert.throws(() => validateCubismModel(duplicateExpression, root));
  const unbounded = manifest(); unbounded.FileReferences.Motions.Idle = Array(33).fill({ File: 'idle.motion3.json' });
  assert.throws(() => validateCubismModel(unbounded, root));
  const wrong = manifest(); wrong.Version = 2; assert.throws(() => validateCubismModel(wrong, root));
});

test('Cubism limits actual streamed bytes even when Content-Length is absent or understated', async () => {
  const fetcher = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8)); controller.enqueue(new Uint8Array(8)); controller.close(); } }), { headers: { 'Content-Length': '2' } });
  await assert.rejects(fetchCubismBytes(root, { fetcher, maxBytes: 10 }), /too large/u);
  const bytes = await fetchCubismBytes(root, { fetcher, maxBytes: 20 }); assert.equal(bytes.byteLength, 16);
  await assert.rejects(fetchCubismBytes(root, { fetcher: async () => new Response(null, { status: 404 }) }), /unavailable/u);
});

test('Cubism Framework lease only destroys globals after the last model and is idempotent', () => {
  const calls = [];
  const module = { CubismFramework: { startUp: () => { calls.push('start'); return true; }, initialize: () => calls.push('initialize'), isInitialized: () => true, dispose: () => calls.push('dispose'), cleanUp: () => calls.push('cleanUp') } };
  const first = acquireCubismFramework(module, {}), second = acquireCubismFramework(module, {});
  assert.deepEqual(calls, ['start', 'initialize']);
  first.release(); first.release(); assert.deepEqual(calls, ['start', 'initialize']);
  second.release(); assert.deepEqual(calls, ['start', 'initialize', 'dispose', 'cleanUp']);
  const third = acquireCubismFramework(module, {}); third.release();
  assert.deepEqual(calls.slice(4), ['start', 'initialize', 'dispose', 'cleanUp']);
});

test('Cubism does not report ready before asynchronous shaders finish', async () => {
  const shader = { _isShaderLoaded: false, _isShaderLoading: true, _shaderSets: [] };
  let ticks = 0;
  await waitForCubismShaders(shader, { now: () => ticks, schedule: callback => { if (++ticks === 3) { shader._isShaderLoaded = true; shader._shaderSets = [...Array.from({ length: 11 }, () => ({ shaderProgram: {} })), { shaderProgram: null }, { shaderProgram: null }, { shaderProgram: null }]; } callback(); } });
  assert.equal(ticks, 3);
  await assert.rejects(waitForCubismShaders({ _isShaderLoaded: true, _shaderSets: [{ shaderProgram: null }] }), /compile/u);
  await assert.rejects(waitForCubismShaders({ _isShaderLoaded: false, _isShaderLoading: false }), /initialize/u);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(waitForCubismShaders(shader, { signal: abort.signal }), { name: 'AbortError' });
});

test('Cubism waits for Core runtime exports and accepts independent Core 6 versioning', async () => {
  let ticks = 0;
  const core = { Version: { csmGetVersion() { if (ticks < 3) throw new Error('not ready'); return 0x06000001; }, csmGetLatestMocVersion: () => 6 }, Moc: {}, Model: {}, Memory: {} };
  assert.equal(await waitForCubismCore(() => core, { now: () => ticks, schedule: callback => { ticks++; callback(); } }), core);
  assert.equal(ticks, 3);
  await assert.rejects(waitForCubismCore(() => undefined, { timeoutMs: 1, now: () => ticks, schedule: callback => { ticks++; callback(); } }), /initialization failed/u);
});
