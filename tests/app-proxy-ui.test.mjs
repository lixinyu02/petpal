import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(await readFile(new URL('../src/AppProxySettings.tsx', import.meta.url), 'utf8'),
  { fileName:'AppProxySettings.tsx', compilerOptions:{ target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.ReactJSX } }).outputText;
const stopped = { supported:true, state:'stopped', configured:false, running:false, autoStart:false, version:'1.19.32', platform:'win32', arch:'x64', groups:[] };
const groups = [{ name:'我的代理', selected:'节点 A', choices:['节点 A','节点 B','DIRECT'] }];
const running = { ...stopped, state:'running', configured:true, running:true, groups };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children)];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? typeof tree === 'symbol' ? '' : String(tree) : text(tree.props?.children);

function fixture({ platform='desktop', connected=true, target='local', value=stopped, status, handlers={}, remoteBridge=true } = {}) {
  const window = new EventTarget(), document = new EventTarget(), calls = [], timers = new Map(), hooks = [], effects = [];
  let actual = structuredClone(value), epoch = 1, identity = { instanceId:'local-service', userId:'owner' },
    timerId = 0, index = 0, tree, dirty = false, mounted = true, updatesAfterUnmount = 0;
  document.hidden = false;
  const native = Object.fromEntries(['status','importFile','importText','importUrl','updateRemote','start','stop','preferences','select'].map(action => [action, async input => {
    calls.push({ action, ...(input === undefined ? {} : { input }) });
    if (action === 'status') return status ? status(calls.filter(call => call.action === 'status').length, actual) : structuredClone(actual);
    if (handlers[action]) return handlers[action](input, actual);
    if (action === 'importFile' || action === 'importText') actual = { ...actual, configured:true, remoteConfigured:false, remoteUpdatedAt:undefined };
    else if (action === 'importUrl' || action === 'updateRemote') actual = { ...actual, configured:true, remoteConfigured:true, remoteUpdatedAt:'2026-10-15T08:30:00.000Z' };
    else if (action === 'start') actual = { ...actual, state:'running', running:true, groups:structuredClone(groups) };
    else if (action === 'stop') actual = { ...actual, state:'stopped', running:false, groups:[] };
    else if (action === 'preferences') actual = { ...actual, autoStart:input.autoStart };
    else if (action === 'select') actual = { ...actual, groups:actual.groups.map(group => group.name === input.group ? { ...group, selected:input.name } : group) };
    return structuredClone(actual);
  }]));
  if (!remoteBridge) { delete native.importUrl; delete native.updateRemote; }
  if (platform === 'desktop') window.petpal = { appProxy:native };
  else if (platform === 'legacy') window.petpal = {};
  const api = { getConnection:() => ({ url:target === 'local' ? 'http://127.0.0.1:4318' : 'https://central.example.invalid', token:connected ? 'fixture-session' : '' }),
    getExecutionTarget:() => target, getIdentity:() => connected ? identity : null, getSessionEpoch:() => epoch };
  const same = (a,b) => a && b && a.length === b.length && a.every((value, at) => Object.is(value, b[at]));
  const react = {
    useId() { index++; return 'app-proxy-fixture'; },
    useState(initial) { const at = index++; if (!hooks[at]) hooks[at] = { value:typeof initial === 'function' ? initial() : initial };
      return [hooks[at].value, next => { if (!mounted) updatesAfterUnmount++; hooks[at].value = typeof next === 'function' ? next(hooks[at].value) : next; dirty = true; }]; },
    useRef(initial) { const at = index++; hooks[at] ||= { current:initial }; return hooks[at]; },
    useEffect(effect, deps) { const at = index++, previous = hooks[at]; if (!same(previous?.deps, deps)) effects.push(() => {
      previous?.cleanup?.(); hooks[at] = { deps, cleanup:effect() };
    }); },
  };
  const module = { exports:{} }, modules = { react, './api':api,
    'react/jsx-runtime':{ jsx:(type,props) => ({ type,props }), jsxs:(type,props) => ({ type,props }) },
    'lucide-react':new Proxy({}, { get:(_target,key) => Symbol.for(String(key)) }),
  };
  vm.runInNewContext(source, { module, exports:module.exports, window, document, TextEncoder, Set, Error, Object,
    setTimeout(callback, ms) { const id = ++timerId; timers.set(id, { callback,ms }); return id; }, clearTimeout:id => timers.delete(id),
    require(name) { if (name.endsWith('.css')) return {}; assert.ok(Object.hasOwn(modules, name), name); return modules[name]; },
  });
  const render = () => { index = 0; dirty = false; effects.length = 0; tree = module.exports.default({ connected }); for (const effect of effects) effect(); return tree; };
  const find = (type, predicate=() => true) => nodes(tree).find(node => node.type === type && predicate(node.props));
  const flush = async () => { for (let i = 0; i < 30; i++) { await Promise.resolve(); if (dirty && mounted) render(); } };
  render();
  return { calls, native, render, flush, find, validate:module.exports.readAppProxyStatus,
    get tree() { return tree; }, get timerCount() { return timers.size; }, get updatesAfterUnmount() { return updatesAfterUnmount; }, text:() => text(tree),
    click(label) { const node = find('button', props => props['aria-label'] === label || text(props.children) === label); assert.ok(node, `Missing button ${label}`); node.props.onClick(); },
    paste(value) { const textarea = find('textarea'); assert.ok(textarea); textarea.props.onChange({ target:{ value } }); render(); },
    typeUrl(value) { const input = find('input', props => props.type === 'password'); assert.ok(input); input.props.onChange({ target:{ value } }); render(); },
    setValue(next) { actual = structuredClone(next); },
    changeSession({ authenticated=connected, executionTarget=target }={}) { epoch++; connected = authenticated; target = executionTarget; identity = { ...identity, userId:`owner-${epoch}` }; window.dispatchEvent(new Event('petpal:session-change')); render(); },
    setHidden(hidden) { document.hidden = hidden; document.dispatchEvent(new Event('visibilitychange')); },
    fireTimers() { const pending = [...timers.values()]; timers.clear(); for (const timer of pending) { assert.equal(timer.ms, 15000); timer.callback(); } },
    close() { if (!mounted) return; mounted = false; for (const hook of hooks) hook?.cleanup?.(); assert.equal(timers.size, 0); },
  };
}

