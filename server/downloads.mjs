import { createLocalDownloads, compareDownloadVersions } from './local-downloads.mjs';

export const DOWNLOAD_REPOSITORY = 'lixinyu02/petpal';
export const DOWNLOAD_RELEASES_URL = `https://github.com/${DOWNLOAD_REPOSITORY}/releases`;
export const DOWNLOAD_API_URL = `https://api.github.com/repos/${DOWNLOAD_REPOSITORY}/releases?per_page=100`;
const VERSION = '(?:0|[1-9]\\d{0,8})\\.(?:0|[1-9]\\d{0,8})\\.(?:0|[1-9]\\d{0,8})';
const tagPattern = new RegExp(`^v?(${VERSION})$`);
const assetPattern = new RegExp(`^PetPal-(${VERSION})-(?:Android(?:-(debug|release))?\\.apk|Windows-(x64|arm64)\\.(exe|zip)|Ubuntu-(x64|arm64)\\.(tar\\.gz|AppImage|deb))$`);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const stableVersion = release => release?.draft === false && release.prerelease === false && typeof release.tag_name === 'string' ? tagPattern.exec(release.tag_name)?.[1] : undefined;
const compareVersions = (a, b) => {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
};
const latestStableVersion = releases => releases.map(stableVersion).filter(Boolean).sort(compareVersions).at(-1) || null;

/** Metadata becomes a link only when both its name and its exact download destination match. */
export function publishedDownloadPackages(releases) {
  if (!Array.isArray(releases) || releases.length > 100) throw new Error('Invalid release list');
  // Select across platforms before inspecting assets. A missing/bad asset in
  // the newest stable release must never silently resurrect an older package.
  const latestVersion = releases.map(stableVersion).filter(Boolean).sort(compareVersions).at(-1);
  if (!latestVersion) return [];
  const packages = [], seen = new Set();
  for (const release of releases) {
    const version = stableVersion(release);
    if (version !== latestVersion || !Array.isArray(release.assets)) continue;
    const publishedAt = timestamp(release.published_at);
    if (!version || !publishedAt || release.assets.length > 100) continue;
    for (const asset of release.assets) {
      if (!asset || typeof asset.name !== 'string' || asset.name.length > 200 || asset.state !== 'uploaded' || !Number.isSafeInteger(asset.id) || asset.id <= 0 || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 2 * 1024 ** 3) continue;
      const match = assetPattern.exec(asset.name);
      if (!match || match[1] !== version) continue;
      const url = `${DOWNLOAD_RELEASES_URL}/download/${release.tag_name}/${asset.name}`;
      if (asset.browser_download_url !== url || seen.has(asset.id)) continue;
      seen.add(asset.id);
      const platform = match[3] ? 'windows' : match[5] ? 'ubuntu' : 'android';
      const format = platform === 'windows' ? match[4] === 'zip' ? 'portable-zip' : 'portable-exe' : platform === 'android' ? 'apk' : match[6] === 'AppImage' ? 'appimage' : match[6];
      packages.push({ id: String(asset.id), platform, arch: match[3] || match[5] || 'universal', version,
        channel: 'stable', format, filename: asset.name, url,
        releaseUrl: `${DOWNLOAD_RELEASES_URL}/tag/${release.tag_name}`, bytes: asset.size, publishedAt,
        ...(/^sha256:[a-f\d]{64}$/i.test(asset.digest || '') ? { sha256: asset.digest.slice(7).toLowerCase() } : {}),
        debug: match[2] === 'debug',
      });
    }
  }
  return packages.sort((a, b) => a.platform.localeCompare(b.platform) || a.arch.localeCompare(b.arch)
    || (a.platform === 'windows' && b.platform === 'windows' && a.releaseUrl === b.releaseUrl && a.arch === b.arch
      ? Number(b.format === 'portable-zip') - Number(a.format === 'portable-zip') : 0)
    || a.filename.localeCompare(b.filename));
}

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', abort, { once: true });
  });
}
async function readJson(response, signal, limit) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new Error('Metadata too large');
  if (!response.body) throw new Error('Empty release metadata');
  const reader = response.body.getReader(), chunks = []; let bytes = 0, complete = false;
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal); signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength; if (bytes > limit) throw new Error('Metadata too large'); chunks.push(value);
    }
    complete = true; return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { if (!complete) void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch {} }
}

