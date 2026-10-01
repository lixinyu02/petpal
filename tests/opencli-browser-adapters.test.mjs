import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OpenCliRunner, resolveBundledOpenCli } from '../server/opencli.mjs';
import { browserQueryPolicy } from '../server/opencli-browser-policies.mjs';
import { assertBrowserAdapterUrl, browserAdapterOrigins, browserAdapterNetworkRules, cleanBrowserAdapterRows, runBrowserAdapter } from '../server/opencli-browser-adapters.mjs';

const globals = { URL, URLSearchParams, Response, Headers, Blob, AbortSignal, setTimeout, clearTimeout, atob };
const query = (site, command, args = {}) => ({ site, command, arguments: args });
const builtIn = async (site, command, args, page, extra = {}) => runBrowserAdapter({ args: query(site, command, args), policy: browserQueryPolicy(site, command), page, ...extra });

function pageFixture({ document = { body: { innerText: '页面实际正文内容需要具有至少十二字。' }, title: '资料', querySelector: () => null, querySelectorAll: () => [] }, fetchImpl, additional = {} } = {}) {
  const urls = [], scripts = [];
  const location = new URL('https://pan.quark.cn/');
  const page = {
    goto: async url => { urls.push(url); location.href = url; },
    wait: async () => {},
    evaluate: async code => {
      scripts.push(code); new Function(`return (${code})`);
      const result = vm.runInNewContext(code, { ...globals, location, document, fetch: fetchImpl, ...additional });
      return typeof result === 'function' ? result() : result;
    },
  };
  return { page, urls, scripts };
}

function anchor(title, url, excluded = false) {
  return { href: url, textContent: title, closest: () => excluded ? {} : null };
}

