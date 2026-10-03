import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as executionHosts from '../src/execution-host-picker.mjs';

const source = ts.transpileModule(await readFile(new URL('../src/WorkspaceControls.tsx', import.meta.url), 'utf8'), {
  fileName: 'WorkspaceControls.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children)];
const providers = [
  { id: 'one', name: '模型一', model: 'model-one', protocol: 'responses' },
  { id: 'two', name: '模型二', model: 'model-two', protocol: 'responses' },
];

/** Exercise the real component, layout effects and input handlers with isolated browser focus. */
function pickerFixture({ width = 412, disabled = false, available = providers } = {}) {
  const hooks = [], effects = [], focusCalls = [], changes = [], frames = new Map();
  const document = new EventTarget(), window = new EventTarget();
  let index = 0, tree, frameId = 0;
  const element = (type, props) => ({ type, props });
  const same = (left, right) => left && right && left.length === right.length && left.every((value, i) => Object.is(value, right[i]));
  const react = {
    useState(initial) { const at = index++; hooks[at] ||= { state: typeof initial === 'function' ? initial() : initial }; return [hooks[at].state, value => { hooks[at].state = typeof value === 'function' ? value(hooks[at].state) : value; }]; },
    useRef(initial) { const at = index++; hooks[at] ||= { ref: { current: initial } }; return hooks[at].ref; },
    useId() { const at = index++; hooks[at] ||= { id: `model-fixture-${at}` }; return hooks[at].id; },
    useMemo(callback, deps) { const at = index++; if (!same(hooks[at]?.deps, deps)) hooks[at] = { deps, value: callback() }; return hooks[at].value; },
    useEffect(effect, deps) { const at = index++, previous = hooks[at]; if (!same(previous?.deps, deps)) effects.push(() => { previous?.cleanup?.(); hooks[at] = { deps, cleanup: effect() }; }); },
  };
  react.useLayoutEffect = react.useEffect;
  const fakeElement = name => ({
    name,
    focus(options) { focusCalls.push({ name, options }); document.activeElement = this; },
    getBoundingClientRect() { return { left: 16, top: 80, right: width - 16, bottom: 128 }; },
    contains(target) { return target === this || name === 'popup' && ['search', 'close', 'option'].includes(target?.name); },
  });
  const trigger = fakeElement('trigger'), popup = fakeElement('popup'), search = fakeElement('search');
  document.activeElement = trigger;
  document.body = fakeElement('body');
  document.getElementById = () => ({ scrollIntoView() {} });
  Object.assign(window, { innerWidth: width, innerHeight: 960, visualViewport: Object.assign(new EventTarget(), { width, height: 960, offsetLeft: 0, offsetTop: 0 }) });
  const modules = {
    react, 'react/jsx-runtime': { jsx: element, jsxs: element },
    'react-dom': { createPortal: children => element('portal', { children }) },
    'lucide-react': new Proxy({}, { get: (_target, key) => Symbol.for(String(key)) }),
    './execution-host-picker.mjs': executionHosts,
    './WorkspaceDisclosure': { __esModule: true, default: Symbol('WorkspaceDisclosure') },
    './AgentOnboarding': { AgentOnboarding: Symbol('AgentOnboarding') },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports, window, document,
    require: name => { if (name.endsWith('.css')) return {}; assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`); return modules[name]; },
    requestAnimationFrame(callback) { const id = ++frameId; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  const Component = module.exports.ModelPicker;
  const find = (type, predicate = () => true) => nodes(tree).find(node => node.type === type && predicate(node.props));
  const render = () => {
    index = 0; effects.length = 0;
    tree = Component({ providers: available, value: 'one', disabled, onChange: id => changes.push(id) });
    find('button', props => props.className === 'workspace-model-trigger').props.ref.current = trigger;
    const popupNode = find('div', props => props.className === 'workspace-model-popup');
    if (popupNode) { popupNode.props.ref.current = popup; find('input').props.ref.current = search; }
    for (const effect of effects) effect();
    return tree;
  };
  const triggerNode = () => find('button', props => props.className === 'workspace-model-trigger');
  const key = (node, key, target = trigger) => { node.props.onKeyDown({ key, target, preventDefault() {}, stopPropagation() {} }); render(); };
  render();
  return {
    find, focusCalls, changes, document, search,
    pointer(pointerType) { triggerNode().props.onPointerDown?.({ pointerType }); },
    cancelPointer() { triggerNode().props.onPointerCancel?.(); },
    click(detail = 1) { triggerNode().props.onClick({ detail, nativeEvent: { detail } }); render(); },
    triggerKey(keyValue) { key(triggerNode(), keyValue); },
    searchKey(keyValue) { key(find('div', props => props.className === 'workspace-model-popup'), keyValue, search); },
    choose(id) { find('div', props => props.role === 'option' && props.children[0].props.children[0].props.children === providers.find(provider => provider.id === id).name).props.onClick(); render(); },
    type(query) { find('input').props.onChange({ target: { value: query } }); render(); },
    close() { for (const hook of hooks) hook?.cleanup?.(); assert.equal(frames.size, 0, 'position listeners must release queued animation frames'); },
  };
}

test('touch opens the real model list without focusing an editable field, and selection restores the trigger', t => {
  const f = pickerFixture(); t.after(() => f.close());
  f.pointer('touch'); f.click();
  assert.ok(f.find('div', props => props.role === 'listbox'));
  assert.equal(f.focusCalls.some(call => call.name === 'search'), false, 'opening by touch must not summon the software keyboard');
  assert.equal(f.document.activeElement.name, 'trigger');
  f.choose('two');
  assert.deepEqual(f.changes, ['two']);
  assert.equal(f.document.activeElement.name, 'trigger');
  assert.equal(f.find('div', props => props.role === 'listbox'), undefined);
});

test('touch and pen activation stay non-editable on wide hybrid devices, independently of viewport size', t => {
  for (const pointerType of ['touch', 'pen']) {
    const f = pickerFixture({ width: 1366 }); t.after(() => f.close());
    f.pointer(pointerType); f.click();
    assert.ok(f.find('div', props => props.role === 'listbox'));
    assert.equal(f.focusCalls.some(call => call.name === 'search'), false, `${pointerType} activation must not depend on a mobile breakpoint`);
  }
});

test('mouse activation on a narrow Ubuntu window retains focused search and real filtering', t => {
  const f = pickerFixture(); t.after(() => f.close());
  f.pointer('mouse'); f.click();
  assert.equal(f.document.activeElement.name, 'search');
  assert.equal(f.focusCalls[0].options.preventScroll, true);
  f.type('model-two');
  assert.equal(nodes(f.find('div', props => props.role === 'listbox')).filter(node => node.props?.role === 'option').length, 1);
  f.searchKey('Enter');
  assert.deepEqual(f.changes, ['two']);
  assert.equal(f.document.activeElement.name, 'trigger');
});

test('keyboard activation preserves focused search, arrow navigation and Enter selection', t => {
  const f = pickerFixture(); t.after(() => f.close());
  f.triggerKey('ArrowDown');
  assert.equal(f.document.activeElement.name, 'search');
  f.searchKey('ArrowDown'); f.searchKey('Enter');
  assert.deepEqual(f.changes, ['two']);
  assert.equal(f.document.activeElement.name, 'trigger');
});

test('zero-detail keyboard or assistive activation overrides a prior touch pointer, including cancellation', t => {
  for (const cancel of [false, true]) {
    const f = pickerFixture(); t.after(() => f.close());
    f.pointer('touch'); if (cancel) f.cancelPointer(); f.click(0);
    assert.equal(f.document.activeElement.name, 'search', 'semantic activation must retain the accessible search focus');
    f.searchKey('Escape');
    assert.equal(f.document.activeElement.name, 'trigger');
    assert.equal(f.find('div', props => props.role === 'listbox'), undefined);
  }
});

test('a keyboard can take over a list opened by touch without requiring a close/reopen', t => {
  const f = pickerFixture(); t.after(() => f.close());
  f.pointer('touch'); f.click();
  assert.equal(f.document.activeElement.name, 'trigger');
  f.triggerKey('ArrowDown');
  assert.equal(f.document.activeElement.name, 'search');
});

test('Escape closes a touch-opened list while focus remains on the trigger', t => {
  const f = pickerFixture(); t.after(() => f.close());
  f.pointer('touch'); f.click(); f.triggerKey('Escape');
  assert.equal(f.find('div', props => props.role === 'listbox'), undefined);
  assert.equal(f.document.activeElement.name, 'trigger');
  assert.equal(f.focusCalls.some(call => call.name === 'search'), false);
});

test('disabled and empty pickers do not open or change focus', t => {
  for (const options of [{ disabled: true }, { available: [] }]) {
    const f = pickerFixture(options); t.after(() => f.close());
    f.pointer('touch'); f.click(); f.triggerKey('ArrowDown');
    assert.equal(f.find('div', props => props.role === 'listbox'), undefined);
    assert.deepEqual(f.focusCalls, []);
    assert.deepEqual(f.changes, []);
  }
});
