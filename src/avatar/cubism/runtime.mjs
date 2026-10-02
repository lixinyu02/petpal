import { fetchCubismBytes, validateCubismModel } from './resources.mjs';
import { createCubismParameterBridge, cubismParameterTargets } from './parameters.mjs';

export const CUBISM_RUNTIME_ROOT = '/avatars/cubism-runtime/';
export const CUBISM_CORE_URL = '/vendor/live2d/live2dcubismcore.min.js';
const DEFAULT_MODEL = '/avatars/akari-cubism-v7/akari.model3.json';
const FRAMEWORK_EXPORTS = ['CubismFramework', 'CubismModelSettingJson', 'CubismMoc', 'CubismUserModel', 'CubismMatrix44', 'CubismShaderManager_WebGL', 'releaseCubismContext'];
let corePromise, modulePromise;
const runtimes = new WeakMap();
const stopped = signal => { if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError'); };
const parseJson = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));

function localRuntimeUrl(path, location, prefix = CUBISM_RUNTIME_ROOT) {
  const url = new URL(path, location.href);
  if (url.origin !== location.origin || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(prefix)) throw new Error('Cubism runtime must be bundled at the same origin.');
  return url.href;
}

/** Shared singleton lifetime; individual canvases must never dispose another model. */
export function acquireCubismFramework(module, core) {
  const framework = module.CubismFramework;
  let state = runtimes.get(framework);
  if (!state) {
    if (!framework.startUp()) throw new Error('Cubism Framework startup failed.');
    framework.initialize(32 * 1024 * 1024);
    if (!framework.isInitialized()) throw new Error('Cubism Framework initialization failed.');
    state = { references: 0 }; runtimes.set(framework, state);
  }
  state.references++;
  let released = false;
  return {
    core,
    release() {
      if (released) return; released = true;
      if (--state.references === 0) {
        try { framework.dispose(); } finally { framework.cleanUp(); runtimes.delete(framework); }
      }
    },
  };
}

function validateCore(core) {
  if (!core?.Version || !core.Moc || !core.Model || !core.Memory) throw new Error('Cubism Core is not installed.');
  const version = core.Version.csmGetVersion(), latest = core.Version.csmGetLatestMocVersion();
  // SDK/Editor and Core have independent major versions (5-r.5 ships Core 6.0).
  if (!Number.isInteger(version) || version <= 0 || !Number.isInteger(latest) || latest < 6) throw new Error('Cubism 5.3 compatible Core is required.');
  return core;
}

/** Script.onload means wrapper readiness. Embedded runtime exports can settle later. */
export async function waitForCubismCore(getCore, { timeoutMs = 3000, now = () => performance.now(), schedule = callback => setTimeout(callback, 16) } = {}) {
  const deadline = now() + timeoutMs;
  let lastError;
  for (;;) {
    try { return validateCore(getCore()); } catch (error) { lastError = error; }
    if (now() > deadline) throw new Error(`Cubism Core initialization failed: ${lastError instanceof Error ? lastError.message : 'timeout'}`);
    await new Promise(resolve => schedule(resolve));
  }
}

async function loadCore({ document, window, coreUrl, timeoutMs = 2500 }) {
  if (window.Live2DCubismCore) return waitForCubismCore(() => window.Live2DCubismCore);
  if (!corePromise) {
    corePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let done = false;
      const finish = error => {
        if (done) return; done = true;
        clearTimeout(timer); script.onload = script.onerror = null;
        if (error) { script.remove(); reject(error); }
        else resolve();
      };
      const timer = setTimeout(() => finish(new Error('Cubism Core loading timed out.')), timeoutMs);
      script.async = true; script.src = coreUrl;
      script.dataset.cubismRuntime = 'core';
      script.onload = () => finish(); script.onerror = () => finish(new Error('Cubism Core is unavailable.'));
      document.head.appendChild(script);
    }).then(() => waitForCubismCore(() => window.Live2DCubismCore)).catch(error => { corePromise = undefined; throw error; });
  }
  return corePromise;
}

