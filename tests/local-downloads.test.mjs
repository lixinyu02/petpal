import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { createLocalDownloads } from '../server/local-downloads.mjs';
import { createDownloadsCatalog, DOWNLOAD_RELEASES_URL } from '../server/downloads.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const name = (version = '0.9.7', suffix = 'Windows-x64.zip') => `PetPal-${version}-${suffix}`;
const target = filename => filename.includes('-Windows-') ? 'windows-' + filename.match(/Windows-(x64|arm64)/)[1] :
  filename.includes('-Ubuntu-') ? 'ubuntu-' + filename.match(/Ubuntu-(x64|arm64)/)[1] : filename.includes('-Web.') ? 'web' : 'android';
const githubRelease = (version, names) => ({ tag_name: 'v' + version, draft: false, prerelease: false,
  published_at: '2026-10-04T00:00:00Z', assets: names.map((filename, index) => ({ name: filename, id: index + 1, state: 'uploaded',
    size: 100, browser_download_url: `${DOWNLOAD_RELEASES_URL}/download/v${version}/${filename}` })) });

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'petpal-local-downloads-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('petpal-local-downloads-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  async function publish(version = '0.9.7', names = [name(version)], { channel = 'stable' } = {}) {
    const files = [];
    for (const filename of names) {
      const bytes = Buffer.from('isolated-package-fixture:' + filename);
      await fs.writeFile(path.join(directory, filename), bytes);
      files.push({ name: filename, target: target(filename), bytes: bytes.length, sha256: digest(bytes) });
    }
    const manifest = { version, channel, createdAt: '2026-10-04T00:00:00Z', files };
    await fs.writeFile(path.join(directory, `release-manifest-${version}.json`), JSON.stringify(manifest));
    await fs.writeFile(path.join(directory, `SHA256SUMS-${version}.txt`), files.map(file => `${file.sha256}  ${file.name}\n`).join(''));
    return manifest;
  }
  const local = options => createLocalDownloads({ directory, releasesUrl: DOWNLOAD_RELEASES_URL, ...options });
  const catalog = options => createDownloadsCatalog({ localDirectory: directory, ...options });
  return { directory, publish, local, catalog };
}

test('a validated manifest exposes all local clients and keeps the official Web archive out of the client picker', async t => {
  const f = await fixture(t), filenames = [name(), name('0.9.7', 'Windows-x64.exe'), name('0.9.7', 'Android-debug.apk'),
    name('0.9.7', 'Ubuntu-x64.tar.gz'), name('0.9.7', 'Ubuntu-arm64.tar.gz'), name('0.9.7', 'Web.zip')];
  const manifest = await f.publish('0.9.7', filenames), catalog = f.local(); t.after(() => catalog.close());
  const result = await catalog.list();
  assert.equal(result.latestVersion, '0.9.7'); assert.equal(result.error, null); assert.equal(result.packages.length, 5);
  assert.ok(result.packages.every(item => item.source === 'server' && item.channel === 'stable' && item.url === '/downloads/' + item.filename));
  assert.equal(result.packages.find(item => item.platform === 'android').debug, true);
  assert.equal(result.packages[0].sha256, manifest.files[0].sha256);
  assert.ok(!JSON.stringify(result).includes(f.directory));
  const file = await catalog.file(name()); assert.equal(file.path, path.join(f.directory, name())); assert.equal(file.bytes, manifest.files[0].bytes);
  assert.equal((await catalog.file('release-manifest-0.9.7.json')).version, '0.9.7');
  assert.equal((await catalog.file('SHA256SUMS-0.9.7.txt')).version, '0.9.7');
  assert.equal((await catalog.file(name('0.9.7', 'Web.zip'))).version, '0.9.7');
});

test('malformed newest local metadata establishes a version floor and never revives old local packages', async t => {
  const f = await fixture(t); await f.publish('0.9.6');
  await fs.writeFile(path.join(f.directory, 'release-manifest-0.9.7.json'), '{"private-path-and-key');
  const catalog = f.local(); t.after(() => catalog.close());
  const result = await catalog.list(); assert.equal(result.latestVersion, '0.9.7'); assert.deepEqual(result.packages, []);
  assert.ok(result.error && !result.error.includes('private') && !result.error.includes(f.directory));
  assert.equal(await catalog.file(name('0.9.6')), null);
});

