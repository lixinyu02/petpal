import { fetchCubismBytes, validateCubismModel } from './resources.mjs';
import { createCubismParameterBridge, cubismParameterTargets } from './parameters.mjs';

export const CUBISM_RUNTIME_ROOT = '/avatars/cubism-runtime/';
export const CUBISM_CORE_URL = '/vendor/live2d/live2dcubismcore.min.js';
const DEFAULT_MODEL = '/avatars/akari-cubism/akari.model3.json';
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
      expressions.set(item.name, motion);
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
    let expressionName = 'neutral', motionName = '', motionGroup = '', gestureName = 'none';
    const startMotion = group => {
      const chosen = [...motions.keys()].find(name => name.startsWith(`${group}_`));
      if (!chosen || chosen === motionName && !avatar._motionManager.isFinished()) return;
      avatar._motionManager.stopAllMotions();
      avatar._motionManager.startMotionPriority(motions.get(chosen).motion, false, group === 'Idle' ? 1 : 3);
      motionName = chosen; motionGroup = group;
    };
    return {
      mocVersion, coreVersion: core.Version.csmGetVersion(), supportedParameters: bridge.supported,
      get motionGroup() { return motionGroup; },
      update(dt, pose, follow, options = {}) {
        if (disposed || !initialized) return;
        const seconds = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, .1));
        const still = options.hidden || options.sleeping || options.reducedMotion;
        if (still) { avatar._motionManager.stopAllMotions(); avatar._expressionManager.stopAllMotions(); motionName = motionGroup = ''; expressionName = 'neutral'; gestureName = 'none'; }
        else if (pose.gesture !== gestureName) {
          gestureName = pose.gesture;
          if (gestureName === 'nod') startMotion('Nod');
          else if (gestureName === 'shake') startMotion('Shake');
        }
        if (!still && avatar._motionManager.isFinished()) startMotion('Idle');
        const targets = cubismParameterTargets(pose, follow, { ...options, nativeMotion: motionGroup });
        model.loadParameters();
        if (!still) avatar._motionManager.updateMotion(model, seconds);
        model.saveParameters();
        if (!still && pose.expression !== expressionName) {
          expressionName = pose.expression;
          const expression = expressions.get(expressionName) || expressions.get('neutral');
          avatar._expressionManager.stopAllMotions();
          if (expression) avatar._expressionManager.startMotion(expression, false);
        }
        if (!still) avatar._expressionManager.updateMotion(model, seconds);
        const own = !still ? motions.get(motionName)?.parameters : undefined;
        // Authored motion angles and gaze add together; a motion owning Nod or
        // Shake replaces that semantic cue, rather than applying it twice.
        const additive = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ'].filter(name => own?.has(name));
        const multiply = motionGroup !== 'Idle' && !still ? ['ParamEyeLOpen', 'ParamEyeROpen'].filter(name => own?.has(name)) : [];
        bridge.apply(targets, { additive, multiply });
        if (!still && avatar._physics) avatar._physics.evaluate(model, seconds);
        bridge.apply(targets, { mouthOnly: true });
        if (avatar._pose) avatar._pose.updateParameters(model, seconds);
        model.update();
      },
      react(kind) {
        if (disposed) return;
        const preferred = kind === 'pet' ? 'TapHead' : kind === 'greet' ? 'Greet' : 'Idle';
        startMotion([...motions.keys()].some(name => name.startsWith(`${preferred}_`)) ? preferred : kind === 'wake' ? 'Idle' : 'Nod');
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