async function loadFramework(url) {
  if (!modulePromise) modulePromise = import(/* @vite-ignore */ url).then(module => {
    for (const name of FRAMEWORK_EXPORTS) if (!module[name]) throw new Error(`Cubism Framework export missing: ${name}`);
    return module;
  }).catch(error => { modulePromise = undefined; throw error; });
  return modulePromise;
}

/** Official 5-r.5 shaders are asynchronous; readiness is not texture readiness. */
export async function waitForCubismShaders(shader, { signal, timeoutMs = 8000, now = () => performance.now(), schedule = callback => setTimeout(callback, 16) } = {}) {
  const deadline = now() + timeoutMs;
  while (!shader._isShaderLoaded) {
    stopped(signal);
    if (now() > deadline || !shader._isShaderLoading) throw new Error('Cubism shaders did not initialize.');
    await new Promise(resolve => schedule(resolve));
  }
  stopped(signal);
  // A network HTML error can be returned as shader text; require actual linked programs.
  // 5-r.5 reserves Normal+Over's three blend slots, then intentionally skips
  // them because programs 1..3 serve that combination. Trailing slots are empty.
  // Check the standard programs and the actual registered blend map instead.
  const required = new Set(Array.from({ length: 11 }, (_, index) => index));
  for (const base of shader._blendShaderSetMap?.values() || []) for (let offset = 0; offset < 3; offset++) required.add(base + offset);
  if (!Array.isArray(shader._shaderSets) || [...required].some(index => !shader._shaderSets[index]?.shaderProgram)) throw new Error('Cubism shaders could not compile.');
}

async function loadTexture(gl, url, signal) {
  const bytes = await fetchCubismBytes(url, { signal, maxBytes: 12 * 1024 * 1024 });
  stopped(signal);
  const blob = new Blob([bytes], { type: url.endsWith('.webp') ? 'image/webp' : 'image/png' });
  const objectUrl = URL.createObjectURL(blob), image = new Image();
  let texture;
  try {
    await new Promise((resolve, reject) => {
      const cancel = () => { image.src = ''; reject(signal.reason || new DOMException('Aborted', 'AbortError')); };
      image.onload = () => { signal?.removeEventListener('abort', cancel); resolve(); };
      image.onerror = () => { signal?.removeEventListener('abort', cancel); reject(new Error('Cubism texture decoding failed.')); };
      if (signal) signal.addEventListener('abort', cancel, { once: true });
      image.src = objectUrl;
    });
    stopped(signal);
    const limit = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    if (image.naturalWidth < 1 || image.naturalHeight < 1 || image.naturalWidth > limit || image.naturalHeight > limit) throw new Error('Cubism texture dimensions exceed this device limit.');
    texture = gl.createTexture();
    if (!texture) throw new Error('Cubism texture allocation failed.');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  } catch (error) { if (texture) gl.deleteTexture(texture); throw error; }
  finally { image.onload = image.onerror = null; URL.revokeObjectURL(objectUrl); }
}

const ANGLES = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ'];
const GAZE = ['ParamEyeBallX', 'ParamEyeBallY'];
const EYELIDS = ['ParamEyeLOpen', 'ParamEyeROpen'];
const FACE = ['ParamEyeLSmile', 'ParamEyeRSmile', 'ParamEyeBallForm', 'ParamBrowLY', 'ParamBrowRY', 'ParamBrowLAngle', 'ParamBrowRAngle', 'ParamCheek', 'ParamTear', 'ParamExcited', 'ParamSad', 'ParamShoulderY'];

