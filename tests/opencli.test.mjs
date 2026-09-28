import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OpenCliRunner, validateBrowserAction, describeBrowserAction, openCliEnvironment, resolveBundledOpenCli } from '../server/opencli.mjs';

async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-opencli-'));
  const requests = [], launches = [], children = [];
  let raw = options.raw || null;
  let pageCount = 0;
  const tabs = new Map();
  const profiles = options.profiles ?? [{ contextId: 'chrome-a', extensionConnected: true, extensionVersion: '1.0.24' }, { contextId: 'chrome-b', extensionConnected: true, extensionVersion: '1.0.24' }];
  const runner = new OpenCliRunner({ dataDir: directory, timeoutMs: 1000, shutdownTimeoutMs: options.shutdownTimeoutMs ?? 30,
    checkPort: async () => options.portBusy || false,
    launch: (file, args, config) => {
      launches.push({ file, args, config });
      const child = Object.assign(new EventEmitter(), { pid: 1010 + children.length, killed: false, exitCode: null });
      child.signals = [];
      child.kill = (signal) => {
        child.signals.push(signal); child.killed = true;
        const finish = () => { child.exitCode = 0; if (raw?.pid === child.pid) raw = null; child.emit('exit', 0); child.emit('close', 0); };
        if (options.kill) options.kill(child, signal, finish);
        else finish();
      };
      children.push(child);
      raw = options.racingStatus || { ok: true, pid: child.pid, daemonVersion: '1.8.8', profiles };
      return child;
    },
    transport: async (url, init) => {
      assert.equal(new URL(url).hostname, '127.0.0.1');
      const body = init.body ? JSON.parse(init.body) : null;
      requests.push({ url, body });
      if (!body) {
        if (!raw) throw new Error('ECONNREFUSED');
        return Response.json(raw);
      }
      assert.equal(body.contextId, runner.selectedProfileId);
      assert.match(body.session, /^petpal-/);
      assert.equal(body.surface, 'browser');
      if (options.command) {
        const custom = await options.command(body, init, { tabs });
        if (custom) return custom;
      }
      if (body.action === 'tabs') {
        if (body.op === 'list') return Response.json({ ok: true, data: [...tabs.values(), { page: 'foreign-tab', url: 'https://mail.example/', title: 'Do not read' }] });
        if (body.op === 'new') {
          const page = `page-${++pageCount}`;
          tabs.set(page, { page, url: body.url, title: '音乐', active: true });
          return Response.json({ ok: true, page, data: null });
        }
        if (body.op === 'close') { tabs.delete(body.page); return Response.json({ ok: true, data: { closed: body.page } }); }
      }
      if (body.action === 'exec') {
        assert.match(body.code, /PetPal origin rejected/);
        // Verify every actual upstream helper is wrapped as valid JavaScript.
        new Function(`return ${body.code}`);
        if (body.code.includes('ANNOTATE_REFS')) return Response.json({ ok: true, data: options.snapshot || '[1]<button>播放</button>' });
        if (body.code.includes('window.__opencli_prev_hashes')) return Response.json({ ok: true, data: null });
        if (body.code.includes('no_resolved_element') && body.code.includes('expected')) return Response.json({ ok: true, data: { ok: true, actual: 'hello' } });
        return Response.json({ ok: true, data: { ok: true, matches_n: 1, match_level: 'exact', status: 'clicked', visible: true, hit: 'target', x: 1, y: 2 } });
      }
      throw new Error(`Unexpected command ${body.action}`);
    },
  });
  t.after(async () => { await runner.close(); await rm(directory, { recursive: true, force: true }); });
  return { runner, requests, launches, children, tabs, setStatus: (value) => { raw = value; } };
}

test('strict browser actions reject arbitrary execution, origins, selectors and injected fields', () => {
  for (const input of [null, [], { action: 'eval', code: 'alert(1)' }, { action: 'tabs', args: ['--help'] },
    { action: 'open', url: 'https://y.qq.com.evil.test/' }, { action: 'open', url: 'https://x@y.qq.com/' },
    { action: 'open', url: 'http://music.163.com' }, { action: 'open', url: 'file:///etc/passwd' },
    { action: 'click', tabId: 'page-1', target: 'button' }, { action: 'key', tabId: 'page-1', key: 'Ctrl+L' },
    { action: 'fill', tabId: 'page-1', target: 1, text: 'x'.repeat(2001) }, { action: 'connect', profileId: '--help' }]) {
    assert.throws(() => validateBrowserAction(input));
  }
  assert.equal(validateBrowserAction({ action: 'open', url: 'https://y.qq.com' }).url, 'https://y.qq.com/');
  assert.doesNotMatch(describeBrowserAction({ action: 'fill', tabId: 'p', target: 1, text: 'private-text' }), /private-text/);
  assert.doesNotMatch(describeBrowserAction({ action: 'open', url: 'https://y.qq.com/?token=private-token' }), /private-token/);
});

