import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NOTEBOOK_WEBSITES, OPENCLI_BROWSER_POLICIES, browserQueryPolicy, describeOpenCliQueryArguments, normalizeSiteOrigins, notebookWebsiteCatalog, validateBrowserQueryUrl } from '../server/opencli-browser-policies.mjs';
import { loadOpenCliCatalog, resolveOpenCliQueryBundle, validateOpenCliQuery } from '../server/opencli-sites.mjs';

const expectedOrigins = {
  dyyj: ['https://bbs.dyyjv.com', 'https://bbs.dyyjmax.org'],
  'baidu-pan': ['https://pan.baidu.com'],
  switch520: ['https://www.520switch.com', 'https://520switch.com'],
  gamer520: ['https://www.gamer520.com', 'https://gamer520.com'],
  bing: ['https://www.bing.com', 'https://cn.bing.com'],
  dygang: ['https://dygangs.me'],
  wlgo: ['https://www.wlgooo.com', 'https://wlgooo.com'],
  'baidu-search': ['https://www.baidu.com'],
  'fire-exam': ['https://xfhyjd.119.gov.cn'],
  tieba: ['https://tieba.baidu.com'],
  bilibili: ['https://www.bilibili.com', 'https://search.bilibili.com'],
  quark: ['https://pan.quark.cn'],
  'xunlei-pan': ['https://pan.xunlei.com'],
  zhihu:['https://www.zhihu.com'],
  weibo:['https://weibo.com','https://s.weibo.com'],
  douban:['https://movie.douban.com','https://book.douban.com'],
  jd:['https://search.jd.com'],
  taobao:['https://s.taobao.com'],
  xiaohongshu:['https://www.xiaohongshu.com'],
  douyin:['https://www.douyin.com'],
};
const configuredSites = ['dygang', 'dyyj', 'fire-exam', 'gamer520', 'switch520', 'wlgo'];
const shareUrls = { 'baidu-pan': 'https://pan.baidu.com/s/1abcdeFGH', quark: 'https://pan.quark.cn/s/abcdef12', 'xunlei-pan': 'https://pan.xunlei.com/s/abcdef12' };
const requiredArguments = policy => Object.fromEntries(policy.inputSchema.required.map(key => [key, key === 'url' ? shareUrls[policy.site] || `${policy.origins[0]}/article/1` : key === 'bvid' ? 'BV1xx411c7mD' : key === 'id' ? '1' : '小猫']));

test('common website catalog keeps supplied and popular sites separate from six configurable entries', () => {
  assert.deepEqual(Object.fromEntries(NOTEBOOK_WEBSITES.map(site => [site.site, site.origins])), expectedOrigins);
  assert.deepEqual(NOTEBOOK_WEBSITES.filter(site => site.maxOrigins).map(site => site.site).sort(), configuredSites);
  const catalog = notebookWebsiteCatalog({ dyyj: ['https://film.example.com'] });
  assert.equal(catalog.length, 20);
  assert.ok(catalog.every(site => site.status === 'ready' && site.commands.length));
  assert.deepEqual(catalog.find(site => site.site === 'dyyj').origins, ['https://film.example.com']);
  assert.deepEqual(catalog.find(site => site.site === 'wlgo').origins, expectedOrigins.wlgo);
  catalog.find(site => site.site === 'wlgo').origins.push('https://mutable.example.com');
  assert.deepEqual(notebookWebsiteCatalog().find(site => site.site === 'wlgo').origins, expectedOrigins.wlgo);
});