test('Web Android legacy and logged-out/remote clients expose no actionable proxy controls or IPC calls', async t => {
  for (const options of [{ platform:'web' }, { platform:'android' }, { platform:'legacy' }, { connected:false }, { target:'remote' }]) {
    const f = fixture(options); t.after(() => f.close()); await f.flush();
    assert.equal(f.calls.length, 0); assert.equal(f.find('button'), undefined); assert.equal(f.find('textarea'), undefined);
    assert.match(f.text(), /桌面客户端|先登录|本机服务/);
  }
});

test('local status starts stopped and imports file without generating model/network tests', async t => {
  const f = fixture(); t.after(() => f.close()); await f.flush();
  assert.match(f.text(), /未启用/); assert.match(f.text(), /尚未导入/); assert.match(f.text(), /Mihomo 1.19.32/);
  assert.equal(f.find('button', props => text(props.children) === '启用代理').props.disabled, true);
  f.click('导入配置'); await f.flush(); assert.equal(f.calls.at(-1).action, 'importFile'); assert.match(f.text(), /配置已保存/);
  assert.equal(f.find('button', props => text(props.children) === '启用代理').props.disabled, false);
  assert.ok(f.calls.every(call => ['status','importFile'].includes(call.action)));
});

test('pasted YAML stays ephemeral, passes only to native import and clears after save', async t => {
  const f = fixture(); t.after(() => f.close()); await f.flush(); f.click('粘贴 YAML 配置'); await f.flush();
  const yaml = 'proxies:\n  - name: private-node\n    password: private-fixture-value';
  f.paste(yaml); assert.equal(f.find('textarea').props.value, yaml); f.click('保存配置'); await f.flush();
  assert.equal(f.calls.at(-1).action, 'importText'); assert.equal(f.calls.at(-1).input.yaml, yaml);
  assert.equal(f.find('textarea'), undefined); f.click('粘贴 YAML 配置'); await f.flush();
  assert.equal(f.find('textarea').props.value, ''); assert.equal(f.text().includes('private-fixture-value'), false);
});

test('YAML byte limit uses UTF-8 and rejects oversized Chinese text before IPC', async t => {
  const f = fixture(); t.after(() => f.close()); await f.flush(); f.click('粘贴 YAML 配置'); await f.flush();
  f.paste('字'.repeat(Math.ceil(4 * 1024 ** 2 / 3))); f.click('保存配置'); await f.flush();
  assert.match(f.text(), /超过 4 MiB/); assert.equal(f.calls.filter(call => call.action === 'importText').length, 0);
});

