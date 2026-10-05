import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as projectPreferences from '../src/project-directory-preferences.mjs';

const source = ts.transpileModule(await readFile(new URL('../src/AutomationsView.tsx', import.meta.url), 'utf8'), {
  fileName: 'AutomationsView.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children)];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : text(tree.props?.children);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const clone = value => JSON.parse(JSON.stringify(value));
const user = { id: 'user-one', username: 'fixture', displayName: 'Fixture', role: 'user', isOwner: false, canUseCodex: true, agentAccess: 'full' };
const providers = [{ id: 'responses-one', name: 'Agent 模型', model: 'fixture-responses', protocol: 'responses', supportsImages: true }];
const hosts = [{ id: '00000000-0000-4000-8000-000000000101', name: 'Windows fixture', kind: 'desktop', platform: 'win32', online: true, codex: { available: true, projectDirectory: true } },
  { id: '00000000-0000-4000-8000-000000000102', name: 'Ubuntu fixture', kind: 'desktop', platform: 'linux', online: false, codex: { available: true, projectDirectory: true } }];
const revisionOne = '00000000-0000-4000-8000-000000000301', revisionTwo = '00000000-0000-4000-8000-000000000302', revisionThree = '00000000-0000-4000-8000-000000000303';
const job = (extra = {}) => ({ id: '00000000-0000-4000-8000-000000000201', title: '日报', prompt: '总结今天的工作', hostId: '00000000-0000-4000-8000-000000000101', providerId: 'responses-one', projectDirectory: '',
  permissions: { access: 'read-only', approval: 'ask' }, schedule: { kind: 'daily', time: '18:00', timezone: 'Asia/Shanghai' }, enabled: true, revision: revisionOne,
  createdBy: 'user', sourceConversationId: null, createdAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-05T00:00:00.000Z', nextRunAt: '2026-10-05T10:00:00.000Z', runs: [], ...extra });

/** Execute the component's actual effects and event handlers. Only lifecycle,
 * child pickers and HTTP are fixtures; payload and concurrency decisions remain in TSX. */
function fixture({ initial = [], connectedUser = user, request, availableHosts = hosts, defaultHostId = '00000000-0000-4000-8000-000000000101' } = {}) {
  let epoch = 1, identity = { instanceId: 'server-one', userId: connectedUser?.id || 'user-one' }, index = 0, tree, dirty = false, mounted = true, afterUnmountUpdates = 0, sequence = 0;
  let actual = clone(initial), preferences = { allowAgentCreate: true };
  const hooks = [], effects = [], requests = [], editing = [], opened = [], refreshes = [], timers = new Map();
  const same = (left, right) => left && right && left.length === right.length && left.every((entry, at) => Object.is(entry, right[at]));
  const react = {
    useState(initialValue) { const at = index++; hooks[at] ||= { value: typeof initialValue === 'function' ? initialValue() : initialValue }; return [hooks[at].value, next => { if (!mounted) afterUnmountUpdates++; hooks[at].value = typeof next === 'function' ? next(hooks[at].value) : next; dirty = true; }]; },
    useRef(initialValue) { const at = index++; hooks[at] ||= { ref: { current: initialValue } }; return hooks[at].ref; },
    useId() { const at = index++; hooks[at] ||= { id: `automation-fixture-${at}` }; return hooks[at].id; },
    useEffect(effect, deps) { const at = index++, previous = hooks[at]; if (!same(previous?.deps, deps)) effects.push(() => { previous?.cleanup?.(); hooks[at] = { deps, cleanup: effect() }; }); },
    useMemo(callback, deps) { const at = index++; if (!same(hooks[at]?.deps, deps)) hooks[at] = { deps, value: callback() }; return hooks[at].value; },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useSyncExternalStore(_subscribe, snapshot) { index++; return snapshot(); },
  };
  react.useLayoutEffect = react.useEffect;
  const controls = { ModelPicker: Symbol('ModelPicker'), ExecutionHostPicker: Symbol('ExecutionHostPicker') }, permissions = Symbol('AgentPermissions');
  const api = {
    getSessionEpoch: () => epoch, getIdentity: () => identity, subscribeSession: () => () => {}, isSessionChanged: error => error?.name === 'SessionChangedError',
    api: async (path, options = {}) => {
      const call = { path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined, signal: options.signal, epoch }; requests.push(call);
      if (request) { const result = await request(call, { actual, preferences }); if (result !== undefined) return result; }
      if (path === '/automations' && call.method === 'GET') return { ...preferences, automations: clone(actual) };
      throw new Error(`Unexpected isolated API call: ${call.method} ${path}`);
    },
  };
  const element = (type, props) => ({ type, props });
  const modules = {
    react, 'react/jsx-runtime': { jsx: element, jsxs: element }, 'lucide-react': new Proxy({}, { get: (_target, name) => Symbol.for(String(name)) }),
    './api': api, './WorkspaceControls': controls, './AgentPermissions': { __esModule: true, default: permissions, defaultAgentPermissions: { access: 'read-only', approval: 'ask' } },
    './project-directory-preferences.mjs': projectPreferences,
  };
  const window = new EventTarget(), document = new EventTarget();
  const nativeConfirmCalls = [];
  window.confirm = message => { nativeConfirmCalls.push(message); throw new Error('Native browser confirmation is forbidden in automation UI'); };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, window, document, Intl, Date, URL, AbortController, DOMException,
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}` },
    setTimeout(callback) { const id = ++sequence; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id),
    require: name => { if (name.endsWith('.css')) return {}; assert.ok(Object.hasOwn(modules, name), `Unexpected dependency ${name}`); return modules[name]; },
  });
  const props = { user: connectedUser, providers, hosts: availableHosts, defaultHostId, hostsLoading: false, hostsError: '', onRefreshHosts: () => refreshes.push(true),
    onOpenConversation: id => opened.push(id), onEditingChange: value => editing.push(clone(value)) };
  const find = (type, predicate = () => true) => nodes(tree).find(node => node.type === type && predicate(node.props));
  const render = () => { index = 0; dirty = false; effects.length = 0; tree = module.exports.default(props); for (const effect of effects) effect(); return tree; };
  const flush = async () => { for (let tick = 0; tick < 16; tick++) { await new Promise(resolve => setImmediate(resolve)); if (dirty && mounted) render(); } };
  const button = label => find('button', item => item['aria-label'] === label || text(item.children).trim() === label);
  const field = label => {
    const direct = nodes(tree).find(node => ['input', 'textarea', 'select'].includes(node.type) && node.props?.['aria-label'] === label); if (direct) return direct;
    const owner = find('label', item => text(item.children).trim().startsWith(label));
    return owner && (nodes(owner).find(node => ['input', 'textarea', 'select'].includes(node.type)) || nodes(tree).find(node => node.props?.id === owner.props.htmlFor));
  };
  render();
  return {
    flush, find, button, field, requests, editing, opened, refreshes, render, controls, permissions,
    text: () => text(tree), get tree() { return tree; }, get afterUnmountUpdates() { return afterUnmountUpdates; },
    get lastEditing() { return editing.at(-1); },
    setJobs(value) { actual = clone(value); },
    click(label, { rerender = true } = {}) { const node = button(label); assert.ok(node, `Missing button ${label}`); const result = node.props.onClick?.({ preventDefault() {}, stopPropagation() {} }); if (rerender) render(); return result; },
    type(label, value, { rerender = true } = {}) { const node = field(label); assert.ok(node, `Missing field ${label}`); node.props.onChange({ target: { value, checked: value } }); if (rerender) render(); },
    chooseHost(value) { find(controls.ExecutionHostPicker).props.onChange(value); render(); },
    chooseModel(value) { find(controls.ModelPicker).props.onChange(value); render(); },
    choosePermissions(value) { find(permissions).props.onChange(value); render(); },
    submit({ rerender = true } = {}) { const node = find('form'); assert.ok(node, 'edit form is mounted'); const result = node.props.onSubmit({ preventDefault() {} }); if (rerender) render(); return result; },
    changeSession({ notify = true } = {}) { epoch++; identity = { ...identity, userId: 'user-two' }; if (notify) render(); },
    dialog() { return nodes(tree).find(node => node.props?.role === 'alertdialog'); },
    escape() { const dialog = this.dialog(); assert.ok(dialog); let prevented = false, stopped = false; dialog.props.onKeyDown({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } }); render(); return { prevented, stopped }; },
    disconnect() { props.user = undefined; render(); },
    close() { mounted = false; for (const hook of hooks) hook?.cleanup?.(); assert.equal(nativeConfirmCalls.length, 0, 'all automation confirmations must remain in the React UI'); },
  };
}

test('new automation form uses selected fixed host, Responses model and explicit schedule in one request', async t => {
  const result = job({ id: '00000000-0000-4000-8000-000000000202', title: '睡前总结', prompt: '帮我总结今天', revision: revisionOne, hostId: '00000000-0000-4000-8000-000000000102', schedule: { kind: 'interval', minutes: 15 } });
  const f = fixture({ request: call => { if (call.method === 'POST' && call.path === '/automations') { f.setJobs([result]); return { automation: result }; } } }); t.after(() => f.close()); await f.flush();
  f.click('新建自动化'); f.type('自动化名称', '睡前总结'); f.type('任务指令', '帮我总结今天'); f.chooseHost('00000000-0000-4000-8000-000000000102'); f.type('执行时间', 'interval'); f.type('每隔分钟', '15');
  assert.equal(f.find(f.controls.ExecutionHostPicker).props.allowOffline, true, 'an offline registered host may be saved without substituting another host');
  assert.equal(f.lastEditing.dirty, true); f.submit(); await f.flush();
  const writes = f.requests.filter(item => item.method === 'POST'); assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body, { title: '睡前总结', prompt: '帮我总结今天', hostId: '00000000-0000-4000-8000-000000000102', providerId: 'responses-one', projectDirectory: '',
    permissions: { access: 'read-only', approval: 'ask' }, schedule: { kind: 'interval', minutes: 15 }, enabled: true, requestId: writes[0].body.requestId });
  assert.match(writes[0].body.requestId, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-8[\da-f]{3}-[\da-f]{12}$/);
  assert.equal(f.lastEditing.dirty, false); assert.equal(f.lastEditing.busy, false); assert.match(f.text(), /睡前总结/);
});

test('edit and pause mutations carry the server revision instead of guessing the next one', async t => {
  const current = job(); let revision = current.revision;
  const f = fixture({ initial: [current], request: (call, { actual }) => {
    if (call.method === 'PATCH' && call.path === '/automations/00000000-0000-4000-8000-000000000201') { assert.equal(call.body.revision, revision); revision = revision === revisionOne ? revisionTwo : revisionThree; const next = { ...actual[0], ...call.body, revision }; f.setJobs([next]); return { automation: next }; }
  } }); t.after(() => f.close()); await f.flush();
  f.click('编辑自动化：日报'); f.type('自动化名称', '周报'); f.submit(); await f.flush();
  f.click('暂停自动化：周报'); await f.flush();
  const writes = f.requests.filter(item => item.method === 'PATCH'); assert.equal(writes.length, 2); assert.equal(writes[0].body.revision, revisionOne); assert.equal(writes[1].body.revision, revisionTwo); assert.equal(writes[1].body.enabled, false);
  assert.match(f.text(), /已暂停/);
});

test('duplicate form submission is serialized synchronously before a React rerender', async t => {
  const writing = deferred(), f = fixture({ request: call => call.method === 'POST' ? writing.promise : undefined }); t.after(() => f.close()); await f.flush();
  f.click('新建自动化'); f.type('自动化名称', '唯一计划'); f.type('任务指令', '一次测试');
  f.submit({ rerender: false }); f.submit({ rerender: false }); assert.equal(f.requests.filter(item => item.method === 'POST').length, 1);
  writing.resolve({ automation: job({ title: '唯一计划', revision: revisionOne }) }); await f.flush(); assert.equal(f.lastEditing.busy, false);
});

test('server revision conflicts preserve edits and do not silently retry the mutation', async t => {
  const f = fixture({ initial: [job()], request: call => { if (call.method === 'PATCH') throw Object.assign(new Error('计划已被其他页面修改，请重新读取。'), { status: 409 }); } }); t.after(() => f.close()); await f.flush();
  f.click('编辑自动化：日报'); f.type('任务指令', '我尚未保存的新指令'); f.submit(); await f.flush();
  assert.equal(f.requests.filter(item => item.method === 'PATCH').length, 1); assert.equal(f.field('任务指令').props.value, '我尚未保存的新指令'); assert.equal(f.lastEditing.dirty, true); assert.equal(f.lastEditing.busy, false);
  assert.match(f.text(), /其他页面修改|重新读取/);
});

test('session epoch change blocks stale form handlers and ignores an old save acknowledgement', async t => {
  const writing = deferred(), f = fixture({ request: call => call.method === 'POST' ? writing.promise : undefined }); t.after(() => f.close()); await f.flush();
  f.click('新建自动化'); f.type('自动化名称', '旧账号计划'); f.type('任务指令', '旧账号指令'); f.submit(); await f.flush();
  f.changeSession({ notify: false }); f.submit({ rerender: false }); assert.equal(f.requests.filter(item => item.method === 'POST').length, 1);
  f.disconnect(); writing.resolve({ automation: job({ title: '旧账号计划' }) }); await f.flush();
  assert.doesNotMatch(f.text(), /自动化已保存|已保存自动化/); assert.equal(f.requests.filter(item => item.method === 'GET').length, 1, 'old completion must not read a new account');
});

test('unmounted views do not emit state updates or editing callbacks when reads or saves finish', async () => {
  const reading = deferred(), loaded = fixture({ request: call => call.method === 'GET' ? reading.promise : undefined });
  loaded.close(); const loadEditing = loaded.editing.length; reading.resolve({ allowAgentCreate: true, automations: [job()] }); await loaded.flush(); assert.equal(loaded.afterUnmountUpdates, 0); assert.equal(loaded.editing.length, loadEditing);
  const writing = deferred(), saved = fixture({ request: call => call.method === 'POST' ? writing.promise : undefined }); await saved.flush();
  saved.click('新建自动化'); saved.type('自动化名称', '保存后离开'); saved.type('任务指令', '测试'); saved.submit();
  saved.close(); const editCount = saved.editing.length; writing.resolve({ automation: job() }); await saved.flush(); assert.equal(saved.afterUnmountUpdates, 0); assert.equal(saved.editing.length, editCount);
});

test('unknown create acknowledgement stays protected until explicit receipt confirmation with the exact same request', async t => {
  let writes = 0; const result = job({ id: '00000000-0000-4000-8000-000000000203', title: '网络断开后的计划', revision: revisionOne });
  const f = fixture({ request: call => {
    if (call.method === 'POST' && call.path === '/automations') { writes++; if (writes === 1) throw new TypeError('connection lost after server accepted the plan'); f.setJobs([result]); return { automation: result }; }
  } }); t.after(() => f.close()); await f.flush(); f.click('新建自动化'); f.type('自动化名称', result.title); f.type('任务指令', '绝不能创建两次');
  f.submit(); await f.flush(); const initial = clone(f.requests.find(item => item.method === 'POST').body);
  assert.equal(writes, 1); assert.equal(f.lastEditing.busy, true); assert.equal(f.lastEditing.dirty, true);
  f.render(); await f.flush(); assert.equal(writes, 1, 'effects and rerenders cannot retry unknown mutations');
  f.click('确认结果'); await f.flush(); const calls = f.requests.filter(item => item.method === 'POST');
  assert.equal(calls.length, 2); assert.equal(calls[1].path, calls[0].path); assert.deepEqual(calls[1].body, initial);
  assert.equal(f.lastEditing.busy, false); assert.equal(f.lastEditing.dirty, false); assert.match(f.text(), /网络断开后的计划/);
});

test('unknown manual run cannot dispatch again until the user confirms the same deduplicated request', async t => {
  let writes = 0; const run = { id: '00000000-0000-4000-8000-000000000401', status: 'queued', conversationId: '00000000-0000-4000-8000-000000000501', startedAt: '2026-10-05T00:00:00.000Z' };
  const f = fixture({ initial: [job()], request: call => {
    if (call.method === 'POST' && call.path === '/automations/00000000-0000-4000-8000-000000000201/run') { writes++; if (writes === 1) throw new TypeError('connection lost after dispatcher accepted the run'); f.setJobs([job({ runs: [run] })]); return { run }; }
  } }); t.after(() => f.close()); await f.flush();
  f.click('立即执行：日报', { rerender: false }); f.click('立即执行：日报', { rerender: false }); assert.equal(writes, 1, 'event lock must apply before rerender');
  await f.flush(); assert.equal(f.lastEditing.busy, true); f.render(); await f.flush(); assert.equal(writes, 1);
  f.click('确认结果'); await f.flush(); const calls = f.requests.filter(item => item.method === 'POST');
  assert.equal(calls.length, 2); assert.deepEqual(calls[1].body, calls[0].body); assert.equal(calls[1].path, calls[0].path);
  assert.equal(f.lastEditing.busy, false); assert.match(f.text(), /排队|已提交|queued/);
});

for (const scenario of [
  { preset: 'daily', fields: { '每日时间': '07:35', '计划时区': 'Asia/Shanghai' }, schedule: { kind: 'daily', time: '07:35', timezone: 'Asia/Shanghai' } },
  { preset: 'weekdays', fields: { '每日时间': '20:15', '计划时区': 'Europe/Berlin' }, schedule: { kind: 'weekly', time: '20:15', timezone: 'Europe/Berlin', weekdays: [1, 2, 3, 4, 5] } },
  { preset: 'once', fields: { '一次执行时间': '2099-01-02T12:34' }, schedule: { kind: 'once', at: new Date('2099-01-02T12:34').toISOString() } },
]) {
  test(`real ${scenario.preset} controls produce a precise schedule without calculating the next server trigger`, async t => {
    const f = fixture({ request: call => call.method === 'POST' ? { automation: job({ schedule: call.body.schedule }) } : undefined }); t.after(() => f.close()); await f.flush();
    f.click('新建自动化'); f.type('自动化名称', '定时格式测试'); f.type('任务指令', '只测试计划格式'); f.type('执行时间', scenario.preset);
    for (const [label, value] of Object.entries(scenario.fields)) f.type(label, value);
    f.submit(); await f.flush(); const writes = f.requests.filter(item => item.method === 'POST'); assert.equal(writes.length, 1); assert.deepEqual(writes[0].body.schedule, scenario.schedule);
    assert.equal(Object.hasOwn(writes[0].body, 'nextRunAt'), false, 'the authoritative next trigger belongs to the backend');
  });
}

test('weekly day toggles submit sorted actual choices, including Sunday and Saturday', async t => {
  const f = fixture({ request: call => call.method === 'POST' ? { automation: job({ schedule: call.body.schedule }) } : undefined }); t.after(() => f.close()); await f.flush();
  f.click('新建自动化'); f.type('自动化名称', '周末'); f.type('任务指令', '周末任务'); f.type('执行时间', 'weekly');
  for (const day of ['一', '二', '三', '四', '五']) f.type(`周${day}`, false);
  f.type('周六', true); f.type('周日', true); f.type('每日时间', '10:00'); f.type('计划时区', 'Asia/Shanghai'); f.submit(); await f.flush();
  assert.deepEqual(f.requests.find(item => item.method === 'POST').body.schedule, { kind: 'weekly', time: '10:00', timezone: 'Asia/Shanghai', weekdays: [0, 6] });
});

test('invalid schedule stays editable and does not start any network mutation', async t => {
  const f = fixture(); t.after(() => f.close()); await f.flush(); f.click('新建自动化'); f.type('自动化名称', '错误计划'); f.type('任务指令', '不要派发');
  f.type('执行时间', 'once'); f.type('一次执行时间', '2000-01-01T09:00'); f.submit(); await f.flush(); assert.match(f.text(), /未来/);
  f.type('执行时间', 'interval'); f.type('每隔分钟', '4'); f.submit(); await f.flush(); assert.match(f.text(), /5 至 10080/);
  f.type('执行时间', 'daily'); f.type('计划时区', 'Not/A_Valid_Zone'); f.submit(); await f.flush(); assert.match(f.text(), /IANA 时区/);
  assert.ok(f.requests.every(item => item.method === 'GET')); assert.equal(f.lastEditing.dirty, true); assert.equal(f.lastEditing.busy, false);
});

test('cancel editing shows an inline decision and preserves the form when continuing to edit', async t => {
  const f = fixture(); t.after(() => f.close()); await f.flush(); f.click('新建自动化'); f.type('自动化名称', '尚未保存'); f.click('取消编辑');
  assert.equal(f.field('自动化名称').props.value, '尚未保存'); assert.ok(f.dialog()); assert.equal(f.lastEditing.dirty, true); assert.equal(f.button('放弃修改').props.type, 'button');
  f.click('继续编辑'); assert.equal(f.dialog(), undefined); assert.equal(f.field('自动化名称').props.value, '尚未保存');
  f.click('取消编辑'); f.click('放弃修改'); await f.flush(); assert.equal(f.find('form'), undefined); assert.equal(f.lastEditing.dirty, false); assert.ok(f.requests.every(item => item.method === 'GET'));
});

test('reloading a changed plan requires an inline decision and then adopts the new server revision', async t => {
  const original = job(), latest = job({ title: '其他页面的新名称', prompt: '服务器的最新指令', revision: revisionTwo }); let writes = 0;
  const f = fixture({ initial: [original], request: call => {
    if (call.method === 'PATCH') { writes++; if (writes === 1) { f.setJobs([latest]); throw Object.assign(new Error('其他页面已修改此计划'), { status: 409 }); } return { automation: { ...latest, ...call.body, revision: revisionThree } }; }
  } }); t.after(() => f.close()); await f.flush(); f.click('编辑自动化：日报'); f.type('任务指令', '我的未保存修改'); f.submit(); await f.flush();
  const before = f.requests.length; f.click('重新载入最新版本'); assert.ok(f.dialog()); assert.equal(f.field('任务指令').props.value, '我的未保存修改'); assert.equal(f.button('载入最新版本').props.type, 'button');
  f.click('继续编辑'); assert.equal(f.dialog(), undefined); assert.equal(f.field('任务指令').props.value, '我的未保存修改'); assert.equal(f.requests.length, before);
  f.click('重新载入最新版本'); f.click('载入最新版本'); assert.equal(f.field('自动化名称').props.value, latest.title); assert.equal(f.field('任务指令').props.value, latest.prompt); assert.equal(f.lastEditing.dirty, false);
  f.type('任务指令', '基于最新版本保存'); f.submit(); await f.flush(); const mutations = f.requests.filter(item => item.method === 'PATCH'); assert.equal(mutations.length, 2); assert.equal(mutations[1].body.revision, revisionTwo);
});

test('a stale inline discard confirmation cannot erase editor contents after the account changes', async t => {
  const f = fixture(); t.after(() => f.close()); await f.flush(); f.click('新建自动化'); f.type('自动化名称', '旧账号的未保存名称'); f.click('取消编辑'); assert.ok(f.dialog());
  const callbacks = f.editing.length; f.changeSession({ notify: false }); f.click('放弃修改', { rerender: false }); f.render();
  assert.equal(f.field('自动化名称').props.value, '旧账号的未保存名称'); assert.equal(f.editing.length, callbacks); assert.ok(f.requests.every(item => item.method === 'GET'));
});

test('Escape cancels inline discard without saving, navigating or changing the edited values', async t => {
  const f = fixture(); t.after(() => f.close()); await f.flush(); f.click('新建自动化'); f.type('自动化名称', '保留名称'); f.type('任务指令', '保留指令'); f.click('取消编辑');
  assert.deepEqual(f.escape(), { prevented: true, stopped: true }); assert.equal(f.dialog(), undefined); assert.equal(f.field('自动化名称').props.value, '保留名称'); assert.equal(f.field('任务指令').props.value, '保留指令');
  assert.equal(f.lastEditing.dirty, true); assert.ok(f.requests.every(item => item.method === 'GET'));
});

test('Escape cancels inline reload and retains the local revision and draft', async t => {
  const latest = job({ prompt: '服务器新指令', revision: revisionTwo }); const f = fixture({ initial: [job()], request: call => { if (call.method === 'PATCH') { f.setJobs([latest]); throw Object.assign(new Error('revision conflict'), { status: 409 }); } } }); t.after(() => f.close()); await f.flush();
  f.click('编辑自动化：日报'); f.type('任务指令', '我的本地修改'); f.submit(); await f.flush(); const before = f.requests.length; f.click('重新载入最新版本'); assert.deepEqual(f.escape(), { prevented: true, stopped: true });
  assert.equal(f.dialog(), undefined); assert.equal(f.field('任务指令').props.value, '我的本地修改'); assert.ok(f.button('重新载入最新版本')); assert.equal(f.requests.length, before); assert.equal(f.lastEditing.dirty, true);
});

test('an inline confirmation fences stale background form and preference handlers before rerendering', async t => {
  const f = fixture(); t.after(() => f.close()); await f.flush(); f.click('新建自动化'); f.type('自动化名称', '冻结草稿'); f.type('任务指令', '必须先决定是否保留');
  f.click('取消编辑', { rerender: false }); f.type('自动化名称', '不应写入的陈旧输入', { rerender: false }); f.submit({ rerender: false }); f.type('允许 Agent 创建自动化', false, { rerender: false }); f.render();
  assert.ok(f.dialog()); assert.equal(f.field('自动化名称').props.value, '冻结草稿'); assert.ok(f.requests.every(item => item.method === 'GET')); f.click('继续编辑'); assert.equal(f.dialog(), undefined);
});

test('delete requires explicit confirmation, uses the actual revision, and does not delete on the first click', async t => {
  const current = job(), f = fixture({ initial: [current], request: call => call.method === 'DELETE' ? { deleted: true } : undefined }); t.after(() => f.close()); await f.flush();
  f.click('删除自动化：日报'); assert.equal(f.requests.filter(item => item.method === 'DELETE').length, 0); assert.ok(f.button('保留计划'));
  f.click('保留计划'); assert.equal(f.button('确认删除'), undefined); f.click('删除自动化：日报'); f.click('确认删除'); await f.flush();
  const writes = f.requests.filter(item => item.method === 'DELETE'); assert.equal(writes.length, 1); assert.deepEqual(writes[0].body, { revision: revisionOne });
  assert.equal(f.button('编辑自动化：日报'), undefined); assert.match(f.text(), /自动化已删除/);
});

test('Agent-create preference serializes rapid changes and adopts only the server readback', async t => {
  const writing = deferred(), f = fixture({ request: call => call.path === '/automations/preferences' ? writing.promise : undefined }); t.after(() => f.close()); await f.flush();
  f.type('允许 Agent 创建自动化', false, { rerender: false }); f.type('允许 Agent 创建自动化', true, { rerender: false }); assert.equal(f.requests.filter(item => item.method === 'PATCH').length, 1);
  await f.flush(); assert.equal(f.field('允许 Agent 创建自动化').props.checked, true, 'the old confirmed preference remains until the response');
  writing.resolve({ allowAgentCreate: false }); await f.flush(); assert.equal(f.field('允许 Agent 创建自动化').props.checked, false); assert.equal(f.lastEditing.busy, false);
});

test('unknown PATCH is reconciled by readback and does not repeat an already committed edit', async t => {
  let writes = 0; const original = job(); const f = fixture({ initial: [original], request: call => {
    if (call.method === 'PATCH') { writes++; f.setJobs([{ ...original, ...call.body, revision: revisionTwo }]); throw new TypeError('acknowledgement lost after commit'); }
  } }); t.after(() => f.close()); await f.flush(); f.click('编辑自动化：日报'); f.type('任务指令', '此前已保存的新指令'); f.submit(); await f.flush();
  assert.equal(f.lastEditing.busy, true); f.click('确认结果'); await f.flush();
  assert.equal(writes, 1); assert.equal(f.find('form'), undefined); assert.equal(f.lastEditing.busy, false); assert.equal(f.lastEditing.dirty, false); assert.match(f.text(), /已确认此前的修改/);
});

test('unknown PATCH keeps the original revision and payload when readback proves it has not committed', async t => {
  let writes = 0; const original = job(); const f = fixture({ initial: [original], request: call => {
    if (call.method === 'PATCH') { writes++; if (writes === 1) throw new TypeError('request did not reach server'); return { automation: { ...original, ...call.body, revision: revisionTwo } }; }
  } }); t.after(() => f.close()); await f.flush(); f.click('编辑自动化：日报'); f.type('任务指令', '明确确认后再保存'); f.submit(); await f.flush(); f.click('确认结果'); await f.flush();
  const calls = f.requests.filter(item => item.method === 'PATCH'); assert.equal(calls.length, 2); assert.deepEqual(calls[1].body, calls[0].body); assert.equal(f.lastEditing.busy, false);
});

test('stale refresh handlers after a session change cannot read a different account', async t => {
  const f = fixture(); t.after(() => f.close()); await f.flush(); f.changeSession({ notify: false }); f.click('刷新自动化', { rerender: false }); await f.flush();
  assert.equal(f.requests.length, 1, 'a handler captured under account one cannot begin a new account-two request');
});

test('old account input, editor and result handlers cannot change or navigate the new session before a rerender', async t => {
  const editing = fixture(); t.after(() => editing.close()); await editing.flush(); editing.click('新建自动化'); editing.type('任务指令', '旧账号当前草稿');
  const callbackCount = editing.editing.length; editing.changeSession({ notify: false }); editing.type('任务指令', '陈旧事件不能写入', { rerender: false }); editing.render();
  assert.equal(editing.field('任务指令').props.value, '旧账号当前草稿'); assert.equal(editing.editing.length, callbackCount);
  const completed = { id: '00000000-0000-4000-8000-000000000401', status: 'completed', conversationId: '00000000-0000-4000-8000-000000000501', startedAt: '2026-10-05T00:00:00.000Z' };
  const listing = fixture({ initial: [job({ runs: [completed] })] }); t.after(() => listing.close()); await listing.flush(); listing.changeSession({ notify: false });
  listing.click('编辑自动化：日报', { rerender: false }); listing.click('查看结果', { rerender: false }); await listing.flush();
  assert.equal(listing.find('form'), undefined); assert.deepEqual(listing.opened, []); assert.equal(listing.requests.length, 1);
});

test('an old initial read result is discarded when the account epoch changes while it is pending', async t => {
  const reading = deferred(), f = fixture({ request: call => call.method === 'GET' ? reading.promise : undefined }); t.after(() => f.close());
  f.changeSession({ notify: false }); reading.resolve({ allowAgentCreate: true, automations: [job({ title: '只属于旧账号的计划' })] }); await f.flush();
  assert.doesNotMatch(f.text(), /只属于旧账号的计划/); assert.equal(f.requests.length, 1); assert.equal(f.button('编辑自动化：只属于旧账号的计划'), undefined);
});

test('oldest-first stored runs render newest first and the first result button opens the most recent run', async t => {
  const older = { id: '00000000-0000-4000-8000-000000000401', status: 'error', conversationId: '00000000-0000-4000-8000-000000000501', startedAt: '2026-10-04T07:00:00.000Z', trigger: 'manual' };
  const newest = { id: '00000000-0000-4000-8000-000000000402', status: 'completed', conversationId: '00000000-0000-4000-8000-000000000502', startedAt: '2026-10-05T08:00:00.000Z', trigger: 'scheduled' };
  const f = fixture({ initial: [job({ runs: [older, newest] })] }); t.after(() => f.close()); await f.flush();
  assert.match(f.text(), /最近：已完成/); const runs = f.find('ol', props => props.className === 'automation-runs'); assert.ok(runs);
  const statuses = nodes(runs).filter(node => node.type === 'strong').map(node => text(node.props.children)); assert.deepEqual(statuses, ['已完成', '执行失败']);
  f.click('查看结果'); await f.flush(); assert.deepEqual(f.opened, [newest.conversationId]);
});

test('an old custom directory can be explicitly reset to the default workspace when the selected host no longer supports it', async t => {
  const current = job({ projectDirectory: 'C:\\fixture\\historical-project' }), availableHosts = hosts.map(host => ({ ...host, codex: { ...host.codex, projectDirectory: false } }));
  const f = fixture({ initial: [current], availableHosts, request: call => call.method === 'PATCH' ? { automation: { ...current, ...call.body, revision: revisionTwo } } : undefined }); t.after(() => f.close()); await f.flush();
  f.click('编辑自动化：日报'); assert.equal(f.field('自动化项目目录').props.disabled, true); assert.equal(f.field('自动化项目目录').props.value, current.projectDirectory);
  f.click('使用默认工作区'); assert.equal(f.field('自动化项目目录').props.value, ''); assert.equal(f.lastEditing.dirty, true); f.submit(); await f.flush();
  const calls = f.requests.filter(item => item.method === 'PATCH'); assert.equal(calls.length, 1); assert.equal(calls[0].body.projectDirectory, ''); assert.equal(calls[0].body.hostId, current.hostId); assert.equal(calls[0].body.revision, revisionOne);
});

const unknownRun = { id: '00000000-0000-4000-8000-000000000401', status: 'unknown', conversationId: '00000000-0000-4000-8000-000000000501', startedAt: '2026-10-05T08:00:00.000Z', trigger: 'manual' };

test('unknown task acknowledgement needs explicit stopped-task confirmation and does not resume or run by itself', async t => {
  const original = job({ enabled: false, nextRunAt: null, runs: [unknownRun] }), stopped = job({ enabled: false, nextRunAt: null, revision: revisionTwo, runs: [{ ...unknownRun, status: 'cancelled' }] });
  const f = fixture({ initial: [original], request: call => {
    if (call.path.endsWith('/acknowledge')) return { automation: stopped };
    if (call.method === 'PATCH') return { automation: { ...stopped, enabled: true, revision: revisionThree } };
  } }); t.after(() => f.close()); await f.flush();
  assert.equal(f.button('恢复自动化：日报').props.disabled, true); assert.equal(f.button('立即执行：日报').props.disabled, true);
  f.click('确认任务已停止'); await f.flush(); assert.equal(f.requests.filter(item => item.method === 'POST').length, 0); assert.ok(f.dialog()); assert.equal(f.button('确认已停止').props.type, 'button');
  f.click('保留待确认'); assert.equal(f.dialog(), undefined); f.click('确认任务已停止'); f.click('确认已停止', { rerender: false }); f.click('确认已停止', { rerender: false }); await f.flush();
  const writes = f.requests.filter(item => item.method === 'POST'); assert.equal(writes.length, 1); assert.equal(writes[0].path, '/automations/00000000-0000-4000-8000-000000000201/acknowledge');
  assert.deepEqual(writes[0].body, { revision: revisionOne, runId: unknownRun.id }); assert.equal(f.button('恢复自动化：日报').props.disabled, false); assert.equal(f.lastEditing.busy, false);
  assert.match(f.text(), /已暂停/); assert.equal(f.requests.some(item => item.path.endsWith('/run')), false, 'acknowledgement only releases the unknown lock');
  f.click('恢复自动化：日报'); await f.flush(); const resume = f.requests.find(item => item.method === 'PATCH'); assert.deepEqual(resume.body, { revision: revisionTwo, enabled: true });
  assert.equal(f.requests.some(item => item.path.endsWith('/run')), false, 'resuming a schedule does not immediately dispatch an old run');
});

test('unknown acknowledgement response is confirmed by cancelled-run readback without repeating the write or dispatching a task', async t => {
  const original = job({ enabled: false, nextRunAt: null, runs: [unknownRun] }), stopped = job({ enabled: false, nextRunAt: null, revision: revisionTwo, runs: [{ ...unknownRun, status: 'cancelled' }] }); let writes = 0;
  const f = fixture({ initial: [original], request: call => { if (call.path.endsWith('/acknowledge')) { writes++; f.setJobs([stopped]); throw new TypeError('acknowledgement response lost after commit'); } } }); t.after(() => f.close()); await f.flush();
  f.click('确认任务已停止'); f.click('确认已停止'); await f.flush(); assert.equal(f.lastEditing.busy, true); assert.equal(writes, 1);
  f.render(); await f.flush(); assert.equal(writes, 1); f.click('确认结果'); await f.flush();
  assert.equal(writes, 1); assert.equal(f.lastEditing.busy, false); assert.equal(f.button('确认任务已停止'), undefined); assert.match(f.text(), /已暂停/);
  assert.equal(f.requests.some(item => item.path.endsWith('/run')), false);
});

test('acknowledgement confirmation preserves its run ID and original revision when readback proves it has not committed', async t => {
  const original = job({ enabled: false, nextRunAt: null, runs: [unknownRun] }), stopped = job({ enabled: false, nextRunAt: null, revision: revisionTwo, runs: [{ ...unknownRun, status: 'cancelled' }] }); let writes = 0;
  const f = fixture({ initial: [original], request: call => { if (call.path.endsWith('/acknowledge')) { writes++; if (writes === 1) throw new TypeError('acknowledgement request never reached server'); return { automation: stopped }; } } }); t.after(() => f.close()); await f.flush();
  f.click('确认任务已停止'); f.click('确认已停止'); await f.flush(); f.click('确认结果'); await f.flush();
  const calls = f.requests.filter(item => item.path.endsWith('/acknowledge')); assert.equal(calls.length, 2); assert.deepEqual(calls[1].body, calls[0].body); assert.equal(f.lastEditing.busy, false);
  assert.equal(f.requests.some(item => item.path.endsWith('/run')), false); assert.match(f.text(), /已暂停/);
});

test('an inline stopped-task confirmation cannot acknowledge under a newly selected account', async t => {
  const f = fixture({ initial: [job({ enabled: false, nextRunAt: null, runs: [unknownRun] })] }); t.after(() => f.close()); await f.flush(); f.click('确认任务已停止'); assert.ok(f.dialog());
  f.changeSession({ notify: false }); f.click('确认已停止', { rerender: false }); await f.flush(); assert.equal(f.requests.length, 1); assert.equal(f.lastEditing.busy, false);
});

test('Escape preserves an unknown run and cancels the inline acknowledgement without any API mutation', async t => {
  const f = fixture({ initial: [job({ enabled: false, nextRunAt: null, runs: [unknownRun] })] }); t.after(() => f.close()); await f.flush(); f.click('确认任务已停止');
  assert.equal(f.lastEditing.dirty, true, 'the prompt protects parent navigation and task notifications'); assert.deepEqual(f.escape(), { prevented: true, stopped: true });
  assert.equal(f.dialog(), undefined); assert.ok(f.requests.every(item => item.method === 'GET')); assert.equal(f.button('恢复自动化：日报').props.disabled, true); assert.equal(f.button('立即执行：日报').props.disabled, true);
  assert.equal(f.lastEditing.dirty, false); assert.equal(f.lastEditing.busy, false);
});

test('an inline acknowledgement prompt blocks old create and preference events synchronously', async t => {
  const f = fixture({ initial: [job({ enabled: false, nextRunAt: null, runs: [unknownRun] })] }); t.after(() => f.close()); await f.flush(); f.click('确认任务已停止', { rerender: false });
  f.click('新建自动化', { rerender: false }); f.type('允许 Agent 创建自动化', false, { rerender: false }); f.render(); assert.ok(f.dialog()); assert.equal(f.find('form'), undefined); assert.ok(f.requests.every(item => item.method === 'GET'));
  f.click('保留待确认'); assert.equal(f.dialog(), undefined); assert.equal(f.lastEditing.dirty, false);
});
