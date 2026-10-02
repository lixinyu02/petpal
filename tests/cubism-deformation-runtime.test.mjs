import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { registerHooks } from 'node:module';
import { acquireCubismFramework, createCubismAvatar, createCubismFrameController, waitForCubismCore } from '../src/avatar/cubism/runtime.mjs';
import { createCubismParameterBridge, cubismParameterTargets } from '../src/avatar/cubism/parameters.mjs';

const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < .00001, `${actual} differs from ${expected}`);

test('smile intent controls eyelids independently of the iris squash channel and only the reviewed rig limits speech opening', () => {
  const smile = cubismParameterTargets({ eyeSmile: 1, speaking: true, mouthOpen: .9 });
  assert.equal(smile.ParamEyeBallForm, 0);
  assert.equal(smile.ParamEyeLSmile, 1);
  assert.equal(smile.ParamEyeRSmile, 1);
  assert.equal(smile.ParamMouthOpenY, .9);
  assert.equal(cubismParameterTargets({ speaking: true, mouthOpen: .9 }, {}, { deformationProfile: 'akari-stable' }).ParamMouthOpenY, .6);
  assert.equal(cubismParameterTargets({ speaking: false, mouthOpen: .9 }, {}, { deformationProfile: 'akari-stable' }).ParamMouthOpenY, 0);
});

// This surface permits the production factory to finish its resource loading.
// It does not render pixels or certify shader/visual quality; model creation,
// Framework, motions and the inspected native Core parameters remain real.
function factoryWebGlStub() {
  let sequence = 0, context;
  const enums = new Map([['NO_ERROR', 0]]);
  const object = () => ({ factoryStubObject: ++sequence });
  const methods = {
    createTexture: object, createFramebuffer: object, createBuffer: object,
    createShader: object, createProgram: object,
    getExtension: () => null,
    getParameter: name => name === context.MAX_TEXTURE_SIZE || name === context.MAX_RENDERBUFFER_SIZE ? 4096 : name === context.VIEWPORT ? [0, 0, 256, 384] : null,
    getShaderParameter: () => true, getProgramParameter: () => true,
    getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    checkFramebufferStatus: () => context.FRAMEBUFFER_COMPLETE,
    getAttribLocation: () => 0, getUniformLocation: object,
    getError: () => 0, isContextLost: () => false,
  };
  context = new Proxy(methods, { get(target, name) {
    if (name in target) return target[name];
    if (typeof name === 'string' && /^[A-Z_0-9]+$/u.test(name)) {
      if (!enums.has(name)) enums.set(name, enums.size + 1000);
      return enums.get(name);
    }
    return () => {};
  } });
  return context;
}