test('remote links stay masked and ephemeral, download only through native IPC and expose safe source metadata', async t => {
  const gate = deferred(), f = fixture({ handlers:{ importUrl:() => gate.promise } }); t.after(() => f.close()); await f.flush();
  assert.equal(f.find('input', props => props.type === 'password'), undefined);
  f.click('从链接下载配置'); await f.flush();
  const input = f.find('input', props => props.type === 'password');
  assert.equal(input.props.autoComplete, 'off'); assert.equal(input.props.spellCheck, false);
  assert.equal(input.props.autoCapitalize, 'off'); assert.equal(input.props.maxLength, 4096);
  assert.equal(input.props.placeholder, 'https://example.com/clash.yaml'); assert.match(f.text(), /配置文件链接/);
  const url = 'https://server.example.invalid/config/clash.yaml?token=private-fixture-token';
  f.typeUrl(url); assert.doesNotMatch(f.text(), /private-fixture-token/);
  f.click('下载并保存'); f.click('下载并保存'); await f.flush();
  assert.equal(f.calls.filter(call => call.action === 'importUrl').length, 1);
  assert.equal(f.calls.at(-1).input.url, url); assert.equal(f.find('input', props => props.type === 'password').props.value, '');
  gate.resolve({ ...stopped, configured:true, remoteConfigured:true, remoteUpdatedAt:'2026-10-15T08:30:00.000Z', remoteUrl:url }); await f.flush();
  assert.equal(f.find('input', props => props.type === 'password'), undefined); assert.match(f.text(), /已保存远程来源|更新于/);
  assert.equal(f.find('time').props.dateTime, '2026-10-15T08:30:00.000Z'); assert.doesNotMatch(JSON.stringify(f.tree), /private-fixture-token|server\.example/);
  f.click('从链接下载配置'); await f.flush(); assert.equal(f.find('input', props => props.type === 'password').props.value, '');
});

test('LAN HTTP links are supported, and local imports remove remote update controls', async t => {
  const f = fixture(); t.after(() => f.close()); await f.flush(); f.click('从链接下载配置'); await f.flush();
  f.typeUrl('http://192.168.60.10:8090/clash.yaml'); f.click('下载并保存'); await f.flush();
  assert.equal(f.calls.at(-1).input.url, 'http://192.168.60.10:8090/clash.yaml'); assert.match(f.text(), /已保存远程来源/);
  f.click('导入配置'); await f.flush(); assert.equal(f.find('button', props => text(props.children) === '更新远程配置'), undefined);
  assert.doesNotMatch(f.text(), /已保存远程来源|更新于/);
});

test('failed remote downloads clear the link and preserve current metadata without exposing native errors', async t => {
  const f = fixture({ value:{ ...stopped, configured:true, remoteConfigured:true, remoteUpdatedAt:'2026-10-14T08:30:00.000Z' },
    handlers:{ importUrl:() => { throw new Error('https://node.invalid/?token=private-token'); } } }); t.after(() => f.close()); await f.flush();
  f.click('从链接下载配置'); await f.flush(); f.typeUrl('https://node.invalid/?token=private-token'); f.click('下载并保存'); await f.flush();
  assert.match(f.text(), /远程配置未能下载或保存/); assert.doesNotMatch(JSON.stringify(f.tree), /private-token|node\.invalid/);
  assert.equal(f.find('input', props => props.type === 'password').props.value, '');
  assert.equal(f.find('time').props.dateTime, '2026-10-14T08:30:00.000Z');
});

test('oversized remote links are cleared and rejected before IPC', async t => {
  const f = fixture(); t.after(() => f.close()); await f.flush(); f.click('从链接下载配置'); await f.flush();
  f.typeUrl(`https://node.invalid/${'x'.repeat(4096)}`); f.click('下载并保存'); await f.flush();
  assert.equal(f.calls.filter(call => call.action === 'importUrl').length, 0); assert.match(f.text(), /配置链接过长/);
  assert.equal(f.find('input', props => props.type === 'password').props.value, '');
});