test('site origin overrides accept only six human-configurable HTTPS origins and canonicalize without extra fields', () => {
  assert.deepEqual(normalizeSiteOrigins({ wlgo: ['https://CUSTOM.example.com/'], dyyj: ['https://film.example.com', 'https://film.example.com/'] }), { dyyj: ['https://film.example.com'], wlgo: ['https://custom.example.com'] });
  assert.deepEqual(normalizeSiteOrigins({ dyyj: [], wlgo: [] }), {});
  for (const value of [null, [], { unknown: [] }, { bilibili: ['https://www.bilibili.com'] }, { dyyj: 'https://film.example.com' }, { wlgo: ['https://a.example.com', 'https://b.example.com'] }, { dyyj: ['https://a.example.com', 'https://b.example.com', 'https://c.example.com'] }]) {
    assert.throws(() => normalizeSiteOrigins(value), error => error.status === 400 && error.code === 'invalid_arguments');
  }
  for (const origin of ['http://example.com', 'https://example.com:8443', 'https://user:private@example.com', 'https://example.com/path', 'https://example.com?token=private', 'https://example.com#secret', 'https://127.0.0.1', 'https://2130706433', 'https://[::1]', 'https://localhost', 'https://host.local', 'https://host.lan', 'https://host.internal', 'https://host.invalid', 'https://example.com\n', ' https://example.com', 'https://example.com/ ']) {
    assert.throws(() => normalizeSiteOrigins({ wlgo: [origin] }), undefined, origin);
  }
});

test('each reviewed browser policy validates its fixed typed schema and refuses execution hints or credentials', () => {
  for (const policy of OPENCLI_BROWSER_POLICIES) {
    const args = { site: policy.site, command: policy.command, arguments: requiredArguments(policy) };
    const normalized = validateOpenCliQuery(args);
    assert.equal(normalized.site, policy.site);
    assert.equal(policy.inputSchema.additionalProperties, false);
    validateBrowserQueryUrl(normalized);
    for (const extra of ['profileId', 'modulePath', 'source', 'siteOrigins', 'cookie', 'token', 'script']) {
      assert.throws(() => validateOpenCliQuery({ ...args, arguments: { ...args.arguments, [extra]: 'untrusted' } }), undefined, `${policy.site}/${policy.command}:${extra}`);
    }
    for (const [key, schema] of Object.entries(policy.inputSchema.properties)) {
      for (const invalid of schema.type === 'integer' ? [String(schema.default || 1), schema.minimum - 1, schema.maximum + 1, 1.5, NaN] : [123, [], {}, '\u0000secret', 'a'.repeat(schema.maxLength + 1)]) {
        assert.throws(() => validateOpenCliQuery({ ...args, arguments: { ...args.arguments, [key]: invalid } }), undefined, `${policy.site}/${policy.command}:${key}`);
      }
    }
  }
  assert.equal(browserQueryPolicy('bilibili', 'favorite').engine, 'builtin');
  for (const [site, command] of [['quark', 'save'], ['baidu-pan', 'download'], ['xunlei-pan', 'save'], ['tieba', 'post'], ['bilibili', 'like'], ['fire-exam', 'submit']]) assert.throws(() => validateOpenCliQuery({ site, command, arguments: {} }));
  const clone = browserQueryPolicy('tieba', 'read'); clone.origins.push('https://untrusted.example.com'); clone.inputSchema.properties.id.pattern = '.*';
  assert.deepEqual(browserQueryPolicy('tieba', 'read').origins, expectedOrigins.tieba);
  assert.throws(() => validateOpenCliQuery({ site: 'tieba', command: 'read', arguments: { id: '../../admin' } }));
});

test('share URL validation rejects source expansion, wrong routes and unsupported share credentials', () => {
  for (const [site, url] of Object.entries(shareUrls)) {
    const args = validateOpenCliQuery({ site, command: 'share-tree', arguments: { url, passcode: 'Ab12' } });
    validateBrowserQueryUrl(args);
    validateBrowserQueryUrl({ ...args, arguments: { ...args.arguments, url: `${url}?pwd=Ab12` } });
    for (const candidate of [url.replace('https:', 'http:'), url.replace('https://', 'https://private@'), url.replace('.com/', '.com.evil.test/').replace('.cn/', '.cn.evil.test/'), url.replace('/s/', ':8443/s/'), url.replace('/s/', '/admin/'), `${url}#private`, `${url}?token=private`, `${url}?pwd=bad-value`, `${url}?redirect=https://evil.test`]) {
      assert.throws(() => validateBrowserQueryUrl({ ...args, arguments: { ...args.arguments, url: candidate } }), undefined, `${site}:${candidate}`);
    }
  }
  const page = validateOpenCliQuery({ site: 'dyyj', command: 'read', arguments: { url: 'https://film.example.com/article/1' } });
  assert.throws(() => validateBrowserQueryUrl(page));
  validateBrowserQueryUrl(page, { dyyj: ['https://film.example.com'] });
  assert.throws(() => validateBrowserQueryUrl({ ...page, arguments: { ...page.arguments, url: 'https://film.example.com.evil.test/article/1' } }, { dyyj: ['https://film.example.com'] }));
  assert.throws(() => validateBrowserQueryUrl({ ...page, arguments: { ...page.arguments, url: expectedOrigins.dyyj[0] } }, { dyyj: ['https://film.example.com'] }));
});