test('explicit previews are omitted and highest numeric stable manifest wins regardless of creation date', async t => {
  const f = await fixture(t); await f.publish('0.9.99'); await f.publish('0.10.0');
  await f.publish('1.0.0', [name('1.0.0')], { channel: 'preview' });
  const catalog = f.local(); t.after(() => catalog.close());
  const result = await catalog.list(); assert.equal(result.latestVersion, '0.10.0'); assert.equal(result.packages.length, 1);
  assert.equal(result.packages[0].version, '0.10.0');
});

test('unsafe names, target/version mismatches, oversized metadata and ambiguous checksums never become links', async t => {
  for (const patch of [file => { file.name = '../fixture-private.zip'; }, file => { file.name = 'PetPal-0.9.7-Windows-x64.zip?private'; },
    file => { file.name = name('0.9.6'); }, file => { file.target = 'ubuntu-x64'; }, file => { file.bytes = 0; },
    file => { file.sha256 = 'not-a-hash'; }, file => { file.url = 'https://evil.invalid'; }]) {
    const f = await fixture(t), manifest = await f.publish(); patch(manifest.files[0]);
    await fs.writeFile(path.join(f.directory, 'release-manifest-0.9.7.json'), JSON.stringify(manifest));
    const catalog = f.local(); t.after(() => catalog.close());
    const result = await catalog.list(); assert.deepEqual(result.packages, []); assert.ok(result.error);
  }
  for (const patch of ['oversized', 'checksum-mismatch', 'checksum-duplicate']) {
    const f = await fixture(t), manifest = await f.publish();
    if (patch === 'oversized') await fs.writeFile(path.join(f.directory, 'release-manifest-0.9.7.json'), Buffer.alloc(65537, 32));
    else await fs.writeFile(path.join(f.directory, 'SHA256SUMS-0.9.7.txt'), patch === 'checksum-mismatch' ? `${'0'.repeat(64)}  ${name()}\n` :
      `${manifest.files[0].sha256}  ${name()}\n`.repeat(2));
    const catalog = f.local(); t.after(() => catalog.close());
    assert.deepEqual((await catalog.list()).packages, []);
  }
});

test('missing, truncated and same-size corrupt packages are omitted without filling from old versions', async t => {
  for (const state of ['missing', 'truncated', 'corrupt']) {
    const f = await fixture(t); await f.publish('0.9.6'); const manifest = await f.publish();
    const file = path.join(f.directory, name());
    if (state === 'missing') await fs.unlink(file);
    else await fs.writeFile(file, Buffer.alloc(state === 'corrupt' ? manifest.files[0].bytes : 2, 42));
    const catalog = f.local(); t.after(() => catalog.close());
    const result = await catalog.list(); assert.equal(result.latestVersion, '0.9.7'); assert.deepEqual(result.packages, []);
    assert.ok(result.error); assert.equal(await catalog.file(name()), null); assert.equal(await catalog.file(name('0.9.6')), null);
  }
});

test('file identity changes invalidate cached hashes while unchanged concurrent requests share the same hash', async t => {
  const f = await fixture(t), manifest = await f.publish(); let hashes = 0;
  const fsImpl = { ...fs, async open(file, flags) {
    const handle = await fs.open(file, flags), original = handle.createReadStream.bind(handle);
    handle.createReadStream = options => { hashes++; return original(options); }; return handle;
  } };
  const catalog = f.local({ fsImpl }); t.after(() => catalog.close());
  const [first, second] = await Promise.all([catalog.list(), catalog.list()]);
  assert.equal(hashes, 1); assert.equal(first.packages.length, 1); assert.equal(second.packages.length, 1);
  first.packages[0].url = 'https://evil.invalid'; assert.notEqual((await catalog.list()).packages[0].url, first.packages[0].url);
  assert.equal(hashes, 1);
  await fs.writeFile(path.join(f.directory, name()), Buffer.alloc(manifest.files[0].bytes, 42));
  assert.deepEqual((await catalog.list()).packages, []); assert.equal(hashes, 2);
  await catalog.list(); assert.equal(hashes, 2, 'unchanged corrupt files are not repeatedly hashed');
  await f.publish(); assert.equal((await catalog.list()).packages.length, 1); assert.equal(hashes, 3);
});

