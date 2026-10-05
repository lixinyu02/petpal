import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(await readFile(new URL('../src/ThemeSettings.tsx', import.meta.url), 'utf8'), {
  fileName: 'ThemeSettings.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children)];
const text = tree => Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'string' ? tree : tree && typeof tree === 'object' ? text(tree.props?.children) : '';
function fixture({ connected = true, state = { preference: 'auto', theme: 'night', saved: true } } = {}) {
  const changes = [], module = { exports: {} };
  const modules = {
    react: { useId: () => 'fixture-theme' },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'lucide-react': new Proxy({}, { get: (_target, name) => Symbol.for(String(name)) }),
    './platform/theme.ts': { useTheme: () => state, setThemePreference: preference => changes.push(preference) },
  };
  vm.runInNewContext(source, { module, exports: module.exports, require: name => { assert.ok(Object.hasOwn(modules, name), name); return modules[name]; } });
  let tree = module.exports.default({ connected });
  return {
    changes,
    get tree() { return tree; },
    find(type, predicate = () => true) { return nodes(tree).find(node => node.type === type && predicate(node.props)); },
    update(next) { state = next; tree = module.exports.default({ connected }); },
  };
}

test('appearance renders three native radios with one shared group and accessible time guidance', () => {
  const f = fixture(), radios = nodes(f.tree).filter(node => node.type === 'input');
  assert.deepEqual(radios.map(node => node.props.type), ['radio', 'radio', 'radio']);
  assert.deepEqual(radios.map(node => node.props.value), ['auto', 'day', 'night']);
  assert.equal(new Set(radios.map(node => node.props.name)).size, 1);
  assert.deepEqual(radios.map(node => node.props.checked), [true, false, false]);
  const group = f.find('fieldset'), guide = f.find('p', props => props.id === group.props['aria-describedby']);
  assert.match(text(guide), /07:00–19:00/); assert.match(text(f.find('legend')), /界面主题/);
  assert.match(text(f.find('p', props => props.role === 'status')), /夜间.*自动切换/);
});

test('selecting a manual theme forwards only the chosen local preference and reflects live store state', () => {
  const f = fixture(); f.find('input', props => props.value === 'day').props.onChange();
  assert.deepEqual(f.changes, ['day']);
  f.update({ preference: 'day', theme: 'day', saved: true });
  assert.equal(f.find('input', props => props.value === 'day').props.checked, true);
  assert.equal(f.find('input', props => props.value === 'auto').props.checked, false);
  assert.match(text(f.find('p', props => props.role === 'status')), /日间.*固定主题/);
});

test('logged-out settings disable the native group and reject late handlers', () => {
  const f = fixture({ connected: false });
  assert.equal(f.find('fieldset').props.disabled, true);
  f.find('input', props => props.value === 'night').props.onChange(); assert.equal(f.changes.length, 0);
});

test('storage denial keeps the usable local preference visible and explains that it was not persisted', () => {
  const f = fixture({ state: { preference: 'night', theme: 'night', saved: false } });
  assert.equal(f.find('input', props => props.value === 'night').props.checked, true);
  assert.match(text(f.find('p', props => props.role === 'status')), /当前会话可用，未能保存到此设备/);
});