test('saved remote sources can be manually updated without a URL or overlapping operation', async t => {
  const gate = deferred(), f = fixture({ value:{ ...stopped, configured:true, remoteConfigured:true }, handlers:{ updateRemote:() => gate.promise } }); t.after(() => f.close()); await f.flush();
  f.click('更新远程配置'); f.click('更新远程配置'); await f.flush();
  assert.equal(f.calls.filter(call => call.action === 'updateRemote').length, 1); assert.equal(f.calls.at(-1).input, undefined);
  assert.equal(f.find('button', props => text(props.children) === '更新远程配置').props.disabled, true);
  gate.resolve({ ...stopped, configured:true, remoteConfigured:true, remoteUpdatedAt:'2026-10-15T08:30:00.000Z' }); await f.flush();
  assert.equal(f.find('time').props.dateTime, '2026-10-15T08:30:00.000Z');
});

test('running proxies prevent remote imports and updates until stopped', async t => {
  const f = fixture({ value:{ ...running, remoteConfigured:true } }); t.after(() => f.close()); await f.flush();
  for (const label of ['从链接下载配置','更新远程配置']) assert.equal(f.find('button', props => text(props.children) === label).props.disabled, true);
  assert.match(f.text(), /更换或更新配置前，请先关闭代理/);
  f.click('更新远程配置'); await f.flush(); assert.equal(f.calls.filter(call => call.action === 'updateRemote').length, 0);
  f.click('关闭代理'); await f.flush(); assert.equal(f.find('button', props => text(props.children) === '更新远程配置').props.disabled, false);
});

test('older native bridges keep existing imports while omitting unavailable remote features', async t => {
  const f = fixture({ remoteBridge:false, value:{ ...stopped, configured:true, remoteConfigured:true } }); t.after(() => f.close()); await f.flush();
  assert.equal(f.find('button', props => text(props.children) === '从链接下载配置'), undefined);
  assert.equal(f.find('button', props => text(props.children) === '更新远程配置'), undefined);
  f.click('导入配置'); await f.flush(); assert.equal(f.calls.at(-1).action, 'importFile');
});

test('session and execution target changes clear remote drafts and discard late download results', async t => {
  const gate = deferred(), f = fixture({ handlers:{ importUrl:() => gate.promise } }); t.after(() => f.close()); await f.flush();
  f.click('从链接下载配置'); await f.flush(); f.typeUrl('https://node.invalid/?token=private-draft');
  f.changeSession(); await f.flush(); assert.equal(f.find('input', props => props.type === 'password'), undefined);
  f.click('从链接下载配置'); await f.flush(); assert.equal(f.find('input', props => props.type === 'password').props.value, '');
  f.typeUrl('https://node.invalid/?token=private-pending'); f.click('下载并保存'); await f.flush();
  f.changeSession({ executionTarget:'remote' }); await f.flush(); gate.resolve({ ...running, remoteConfigured:true }); await f.flush();
  assert.match(f.text(), /本机服务/); assert.doesNotMatch(JSON.stringify(f.tree), /private-|已保存远程来源/);
  assert.equal(f.calls.filter(call => call.action === 'stop').length, 0);
});

test('unmounting during a remote download prevents late state writes', async () => {
  const gate = deferred(), f = fixture({ handlers:{ importUrl:() => gate.promise } }); await f.flush();
  f.click('从链接下载配置'); await f.flush(); f.typeUrl('https://node.invalid/?token=private-pending'); f.click('下载并保存'); await f.flush(); f.close();
  gate.resolve({ ...stopped, configured:true, remoteConfigured:true }); await f.flush(); assert.equal(f.updatesAfterUnmount, 0);
});

test('start stop preferences and selector use the matching native actions with bounded state', async t => {
  const f = fixture({ value:{ ...stopped, configured:true } }); t.after(() => f.close()); await f.flush();
  f.find('input', props => props.type === 'checkbox').props.onChange({ target:{ checked:true } }); await f.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-1))), { action:'preferences', input:{ autoStart:true } });
  assert.equal(f.find('input', props => props.type === 'checkbox').props.checked, true);
  f.click('启用代理'); await f.flush(); assert.equal(f.calls.at(-1).action, 'start'); assert.match(f.text(), /已启用/);
  assert.equal(f.find('button', props => text(props.children) === '导入配置').props.disabled, true);
  f.find('select').props.onChange({ target:{ value:'节点 B' } }); await f.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-1))), { action:'select', input:{ group:'我的代理', name:'节点 B' } });
  assert.equal(f.find('select').props.value, '节点 B'); f.click('关闭代理'); await f.flush();
  assert.equal(f.calls.at(-1).action, 'stop'); assert.match(f.text(), /未启用/); assert.equal(f.find('select'), undefined);
});