/** Owns frame composition independently of WebGL, using the official queues. */
export function createCubismFrameController({ model, avatar, bridge, motions = new Map(), expressions = new Map(), deformationProfile = 'standard' }) {
  let expressionName = '', motionName = '', motionGroup = '', gestureName = 'none', muted = false, mouthForm = 0;
  const motionRecords = new Map([...motions.entries()].map(([name, record]) => [record.motion, { ...record, group: name.slice(0, name.lastIndexOf('_')) }]));
  const expressionRecords = new Map([...expressions.values()].map(record => [record.motion, record]));
  // Capture neutral once. Persisting each animated frame into the next frame's
  // baseline leaves interrupted sparse curves behind and recursively amplifies
  // fades. Expressions and physics must also never enter that neutral baseline.
  model.saveParameters();
  const stop = manager => {
    // The pinned Framework's stopAllMotions splices while iterating. A second
    // crossfading entry can survive its first pass, so clear the bounded queue.
    for (let pass = 0; pass < 64 && !manager.isFinished(); pass++) manager.stopAllMotions();
  };
  const active = (manager, records, fallback) => {
    const entries = manager.getCubismMotionQueueEntries?.();
    if (!entries) return manager.isFinished() || !fallback ? [] : [fallback];
    return entries.map(entry => records.get(entry?.getCubismMotion?.())).filter(Boolean);
  };
  const startMotion = group => {
    const chosen = [...motions.keys()].find(name => name.startsWith(`${group}_`));
    if (muted || !chosen || chosen === motionName && !avatar._motionManager.isFinished()) return;
    // startMotionPriority asks the outgoing queue entries to fade out. Stopping
    // the queue here would discard their authored transition immediately.
    avatar._motionManager.startMotionPriority(motions.get(chosen).motion, false, group === 'Idle' ? 1 : 3);
    motionName = chosen; motionGroup = group;
  };
  return {
    get motionGroup() { return motionGroup; },
    update(dt, pose = {}, follow = {}, options = {}) {
      const seconds = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, .1));
      const still = Boolean(options.hidden || options.sleeping || options.reducedMotion);
      if (still) {
        if (!muted) { stop(avatar._motionManager); stop(avatar._expressionManager); }
        motionName = motionGroup = expressionName = ''; gestureName = 'none';
      }
      muted = still;
      if (!still && pose.gesture !== gestureName) {
        gestureName = pose.gesture;
        // A user interaction must not be replaced by the performance controller's
        // nod in the same frame. Consume that cue rather than replaying it later.
        const interacting = (motionGroup === 'TapHead' || motionGroup === 'Greet') && !avatar._motionManager.isFinished();
        if (!interacting && gestureName === 'nod') startMotion('Nod');
        else if (!interacting && gestureName === 'shake') startMotion('Shake');
      }
      if (!still && avatar._motionManager.isFinished()) startMotion('Idle');
      model.loadParameters();
      const referencePortrait = deformationProfile === 'reference-layered';
      // Only a pure idle queue gets the slower clock; an outgoing reaction
      // keeps its authored timing through the end of its fade.
      const previousLayers = active(avatar._motionManager, motionRecords, motionRecords.get(motions.get(motionName)?.motion));
      const pureIdleClock = referencePortrait && previousLayers.length > 0 && previousLayers.every(record => record.group === 'Idle');
      if (!still) avatar._motionManager.updateMotion(model, seconds * (pureIdleClock ? .75 : 1));
      if (!still) {
        const resolved = expressions.has(pose.expression) ? pose.expression : expressions.has('neutral') ? 'neutral' : '';
        if (resolved !== expressionName) {
          expressionName = resolved;
          const expression = expressions.get(resolved);
          if (expression) avatar._expressionManager.startMotion(expression.motion, false);
          else stop(avatar._expressionManager);
        }
        avatar._expressionManager.updateMotion(model, seconds);
      }
      const motionLayers = still ? [] : active(avatar._motionManager, motionRecords, motionRecords.get(motions.get(motionName)?.motion));
      const expressionLayers = still ? [] : active(avatar._expressionManager, expressionRecords, expressions.get(expressionName));
      const pureIdle = referencePortrait && motionLayers.length > 0 && motionLayers.every(record => record.group === 'Idle');
      if (pureIdle) bridge.apply(Object.fromEntries(ANGLES.map(name => [name, Number.isFinite(bridge.read(name)) ? bridge.read(name) * .7 : undefined])));
      const own = new Set([...motionLayers, ...expressionLayers].flatMap(record => [...record.parameters]));
      // The live performance already schedules natural blinks. Multiplying
      // another idle blink into it produces double blinks and long closures.
      // Preserve the authored eyelids of reactions (including outgoing fades).
      const reactionEyes = new Set(motionLayers.filter(record => record.group !== 'Idle').flatMap(record => [...record.parameters]));
      const nativeReactionParameters = new Set(motionLayers.filter(record => record.group !== 'Idle').flatMap(record => [...record.parameters]).filter(name => ANGLES.includes(name)));
      const reaction = motionLayers.find(record => record.group !== 'Idle')?.group || '';
      const targets = cubismParameterTargets(pose, follow, { ...options, nativeMotion: reaction || motionGroup, nativeParameters: [...own], nativeReactionParameters, supportedParameters: bridge.supported, deformationProfile });
      bridge.apply(targets, {
        additive: [...ANGLES, ...GAZE].filter(name => own.has(name)),
        multiply: EYELIDS.filter(name => own.has(name) && (!referencePortrait || reactionEyes.has(name))),
        dominant: FACE.filter(name => own.has(name)),
        preserve: [...(own.has('ParamBreath') ? ['ParamBreath'] : []), ...(own.has('ParamEyeBallForm') ? ['ParamEyeBallForm'] : [])],
      });
      if (!still && avatar._physics) avatar._physics.evaluate(model, seconds);
      if (avatar._pose) avatar._pose.updateParameters(model, seconds);
      let form = targets.ParamMouthForm;
      // Quiet smiles in real gesture/expression curves remain visible, but a
      // speaking mouth belongs exclusively to the live articulation controller.
      if (!still && !pose.speaking && own.has('ParamMouthForm')) {
        const authored = bridge.read('ParamMouthForm');
        if (Number.isFinite(authored) && Math.abs(authored) > Math.abs(form)) form = authored;
      }
      // Only categorical mouth shape needs this short transition. Gaze and
      // emotion channels already have their own smoothing; blinking stays sharp.
      mouthForm = still ? form : mouthForm + (form - mouthForm) * (1 - Math.exp(-seconds * 28));
      bridge.apply({ ...targets, ParamMouthForm: mouthForm }, { mouthOnly: true });
      model.update();
    },
    react(kind) {
      if (muted) return;
      const preferred = kind === 'pet' ? 'TapHead' : kind === 'greet' ? 'Greet' : 'Idle';
      startMotion([...motions.keys()].some(name => name.startsWith(`${preferred}_`)) ? preferred : kind === 'wake' ? 'Idle' : 'Nod');
    },
  };
}

