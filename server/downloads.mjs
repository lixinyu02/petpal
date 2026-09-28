export const DOWNLOAD_REPOSITORY = 'lixinyu02/petpal';
export const DOWNLOAD_RELEASES_URL = `https://github.com/${DOWNLOAD_REPOSITORY}/releases`;
export const DOWNLOAD_API_URL = `https://api.github.com/repos/${DOWNLOAD_REPOSITORY}/releases?per_page=30`;
const VERSION = '(?:0|[1-9]\\d{0,8})\\.(?:0|[1-9]\\d{0,8})\\.(?:0|[1-9]\\d{0,8})(?:-[A-Za-z0-9][A-Za-z0-9.-]{0,59})?';
const tagPattern = new RegExp(`^v?(${VERSION})$`);
const assetPattern = new RegExp(`^PetPal-(${VERSION})-(?:Android(?:-(debug|release))?\\.apk|Windows-(x64|arm64)\\.exe|Ubuntu-(x64|arm64)\\.(tar\\.gz|AppImage|deb))$`);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

/** Metadata becomes a link only when both its name and its exact download destination match. */
export function publishedDownloadPackages(releases) {
  if (!Array.isArray(releases) || releases.length > 100) throw new Error('Invalid release list');
  const packages = [], seen = new Set();
  for (const release of releases) {
    if (!release || release.draft !== false || typeof release.prerelease !== 'boolean' || !Array.isArray(release.assets)) continue;
    const version = typeof release.tag_name === 'string' && tagPattern.exec(release.tag_name)?.[1];
    const publishedAt = timestamp(release.published_at);
    if (!version || !publishedAt || release.assets.length > 100) continue;
    for (const asset of release.assets) {
      if (!asset || typeof asset.name !== 'string' || asset.name.length > 200 || asset.state !== 'uploaded' || !Number.isSafeInteger(asset.id) || asset.id <= 0 || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 2 * 1024 ** 3) continue;
      const match = assetPattern.exec(asset.name);
      if (!match || match[1] !== version) continue;
      const url = `${DOWNLOAD_RELEASES_URL}/download/${release.tag_name}/${asset.name}`;
      if (asset.browser_download_url !== url || seen.has(asset.id)) continue;
      seen.add(asset.id);
      const platform = match[3] ? 'windows' : match[4] ? 'ubuntu' : 'android';
      const format = platform === 'windows' ? 'portable-exe' : platform === 'android' ? 'apk' : match[5] === 'AppImage' ? 'appimage' : match[5];
      packages.push({ id: String(asset.id), platform, arch: match[3] || match[4] || 'universal', version,
        channel: release.prerelease ? 'preview' : 'stable', format, filename: asset.name, url,
        releaseUrl: `${DOWNLOAD_RELEASES_URL}/tag/${release.tag_name}`, bytes: asset.size, publishedAt,
        ...(/^sha256:[a-f\d]{64}$/i.test(asset.digest || '') ? { sha256: asset.digest.slice(7).toLowerCase() } : {}),
        debug: match[2] === 'debug',
      });
    }
  }
  return packages.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.filename.localeCompare(b.filename));
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

export function createDownloadsCatalog({ fetchImpl = globalThis.fetch, now = Date.now, cacheMs = 300000, errorCacheMs = 15000, timeoutMs = 10000, responseLimit = 2 * 1024 ** 2 } = {}) {
  let cache = null, cachedAt = 0, retryAt = 0, error = null, pending, controller, closed = false;
  const snapshot = () => ({ repository: DOWNLOAD_REPOSITORY, releasesUrl: DOWNLOAD_RELEASES_URL,
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
      const releases = await readJson(response, active.signal, responseLimit); active.signal.throwIfAborted();
      cache = publishedDownloadPackages(releases); cachedAt = now(); error = null; retryAt = 0;
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