test('production avatar factory defaults to V11, keeps legacy limits, and isolates portrait controls from imported paths', async () => {
  const source = await fs.readFile(new URL('../public/vendor/live2d/live2dcubismcore.min.js', import.meta.url), 'utf8');
  const sandbox = { console, setTimeout, clearTimeout, TextDecoder, TextEncoder, atob, btoa, window: {}, document: { currentScript: { src: 'https://petpal.test/vendor/live2d/live2dcubismcore.min.js' } } };
  vm.runInNewContext(source, sandbox, { timeout: 2000 });
  const core = await waitForCubismCore(() => sandbox.Live2DCubismCore);
  const prior = { core: globalThis.Live2DCubismCore, fetch: globalThis.fetch, Image: globalThis.Image, WebGLBuffer: globalThis.WebGLBuffer };
  const fromMoc = core.Model.fromMoc, nativeModels = [], requests = [];
  const origin = 'https://petpal-factory.test';
  const frameworkUrl = `${origin}/avatars/cubism-runtime/framework.mjs`;
  // Remap only the official same-origin module URL to the same bundled
  // Framework bytes. The factory's URL/profile decisions are not replaced.
  const hooks = registerHooks({ resolve(specifier, context, next) {
    return next(specifier === frameworkUrl ? new URL('../public/avatars/cubism-runtime/framework.mjs', import.meta.url).href : specifier, context);
  } });
  globalThis.Live2DCubismCore = core;
  // The official renderer initializes its buffer slots through assignments to
  // the browser's WebGLBuffer global. Node has no corresponding global.
  globalThis.WebGLBuffer = null;
  core.Model.fromMoc = function(moc) { const model = fromMoc.call(this, moc); nativeModels.push(model); return model; };
  globalThis.fetch = async input => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.origin, origin, 'Factory resources must remain at the test origin');
    requests.push(url.pathname);
    // Give imported-path controls the exact bundled model bytes, so only the
    // production pathname classification differs from the built-in case.
    const pathname = url.pathname.replace(/^\/avatars\/user\/(akari-cubism-v(?:[6789]|10|11))\//u, '/avatars/$1/');
    assert.ok(pathname.startsWith('/avatars/') || pathname.startsWith('/vendor/'));
    const bytes = await fs.readFile(new URL(`../public${pathname}`, import.meta.url));
    return new Response(bytes, { headers: { 'Content-Length': String(bytes.length) } });
  };
  globalThis.Image = class {
    set src(value) {
      this.value = value;
      if (!value) return;
      // Read real PNG header dimensions from the Blob used by loadTexture.
      // Decoding/rendering the bitmap is outside this routing/parameter test.
      void prior.fetch(value).then(response => response.arrayBuffer()).then(bytes => {
        if (this.value !== value) return;
        const data = new DataView(bytes);
        this.naturalWidth = data.getUint32(16); this.naturalHeight = data.getUint32(20);
        this.onload?.();
      }).catch(() => this.onerror?.());
    }
    get src() { return this.value; }
  };
  let avatar;
  try {
    for (const [modelUrl, expected, requestedManifest, referenceLayered = false] of [
      [undefined, .9, '/avatars/akari-cubism-v11/akari.model3.json', true],
      ['/avatars/akari-cubism-v10/akari.model3.json', .9, '/avatars/akari-cubism-v10/akari.model3.json', true],
      ['/avatars/akari-cubism-v11/akari.model3.json', .9, '/avatars/akari-cubism-v11/akari.model3.json', true],
      ['/avatars/akari-cubism-v9/akari.model3.json', .9, '/avatars/akari-cubism-v9/akari.model3.json', true],
      ['/avatars/akari-cubism-v8/akari.model3.json', .9, '/avatars/akari-cubism-v8/akari.model3.json', true],
      ['/avatars/akari-cubism-v7/akari.model3.json', .9, '/avatars/akari-cubism-v7/akari.model3.json', true],
      ['/avatars/akari-cubism-v6/akari.model3.json', .6, '/avatars/akari-cubism-v6/akari.model3.json'],
      ['/avatars/akari-cubism-v5/akari.model3.json', .6, '/avatars/akari-cubism-v5/akari.model3.json'],
      ['/avatars/akari-cubism-v3/akari.model3.json', .6, '/avatars/akari-cubism-v3/akari.model3.json'],
      ['/avatars/akari-cubism-v4/akari.model3.json', .6, '/avatars/akari-cubism-v4/akari.model3.json'],
      ['/avatars/user/akari-cubism-v6/akari.model3.json', .9, '/avatars/user/akari-cubism-v6/akari.model3.json'],
      ['/avatars/user/akari-cubism-v7/akari.model3.json', .9, '/avatars/user/akari-cubism-v7/akari.model3.json'],
      ['/avatars/user/akari-cubism-v8/akari.model3.json', .9, '/avatars/user/akari-cubism-v8/akari.model3.json'],
      ['/avatars/user/akari-cubism-v9/akari.model3.json', .9, '/avatars/user/akari-cubism-v9/akari.model3.json'],
      ['/avatars/user/akari-cubism-v10/akari.model3.json', .9, '/avatars/user/akari-cubism-v10/akari.model3.json'],
      ['/avatars/user/akari-cubism-v11/akari.model3.json', .9, '/avatars/user/akari-cubism-v11/akari.model3.json'],
    ]) {
      const context = factoryWebGlStub(), location = new URL(`${origin}/`);
      const canvas = { width: 256, height: 384, ownerDocument: { defaultView: { Live2DCubismCore: core, location } }, getContext: type => { assert.equal(type, 'webgl2'); return context; } };
      const firstRequest = requests.length;
      avatar = await createCubismAvatar({ canvas, ...(modelUrl ? { modelUrl } : {}) });
      assert.equal(requests[firstRequest], requestedManifest);
      const model = nativeModels.at(-1), ids = Array.from(model.parameters.ids), mouth = ids.indexOf('ParamMouthOpenY');
      assert.ok(mouth >= 0);
      const read = name => {
        const index = ids.indexOf(name);
        assert.ok(index >= 0, `${name} must be a real Core parameter`);
        assert.ok(avatar.supportedParameters.includes(name), `${name} must be bound by the production bridge`);
        return model.parameters.values[index];
      };
      avatar.update(.1, { speaking: true, mouthOpen: .9, mouthShape: 'A' }, {});
      close(model.parameters.values[mouth], expected);
      const facialV10 = requestedManifest.includes('-v10/');
      const featuresV11 = requestedManifest.includes('-v11/');
      if (featuresV11) {
        assert.equal(ids.length, 22, 'V11 must expose its actual 22 native controls');
        close(read('ParamMouthA'), referenceLayered ? 1 : .9);
        assert.equal(read('ParamMouthO'), 0);
        for (const missing of ['ParamWarm', 'ParamSad', 'ParamPout', 'ParamShy', 'ParamSurprise', 'ParamRelaxed', 'ParamMouthForm']) {
          assert.equal(ids.includes(missing), false, 'V11 cannot simulate native controls with virtual parameter indices');
          assert.equal(avatar.supportedParameters.includes(missing), false);
        }
        avatar.update(.1, { eyeSmile: 1, blinkLeft: .4, blinkRight: .2, browRaise: .6, browTilt: .5,
          speaking: true, mouthOpen: .9, mouthShape: 'O' }, { gazeX: .7, gazeY: -.3 });
        close(read('ParamEyeLOpen'), referenceLayered ? .48 : .51);
        close(read('ParamEyeROpen'), referenceLayered ? .64 : .68);
        close(read('ParamEyeBallX'), .7); close(read('ParamEyeBallY'), -.3);
        close(read('ParamBrowLY'), .42); close(read('ParamBrowRY'), .42);
        close(read('ParamBrowLAngle'), .35); close(read('ParamBrowRAngle'), -.35);
        close(read('ParamMouthA'), referenceLayered ? 1 : 0);
        close(read('ParamMouthO'), referenceLayered ? 1 : .9);
      }
      if (/akari-cubism-v(?:[789]|10)\//u.test(requestedManifest)) {
        assert.equal(ids.length, facialV10 ? 22 : requestedManifest.includes('-v7/') ? 16 : 19, 'Reference MOC must expose only its real rig parameters');
        close(read('ParamMouthA'), referenceLayered ? 1 : .9);
        assert.equal(read('ParamMouthO'), 0);
        avatar.update(.1, { speaking: true, mouthOpen: .9, mouthShape: 'O' });
        close(read('ParamMouthA'), referenceLayered ? 1 : 0);
        close(read('ParamMouthO'), referenceLayered ? 1 : .9);
        close(read('ParamMouthOpenY'), .9);
        avatar.update(.1, { speaking: true, mouthOpen: .9, mouthShape: 'A', warmAmount: .8, sadAmount: .4, poutAmount: .6 });
        close(read('ParamWarm'), facialV10 && referenceLayered ? 1 : .8);
        close(read('ParamSad'), referenceLayered ? 0 : .4);
        close(read('ParamPout'), referenceLayered ? 0 : .6);
        if (facialV10) for (const [channel, parameter] of [['shyAmount', 'ParamShy'], ['surpriseAmount', 'ParamSurprise'], ['reliefAmount', 'ParamRelaxed']]) {
          avatar.update(.1, { [channel]: .7, speaking: true, mouthOpen: .9, mouthShape: 'O' });
          close(read(parameter), referenceLayered ? 1 : 0, `${parameter} must only use bundled portrait semantics`);
          for (const other of ['ParamWarm', 'ParamSad', 'ParamPout', 'ParamShy', 'ParamSurprise', 'ParamRelaxed'].filter(name => name !== parameter)) close(read(other), 0);
          close(read('ParamMouthOpenY'), .9);
        }
      }
      avatar.update(0, { speaking: false, voiceEnergy: 1 }, {});
      assert.equal(model.parameters.values[mouth], 0);
      if (featuresV11) {
        for (const name of ['ParamMouthA', 'ParamMouthO']) assert.equal(read(name), 0);
        avatar.update(0, { eyeSmile: 1, browRaise: 1, browTilt: 1, speaking: true, mouthOpen: 1, mouthShape: 'O' }, { gazeX: 1, gazeY: 1 }, { hidden: true });
        for (const name of ['ParamMouthOpenY', 'ParamMouthA', 'ParamMouthO', 'ParamEyeBallX', 'ParamEyeBallY', 'ParamBrowLY', 'ParamBrowRY', 'ParamBrowLAngle', 'ParamBrowRAngle']) assert.equal(read(name), 0);
        close(read('ParamEyeLOpen'), 1); close(read('ParamEyeROpen'), 1);
      }
      if (/akari-cubism-v(?:[789]|10)\//u.test(requestedManifest)) {
        const cleared = ['ParamMouthA', 'ParamMouthO', 'ParamWarm', 'ParamSad', 'ParamPout', ...(facialV10 ? ['ParamShy', 'ParamSurprise', 'ParamRelaxed'] : [])];
        for (const name of cleared) assert.equal(read(name), 0);
        for (const state of [{ hidden: true }, { sleeping: true }]) {
          avatar.update(0, { speaking: true, mouthOpen: .9, mouthShape: 'O', warmAmount: .8, sadAmount: .4, poutAmount: .6, shyAmount: 1, surpriseAmount: 1, reliefAmount: 1 }, {}, state);
          for (const name of ['ParamMouthOpenY', ...cleared]) assert.equal(read(name), 0);
        }
      }
      const cheek = ids.indexOf('ParamCheek');
      if (cheek >= 0) close(model.parameters.values[cheek], expected === .6 ? .16 : 0);
      avatar.update(0, {}, {}, { hidden: true });
      if (cheek >= 0) assert.equal(model.parameters.values[cheek], 0);
      avatar.release(); avatar = undefined;
    }
  } finally {
    avatar?.release(); hooks.deregister(); core.Model.fromMoc = fromMoc;
    globalThis.fetch = prior.fetch;
    if (prior.Image === undefined) delete globalThis.Image; else globalThis.Image = prior.Image;
    if (prior.WebGLBuffer === undefined) delete globalThis.WebGLBuffer; else globalThis.WebGLBuffer = prior.WebGLBuffer;
    if (prior.core === undefined) delete globalThis.Live2DCubismCore; else globalThis.Live2DCubismCore = prior.core;
  }
});