/** Uses real Cubism Core/Framework only. Missing runtime returns a rejected load for safe fallback. */
export async function createCubismAvatar({ canvas, modelUrl = DEFAULT_MODEL, signal, compact = false }) {
  const document = canvas.ownerDocument, window = document.defaultView;
  if (!window) throw new Error('Cubism window is unavailable.');
  const location = window.location;
  const modelPath = new URL(modelUrl, location.href);
  if (modelPath.origin !== location.origin || !modelPath.pathname.startsWith('/avatars/')) throw new Error('Cubism model must be bundled at the same origin.');
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: !compact, powerPreference: 'low-power', preserveDrawingBuffer: false });
  if (!gl) throw new Error('Cubism requires WebGL2.');
  const coreUrl = localRuntimeUrl(CUBISM_CORE_URL, location, '/vendor/live2d/');
  const frameworkUrl = localRuntimeUrl(`${CUBISM_RUNTIME_ROOT}framework.mjs`, location);
  let lease, avatar, module, disposed = false, initialized = false;
  const textures = [], motions = new Map(), expressions = new Map();
  const release = () => {
    if (disposed) return; disposed = true;
    try {
      avatar?.release();
      for (const texture of textures) gl.deleteTexture(texture);
      textures.length = 0; motions.clear(); expressions.clear();
    } finally {
      try { if (module && lease) module.releaseCubismContext(gl); }
      finally { lease?.release(); gl.getExtension('WEBGL_lose_context')?.loseContext(); }
    }
  };
  try {
    const core = await loadCore({ document, window, coreUrl }); stopped(signal);
    const framework = await loadFramework(frameworkUrl); module = framework; stopped(signal);
    lease = acquireCubismFramework(framework, core);
    const bytes = await fetchCubismBytes(modelPath.href, { signal, maxBytes: 256 * 1024 });
    const manifest = parseJson(bytes), resources = validateCubismModel(manifest, modelPath.href);
    const setting = new framework.CubismModelSettingJson(bytes, bytes.byteLength);
    const moc = await fetchCubismBytes(resources.moc, { signal, maxBytes: 24 * 1024 * 1024 });
    const mocVersion = core.Version.csmGetMocVersion(moc);
    if (!Number.isInteger(mocVersion) || mocVersion < 1 || mocVersion > core.Version.csmGetLatestMocVersion()) throw new Error('Cubism model MOC version is unsupported.');
    if (!framework.CubismMoc.hasMocConsistency(moc)) throw new Error('Cubism model failed the official MOC consistency check.');
    stopped(signal);
    avatar = new framework.CubismUserModel(); avatar.loadModel(moc, true);
    const model = avatar.getModel();
    if (!model || !Number.isFinite(model.getCanvasWidth()) || model.getCanvasWidth() <= 0 || model.getCanvasHeight() <= 0) throw new Error('Cubism model creation failed.');
    const bridge = createCubismParameterBridge(model, framework.CubismFramework.getIdManager());
    if (!bridge.supported.includes('ParamMouthOpenY')) throw new Error('Cubism model has no real mouth parameter.');
    if (resources.optional.Physics) { const buffer = await fetchCubismBytes(resources.optional.Physics, { signal, maxBytes: 1024 * 1024 }); avatar.loadPhysics(buffer, buffer.byteLength); }
    if (resources.optional.Pose) { const buffer = await fetchCubismBytes(resources.optional.Pose, { signal, maxBytes: 256 * 1024 }); avatar.loadPose(buffer, buffer.byteLength); }
    // Sequential bounded loading avoids decoding every optional motion at once on mobile.
    for (const item of resources.expressions) {
      const buffer = await fetchCubismBytes(item.url, { signal, maxBytes: 256 * 1024 });
      const motion = avatar.loadExpression(buffer, buffer.byteLength, item.name);
      if (!motion) throw new Error(`Cubism expression could not load: ${item.name}`);
      const json = parseJson(buffer);
      expressions.set(item.name, { motion, parameters: new Set((json.Parameters || []).map(parameter => parameter.Id)) });
    }
    if (expressions.size && !expressions.has('neutral')) {
      // An empty official expression fades named expressions back to the base
      // face without inventing parameters or stopping their outgoing curves.
      const buffer = new TextEncoder().encode(JSON.stringify({ Type: 'Live2D Expression', FadeInTime: .25, FadeOutTime: .25, Parameters: [] })).buffer;
      const motion = avatar.loadExpression(buffer, buffer.byteLength, 'neutral');
      if (!motion) throw new Error('Cubism neutral expression could not load.');
      expressions.set('neutral', { motion, parameters: new Set() });
    }
    for (const item of resources.motions) {
      const buffer = await fetchCubismBytes(item.url, { signal, maxBytes: 1024 * 1024 });
      const motion = avatar.loadMotion(buffer, buffer.byteLength, `${item.group}_${item.index}`, undefined, undefined, setting, item.group, item.index, true);
      if (!motion) throw new Error(`Cubism motion could not load: ${item.group}`);
      // CubismMotion initializes these arrays to null. Even a motion with no
      // model-wide curves requires caller-provided effect IDs before first update.
      motion.setEffectIds(Array.from({ length: setting.getEyeBlinkParameterCount() }, (_, index) => setting.getEyeBlinkParameterId(index)),
        Array.from({ length: setting.getLipSyncParameterCount() }, (_, index) => setting.getLipSyncParameterId(index)));
      const json = parseJson(buffer);
      motions.set(`${item.group}_${item.index}`, { motion, parameters: new Set((json.Curves || []).filter(curve => curve.Target === 'Parameter').map(curve => curve.Id)) });
    }
    stopped(signal);
    avatar.createRenderer(Math.max(1, canvas.width), Math.max(1, canvas.height), 1);
    const renderer = avatar.getRenderer(); renderer.startUp(gl);
    renderer.setIsPremultipliedAlpha(true);
    for (let index = 0; index < resources.textures.length; index++) {
      const texture = await loadTexture(gl, resources.textures[index], signal); textures.push(texture); renderer.bindTexture(index, texture);
    }
    const shaderPath = localRuntimeUrl(`${CUBISM_RUNTIME_ROOT}Shaders/WebGL/`, location);
    renderer.loadShaders(shaderPath);
    await waitForCubismShaders(framework.CubismShaderManager_WebGL.getInstance().getShader(gl), { signal });
    stopped(signal); initialized = true;
    const matrix = new framework.CubismMatrix44();
    const modelMatrix = avatar.getModelMatrix();
    // Contain the authored canvas, independently of the author's layout defaults.
    const canvasInfo = model.getModel().canvasinfo;
    const authoredScale = 2 / model.getCanvasWidth();
    modelMatrix.setWidth(2);
    // Cubism vertices already subtract the authored canvas origin. centerX/Y()
    // assumes 0..width and would incorrectly move this centered MOC off-screen.
    modelMatrix.setPosition(-(canvasInfo.CanvasWidth / 2 - canvasInfo.CanvasOriginX) / canvasInfo.PixelsPerUnit * authoredScale,
      -(canvasInfo.CanvasOriginY - canvasInfo.CanvasHeight / 2) / canvasInfo.PixelsPerUnit * authoredScale);
    // A user-supplied model must never inherit limits from its file name or
    // supported parameter IDs. Only this bundled, reviewed model opts in.
    const deformationProfile = modelPath.pathname === '/avatars/akari-cubism-v7/akari.model3.json' ? 'reference-layered'
      : ['/avatars/akari-cubism-v3/akari.model3.json', '/avatars/akari-cubism-v4/akari.model3.json', '/avatars/akari-cubism-v5/akari.model3.json', '/avatars/akari-cubism-v6/akari.model3.json'].includes(modelPath.pathname) ? 'akari-stable' : 'standard';
    const controller = createCubismFrameController({ model, avatar, bridge, motions, expressions, deformationProfile });
    return {
      mocVersion, coreVersion: core.Version.csmGetVersion(), supportedParameters: bridge.supported,
      get motionGroup() { return controller.motionGroup; },
      update(dt, pose, follow, options = {}) {
        if (disposed || !initialized) return;
        controller.update(dt, pose, follow, options);
      },
      react(kind) {
        if (disposed) return;
        controller.react(kind);
      },
      render() {
        if (disposed || gl.isContextLost()) throw new Error('Cubism WebGL context was lost.');
        const width = Math.max(1, canvas.width), height = Math.max(1, canvas.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        matrix.loadIdentity();
        // Orthographic contain: model width 2, proportion from authored canvas.
        const authoredHeight = 2 * model.getCanvasHeight() / model.getCanvasWidth();
        const scale = Math.min(.92, (2 * height / width) / authoredHeight * .96);
        matrix.scale(scale, scale * width / height); matrix.multiplyByMatrix(modelMatrix);
        renderer.setMvpMatrix(matrix); renderer.setRenderState(null, [0, 0, width, height]); renderer.drawModel(shaderPath);
        if (gl.getError() !== gl.NO_ERROR) throw new Error('Cubism rendering reported a WebGL error.');
      },
      release,
    };
  } catch (error) {
    if (import.meta.env?.DEV) console.error('PetPal Cubism initialization failed:', error);
    release(); throw error;
  }
}