test('child home is isolated and inherits neither host credentials nor arbitrary Node/OpenCLI settings', () => {
  const input = { PATH: '/bin', HOME: '/real-home', USERPROFILE: 'C:\\real-home', NODE_OPTIONS: '--require bad', OPENCLI_PROFILE: 'wrong', OPENAI_API_KEY: 'secret' };
  const env = openCliEnvironment('/petpal-data', input);
  assert.notEqual(env.HOME, input.HOME);
  assert.equal(env.HOME, env.USERPROFILE);
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(env.CI, '1');
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.OPENCLI_PROFILE, undefined);
  assert.equal(input.HOME, '/real-home');
});

test('official runtime is pinned and its daemon and license resolve', async () => {
  const bundle = await resolveBundledOpenCli();
  assert.equal(bundle.version, '1.8.8');
  assert.match(bundle.daemon, /daemon\.js$/);
});

test('status is read only and never starts or takes ownership of an existing daemon', async (t) => {
  const f = await setup(t, { raw: { ok: true, pid: 77, daemonVersion: '0.1.0', profiles: [{ contextId: 'private', extensionConnected: true, extensionVersion: '1.0.24' }] } });
  const status = await f.runner.status();
  assert.equal(status.daemon.state, 'external');
  assert.equal(status.ready, false);
  assert.deepEqual(status.profiles, []);
  await assert.rejects(f.runner.execute({ action: 'connect' }), /不会接管/);
  await f.runner.close();
  assert.equal(f.launches.length, 0);
  assert.equal(f.requests.filter((r) => r.body).length, 0);
});

test('a non-OpenCLI busy port is also refused without launching or sending commands', async (t) => {
  const f = await setup(t, { portBusy: true });
  assert.equal((await f.runner.status()).daemon.state, 'unavailable');
  await assert.rejects(f.runner.execute({ action: 'connect' }), /不会接管/);
  assert.equal(f.launches.length, 0);
});

test('a racing process on the fixed port is not adopted or killed', async (t) => {
  const f = await setup(t, { racingStatus: { ok: true, pid: 99, daemonVersion: '1.8.8', profiles: [] } });
  await assert.rejects(f.runner.execute({ action: 'connect' }), /没有接管外部进程/);
  assert.equal(f.children[0].killed, true);
  assert.equal((await f.runner.status()).daemon.state, 'external');
  assert.equal(f.requests.filter((r) => r.body).length, 0);
});

test('connect requires explicit live profile, safely reports absent extension and never picks the lone profile', async (t) => {
  const f = await setup(t, { profiles: [] });
  const status = await f.runner.execute({ action: 'connect' });
  assert.equal(status.daemon.owned, true);
  assert.equal(status.extension.connected, false);
  assert.equal(status.ready, false);
  await assert.rejects(f.runner.execute({ action: 'connect', profileId: 'missing' }), /未连接/);
  const f2 = await setup(t, { profiles: [{ contextId: 'only-profile', extensionConnected: true, extensionVersion: '1.0.24' }] });
  assert.equal((await f2.runner.execute({ action: 'connect' })).ready, false);
  await assert.rejects(f2.runner.execute({ action: 'open', url: 'https://music.163.com/' }), /显式选择/);
  assert.equal(f2.requests.filter((r) => r.body).length, 0);
  assert.equal((await f2.runner.execute({ action: 'connect', profileId: 'only-profile' })).ready, true);
  assert.equal(f2.launches.length, 1);
  assert.equal(f2.launches[0].config.shell, false);
  assert.equal(f2.launches[0].config.windowsHide, true);
});

test('only tabs created by PetPal are returned and acted on; redirects revoke access', async (t) => {
  const f = await setup(t);
  await f.runner.execute({ action: 'connect', profileId: 'chrome-a' });
  const opened = await f.runner.execute({ action: 'open', url: 'https://y.qq.com/' });
  assert.equal(opened.tab.id, 'page-1');
  assert.equal((await f.runner.execute({ action: 'tabs' })).tabs.length, 1);
  await assert.rejects(f.runner.execute({ action: 'snapshot', tabId: 'foreign-tab' }), /小伴创建/);
  await assert.rejects(f.runner.execute({ action: 'tabs', profileId: 'chrome-b' }), /不一致/);
  await assert.rejects(f.runner.execute({ action: 'connect', profileId: 'chrome-b' }), /先关闭/);
  f.tabs.get('page-1').url = 'https://evil.test/';
  await assert.rejects(f.runner.execute({ action: 'snapshot', tabId: 'page-1' }), /离开允许/);
  assert.equal(f.requests.filter((r) => r.body?.action === 'exec').length, 0);
});