function contentDocument(links = []) {
  const root = {
    innerText: '资源列表，这里是实际正文内容，不包含登录表单。',
    cloneNode: () => ({ innerText: '资源列表，这里是实际正文内容，不包含登录表单。', querySelectorAll: () => [] }),
    querySelectorAll: selector => selector.includes('DiscussionListItem') ? links.filter(link => /\/(?:d|post)\//.test(new URL(link.href).pathname)) : links,
  };
  return { body: root, title: '资料列表', querySelector: () => root, querySelectorAll: () => [] };
}

test('fixed browser adapter URLs reject foreign, insecure and credential-bearing navigation', () => {
  const policy = browserQueryPolicy('bilibili', 'search');
  assert.deepEqual(browserAdapterOrigins(policy), ['https://www.bilibili.com', 'https://search.bilibili.com']);
  for (const url of ['http://www.bilibili.com/', 'https://www.bilibili.com.evil.test/', 'https://secret@www.bilibili.com/', 'https://www.bilibili.com:8443/', 'file:///tmp/a']) assert.throws(() => assertBrowserAdapterUrl(url, policy.origins));
  assert.equal(assertBrowserAdapterUrl('https://www.bilibili.com/video/BV1xx411c7mD', policy.origins), 'https://www.bilibili.com/video/BV1xx411c7mD');
  assert.deepEqual(browserAdapterNetworkRules('tieba'), []);
  assert.ok(browserAdapterNetworkRules('quark').every(rule => rule.methods.every(method => ['GET', 'POST'].includes(method))));
});

test('configured reads use only reviewed content; links never open external URLs or include login/OAuth', async () => {
  const origin = 'https://bbs.dyyjv.com', external = 'https://pan.example.test/s/public-file';
  const f = pageFixture({ document: contentDocument([
    anchor('资料帖子', `${origin}/d/123`), anchor('登录', `${origin}/login`),
    anchor('QQ 授权', 'https://graph.qq.com/oauth2.0/authorize'), anchor('站外资料', external),
  ]) });
  const rows = await builtIn('dyyj', 'links', { url: origin + '/d/123', limit: 5 }, f.page);
  assert.deepEqual(Array.from(rows, row => row.title), ['资料帖子', '站外资料']);
  assert.equal(rows[1].external, true);
  assert.deepEqual(f.urls, [origin + '/d/123']);
  const latest = await builtIn('dyyj', 'latest', { limit: 5 }, f.page);
  assert.equal(latest.length, 1); assert.equal(latest[0].url, origin + '/d/123'); assert.equal(latest[0].source, 'visible-list');
});

test('Switch search uses observed native route; other configured searches explicitly query every site domain', async () => {
  const f = pageFixture({ document: contentDocument([anchor('搜索帖子', 'https://www.520switch.com/post/123')]) });
  await builtIn('switch520', 'search', { query: '测试 游戏', limit: 5 }, f.page);
  assert.equal(decodeURIComponent(f.urls[0]), 'https://www.520switch.com/search/测试 游戏/');
  const seen = [];
  const page = { goto: async url => seen.push(url), evaluate: async code => { assert.match(code, /https:\/\/bbs\.dyyjv\.com/); assert.match(code, /https:\/\/bbs\.dyyjmax\.org/); return [{ title: '帖子', url: 'https://bbs.dyyjv.com/d/123' }]; } };
  await builtIn('dyyj', 'search', { query: '示例', limit: 5 }, page);
  assert.match(decodeURIComponent(seen[0]), /site:bbs\.dyyjv\.com OR site:bbs\.dyyjmax\.org/);
  assert.equal(new URL(seen[0]).origin, 'https://www.bing.com');
});

test('Bing decodes source URLs without visiting them and rechecks credentials/protocol after decoding', async () => {
  const wrap = url => 'https://www.bing.com/ck/a?u=a1' + Buffer.from(url).toString('base64url');
  const urls = [wrap('https://user:private@bbs.dyyjv.com/d/invalid'), wrap('javascript:alert(1)'), wrap('https://bbs.dyyjv.com/d/valid')];
  const cards = urls.map((url,index) => ({textContent:`资料${index}`,querySelector:()=>anchor(`资料${index}`,url)}));
  const f = pageFixture({document:{body:{innerText:'搜索结果'},querySelectorAll:()=>cards}});
  const rows = await builtIn('dyyj','search',{query:'fixture',limit:5},f.page);
  assert.equal(rows.length,1);assert.equal(rows[0].url,'https://bbs.dyyjv.com/d/valid');assert.equal(rows[0].source,'bing-search');
  assert.equal(f.urls.length,1);assert.equal(new URL(f.urls[0]).origin,'https://www.bing.com');
  const publicRows = await builtIn('bing','search',{query:'fixture',limit:5},f.page);
  assert.equal(publicRows.length,1);assert.equal(publicRows[0].url,'https://bbs.dyyjv.com/d/valid');
});

test('real pinned Bilibili ranking module receives only fixed page APIs and returns bounded metadata', async () => {
  const bundle = await resolveBundledOpenCli();
  const requested = [];
  const f = pageFixture({ fetchImpl: async url => {
    requested.push(new URL(url));
    return Response.json({ code: 0, data: { list: [{ title: '示例视频', owner: { name: '作者' }, stat: { view: 12 }, bvid: 'BV1xx411c7mD' }] } });
  } });
  const rows = await builtIn('bilibili', 'ranking', { limit: 1 }, f.page, { bundleRoot: bundle.root });
  assert.equal(rows[0].title, '示例视频');
  assert.equal(requested[0].hostname, 'api.bilibili.com');
  assert.equal(requested[0].pathname, '/x/web-interface/ranking/v2');
  await assert.rejects(builtIn('bilibili', 'video', { bvid: 'https://b23.tv/private' }, f.page, { bundleRoot: bundle.root }), /BV/);
  const wrong = browserQueryPolicy('bilibili', 'ranking'); wrong.modulePath = 'bilibili/comment.js';
  await assert.rejects(runBrowserAdapter({ args: query('bilibili', 'ranking', { limit: 1 }), policy: wrong, page: f.page, bundleRoot: bundle.root }), /未开放/);
});

test('Quark share tree uses a finite first page and one child depth without exposing share token', async () => {
  const requests = [];
  const f = pageFixture({ fetchImpl: async (input, init) => {
    const url = new URL(input); requests.push({ url, init });
    if (url.pathname.endsWith('/token')) return Response.json({ status: 200, data: { stoken: 'synthetic-private-share-token' } });
    const list = url.searchParams.get('pdir_fid') === '0' ? [{ fid: 'folder', dir: true, file_name: '目录', size: 0 }, { fid: 'file', dir: false, file_name: '资料.txt', size: 12 }] : [{ fid: 'child', dir: false, file_name: '子项.txt', size: 20 }];
    return Response.json({ status: 200, data: { list }, metadata: { _total: 99999 } });
  } });
  const rows = await builtIn('quark', 'share-tree', { url: 'https://pan.quark.cn/s/AbCdEf123456', passcode: 'fixture9', depth: 1, limit: 3 }, f.page);
  assert.equal(rows.length, 3); assert.equal(rows[2].path, '目录/子项.txt');
  assert.equal(requests.length, 3); assert.ok(requests.slice(1).every(item => item.url.searchParams.get('_page') === '1'));
  assert.doesNotMatch(JSON.stringify(rows), /token|fixture9/);
  assert.equal(JSON.parse(requests[0].init.body).passcode, 'fixture9');
  await assert.rejects(builtIn('quark', 'share-tree', { url: 'https://pan.quark.cn/s/AbCdEf123456', depth: 2, limit: 3 }, f.page), /depth/);
});

test('Quark full first page stops traversal and account/auth errors do not return a successful empty list', async () => {
  let requests = 0;
  const f = pageFixture({ fetchImpl: async url => {
    requests++; const token = new URL(url).pathname.endsWith('/token');
    return Response.json({ status: 200, data: token ? { stoken: 'synthetic-only' } : { list: Array.from({ length: 50 }, (_, index) => ({ fid: String(index), dir: true, file_name: `目录${index}` })) } });
  } });
  assert.equal((await builtIn('quark', 'share-tree', { url: 'https://pan.quark.cn/s/AbCdEf123456', depth: 1, limit: 50 }, f.page)).length, 50);
  assert.equal(requests, 2);
  const failed = pageFixture({ fetchImpl: async () => Response.json({ status: 401, message: 'secret-upstream-error' }) });
  await assert.rejects(builtIn('quark', 'ls', { path: '', depth: 0, limit: 5 }, failed.page), error => /登录/.test(error.message) && !error.message.includes('secret-upstream-error'));
});

test('Baidu sharing preserves validated identifiers, hides URL passcode and reports visible file status', async () => {
  const file = { getAttribute: () => '', querySelector: selector => selector.includes('file-name') ? { getAttribute: () => '示例.txt', textContent: '示例.txt' } : null };
  const doc = { title: '测试分享', body: { innerText: '分享文件' }, querySelector: () => null, querySelectorAll: () => [file] };
  const f = pageFixture({ document: doc });
  const url = 'https://pan.baidu.com/share/init?surl=fixtureShare&pwd=abcd';
  const info = await builtIn('baidu-pan', 'share-info', { url, limit: 5 }, f.page);
  assert.equal(new URL(f.urls[0]).search, '?surl=fixtureShare');
  assert.equal(info[0].title, '测试分享'); assert.equal(info[0].available, true); assert.equal(info[0].visibleFiles, 1);
  const tree = await builtIn('baidu-pan', 'share-tree', { url, limit: 5, depth: 0 }, f.page);
  assert.equal(tree[0].name, '示例.txt'); assert.doesNotMatch(JSON.stringify(tree), /abcd/);
  const unavailable = pageFixture({ document: { title: '分享不可用', body: { innerText: '分享已取消' }, querySelector: () => null, querySelectorAll: () => [] } });
  assert.equal((await builtIn('baidu-pan', 'share-info', { url, limit: 5 }, unavailable.page))[0].available, false);
  await assert.rejects(builtIn('baidu-pan', 'share-tree', { url, limit: 5, depth: 0 }, unavailable.page), /不可用/);
});

test('result projection removes nested credentials and rejects overlarge rows or content', () => {
  const rows = cleanBrowserAdapterRows([{ stoken: 'secret', cookie: 'secret', api_key:'secret', apiKey:'secret', nested: { csrf: 'secret', text: 'pass fixture8' }, url: 'https://example.test/?pwd=fixture8' }], { passcode: 'fixture8' });
  assert.doesNotMatch(JSON.stringify(rows), /secret|fixture8|stoken|csrf/);
  assert.equal(rows[0].api_key,undefined);assert.equal(rows[0].apiKey,undefined);
  assert.throws(() => cleanBrowserAdapterRows(Array(51).fill({})), /50/);
  assert.throws(() => cleanBrowserAdapterRows([{ text: 'x'.repeat(128 * 1024) }]), /128/);
});

test('Xunlei share info and root listing read visible files only and do not open save/download actions', async () => {
  let clicked = false;
  const file = { getAttribute: () => '', querySelector: selector => selector.includes('file-name') ? { getAttribute: () => '示例文档.pdf', textContent: '示例文档.pdf' } : null, click: () => { clicked = true; } };
  const f = pageFixture({ document: { title: '迅雷资料分享', body: { innerText: '文件内容' }, querySelector: () => null, querySelectorAll: () => [file] } });
  const info = await builtIn('xunlei-pan', 'share-info', { url: 'https://pan.xunlei.com/s/FixtureShare', limit: 5 }, f.page);
  assert.equal(info[0].available, true); assert.equal(info[0].visibleFiles, 1);
  const rows = await builtIn('xunlei-pan', 'share-tree', { url: 'https://pan.xunlei.com/s/FixtureShare', depth: 0, limit: 5 }, f.page);
  assert.equal(rows[0].name, '示例文档.pdf'); assert.equal(clicked, false);
  assert.ok(f.urls.every(url => url === 'https://pan.xunlei.com/s/FixtureShare'));
});

test('share info distinguishes a required passcode from verified accessible files', async () => {
  const f = pageFixture({ document: { title: '提取分享', body: { innerText: '请输入提取码' }, querySelector: () => ({}), querySelectorAll: () => [] } });
  const result = await builtIn('baidu-pan', 'share-info', { url: 'https://pan.baidu.com/s/1FixtureShare', limit: 5 }, f.page);
  assert.equal(result[0].status, 'requires-passcode'); assert.equal(result[0].available, null);
  await assert.rejects(builtIn('baidu-pan', 'share-tree', { url: 'https://pan.baidu.com/s/1FixtureShare', depth: 0, limit: 5 }, f.page), /需要提取码/);
});

test('SPA content waits for actual body and fire notices use the observed route rather than initial empty markup', async () => {
  let reads = 0;
  const root = { cloneNode: () => ({ innerText: ++reads >= 3 ? '消防考试公告：当前页面显示的真实通知正文。' : '加载中', querySelectorAll: () => [] }), querySelectorAll: () => [] };
  const f = pageFixture({ document: { title: '消防职业技能考试', body: root, querySelector: () => root } });
  const rows = await builtIn('fire-exam', 'notice', { limit: 5 }, f.page);
  assert.ok(reads >= 3); assert.match(rows[0].text, /真实通知正文/); assert.equal(new URL(f.urls[0]).hash, '#/tzgg');
});

test('Bilibili favorite uses authenticated fixed GET APIs despite upstream write metadata', async () => {
  const bundle = await resolveBundledOpenCli(), requests = [];
  const f = pageFixture({ fetchImpl: async url => {
    const endpoint = new URL(url); requests.push(endpoint);
    if (endpoint.pathname.endsWith('/nav')) return Response.json({ code: 0, data: { isLogin: true, mid: 123, wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/fixture-key.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/fixture-sub.png' } } });
    if (endpoint.pathname.endsWith('/list-all')) return Response.json({ code: 0, data: { list: [{ id: 456 }] } });
    return Response.json({ code: 0, data: { medias: [{ title: '收藏资料', upper: { name: '作者' }, bvid: 'BV1xx411c7mD' }] } });
  } });
  const rows = await builtIn('bilibili', 'favorite', { limit: 5 }, f.page, { bundleRoot: bundle.root });
  assert.equal(rows[0].title, '收藏资料');
  assert.ok(requests.every(url => browserAdapterNetworkRules('bilibili')[0].paths.includes(url.pathname)));
  const last = requests.at(-1); assert.equal(last.searchParams.get('pn'), '1'); assert.equal(last.searchParams.get('ps'), '5');
  const loggedOut = pageFixture({ fetchImpl: async () => Response.json({ code: 0, data: { isLogin: false } }) });
  await assert.rejects(builtIn('bilibili', 'favorite', { limit: 5 }, loggedOut.page, { bundleRoot: bundle.root }), /登录/);
});

async function runnerFixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'petpal-adapter-'));
  const commands = [], tabs = new Map(), profile = { contextId: 'fixture-chrome', extensionConnected: true, extensionVersion: '1.0.24' };
  let pages = 0, raw = { ok: true, pid: 777, daemonVersion: '1.8.8', profiles: [profile] };
  const runner = new OpenCliRunner({ dataDir: directory, timeoutMs: options.timeoutMs ?? 2000, launch: () => { throw new Error('must not launch'); }, transport: async (_url, init) => {
    if (!init.body) return Response.json(raw);
    const body = JSON.parse(init.body); commands.push(body);
    if (options.command) { const result = await options.command(body, init); if (result) return result; }
    if (body.action === 'tabs' && body.op === 'new') { const page = `fixture-page-${++pages}`; tabs.set(page, new URL(body.url)); return Response.json({ ok: true, page }); }
    if (body.action === 'tabs' && body.op === 'close') { if (body.page) tabs.delete(body.page); else for (const [id] of tabs) tabs.delete(id); return Response.json({ ok: true, data: { closed: body.page } }); }
    if (body.action === 'navigate') { tabs.set(body.page, new URL(body.url)); return Response.json({ ok: true, page: body.page }); }
    if (body.action === 'exec') {
      new Function(`return (${body.code})`);
      const document = { body: {}, querySelectorAll: () => [] };
      // The complete guard and real pinned ranking script run inside the fixture.
      const result = await vm.runInNewContext(body.code, { ...globals, location: options.foreign ? new URL('https://foreign.example.test/') : tabs.get(body.page), document, fetch: options.fetchImpl || (async () => Response.json({ code: 0, data: { list: [{ title: '真实模块夹具', owner: { name: '作者' }, stat: { view: 12 }, bvid: 'BV1xx411c7mD' }] } })) });
      return Response.json({ ok: true, data: result });
    }
    throw new Error('unexpected fixture command');
  } });
  t.after(async () => { options.command = null; await runner.close(); await rm(directory, { recursive: true, force: true }); });
  return { runner, commands, tabs, setRaw: value => { raw = value; } };
}

test('runner never auto-connects or selects a profile, and ignores supplied module/origin overrides', async t => {
  const f = await runnerFixture(t);
  await assert.rejects(f.runner.executeAdapter(query('bilibili', 'ranking', { limit: 1 })), /断开|显式选择/);
  assert.equal(f.commands.length, 0);
  await f.runner.execute({ action: 'connect', profileId: 'fixture-chrome' });
  const result = await f.runner.executeAdapter(query('bilibili', 'ranking', { limit: 1 }), { policy: { site: 'bilibili', command: 'ranking', modulePath: '../../evil.js', origins: ['https://evil.example.test'], engine: 'builtin' } });
  assert.equal(result.rows[0].title, '真实模块夹具');
  assert.equal(f.runner.tabs.size, 0); assert.equal(f.runner.adapterLeases.size, 0); assert.equal(f.tabs.size, 0);
  assert.equal(f.commands.filter(body => body.action === 'tabs' && body.op === 'list').length, 0);
  const opened = f.commands.find(body => body.op === 'new'), closed = f.commands.find(body => body.op === 'close');
  assert.match(opened.session, /^petpal-query-/); assert.equal(closed.session, opened.session); assert.equal(closed.page, opened.page || 'fixture-page-1');
  assert.equal(opened.contextId, 'fixture-chrome'); assert.equal(opened.url, 'https://www.bilibili.com/');
  await assert.rejects(f.runner.execute({ action: 'snapshot', tabId: 'fixture-page-1' }), /小伴创建/);
  await assert.rejects(f.runner.executeAdapter({ site: 'bilibili', command: 'ranking', arguments: { limit: 1 }, code: 'steal()' }), /字段/);
});

test('query guard rejects a redirected document, closes only its own lease and performs no retry', async t => {
  const f = await runnerFixture(t, { foreign: true });
  await f.runner.execute({ action: 'connect', profileId: 'fixture-chrome' });
  await assert.rejects(f.runner.executeAdapter(query('bilibili', 'ranking', { limit: 1 })), /origin rejected/);
  assert.equal(f.commands.filter(body => body.action === 'exec').length, 1);
  assert.equal(f.commands.filter(body => body.op === 'close').length, 1);
  assert.equal(f.tabs.size, 0);
});

test('cancellation during tab creation still closes the random session without using user tabs', async t => {
  const controller = new AbortController();
  const f = await runnerFixture(t, { command: body => { if (body.op === 'new') { controller.abort(); return Response.json({ ok: true, page: 'cancelled-page' }); } } });
  await f.runner.execute({ action: 'connect', profileId: 'fixture-chrome' });
  await assert.rejects(f.runner.executeAdapter(query('bilibili', 'ranking', { limit: 1 }), { signal: controller.signal }), { name: 'AbortError' });
  const opened = f.commands.find(body => body.op === 'new'), closed = f.commands.find(body => body.op === 'close');
  assert.equal(opened.session, closed.session); assert.equal(closed.page, undefined);
  assert.equal(f.commands.filter(body => body.op === 'new').length, 1);
  assert.equal(f.commands.filter(body => body.action === 'exec').length, 0);
});

test('failed lease cleanup retains ownership and blocks another query until explicit disconnect', async t => {
  let rejectClose = true;
  const f = await runnerFixture(t, { command: body => body.op === 'close' && rejectClose ? Response.json({ ok: false }, { status: 503 }) : null });
  await f.runner.execute({ action: 'connect', profileId: 'fixture-chrome' });
  await assert.rejects(f.runner.executeAdapter(query('bilibili', 'ranking', { limit: 1 })), /未确认关闭/);
  assert.equal(f.runner.adapterLeases.size, 1);
  await assert.rejects(f.runner.executeAdapter(query('bilibili', 'ranking', { limit: 1 })), /上次查询/);
  assert.equal(f.commands.filter(body => body.op === 'new').length, 1);
  await assert.rejects(f.runner.execute({ action: 'close' }), /未确认关闭/);
  assert.equal(f.runner.selectedProfileId, 'fixture-chrome'); assert.equal(f.runner.sharedPid, 777);
  assert.equal(f.runner.adapterLeases.size, 1);
  f.setRaw({ok:true,pid:777,daemonVersion:'1.8.8',profiles:[{contextId:'fixture-chrome',extensionConnected:true,extensionVersion:'1.0.24'},{contextId:'fixture-other',extensionConnected:true,extensionVersion:'1.0.24'}]});
  await assert.rejects(f.runner.execute({action:'connect',profileId:'fixture-other'}),/先关闭/);
  await f.runner.execute({action:'connect',profileId:'fixture-chrome'});
  rejectClose = false; await f.runner.execute({ action: 'close' });
  assert.equal(f.runner.adapterLeases.size, 0);
  assert.equal(f.runner.selectedProfileId,null);assert.equal(f.runner.sharedPid,null);
  const closes=f.commands.filter(body=>body.op==='close');
  assert.equal(closes.length,3);assert.ok(closes.every(body=>body.page==='fixture-page-1'&&body.session===closes[0].session));
});

test('terminal runner close retains exact query ownership after failure and can complete on a later close', async t => {
  let rejectClose = true;
  const f = await runnerFixture(t, { command: body => body.op === 'close' && rejectClose ? Response.json({ok:false},{status:503}) : null });
  await f.runner.execute({action:'connect',profileId:'fixture-chrome'});
  await assert.rejects(f.runner.executeAdapter(query('bilibili','ranking',{limit:1})),/未确认关闭/);
  await assert.rejects(f.runner.close(),/未确认关闭/);
  assert.equal(f.runner.sharedPid,777);assert.equal(f.runner.selectedProfileId,'fixture-chrome');assert.equal(f.runner.adapterLeases.size,1);
  rejectClose=false;await f.runner.close();
  assert.equal(f.runner.adapterLeases.size,0);assert.equal(f.runner.selectedProfileId,null);assert.equal(f.runner.sharedPid,null);
});

test('Bilibili API refusal is reported rather than converted to an empty success result', async t => {
  const f = await runnerFixture(t, { fetchImpl: async () => Response.json({ code: -101, message: 'fixture-private-upstream-message' }) });
  await f.runner.execute({ action: 'connect', profileId: 'fixture-chrome' });
  await assert.rejects(f.runner.executeAdapter(query('bilibili', 'ranking', { limit: 1 })), error => /API 拒绝/.test(error.message) && !error.message.includes('fixture-private'));
  assert.equal(f.commands.filter(body => body.op === 'close').length, 1);
});

test('total query deadline aborts the in-flight browser API and closes the same lease without retry', async t => {
  let aborted = false;
  const f = await runnerFixture(t, { timeoutMs: 80, fetchImpl: (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('fixture API stopped')); }, { once: true })) });
  await f.runner.execute({ action: 'connect', profileId: 'fixture-chrome' });
  await assert.rejects(f.runner.executeAdapter(query('bilibili', 'ranking', { limit: 1 })), error => error.code === 'timeout' && error.status === 504);
  assert.equal(f.commands.filter(body => body.op === 'new').length, 1);
  assert.equal(f.commands.filter(body => body.op === 'close').length, 1);
  assert.equal(f.runner.adapterLeases.size, 0);
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(aborted, true);
});

test('runner close waits for cancelled adapter cleanup before clearing the shared daemon/profile', async t => {
  let started; const entered = new Promise(resolve => { started = resolve; });
  const f = await runnerFixture(t, { command: (body, init) => {
    if (body.action !== 'exec') return null;
    started(); return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('fixture cancelled')), { once: true }));
  } });
  await f.runner.execute({ action: 'connect', profileId: 'fixture-chrome' });
  const pending = f.runner.executeAdapter(query('bilibili', 'ranking', { limit: 1 })).catch(error => error);
  await entered; await f.runner.close();
  assert.equal((await pending).name, 'AbortError');
  assert.equal(f.runner.adapterLeases.size, 0); assert.equal(f.runner.selectedProfileId, null);
  assert.equal(f.commands.filter(body => body.op === 'close').length, 1);
});