test('licensed Core and Framework keep reaction angles exclusive through outgoing fades and retain imported-model articulation', async () => {
  const source = await fs.readFile(new URL('../public/vendor/live2d/live2dcubismcore.min.js', import.meta.url), 'utf8');
  const sandbox = { console, setTimeout, clearTimeout, TextDecoder, TextEncoder, atob, btoa, window: {}, document: { currentScript: { src: 'https://petpal.test/vendor/live2d/live2dcubismcore.min.js' } } };
  vm.runInNewContext(source, sandbox, { timeout: 2000, filename: 'licensed-live2dcubismcore.min.js' });
  const core = await waitForCubismCore(() => sandbox.Live2DCubismCore);
  globalThis.Live2DCubismCore = core;
  const framework = await import('../public/avatars/cubism-runtime/framework.mjs');
  const lease = acquireCubismFramework(framework, core);
  const moc = buffer(await fs.readFile(new URL('../public/avatars/akari-cubism-v2/akari.moc3', import.meta.url)));
  let avatar;
  const create = () => {
    avatar = new framework.CubismUserModel(); avatar.loadModel(moc, true);
    const model = avatar.getModel();
    const bridge = createCubismParameterBridge(model, framework.CubismFramework.getIdManager());
    return { model, bridge };
  };
  try {
    let { model, bridge } = create();
    const motions = new Map();
    for (const [name, values] of [['TapHead_0', { ParamAngleX: -3, ParamAngleY: -4, ParamBodyAngleX: 1.2 }], ['Greet_0', { ParamAngleZ: 2 }]]) {
      const curves = Object.entries(values).map(([Id, value]) => ({ Target: 'Parameter', Id, Segments: [0, value, 0, 1.5, value] }));
      const bytes = new TextEncoder().encode(JSON.stringify({ Version: 3, Meta: { Duration: 1.5, Fps: 30, Loop: false, AreBeziersRestricted: true, CurveCount: curves.length, TotalSegmentCount: curves.length, TotalPointCount: curves.length * 2, UserDataCount: 0, TotalUserDataSize: 0 }, FadeInTime: .01, FadeOutTime: .25, Curves: curves })).buffer;
      const motion = avatar.loadMotion(bytes, bytes.byteLength, name);
      motion.setEffectIds([], []);
      motion.setFadeInTime(.01); motion.setFadeOutTime(.25);
      motions.set(name, { motion, parameters: new Set(Object.keys(values)) });
    }
    const controller = createCubismFrameController({ model, avatar, bridge, motions });
    const follow = { headX: 1, headY: 1, headTilt: 1, bodyXPercent: .65 };
    controller.react('pet');
    for (let frame = 0; frame < 6; frame++) controller.update(.1, { headShake: 1, headNod: 1, bodyTurn: 1 }, follow);
    close(bridge.read('ParamAngleX'), -3);
    close(bridge.read('ParamAngleY'), -4);
    close(bridge.read('ParamBodyAngleX'), 1.2);
    controller.react('greet');
    controller.update(.1, {}, follow);
    assert.equal(avatar._motionManager.getCubismMotionQueueEntries().length, 2);
    // The outgoing authored angle stays negative. A pointer add would change
    // it to a positive turn before its official fade completes.
    assert.ok(bridge.read('ParamAngleX') < 0);
    for (let frame = 0; frame < 5; frame++) controller.update(.1, {}, follow);
    assert.equal(avatar._motionManager.getCubismMotionQueueEntries().length, 1);
    close(bridge.read('ParamAngleX'), 12);
    close(bridge.read('ParamAngleZ'), 2);

    avatar.release(); ({ model, bridge } = create());
    const standard = createCubismFrameController({ model, avatar, bridge });
    standard.update(.1, { speaking: true, mouthOpen: .9, eyeSmile: 1 });
    close(bridge.read('ParamMouthOpenY'), .9);
    close(bridge.read('ParamEyeBallForm'), 0);
    avatar.release(); ({ model, bridge } = create());
    const stable = createCubismFrameController({ model, avatar, bridge, deformationProfile: 'akari-stable' });
    stable.update(.1, { speaking: true, mouthOpen: .9 });
    close(bridge.read('ParamMouthOpenY'), .6);
    stable.update(0, { speaking: false });
    assert.equal(bridge.read('ParamMouthOpenY'), 0);

    avatar.release(); ({ model, bridge } = create());
    const bytes = new TextEncoder().encode(JSON.stringify({ Type: 'Live2D Expression', FadeInTime: .01, FadeOutTime: .1, Parameters: [{ Id: 'ParamEyeBallForm', Value: -.35, Blend: 'Overwrite' }] })).buffer;
    const expressions = new Map([['authored', { motion: avatar.loadExpression(bytes, bytes.byteLength, 'authored'), parameters: new Set(['ParamEyeBallForm']) }]]);
    const authored = createCubismFrameController({ model, avatar, bridge, expressions });
    for (let frame = 0; frame < 6; frame++) authored.update(.1, { expression: 'authored', eyeSmile: 1 });
    close(bridge.read('ParamEyeBallForm'), -.35);
  } finally {
    avatar?.release(); lease.release(); delete globalThis.Live2DCubismCore;
  }
});