test('real upstream snapshot/click/key helpers use guarded finite scripts, and mutations invalidate refs', async (t) => {
  const f = await setup(t, { snapshot: '[1]<button>播放</button> password=secret-value Bearer private-token ' + '猫'.repeat(17000) });
  await f.runner.execute({ action: 'connect', profileId: 'chrome-a' });
  await f.runner.execute({ action: 'open', url: 'https://music.163.com/' });
  await assert.rejects(f.runner.execute({ action: 'click', tabId: 'page-1', target: 1 }), /先读取/);
  const result = await f.runner.execute({ action: 'snapshot', tabId: 'page-1' });
  assert.equal(result.snapshot.length, 16000);
  assert.equal(result.truncated, true);
  assert.doesNotMatch(result.snapshot, /secret-value|private-token/);
  await assert.rejects(f.runner.execute({ action: 'click', tabId: 'page-1', target: 99 }), /不在最近/);
  assert.equal((await f.runner.execute({ action: 'click', tabId: 'page-1', target: 1 })).completed, true);
  await assert.rejects(f.runner.execute({ action: 'key', tabId: 'page-1', key: 'Enter' }), /先读取/);
  await f.runner.execute({ action: 'snapshot', tabId: 'page-1' });
  assert.equal((await f.runner.execute({ action: 'key', tabId: 'page-1', key: 'Enter' })).completed, true);
  await f.runner.execute({ action: 'snapshot', tabId: 'page-1' });
  const filled = await f.runner.execute({ action: 'fill', tabId: 'page-1', target: 1, text: 'hello' });
  assert.equal(filled.completed, true);
  assert.doesNotMatch(JSON.stringify(filled), /hello/);
});

test('compatible external daemon attaches only on explicit connect, with one random lease per tab', async (t) => {
  const f = await setup(t, { raw: { ok: true, pid: 77, daemonVersion: '1.8.8', profiles: [{ contextId: 'chrome-a', extensionConnected: true, extensionVersion: '1.0.24' }] } });
  const before = await f.runner.status();
  assert.equal(before.daemon.state, 'external');
  assert.equal(before.daemon.compatible, true);
  assert.equal(before.ready, false);
  const connected = await f.runner.execute({ action: 'connect', profileId: 'chrome-a' });
  assert.equal(connected.daemon.state, 'shared');
  assert.equal(connected.daemon.owned, false);
  assert.equal(connected.ready, true);
  await f.runner.execute({ action: 'open', url: 'https://music.163.com/' });
  await f.runner.execute({ action: 'open', url: 'https://y.qq.com/' });
  assert.equal((await f.runner.execute({ action: 'tabs' })).tabs.length, 2);
  const opened = f.requests.filter((r) => r.body?.op === 'new').map((r) => r.body);
  assert.notEqual(opened[0].session, opened[1].session);
  await f.runner.execute({ action: 'close' });
  const closed = f.requests.filter((r) => r.body?.op === 'close').map((r) => r.body);
  assert.deepEqual(closed.map((c) => c.session), opened.map((c) => c.session));
  assert.equal(f.launches.length, 0);
  assert.equal(f.children.length, 0);
  assert.equal((await f.runner.status()).daemon.state, 'external');
  assert.ok(f.requests.every((r) => !r.url.endsWith('/shutdown')));
});

test('attached shared daemon cannot silently change its PID', async (t) => {
  const f = await setup(t, { raw: { ok: true, pid: 77, daemonVersion: '1.8.8', profiles: [{ contextId: 'chrome-a', extensionConnected: true, extensionVersion: '1.0.24' }] } });
  await f.runner.execute({ action: 'connect', profileId: 'chrome-a' });
  f.setStatus({ ok: true, pid: 78, daemonVersion: '1.8.8', profiles: [{ contextId: 'chrome-a', extensionConnected: true, extensionVersion: '1.0.24' }] });
  await assert.rejects(f.runner.execute({ action: 'open', url: 'https://y.qq.com/' }), /已断开/);
  assert.equal(f.launches.length, 0);
  assert.equal(f.requests.filter((r) => r.body).length, 0);
});

