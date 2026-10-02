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

test('actual published metadata exposes only stable packages without filling absent platforms from previews', () => {
  const packages = publishedDownloadPackages(published);
  assert.equal(packages.length, 1);
  assert.deepEqual(packages.map(item => [item.platform, item.version, item.channel, item.format]), [['windows', '0.6.1', 'stable', 'portable-exe']]);
  assert.equal(packages[0].bytes, 180858957); assert.equal(packages[0].debug, false); assert.equal(packages[0].arch, 'x64');
  assert.equal(packages[0].sha256, 'f34f8d7ead1e418cb33dbe48fdd13f6ec445997b8e308a5373b99b6d4d30fd68');
  assert.equal(packages[0].url, published[1].assets[0].browser_download_url);
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

test('Windows ZIP and EXE packages keep their architecture, with ZIP preferred only within the same release and architecture', () => {
  const tag = 'v0.9.1';
  const names = ['PetPal-0.9.1-Windows-x64.exe', 'PetPal-0.9.1-Windows-arm64.exe', 'PetPal-0.9.1-Windows-x64.zip', 'PetPal-0.9.1-Windows-arm64.zip'];
  const zipDigest = 'a'.repeat(64);
  const fixture = release(tag, names.map((name, id) => asset(name, tag, { id: id + 80, ...(name.endsWith('.zip') ? { digest: `sha256:${zipDigest}` } : {}) })));
  const current = release('v0.9.2', [asset('PetPal-0.9.2-Windows-x64.exe', 'v0.9.2', { id: 90 })], { published_at: '2026-09-30T01:00:00Z' });
  const newest = publishedDownloadPackages([fixture, current]);
  assert.equal(newest.length, 1);
  assert.equal(newest[0].version, '0.9.2', 'an older ZIP or architecture must not fill a newer release');
  const packages = publishedDownloadPackages([fixture]);
  for (const arch of ['x64', 'arm64']) {
    const sameRelease = packages.filter(item => item.version === '0.9.1' && item.arch === arch);
    assert.deepEqual(sameRelease.map(item => item.format), ['portable-zip', 'portable-exe']);
    assert.equal(sameRelease[0].platform, 'windows');
    assert.equal(sameRelease[0].url, `${DOWNLOAD_RELEASES_URL}/download/${tag}/PetPal-0.9.1-Windows-${arch}.zip`);
    assert.equal(sameRelease[0].sha256, zipDigest);
    assert.equal(sameRelease[0].debug, false);
  }
  assert.equal(packages.filter(item => item.format === 'portable-exe').length, 2, 'EXE remains selectable');
});

test('global highest numeric stable version wins over release dates, order, lexical sorting and misleading preview flags', () => {
  const old=release('v0.9.99',[asset('PetPal-0.9.99-Windows-x64.zip','v0.9.99',{id:11})],{published_at:'2026-10-03T15:00:00Z'});
  const current=release('v0.10.0',[asset('PetPal-0.10.0-Android-release.apk','v0.10.0',{id:12})],{published_at:'2026-01-01T00:00:00Z'});
  const higherDraft=release('v1.0.0',[asset('PetPal-1.0.0-Windows-x64.zip','v1.0.0',{id:13})],{draft:true});
  const higherPreview=release('v2.0.0',[asset('PetPal-2.0.0-Windows-x64.zip','v2.0.0',{id:14})],{prerelease:true});
  const suffixes=['v3.0.0-preview.1','v3.0.0-rc1','v3.0.0-alpha','v3.0.0+build.1','v03.0.0'].map(tag=>release(tag,[asset(`PetPal-${tag.slice(1)}-Windows-x64.zip`,tag,{id:15})]));
  const all=[old,higherDraft,current,higherPreview,...suffixes];
  for(const list of [all,[...all].reverse()]){
    const packages=publishedDownloadPackages(list);assert.equal(packages.length,1);assert.equal(packages[0].version,'0.10.0');assert.equal(packages[0].platform,'android');assert.equal(packages[0].debug,false);
  }
  assert.deepEqual(publishedDownloadPackages([higherDraft,higherPreview,...suffixes]),[]);
});

test('a latest stable release with absent or invalid assets stays empty instead of falling back', () => {
  const previous=release('v0.9.6',[asset('PetPal-0.9.6-Windows-x64.zip','v0.9.6')]);
  const current=release('v0.9.7',[asset('PetPal-0.9.7-Windows-x64.zip','v0.9.7',{browser_download_url:'https://evil.test/package.zip'})]);
  for(const patch of [{},{assets:[]},{assets:null},{published_at:null},{assets:Array(101).fill(current.assets[0])}])assert.deepEqual(publishedDownloadPackages([previous,{...current,...patch}]),[]);
});

test('one latest version keeps all supported platforms, architectures and Windows formats', () => {
  const tag='v0.9.7',names=['Android-release.apk','Windows-x64.zip','Windows-x64.exe','Windows-arm64.zip','Windows-arm64.exe','Ubuntu-x64.tar.gz','Ubuntu-arm64.tar.gz'];
  const packages=publishedDownloadPackages([release(tag,names.map((suffix,index)=>asset(`PetPal-0.9.7-${suffix}`,tag,{id:200+index}))),...published]);
  assert.equal(packages.length,names.length);assert.ok(packages.every(item=>item.version==='0.9.7'&&item.channel==='stable'));
  assert.deepEqual(new Set(packages.map(item=>item.platform)),new Set(['android','windows','ubuntu']));
  for(const arch of ['x64','arm64'])assert.deepEqual(packages.filter(item=>item.platform==='windows'&&item.arch===arch).map(item=>item.format),['portable-zip','portable-exe']);
});

test('Windows ZIP accepts only an exact uploaded release asset, retaining version and trusted-URL validation', () => {
  const tag = 'v0.9.1', name = 'PetPal-0.9.1-Windows-x64.zip', good = asset(name, tag, { id: 100 });
  assert.equal(publishedDownloadPackages([release(tag, [good])])[0].format, 'portable-zip');
  for (const patch of [
    { name: 'PetPal-0.9.0-Windows-x64.zip' },
    { name: 'PetPal-0.9.1-Windows-ia32.zip' },
    { name: 'PetPal-0.9.1-Windows-x64.zip.exe' },
    { name: 'PetPal-0.9.1-Windows-x64.ZIP' },
    { browser_download_url: good.browser_download_url + '?private=token' },
    { browser_download_url: good.browser_download_url.replace('/v0.9.1/', '/v0.9.0/') },
    { browser_download_url: good.browser_download_url.replace('github.com', 'other.example') },
    { state: 'new' }, { size: 0 }, { size: 2 * 1024 ** 3 + 1 }, { id: -1 },
  ]) assert.deepEqual(publishedDownloadPackages([release(tag, [{ ...good, ...patch }])]), [], JSON.stringify(patch));
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
  assert.equal(calls, 1); assert.equal(second.packages.length, 1); assert.equal(first.error, null);
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
    async () => json([], { headers: { link: '<https://api.github.com/repos/lixinyu02/petpal/releases?per_page=100&page=2>; rel="next"' } }),
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
