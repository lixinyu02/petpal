import path from 'node:path';
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';

export const DOWNLOAD_VERSION_PATTERN = '(?:0|[1-9]\\d{0,8})\\.(?:0|[1-9]\\d{0,8})\\.(?:0|[1-9]\\d{0,8})';
const versionPattern = new RegExp(`^${DOWNLOAD_VERSION_PATTERN}$`);
const manifestPattern = new RegExp(`^release-manifest-(${DOWNLOAD_VERSION_PATTERN})\\.json$`);
const packagePattern = new RegExp(`^PetPal-(${DOWNLOAD_VERSION_PATTERN})-(?:Android(?:-(debug|release))?\\.apk|Windows-(x64|arm64)\\.(exe|zip)|Ubuntu-(x64|arm64)\\.(tar\\.gz|AppImage|deb)|Web\\.zip)$`);
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_PACKAGE_BYTES = 2 * 1024 ** 3;
const privateError = () => '服务器最新正式版安装包校验未完成，暂不提供未校验的本地链接。';
const fingerprint = info => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].map(key => String(info[key])).join(':');
const absent = error => error?.code === 'ENOENT';

export function compareDownloadVersions(a, b) {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function describe(name) {
  const match = typeof name === 'string' && packagePattern.exec(name);
  if (!match) return null;
  const platform = match[3] ? 'windows' : match[5] ? 'ubuntu' : /-Web\.zip$/.test(name) ? 'web' : 'android';
  return { version: match[1], platform, arch: match[3] || match[5] || 'universal', debug: match[2] === 'debug',
    format: platform === 'windows' ? match[4] === 'zip' ? 'portable-zip' : 'portable-exe' :
      platform === 'ubuntu' ? match[6] === 'AppImage' ? 'appimage' : match[6] : platform === 'web' ? 'zip' : 'apk' };
}

function validateManifest(value, version) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || value.version !== version || !versionPattern.test(value.version) ||
      value.channel !== 'stable' || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) ||
      !Array.isArray(value.files) || value.files.length > 100) throw new Error('Invalid local release manifest');
  const names = new Set();
  const files = value.files.map(file => {
    const info = describe(file?.name), target = info?.platform === 'windows' || info?.platform === 'ubuntu' ? `${info.platform}-${info.arch}` : info?.platform;
    if (!info || info.version !== version || file.target !== target || names.has(file.name) ||
        !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > MAX_PACKAGE_BYTES ||
        typeof file.sha256 !== 'string' || !/^[a-f\d]{64}$/.test(file.sha256) ||
        Object.keys(file).some(key => !['name', 'target', 'bytes', 'sha256'].includes(key))) throw new Error('Invalid local release file');
    names.add(file.name);
    return { ...info, filename: file.name, bytes: file.bytes, sha256: file.sha256 };
  });
  return { version, publishedAt: new Date(value.createdAt).toISOString(), files };
}

function validateChecksums(text, files) {
  const entries = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const match = /^([a-f\d]{64}) {2}(.+)$/.exec(line);
    if (!match || !describe(match[2]) || entries.has(match[2])) throw new Error('Invalid local checksum list');
    entries.set(match[2], match[1]);
  }
  if (entries.size !== files.length || files.some(file => entries.get(file.filename) !== file.sha256))
    throw new Error('Local release checksums differ');
}

/** Read-only catalog. A cached hash is reusable only for the same file identity,
 * size, mtime/ctime and expected hash; every request still checks the filesystem. */