test('share descriptions redact the whole URL and passcode while retaining bounded nonsecret arguments', () => {
  for (const [site, url] of Object.entries(shareUrls)) {
    const args = validateOpenCliQuery({ site, command: 'share-tree', arguments: { url: `${url}?pwd=Y7gX`, passcode: 'S9pQ', limit: 3 } });
    const description = describeOpenCliQueryArguments(args);
    assert.doesNotMatch(description, /Y7gX|S9pQ|https:|abcdef12|1abcdeFGH/);
    assert.deepEqual(JSON.parse(description), { url: '[已隐藏]', passcode: '[已隐藏]', depth: 0, limit: 3 });
  }
  const status = validateOpenCliQuery({ site: 'fire-exam', command: 'status', arguments: { url: 'https://xfhyjd.119.gov.cn/status?application=private' } });
  assert.doesNotMatch(describeOpenCliQueryArguments(status), /application|https:|private/);
});

async function catalogFixture(t, mutate) {
  const bundle = await resolveOpenCliQueryBundle();
  const manifest = JSON.parse(await readFile(path.join(bundle.root, 'cli-manifest.json'), 'utf8'));
  mutate(manifest);
  const root = await mkdtemp(path.join(tmpdir(), 'petpal-opencli-notebook-catalog-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'dist', 'src'), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, 'package.json'), JSON.stringify({ name: '@jackwener/opencli', version: '1.8.8' })),
    writeFile(path.join(root, 'cli-manifest.json'), JSON.stringify(manifest)),
    ...['execution.js', 'registry.js'].map(file => writeFile(path.join(root, 'dist', 'src', file), '')),
    writeFile(path.join(root, 'LICENSE'), 'fixture'),
  ]);
  return path.join(root, 'package.json');
}

test('catalog rejects modified pinned public and upstream browser modules before making them callable', async t => {
  for (const changes of [
    { site: 'npm', name: 'package', access: 'write' },
    { site: 'npm', name: 'package', browser: true },
    { site: 'npm', name: 'package', modulePath: '../plugin.js' },
    { site: 'tieba', name: 'read', access: 'write' },
    { site: 'tieba', name: 'read', modulePath: 'tieba/post.js' },
    { site: 'bilibili', name: 'video', browser: false },
  ]) {
    const metadata = await catalogFixture(t, manifest => Object.assign(manifest.find(entry => entry.site === changes.site && entry.name === changes.name), changes));
    await assert.rejects(loadOpenCliCatalog(metadata), /固定清单不匹配/);
  }
});

test('builtin favorite catalog uses reviewed read metadata and does not open other inventory writes', async t => {
  const metadata = await catalogFixture(t, manifest => {
    Object.assign(manifest.find(entry => entry.site === 'bilibili' && entry.name === 'favorite'), { access: 'write', strategy: 'mutation', browser: true, description: 'add to collection' });
  });
  const catalog = await loadOpenCliCatalog(metadata);
  const favorite = catalog.records.find(entry => entry.site === 'bilibili' && entry.command === 'favorite');
  assert.equal(favorite.callable, true); assert.equal(favorite.access, 'read'); assert.equal(favorite.mode, 'browser');
  assert.doesNotMatch(favorite.description, /add to collection/);
  assert.ok(catalog.records.filter(entry => entry.access === 'write').every(entry => !entry.callable && entry.mode === 'inventory'));
});