test('a fake filesystem symlink never passes even when it has the right byte count and target digest', async t => {
  const f = await fixture(t); await f.publish();
  const fsImpl = { ...fs, async lstat(file, options) {
    const value = await fs.lstat(file, options);
    if (path.basename(file) === name()) return { ...value, isFile: () => true, isSymbolicLink: () => true };
    return value;
  } };
  const catalog = f.local({ fsImpl }); t.after(() => catalog.close());
  assert.deepEqual((await catalog.list()).packages, []); assert.equal(await catalog.file(name()), null);
  for (const pathname of ['../' + name(), '%2e%2e/' + name(), name() + '?token=x', 'nested/' + name()])
    assert.equal(await catalog.file(pathname), null);
});

test('local verified packages return immediately while GitHub is offline, and shutdown cancels that background fetch', async t => {
  const f = await fixture(t); await f.publish(); let signal, calls = 0;
  const catalog = f.catalog({ fetchImpl: async (_url, options) => { calls++; signal = options.signal; return new Promise(() => {}); } });
  t.after(() => catalog.close());
  const result = await catalog.list(); assert.equal(result.source, 'server'); assert.equal(result.packages.length, 1);
  assert.equal(result.error, null); assert.equal(calls, 1);
  await catalog.close(); assert.equal(signal.aborted, true);
  await assert.rejects(catalog.list(), /已关闭/);
});

test('same-version GitHub packages supply fallback links and only missing local packages use upstream as their primary link', async t => {
  const f = await fixture(t), linuxName = name('0.9.7', 'Ubuntu-x64.tar.gz');
  await f.publish('0.9.7', [name(), linuxName]); await fs.unlink(path.join(f.directory, linuxName));
  const catalog = f.catalog({ fetchImpl: async () => new Response(JSON.stringify([githubRelease('0.9.7', [name(), linuxName])])) });
  t.after(() => catalog.close());
  await catalog.list(); await new Promise(resolve => setImmediate(resolve));
  const result = await catalog.list(); assert.equal(result.source, 'mixed'); assert.equal(result.packages.length, 2);
  const windows = result.packages.find(item => item.platform === 'windows'), ubuntu = result.packages.find(item => item.platform === 'ubuntu');
  assert.equal(windows.source, 'server'); assert.equal(windows.url, '/downloads/' + name());
  assert.equal(windows.fallbackUrl, `${DOWNLOAD_RELEASES_URL}/download/v0.9.7/${name()}`);
  assert.equal(ubuntu.source, 'github'); assert.ok(ubuntu.url.startsWith(DOWNLOAD_RELEASES_URL)); assert.ok(result.notices.length);
});

test('a known newer GitHub stable release cannot be replaced by an older locally available package', async t => {
  const f = await fixture(t); await f.publish();
  const catalog = f.catalog({ fetchImpl: async () => new Response(JSON.stringify([githubRelease('0.9.8', [])])) });
  t.after(() => catalog.close());
  await catalog.list(); await new Promise(resolve => setImmediate(resolve));
  const result = await catalog.list(); assert.equal(result.latestVersion, '0.9.8'); assert.deepEqual(result.packages, []);
  assert.equal(await catalog.localFile(name()), null);
});

test('invalid newest local metadata prevents a lower GitHub fallback but permits a genuinely newer stable release', async t => {
  for (const version of ['0.9.6', '0.9.8']) {
    const f = await fixture(t); await f.publish('0.9.6');
    await fs.writeFile(path.join(f.directory, 'release-manifest-0.9.7.json'), 'private malformed manifest');
    const catalog = f.catalog({ fetchImpl: async () => new Response(JSON.stringify([githubRelease(version, [name(version)])])) });
    t.after(() => catalog.close());
    await catalog.list(); await new Promise(resolve => setImmediate(resolve));
    const result = await catalog.list(); assert.equal(result.latestVersion, version === '0.9.8' ? version : '0.9.7');
    assert.equal(result.packages.length, version === '0.9.8' ? 1 : 0);
  }
});

test('shutdown aborts an active package hash and does not publish partial verification', async t => {
  const f = await fixture(t); await f.publish(); let hashing;
  const started = new Promise(resolve => { hashing = resolve; });
  const fsImpl = { ...fs, async open(file, flags) {
    const handle = await fs.open(file, flags);
    if (path.basename(file) === name()) handle.createReadStream = ({ signal }) => {
      const stream = new Readable({ read() {} }); hashing();
      signal.addEventListener('abort', () => stream.destroy(new Error('aborted')), { once: true }); return stream;
    };
    return handle;
  } };
  const catalog = f.local({ fsImpl }), pending = catalog.list(); await started;
  await catalog.close(); assert.deepEqual((await pending).packages, []); await assert.rejects(catalog.list(), /已关闭/);
});
