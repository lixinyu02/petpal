import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { createAvatarPerformance } from '../src/avatar/performance.mjs';
import { createAvatarPresence } from '../src/avatar/presence.mjs';
import { createCompanionActionState } from '../src/avatar/action-state.mjs';
import { animePoseTransform } from '../src/avatar/anime-pose-render.mjs';

// Execute the real TSX effect/frame. Only React lifecycle/DOM, rendering and
// asynchronous native readiness are controlled; the action state is real.
function createSceneHarness(props = {}) {
  const effects = [], frames = [], states = [], updates = [];
  const hooks = [], listeners = new Map();
  let hookIndex = 0, tree, currentProps = props;
  let finishLoad, failLoad, fallbackImports = 0;
  const Suspense = function Suspense() {}, AvatarLoading = function AvatarLoading() {};
  const attributes = new Map();
  const surface = {
    style: {}, dataset: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 480 }),
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: key => attributes.delete(key),
    getAttribute: key => attributes.get(key),
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type, callback) { if (listeners.get(type) === callback) listeners.delete(type); }, remove() {},
  };
  const container = { dataset: {}, appendChild() {}, getBoundingClientRect: surface.getBoundingClientRect };
  const globals = {
    document: { hidden: false, createElement: () => surface, addEventListener() {}, removeEventListener() {} },
    window: { addEventListener() {}, removeEventListener() {} },
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }),
  };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) globalThis[key] = value;
  const modules = {
    react: {
      lazy: loader => ({ loader }), Suspense,
      useRef(value) {
        const at = hookIndex++;
        if (!hooks[at]) hooks[at] = {ref:{current:value === null ? container : value}};
        return hooks[at].ref;
      },
      useState(value) {
        const at = hookIndex++;
        if (!hooks[at]) hooks[at] = {state:value};
        return [hooks[at].state, value => { hooks[at].state = value; }];
      },
      useEffect(callback, deps) {
        const at = hookIndex++, previous = hooks[at];
        if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) {
          effects.push(() => { previous?.cleanup?.(); hooks[at] = {deps, cleanup:callback()}; });
        }
      },
    },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '../AvatarLoading': { default: AvatarLoading },
    '../performance.mjs': { createAvatarPerformance },
    '../presence.mjs': { createAvatarPresence },
    '../action-state.mjs': { createCompanionActionState },
    '../scene-loop.mjs': {
      createVisibleSceneLoop: callback => { frames.push(callback); return { setActive() {}, dispose() {} }; },
      updateSceneDataset: (dataset, values) => Object.assign(dataset, values),
    },
    '../../pet/interaction.mjs': { bindCompanionGestures: () => Object.assign(() => {}, { refresh() {} }) },
    '../../pet/gesture-feedback.mjs': { createCompanionFeedback: () => ({ update() {}, dispose() {} }) },
    '../anime-pose-render.mjs': { animePoseTransform },
    './runtime.mjs': { createCubismAvatar: () => new Promise((resolve, reject) => { finishLoad = resolve; failLoad = reject; }) },
  };
  const source = fs.readFileSync(new URL('../src/avatar/cubism/CubismScene.tsx', import.meta.url), 'utf8')
    .replace(/const development = .*;/u, 'const development = false;');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    if (name === '../AnimeScene') { fallbackImports++; return {default:function AnimeScene(){}}; }
    return modules[name] || {};
  }, module, module.exports);
  const render = (nextProps = {}) => {
    currentProps = {...currentProps, ...nextProps}; hookIndex = 0; effects.length = 0;
    tree = module.exports.default({ ...currentProps, onState: state => states.push(state.action) });
    for (const effect of effects) effect();
  };
  render();
  return {
    get loading() { return tree.props.children[0]?.type === AvatarLoading; },
    get fallback() { return tree.props.children[0]?.type === Suspense ? tree.props.children[0].props.children : null; },
    get actionState() { return hooks.map(hook => hook?.ref?.current).find(value => typeof value?.consumeCommand === 'function'); },
    get fallbackImports() { return fallbackImports; },
    async loadFallback() { await this.fallback.type.loader(); },
    surface, states, updates,
    async resolveNative() {
      finishLoad({
        update(_dt, _pose, _follow, options) { updates.push(options); },
        render() {}, release() {}, react() {}, supportedParameters: [], motionGroup: 'Idle', mocVersion: 5, coreVersion: 6,
      });
      await new Promise(resolve => setImmediate(resolve));
      render();
    },
    async rejectNative() { failLoad(new Error('Isolated unavailable native fixture')); await new Promise(resolve => setImmediate(resolve)); render(); },
    frame(now) { frames.at(-1)(now); render(); },
    rebuild(nextProps) { render(nextProps); render(); },
    loseContext() { listeners.get('webglcontextlost')({preventDefault() {}}); render(); },
    retry() { tree.props.children[1].props.onClick(); render(); render(); },
    dispose() {
      for (const hook of hooks) hook?.cleanup?.();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test('native loading uses a static portrait and never loads the recovery renderer on success', async t => {
  const scene = createSceneHarness(); t.after(() => scene.dispose());
  assert.equal(scene.loading, true); assert.equal(scene.fallback, null); assert.equal(scene.fallbackImports, 0);
  const state = scene.actionState; state.transition('sleep');
  await scene.resolveNative(); scene.frame(100);
  assert.equal(scene.loading, false); assert.equal(scene.fallback, null); assert.equal(scene.fallbackImports, 0);
  assert.equal(scene.states.at(-1), 'sleep');
  assert.equal(scene.surface.dataset.petAction, 'sleep');
  assert.equal(scene.updates.at(-1).sleeping, true);
});

test('native readiness cannot replay a fallback sleep command after the user wakes it', async t => {
  const command = {id:7, action:'sleep'}, scene = createSceneHarness({command}); t.after(() => scene.dispose());
  const state = scene.actionState;
  assert.equal(state.consumeCommand(command.id), true);
  state.transition(command.action); state.transition('wake');
  await scene.resolveNative(); scene.frame(100);
  assert.equal(scene.surface.dataset.petAction, 'idle');
  assert.equal(scene.updates.at(-1).sleeping, false);
  assert.equal(scene.states.at(-1), 'idle');
});

test('native context loss hands the resting state to fallback and compact or interactive rebuilds retain that same intent', async t => {
  const scene = createSceneHarness(); t.after(() => scene.dispose());
  const state = scene.actionState;
  state.transition('sleep'); await scene.resolveNative(); scene.frame(100);
  scene.loseContext();
  assert.equal(scene.fallback.props.actionState, state);
  assert.equal(scene.fallback.props.actionState.snapshot().action, 'sleep');
  for (const props of [{compact:true}, {interactive:false}, {compact:false,interactive:true}]) {
    scene.rebuild(props);
    assert.equal(scene.loading, true); assert.equal(scene.actionState, state);
    assert.equal(state.snapshot().action, 'sleep');
    await scene.resolveNative(); scene.frame(100);
    assert.equal(scene.surface.dataset.petAction, 'sleep');
    assert.equal(scene.states.at(-1), 'sleep');
  }
});

test('pending commands wait for native readiness and are not replayed after recovery', async t => {
  const scene = createSceneHarness({command:{id:1,action:'sleep'}}); t.after(() => scene.dispose());
  assert.equal(scene.actionState.snapshot().action, 'idle');
  await scene.resolveNative(); scene.frame(100); assert.equal(scene.surface.dataset.petAction, 'sleep');
  scene.loseContext(); await scene.loadFallback(); assert.equal(scene.fallbackImports, 1);
  scene.actionState.transition('wake'); scene.retry();
  assert.equal(scene.loading, true); assert.equal(scene.fallback, null);
  await scene.resolveNative(); scene.frame(100);
  assert.equal(scene.surface.dataset.petAction, 'idle');
});

test('native rejection loads recovery only on demand and manual retry preserves rest', async t => {
  const scene = createSceneHarness(); t.after(() => scene.dispose());
  assert.equal(scene.fallbackImports, 0);
  await scene.rejectNative(); assert.ok(scene.fallback); await scene.loadFallback();
  assert.equal(scene.fallbackImports, 1);
  const shared = scene.fallback.props.actionState; shared.transition('sleep');
  scene.retry(); assert.equal(scene.loading, true); assert.equal(scene.actionState, shared);
  await scene.resolveNative(); scene.frame(100);
  assert.equal(scene.surface.dataset.petAction, 'sleep'); assert.equal(scene.updates.at(-1).sleeping, true);
});
