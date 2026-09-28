import test from 'node:test';
import assert from 'node:assert/strict';
import { createDownloadsCatalog, publishedDownloadPackages, DOWNLOAD_API_URL, DOWNLOAD_RELEASES_URL } from '../server/downloads.mjs';

const asset = (name, tag, extra = {}) => ({ id: 1, name, state: 'uploaded', size: 1000, browser_download_url: `${DOWNLOAD_RELEASES_URL}/download/${tag}/${name}`, ...extra });
const release = (tag, assets, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, published_at: '2026-09-28T15:12:11Z', assets, ...extra });
// Public GitHub metadata observed on 2026-09-29. The real release has no Ubuntu asset.
const published = [
  release('v0.6.2', [asset('PetPal-0.6.2-Android-debug.apk', 'v0.6.2', { id: 596187853, size: 21561010, digest: 'sha256:e2c12c270f4f047460b8eb60fcb6ee853622cfe5469d4b920b730c8c0b86e314' }), asset('SHA256SUMS.txt', 'v0.6.2', { id: 596187857 })], { prerelease: true, published_at: '2026-09-28T19:26:16Z' }),
  release('v0.6.1', [asset('PetPal-0.6.1-Windows-x64.exe', 'v0.6.1', { id: 595626748, size: 180858957, digest: 'sha256:f34f8d7ead1e418cb33dbe48fdd13f6ec445997b8e308a5373b99b6d4d30fd68' }), asset('PetPal-0.6.1-Web.zip', 'v0.6.1', { id: 595603000 })]),
];
const json = (value, options) => new Response(JSON.stringify(value), options);
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

test('actual published stable and prerelease metadata yields exact public packages without inventing Ubuntu', () => {
  const packages = publishedDownloadPackages(published);
  assert.equal(packages.length, 2);
  assert.deepEqual(packages.map(item => [item.platform, item.version, item.channel, item.format]), [['android', '0.6.2', 'preview', 'apk'], ['windows', '0.6.1', 'stable', 'portable-exe']]);
  assert.equal(packages[0].bytes, 21561010); assert.equal(packages[0].debug, true); assert.equal(packages[0].arch, 'universal');
  assert.equal(packages[0].sha256, 'e2c12c270f4f047460b8eb60fcb6ee853622cfe5469d4b920b730c8c0b86e314');
  assert.equal(packages[1].url, published[1].assets[0].browser_download_url);
  assert.equal(packages.some(item => item.platform === 'ubuntu'), false);
});

test('synthetic uploaded Linux packages retain format/architecture; drafts and unpublished releases stay absent', () => {
  const names = ['PetPal-0.7.0-Ubuntu-x64.tar.gz', 'PetPal-0.7.0-Ubuntu-arm64.tar.gz', 'PetPal-0.7.0-Ubuntu-x64.AppImage', 'PetPal-0.7.0-Ubuntu-arm64.deb'];
  const fixture = release('v0.7.0', names.map((name, id) => asset(name, 'v0.7.0', { id: id + 10 })));
  const packages = publishedDownloadPackages([fixture]);
  assert.equal(packages.length, 4); assert.deepEqual(new Set(packages.map(item => item.format)), new Set(['tar.gz', 'appimage', 'deb']));
  assert.deepEqual(new Set(packages.map(item => item.arch)), new Set(['x64', 'arm64']));
  assert.equal(publishedDownloadPackages([{ ...fixture, draft: true }]).length, 0);
  assert.equal(publishedDownloadPackages([{ ...fixture, published_at: null }]).length, 0);
  assert.equal(publishedDownloadPackages([{ ...fixture, published_at: 'invalid' }]).length, 0);
});

test('a package requires matching filename version, exact trusted URL, uploaded state, valid size and unique asset id', () => {
  const good = published[0].assets[0];
  for (const patch of [
    { browser_download_url: 'https://evil.test/PetPal.apk' },
    { browser_download_url: good.browser_download_url + '?token=private' },
    { browser_download_url: good.browser_download_url.replace('github.com', 'user:password@github.com') },
    { browser_download_url: good.browser_download_url.replace('/lixinyu02/', '/other/') },
    { name: 'PetPal-0.6.1-Android-debug.apk' }, { name: '<script>.apk' }, { state: 'new' }, { size: 0 }, { size: -1 }, { size: 1.5 }, { size: 2 * 1024 ** 3 + 1 }, { id: '596187853' },
  ]) assert.equal(publishedDownloadPackages([release('v0.6.2', [{ ...good, ...patch }])]).length, 0, JSON.stringify(patch));
  const duplicate = publishedDownloadPackages([release('v0.6.2', [good, good])]); assert.equal(duplicate.length, 1);
  assert.equal(publishedDownloadPackages([release('v0.6.2', [{ ...good, digest: 'sha256:not-a-digest' }])])[0].sha256, undefined);
  assert.throws(() => publishedDownloadPackages({ message: 'API failure' }));
});