test('lost daemon identity causes failure with no command, restart or external shutdown', async (t) => {
  const f = await setup(t);
  await f.runner.execute({ action: 'connect', profileId: 'chrome-a' });
  f.setStatus({ ok: true, pid: 88, daemonVersion: '1.8.8', profiles: [] });
  await assert.rejects(f.runner.execute({ action: 'tabs' }), /已断开/);
  assert.equal(f.launches.length, 1);
  assert.equal(f.requests.filter((r) => r.body).length, 0);
  await f.runner.close();
  assert.equal(f.children[0].killed, true);
});

test('aborted operations do not dispatch and pending writes are never retried', async (t) => {
  const controller = new AbortController();
  let dispatches = 0;
  const f = await setup(t, { command: (body, init) => {
    if (body.op !== 'new') return null;
    dispatches++;
    controller.abort();
    return Response.json({ ok: true, page: 'page-race' });
  } });
  await f.runner.execute({ action: 'connect', profileId: 'chrome-a' });
  await assert.rejects(f.runner.execute({ action: 'open', url: 'https://y.qq.com/' }, { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(f.runner.execute({ action: 'open', url: 'https://y.qq.com/' }, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(dispatches, 1);
});

test('response byte limit rejects oversized bridge output and close only targets owned pages', async (t) => {
  const f = await setup(t, { command: (body) => body.action === 'exec' ? Response.json({ ok: true, data: 'x'.repeat(300000) }) : null });
  await f.runner.execute({ action: 'connect', profileId: 'chrome-a' });
  await f.runner.execute({ action: 'open', url: 'https://y.qq.com/' });
  await assert.rejects(f.runner.execute({ action: 'snapshot', tabId: 'page-1' }), /长度限制/);
  await f.runner.execute({ action: 'close' });
  assert.equal(f.children[0].killed, true);
  const closes = f.requests.filter((r) => r.body?.op === 'close');
  assert.equal(closes.length, 1);
  assert.equal(closes[0].body.page, 'page-1');
});

test('close awaits the owned child close event and shares concurrent shutdown work', async (t) => {
  let finishChild;
  const f = await setup(t, { shutdownTimeoutMs: 1000, kill: (_child, _signal, finish) => { finishChild = finish; } });
  await f.runner.execute({ action: 'connect', profileId: 'chrome-a' });
  let completed = false;
  const first = f.runner.close().then(() => { completed = true; });
  const second = f.runner.close();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(completed, false);
  assert.deepEqual(f.children[0].signals, ['SIGTERM']);
  finishChild();
  await Promise.all([first, second]);
  assert.equal(completed, true);
  assert.equal(f.children[0].exitCode, 0);
});

test('shutdown escalates only its retained owned child and has a finite failure bound', async (t) => {
  const f = await setup(t, { shutdownTimeoutMs: 15, kill: () => {} });
  await f.runner.execute({ action: 'connect', profileId: 'chrome-a' });
  await assert.rejects(f.runner.close(), /未在时限内退出/);
  assert.deepEqual(f.children[0].signals, ['SIGTERM', 'SIGKILL']);
  // Simulate eventual OS completion so the fixture leaves no outstanding child.
  f.children[0].exitCode = 0;
  f.children[0].emit('close', 0);
  await f.runner.close();
});

test('disconnect attempts every lease after a failure, reports it and never stops a shared daemon', async (t) => {
  const f = await setup(t, {
    raw: { ok: true, pid: 77, daemonVersion: '1.8.8', profiles: [{ contextId: 'chrome-a', extensionConnected: true, extensionVersion: '1.0.24' }] },
    command: (body) => body.op === 'close' && body.page === 'page-1' ? Response.json({ ok: false }, { status: 503 }) : null,
  });
  await f.runner.execute({ action: 'connect', profileId: 'chrome-a' });
  await f.runner.execute({ action: 'open', url: 'https://music.163.com/' });
  await f.runner.execute({ action: 'open', url: 'https://y.qq.com/' });
  await assert.rejects(f.runner.execute({ action: 'close' }), /1 个小伴网页未确认关闭/);
  assert.deepEqual(f.requests.filter((r) => r.body?.op === 'close').map((r) => r.body.page), ['page-1', 'page-2']);
  assert.equal(f.children.length, 0);
  assert.equal(f.tabs.has('page-2'), false);
  assert.equal((await f.runner.status()).daemon.state, 'external');
  assert.ok(f.requests.every((r) => !r.url.endsWith('/shutdown')));
});