function createGithubDownloadsCatalog({ fetchImpl = globalThis.fetch, now = Date.now, cacheMs = 300000, errorCacheMs = 15000, timeoutMs = 10000, responseLimit = 2 * 1024 ** 2 } = {}) {
  let cache = null, latestVersion = null, cachedAt = 0, retryAt = 0, error = null, pending, controller, closed = false;
  const snapshot = () => ({ repository: DOWNLOAD_REPOSITORY, releasesUrl: DOWNLOAD_RELEASES_URL,
    latestVersion,
    checkedAt: cache ? new Date(cachedAt).toISOString() : null, stale: Boolean(error && cache), error,
    retryAt: error && retryAt > now() ? new Date(retryAt).toISOString() : null, packages: structuredClone(cache || []),
  });
  async function refresh() {
    controller = new AbortController(); const active = controller;
    const timer = setTimeout(() => active.abort(new Error('Timeout')), timeoutMs); timer.unref?.();
    let rateLimited = false;
    try {
      const response = await abortable(fetchImpl(DOWNLOAD_API_URL, { signal: active.signal, redirect: 'error', credentials: 'omit',
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'PetPal-Downloads', 'X-GitHub-Api-Version': '2022-11-28' },
      }), active.signal);
      active.signal.throwIfAborted();
      rateLimited = response.status === 429 || response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0';
      if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Error('Release metadata unavailable'); }
      // A truncated date-ordered GitHub page cannot prove the highest numeric
      // version. Keep the marked cache instead of publishing a partial catalog.
      if (/\brel\s*=\s*"?next\b/i.test(response.headers.get('link') || '')) {
        void response.body?.cancel().catch(() => {}); throw new Error('Incomplete release metadata');
      }
      const releases = await readJson(response, active.signal, responseLimit); active.signal.throwIfAborted();
      cache = publishedDownloadPackages(releases); latestVersion = latestStableVersion(releases); cachedAt = now(); error = null; retryAt = 0;
    } catch {
      if (!closed) {
        error = rateLimited ? 'GitHub 请求额度暂时用完，请稍后重试。' : '暂时无法读取 GitHub 发布列表，请稍后重试。';
        retryAt = now() + (rateLimited ? Math.max(60000, errorCacheMs) : errorCacheMs);
      }
    } finally { clearTimeout(timer); active.abort(); if (controller === active) controller = undefined; }
  }
  return {
    async list() {
      if (closed) throw new Error('下载列表服务已关闭。');
      if (pending) { await pending; return snapshot(); }
      if (retryAt > now() || cache && !error && now() - cachedAt < cacheMs) return snapshot();
      pending = refresh();
      try { await pending; } finally { pending = undefined; }
      return snapshot();
    },
    async close() { closed = true; controller?.abort(new Error('Closed')); await pending; },
  };
}

/** Validated same-site packages are immediately available without waiting for
 * GitHub. Its cached metadata supplies same-version fallback links/newer floors. */
export function createDownloadsCatalog({ localDirectory, localOptions, ...githubOptions } = {}) {
  const github = createGithubDownloadsCatalog(githubOptions);
  if (!localDirectory) return { ...github, async localFile() { return null; } };
  const local = createLocalDownloads({ ...localOptions, directory: localDirectory, releasesUrl: DOWNLOAD_RELEASES_URL,
    now: githubOptions.now || Date.now });
  let githubSnapshot = null, githubPending, closed = false;
  function refreshGithub() {
    if (!githubPending) githubPending = github.list().then(value => { githubSnapshot = value; return value; })
      .finally(() => { githubPending = undefined; });
    return githubPending;
  }
  function combine(localSnapshot) {
    const latestVersion = [localSnapshot.latestVersion, githubSnapshot?.latestVersion].filter(Boolean).sort(compareDownloadVersions).at(-1) || null;
    const serverPackages = localSnapshot.packages.filter(item => item.version === latestVersion);
    const upstreamPackages = (githubSnapshot?.packages || []).filter(item => item.version === latestVersion);
    const byName = new Map(upstreamPackages.map(item => [item.filename, { ...item, source: 'github' }]));
    for (const item of serverPackages) {
      const fallback = byName.get(item.filename);
      byName.set(item.filename, { ...item, ...(fallback ? { fallbackUrl: fallback.url } : {}) });
    }
    const packages = [...byName.values()].sort((a, b) => a.platform.localeCompare(b.platform) || a.arch.localeCompare(b.arch) ||
      (a.platform === 'windows' && a.arch === b.arch ? Number(b.format === 'portable-zip') - Number(a.format === 'portable-zip') : 0) ||
      a.filename.localeCompare(b.filename));
    const hasServer = packages.some(item => item.source === 'server'), hasGithub = packages.some(item => item.source === 'github');
    const notices = [];
    if (localSnapshot.error) notices.push('部分服务器安装包暂未通过校验；已校验文件仍可下载，缺失项可使用同版 GitHub 备用。');
    if (hasServer && githubSnapshot?.error) notices.push('GitHub 备用列表暂不可用；服务器已校验的安装包仍可下载。');
    const error = !packages.length ? localSnapshot.error || githubSnapshot?.error || null : !hasServer ? githubSnapshot?.error || null : null;
    return { repository: DOWNLOAD_REPOSITORY, releasesUrl: DOWNLOAD_RELEASES_URL, latestVersion,
      source: hasServer && hasGithub ? 'mixed' : hasServer ? 'server' : hasGithub ? 'github' : 'none',
      checkedAt: hasServer || localSnapshot.latestVersion ? localSnapshot.checkedAt : githubSnapshot?.checkedAt || null,
      stale: hasGithub && Boolean(githubSnapshot?.stale), error, notices,
      retryAt: !hasServer ? githubSnapshot?.retryAt || null : null, packages: structuredClone(packages) };
  }
  async function list() {
    if (closed) throw new Error('下载列表服务已关闭。');
    const localSnapshot = await local.list();
    if (localSnapshot.packages.length) void refreshGithub().catch(() => {});
    else await refreshGithub();
    return combine(localSnapshot);
  }
  return {
    list,
    async localFile(filename) {
      if (closed) return null;
      const file = await local.file(filename);
      if (!file) return null;
      const newestKnown = [file.version, githubSnapshot?.latestVersion].filter(Boolean).sort(compareDownloadVersions).at(-1);
      return file.version === newestKnown ? file : null;
    },
    async close() { closed = true; await Promise.allSettled([local.close(), github.close(), githubPending]); },
  };
}