test('fixed GitHub endpoint has no credentials or redirects, concurrent reads share a fetch, and cache copies cannot be poisoned', async t => {
  let clock = 1000, calls = 0; const ready = deferred();
  const catalog = createDownloadsCatalog({ now: () => clock, cacheMs: 100, fetchImpl: async (url, options) => {
    calls++; assert.equal(url, DOWNLOAD_API_URL); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    assert.equal(Object.keys(options.headers).some(key => /authorization|cookie/i.test(key)), false);
    await ready.promise; return json(published);
  } }); t.after(() => catalog.close());
  const a = catalog.list({ url: 'https://evil.test' }), b = catalog.list();
  ready.resolve(); const first = await a, second = await b;
  assert.equal(calls, 1); assert.equal(second.packages.length, 2); assert.equal(first.error, null);
  first.packages[0].url = 'https://evil.test'; assert.notEqual((await catalog.list()).packages[0].url, first.packages[0].url);
  clock += 101; await catalog.list(); assert.equal(calls, 2);
});

test('failed refresh retains marked stale packages, throttles retries, then recovers with current published data', async t => {
  let clock = 1000, calls = 0, failing = false;
  const catalog = createDownloadsCatalog({ now: () => clock, cacheMs: 100, errorCacheMs: 20, fetchImpl: async () => {
    calls++; if (failing) throw new Error('private token and URL must not leak'); return json(published);
  } }); t.after(() => catalog.close());
  const valid = await catalog.list(); clock += 101; failing = true;
  const stale = await catalog.list(); assert.equal(stale.stale, true); assert.equal(stale.checkedAt, valid.checkedAt); assert.deepEqual(stale.packages, valid.packages);
  assert.doesNotMatch(stale.error, /private|token|URL/); assert.equal(Date.parse(stale.retryAt), clock + 20);
  failing = false; await catalog.list(); assert.equal(calls, 2);
  clock += 21; const restored = await catalog.list(); assert.equal(calls, 3); assert.equal(restored.stale, false); assert.equal(restored.error, null); assert.equal(restored.retryAt, null);
});

test('first failure returns no fabricated assets and rate limits expose a recoverable retry time', async t => {
  const catalog = createDownloadsCatalog({ now: () => 1000, fetchImpl: async () => json({ message: 'private debug message' }, { status: 403, headers: { 'x-ratelimit-remaining': '0' } }) });
  t.after(() => catalog.close()); const result = await catalog.list();
  assert.deepEqual(result.packages, []); assert.equal(result.checkedAt, null); assert.equal(result.stale, false); assert.match(result.error, /额度/); assert.equal(Date.parse(result.retryAt), 61000);
});

test('invalid, excessive and truncated metadata fail closed with visible errors', async t => {
  for (const fetchImpl of [
    async () => json({ message: 'not releases' }),
    async () => new Response('[{"unfinished"'),
    async () => new Response('[]', { headers: { 'content-length': '1000' } }),
    async () => new Response(' '.repeat(101)),
  ]) {
    const catalog = createDownloadsCatalog({ fetchImpl, responseLimit: 100 }); t.after(() => catalog.close());
    const result = await catalog.list(); assert.ok(result.error); assert.deepEqual(result.packages, []);
  }
});

test('timeout and service shutdown cancel metadata fetches without hanging', async t => {
  const keepAlive = setTimeout(() => {}, 1000); t.after(() => clearTimeout(keepAlive)); let signal;
  const timed = createDownloadsCatalog({ timeoutMs: 5, fetchImpl: async (_url, options) => { signal = options.signal; return new Promise(() => {}); } });
  t.after(() => timed.close()); const failed = await timed.list(); assert.ok(failed.error); assert.equal(signal.aborted, true);
  const closing = createDownloadsCatalog({ fetchImpl: async (_url, options) => { signal = options.signal; return new Promise(() => {}); } });
  const pending = closing.list(); await closing.close(); await pending; assert.equal(signal.aborted, true);
  await assert.rejects(closing.list(), /已关闭/);
});