test('busy actions reject duplicate clicks before rerender and expose no configuration credentials', async t => {
  const gate = deferred(), f = fixture({ value:{ ...stopped, configured:true }, handlers:{ start:() => gate.promise } }); t.after(() => f.close()); await f.flush();
  f.click('启用代理'); f.click('启用代理'); await f.flush(); assert.equal(f.calls.filter(call => call.action === 'start').length, 1);
  assert.equal(f.find('button', props => text(props.children) === '启用代理').props.disabled, true);
  gate.resolve({ ...running, yaml:'private-yaml', password:'private-password', secret:'private-secret' }); await f.flush();
  assert.match(f.text(), /已启用/); assert.equal(JSON.stringify(f.tree).includes('private-'), false);
});

test('native raw exceptions and status error contents are replaced with fixed readable messages', async t => {
  const denied = fixture({ status:() => { throw new Error('Bearer private-native-token'); } }); t.after(() => denied.close()); await denied.flush();
  assert.match(denied.text(), /本机主账号/); assert.equal(denied.text().includes('private-native-token'), false);
  assert.equal(denied.find('button', props => text(props.children) === '启用代理'), undefined);
  const f = fixture({ value:{ ...stopped, configured:true }, handlers:{ start:() => { throw new Error('https://private-user:secret@node.invalid'); } } }); t.after(() => f.close()); await f.flush();
  f.click('启用代理'); await f.flush(); assert.match(f.text(), /代理未能启用/); assert.doesNotMatch(f.text(), /private-user|secret@/);
  f.setValue({ ...stopped, configured:true, state:'error', error:'private-core-log' }); f.click('刷新应用代理状态'); await f.flush();
  assert.match(f.text(), /代理运行异常/); assert.doesNotMatch(f.text(), /private-core-log/);
});

test('status validation strips unknown fields and rejects malformed/oversized node catalogs', async t => {
  const f = fixture(); t.after(() => f.close()); await f.flush();
  const clean = f.validate({ ...running, yaml:'private', token:'private', groups:[{ ...groups[0], secret:'private' }] });
  assert.equal(JSON.stringify(clean).includes('private'), false); assert.equal(clean.remoteConfigured, false);
  const remote = f.validate({ ...stopped, configured:true, remoteConfigured:true, remoteUpdatedAt:'2026-10-15T08:30:00.000Z', remoteUrl:'https://private.invalid/?token=private' });
  assert.equal(remote.remoteConfigured, true); assert.equal(remote.remoteUpdatedAt, '2026-10-15T08:30:00.000Z'); assert.doesNotMatch(JSON.stringify(remote), /private/);
  for (const patch of [ { state:'ready' }, { running:'yes' }, { supported:false }, { platform:'darwin' }, { arch:'arm' },
    { groups:[{ ...groups[0], selected:'bad\nselection' }] }, { groups:[{ ...groups[0], choices:['dup','dup'] }] },
    { groups:[{ ...groups[0], name:'bad\nnode' }] }, { groups:Array.from({ length:129 }, (_, i) => ({ name:`g${i}`, selected:'', choices:[] })) },
    { remoteConfigured:'yes' }, { remoteConfigured:true, remoteUpdatedAt:'private-token' }, { remoteConfigured:true, remoteUpdatedAt:'2026-99-99T99:99:99.000Z' },
    { remoteConfigured:true, remoteUpdatedAt:'2026-02-31T08:30:00.000Z' },
    { remoteConfigured:false, remoteUpdatedAt:'2026-10-15T08:30:00.000Z' },
  ]) assert.throws(() => f.validate({ ...running, ...patch }));
});

test('a current node outside the bounded choice list stays visible without becoming a selectable invented node', async t => {
  const f = fixture({ value:{ ...running, groups:[{ ...groups[0], selected:'当前已连接节点' }] } }); t.after(() => f.close()); await f.flush();
  const option = f.find('option', props => props.value === '当前已连接节点'); assert.ok(option); assert.equal(option.props.disabled, true);
  const before = f.calls.length; f.find('select').props.onChange({ target:{ value:'invented' } }); await f.flush(); assert.equal(f.calls.length, before);
  assert.equal(f.find('select').props.value, '当前已连接节点');
});