export function createLocalDownloads({ directory, releasesUrl, fsImpl = fs, now = Date.now } = {}) {
  const root = path.resolve(directory);
  let result = { latestVersion: null, checkedAt: null, error: null, packages: [] }, files = new Map(),
    hashCache = new Map(), pending, controller, closed = false;
  const snapshot = () => structuredClone(result);

  async function safeInfo(filename) {
    const file = path.join(root, filename), info = await fsImpl.lstat(file, { bigint: true });
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unsafe local release file');
    const real = await fsImpl.realpath(file), realRoot = await fsImpl.realpath(root);
    if (path.relative(realRoot, real) !== filename) throw new Error('Local release escapes root');
    return { file, info };
  }

  async function readMetadata(filename) {
    const { file, info } = await safeInfo(filename);
    if (info.size > BigInt(MAX_METADATA_BYTES)) throw new Error('Oversized local metadata');
    const handle = await fsImpl.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      if (fingerprint(await handle.stat({ bigint: true })) !== fingerprint(info)) throw new Error('Local metadata changed');
      const buffer = Buffer.alloc(MAX_METADATA_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      const bytes = buffer.subarray(0, length);
      if (length > MAX_METADATA_BYTES || fingerprint(await handle.stat({ bigint: true })) !== fingerprint(info) ||
          fingerprint((await safeInfo(filename)).info) !== fingerprint(info)) throw new Error('Local metadata changed');
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), file,
        fingerprint: fingerprint(info), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    } finally { await handle.close(); }
  }

  async function verifyPackage(record, signal) {
    const { file, info } = await safeInfo(record.filename), identity = fingerprint(info);
    if (info.size !== BigInt(record.bytes)) throw new Error('Local package size differs');
    const cached = hashCache.get(record.filename);
    if (cached?.fingerprint === identity && cached.sha256 === record.sha256) {
      if (!cached.valid) throw new Error('Local package digest differs');
      return { path: file, fingerprint: identity, bytes: record.bytes, sha256: record.sha256, version: record.version };
    }
    const handle = await fsImpl.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    let digest;
    try {
      if (fingerprint(await handle.stat({ bigint: true })) !== identity) throw new Error('Local package changed');
      const hash = createHash('sha256');
      for await (const chunk of handle.createReadStream({ autoClose: false, signal })) { signal.throwIfAborted(); hash.update(chunk); }
      signal.throwIfAborted();
      if (fingerprint(await handle.stat({ bigint: true })) !== identity || fingerprint((await safeInfo(record.filename)).info) !== identity)
        throw new Error('Local package changed during verification');
      digest = hash.digest('hex');
    } finally { await handle.close(); }
    hashCache.set(record.filename, { fingerprint: identity, sha256: record.sha256, valid: digest === record.sha256 });
    if (digest !== record.sha256) throw new Error('Local package digest differs');
    return { path: file, fingerprint: identity, bytes: record.bytes, sha256: record.sha256, version: record.version };
  }

  async function refresh() {
    const active = new AbortController(); controller = active;
    const next = { latestVersion: null, checkedAt: new Date(now()).toISOString(), error: null, packages: [] };
    const nextFiles = new Map();
    try {
      const info = await fsImpl.lstat(root);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe local downloads directory');
      const candidates = (await fsImpl.readdir(root)).map(name => ({ name, match: manifestPattern.exec(name) }))
        .filter(item => item.match).sort((a, b) => compareDownloadVersions(b.match[1], a.match[1]));
      if (candidates.length > 100) throw new Error('Too many local release manifests');
      let selected, manifestBytes;
      for (const candidate of candidates) {
        active.signal.throwIfAborted();
        next.latestVersion = candidate.match[1]; // Invalid newest metadata must not revive an older version.
        const data = await readMetadata(candidate.name), parsed = JSON.parse(data.text);
        if (parsed?.channel === 'preview' && parsed.version === candidate.match[1]) { next.latestVersion = null; continue; }
        selected = validateManifest(parsed, candidate.match[1]); manifestBytes = data;
        break;
      }
      if (selected) {
        const checksumName = `SHA256SUMS-${selected.version}.txt`, checksums = await readMetadata(checksumName);
        validateChecksums(checksums.text, selected.files);
        nextFiles.set(`release-manifest-${selected.version}.json`, { ...manifestBytes, version: selected.version });
        nextFiles.set(checksumName, { ...checksums, version: selected.version });
        for (const record of selected.files) {
          active.signal.throwIfAborted();
          try {
            const verified = await verifyPackage(record, active.signal); nextFiles.set(record.filename, verified);
            if (record.platform !== 'web') next.packages.push({ ...record, id: `server:${record.filename}`, channel: 'stable',
              source: 'server', url: `/downloads/${record.filename}`, releaseUrl: `${releasesUrl}/tag/v${selected.version}`,
              publishedAt: selected.publishedAt });
          } catch { active.signal.throwIfAborted(); next.error = privateError(); }
        }
        const keep = new Set(selected.files.map(file => file.filename));
        for (const filename of hashCache.keys()) if (!keep.has(filename)) hashCache.delete(filename);
      }
    } catch (error) {
      if (!absent(error) || next.latestVersion) next.error = privateError();
    } finally {
      if (!closed) { result = next; files = nextFiles; }
      if (controller === active) controller = undefined;
    }
  }

  const list = async () => {
    if (closed) throw new Error('本地下载列表服务已关闭。');
    if (!pending) pending = refresh().finally(() => { pending = undefined; });
    await pending;
    return snapshot();
  };
  return {
    list,
    async file(filename) {
      if (typeof filename !== 'string' || !describe(filename) && !manifestPattern.test(filename) &&
          !new RegExp(`^SHA256SUMS-${DOWNLOAD_VERSION_PATTERN}\\.txt$`).test(filename)) return null;
      await list();
      const verified = files.get(filename);
      if (!verified) return null;
      try {
        if (fingerprint((await safeInfo(filename)).info) !== verified.fingerprint) return null;
        const { fingerprint: _fingerprint, text: _text, file: metadataPath, ...value } = verified;
        return { ...value, path: value.path || metadataPath };
      } catch { return null; }
    },
    async close() { closed = true; controller?.abort(new Error('Closed')); await pending; files.clear(); hashCache.clear(); },
  };
}