test('visible settings poll only status every 15 seconds and pause while hidden', async t => {
  const f = fixture({ value:running }); t.after(() => f.close()); await f.flush();
  assert.equal(f.timerCount, 1); const before = f.calls.length; f.fireTimers(); await f.flush(); assert.equal(f.calls.length, before + 1);
  f.setHidden(true); assert.equal(f.timerCount, 0); f.fireTimers(); await f.flush(); assert.equal(f.calls.length, before + 1);
  f.setHidden(false); assert.equal(f.timerCount, 1); f.fireTimers(); await f.flush(); assert.equal(f.calls.length, before + 2);
  assert.ok(f.calls.every(call => call.action === 'status'));
});

test('session changes clear pasted secrets, discard late native results and never stop another user task', async t => {
  const old = deferred(), f = fixture({ status:count => count === 2 ? old.promise : stopped }); t.after(() => f.close()); await f.flush();
  f.click('粘贴 YAML 配置'); await f.flush(); f.paste('private-draft'); f.click('刷新应用代理状态'); await f.flush();
  f.changeSession(); await f.flush(); old.resolve(running); await f.flush();
  assert.match(f.text(), /未启用/); assert.equal(f.find('textarea'), undefined); assert.doesNotMatch(f.text(), /private-draft/);
  assert.equal(f.calls.filter(call => call.action === 'stop').length, 0);
});

test('logout and unmount invalidate slow imports without UI updates or native cancellation', async t => {
  const importGate = deferred(), f = fixture({ handlers:{ importText:() => importGate.promise } }); t.after(() => f.close()); await f.flush();
  f.click('粘贴 YAML 配置'); await f.flush(); f.paste('private-draft'); f.click('保存配置'); await f.flush();
  f.changeSession({ authenticated:false }); await f.flush(); importGate.resolve(running); await f.flush();
  assert.match(f.text(), /先登录/); assert.equal(f.find('textarea'), undefined); assert.equal(f.timerCount, 0);
  const gate = deferred(), closed = fixture({ status:() => gate.promise }); await closed.flush(); closed.close();
  gate.resolve(running); await closed.flush(); assert.equal(closed.updatesAfterUnmount, 0);
});

test('cancelled file chooser returns existing status without claiming a successful import', async t => {
  const f = fixture({ handlers:{ importFile:(_input, actual) => actual } }); t.after(() => f.close()); await f.flush();
  f.click('导入配置'); await f.flush(); assert.match(f.text(), /尚未导入/); assert.doesNotMatch(f.text(), /导入成功|配置已保存/);
});

test('preload exposes only a frozen proxy interface and reads the current connection for every IPC call', async () => {
  const preload = await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8'), calls = [];
  let saved = { url:'', token:'fixture-local-token' }, api;
  const ipcRenderer = { invoke:async (...args) => { calls.push(args); return stopped; }, on() {}, removeListener() {} };
  vm.runInNewContext(preload, { require(name) { assert.equal(name, 'electron'); return { contextBridge:{ exposeInMainWorld(name, value) { assert.equal(name, 'petpal'); api = value; } }, ipcRenderer }; },
    sessionStorage:{ getItem:() => JSON.stringify(saved) }, location:{ origin:'http://127.0.0.1:4318' } });
  assert.ok(Object.isFrozen(api.appProxy));
  const operations = [['status'], ['importFile'], ['importText', { yaml:'proxies: []' }], ['importUrl', { url:'https://node.invalid/config.yaml?token=fixture' }], ['updateRemote'], ['start'], ['stop'], ['preferences', { autoStart:true }], ['select', { group:'group', name:'node' }]];
  for (const [action, input] of operations) {
    await api.appProxy[action](input); const call = calls.at(-1);
    assert.equal(call[0], `petpal:app-proxy:${action}`); assert.deepEqual(JSON.parse(JSON.stringify(call[1])), { url:'http://127.0.0.1:4318', token:'fixture-local-token' });
    assert.deepEqual(call[2], input);
  }
  saved = null; await api.appProxy.status(); assert.equal(calls.at(-1)[1], null);
  assert.deepEqual(Object.keys(api.appProxy), operations.map(([action]) => action));
});
