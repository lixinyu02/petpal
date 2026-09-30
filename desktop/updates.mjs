import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, lstat, open, rename, unlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { validateServerManifestUrl, validateServerAssetUrl, validateServerRedirect } from '../server/update-source.mjs';

export const MAX_UPDATE_BYTES = 2 * 1024 * 1024 * 1024;
const SUPPORTED = new Set(['windows-x64', 'ubuntu-x64', 'ubuntu-arm64']);
const abortError = () => Object.assign(new Error('更新操作已取消'), { name: 'AbortError' });
const assertActive = (signal) => { if (signal?.aborted) throw abortError(); };
const publicRelease = (release) => release ? Object.fromEntries(['id', 'target', 'version', 'bytes', 'sha256', 'format', 'notes'].map(key => [key, release[key]])) : undefined;
const versionParts = (version) => {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || version.length > 64) throw new Error('更新版本号无效');
  return version.split('.').map(BigInt);
};
const newer = (left, right) => {
  const a = versionParts(left), b = versionParts(right);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
};
const updateSource = value => value === undefined ? 'github' : value;
const sameSourceBinding = (release, config) => {
  const source = updateSource(release?.source);
  return ['github', 'server'].includes(source) && source === updateSource(config?.source) && release?.revision === config?.revision && release?.repository === config?.repository &&
    (source === 'github' || release?.manifestUrl === config?.manifestUrl);
};

export function desktopUpdateTarget(platform = process.platform, arch = process.arch) {
  return `${platform === 'win32' ? 'windows' : platform === 'linux' ? 'ubuntu' : platform}-${arch}`;
}

/** No renderer URL enters this function. It independently constrains signed metadata. */
export function validateDesktopAssetUrl(value, repository, { cdn = false } = {}) {
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u0020\u007f\\]/.test(value) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')) throw new Error('更新下载地址无效');
  let url; try { url = new URL(value); } catch { throw new Error('更新下载地址无效'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || value.includes('#')) throw new Error('更新下载只允许官方 HTTPS 地址');
  if (cdn && url.hostname === 'release-assets.githubusercontent.com' && url.pathname.startsWith('/github-production-release-asset/') && url.pathname.length > '/github-production-release-asset/'.length) return url.href;
  const prefix = `/${repository}/releases/download/`;
  if (url.hostname !== 'github.com' || !url.pathname.toLowerCase().startsWith(prefix.toLowerCase()) || url.search || value.includes('?')) throw new Error('更新必须来自配置仓库的 GitHub Releases 资产');
  const segments = url.pathname.slice(prefix.length).split('/');
  if (segments.length !== 2 || segments.some(part => !part || /[\\/\u0000-\u0020\u007f]/.test(decodeURIComponent(part)) || ['.', '..'].includes(decodeURIComponent(part)))) throw new Error('GitHub 更新资产路径无效');
  return url.href;
}

function validateRelease(release, target, currentVersion, config) {
  if (!release || typeof release !== 'object' || !/^[\w][\w.-]{0,127}$/.test(release.id || '') || release.target !== target || !SUPPORTED.has(target)) throw new Error('更新发布项与本机平台不匹配');
  if (!newer(release.version, currentVersion)) throw new Error('更新版本必须高于当前版本');
  const format = target === 'windows-x64' ? 'portable-exe' : 'tar.gz';
  if (release.format !== format || !Number.isSafeInteger(release.bytes) || release.bytes < 1 || release.bytes > MAX_UPDATE_BYTES || !/^[a-f0-9]{64}$/i.test(release.sha256 || '')) throw new Error('更新文件格式、大小或校验值无效');
  if (!config?.configured || !sameSourceBinding(release, config)) throw new Error('更新源已变化，请重新检查');
  const source = updateSource(release.source);
  const manifestUrl = source === 'server' ? validateServerManifestUrl(release.manifestUrl) : undefined;
  if (manifestUrl !== undefined && manifestUrl !== config.manifestUrl) throw new Error('更新源已变化，请重新检查');
  const url = source === 'server' ? validateServerAssetUrl(release.url, manifestUrl) : validateDesktopAssetUrl(release.url, config.repository);
  return { ...release, source, manifestUrl, url, sha256: release.sha256.toLowerCase() };
}

function sameRelease(a, b) {
  return ['id', 'target', 'version', 'bytes', 'sha256', 'format', 'revision', 'repository', 'manifestHash', 'sequence', 'source', 'manifestUrl', 'url'].every(key => a?.[key] === b?.[key]);
}

/** Also used immediately before main-process portable launch, after old backend closes. */
export async function verifyDownloadedUpdate(file, release, { directory, signal } = {}) {
  assertActive(signal);
  const absolute = path.resolve(file), expectedDir = path.resolve(directory);
  if (path.dirname(absolute) !== expectedDir || await realpath(expectedDir) !== expectedDir) throw new Error('更新缓存目录无效');
  const entry = await lstat(absolute);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size !== release.bytes || entry.size > MAX_UPDATE_BYTES) throw new Error('更新缓存文件长度已变化');
  const hash = createHash('sha256'); let received = 0;
  for await (const chunk of createReadStream(absolute, { signal })) {
    assertActive(signal); received += chunk.length;
    if (received > release.bytes) throw new Error('更新缓存文件长度已变化');
    hash.update(chunk);
  }
  if (received !== release.bytes || hash.digest('hex') !== release.sha256) throw new Error('更新缓存校验失败，请重新下载');
  assertActive(signal);
  return absolute;
}

export class DesktopUpdateManager {
  constructor({ service, dataDir, currentVersion, platform = process.platform, arch = process.arch, fetchImpl = fetch,
    launchPortable, revealArchive, downloadTimeoutMs = 15 * 60_000, stallTimeoutMs = 30_000 } = {}) {
    if (!service || !dataDir) throw new Error('更新服务与私有数据目录不能为空');
    versionParts(currentVersion);
    this.service = service;
    this.directory = path.join(path.resolve(dataDir), 'updates');
    this.currentVersion = currentVersion;
    this.target = desktopUpdateTarget(platform, arch);
    this.installMode = this.target.startsWith('windows-') ? 'launch-portable' : 'reveal-archive';
    this.fetch = fetchImpl;
    this.launchPortable = launchPortable;
    this.revealArchive = revealArchive;
    this.downloadTimeoutMs = downloadTimeoutMs;
    this.stallTimeoutMs = stallTimeoutMs;
    this.state = { phase: 'idle', received: 0, total: 0 };
    this.checked = null;
    this.downloaded = null;
    this.operation = null;
    this.handoffController = null;
    this.closed = false;
  }

  #config() { return this.service.statusConfig(); }
  #configMatches(release) { const config = this.#config(); return config.configured && sameSourceBinding(release, config); }
  status() {
    const config = this.#config();
    if (this.checked && !this.#configMatches(this.checked)) {
      this.checked = null; this.downloaded = null;
      if (!this.operation) this.state = { phase: config.configured ? 'idle' : 'not-configured', received: 0, total: 0, message: '更新源已变化，请重新检查' };
    }
    const configured = config.configured && SUPPORTED.has(this.target);
    const state = !configured && !this.operation ? { ...this.state, phase: 'not-configured', message: SUPPORTED.has(this.target) ? '更新源尚未配置发布公钥' : '当前桌面平台暂无更新包' } : this.state;
    return { target: this.target, currentVersion: this.currentVersion, ...state, release: publicRelease(this.checked),
      installMode: this.installMode, canInstall: Boolean(!this.closed && !this.operation && !this.handoffController && this.downloaded && this.checked && sameRelease(this.downloaded.release, this.checked) && this.#configMatches(this.checked)) };
  }

  #requireId(id) {
    if (typeof id !== 'string' || !this.checked || id !== this.checked.id) throw new Error('只能操作本机已检查的发布版本');
    if (!this.#configMatches(this.checked)) throw new Error('更新源已变化，请重新检查');
    return { ...this.checked };
  }

  async #resolve(checked, signal) {
    assertActive(signal);
    const fresh = validateRelease(await this.service.resolveRelease(checked.id, { target: this.target, currentVersion: this.currentVersion, signal }), this.target, this.currentVersion, this.#config());
    assertActive(signal);
    if (!sameRelease(checked, fresh)) throw new Error('发布清单已变化，请重新检查并下载');
    return fresh;
  }

  async #run(kind, task) {
    if (this.closed) throw new Error('更新服务正在关闭');
    if (this.operation) throw new Error('另一项更新操作正在进行');
    const controller = new AbortController();
    const operation = { controller, kind, done: null };
    this.operation = operation;
    operation.done = Promise.resolve().then(() => task(controller.signal)).catch(error => {
      if (controller.signal.aborted) this.state = { phase: this.downloaded ? 'downloaded' : this.checked ? 'available' : 'idle', received: 0, total: this.checked?.bytes || 0, message: '已取消更新操作；没有安装或覆盖软件' };
      else this.state = { ...this.state, phase: 'error', error: error?.safeMessage || '更新操作失败：请检查更新源、网络和文件校验后重试', message: undefined };
    }).finally(() => { if (this.operation === operation) this.operation = null; });
    await operation.done;
    return this.status();
  }

  check({ authorize = async () => {} } = {}) {
    return this.#run('check', async signal => {
      await authorize(); assertActive(signal);
      this.state = { phase: 'checking', received: 0, total: 0 };
      this.checked = null; this.downloaded = null;
      if (!SUPPORTED.has(this.target)) { this.state.phase = 'not-configured'; return; }
      const result = await this.service.check({ target: this.target, currentVersion: this.currentVersion, signal });
      await authorize();
      assertActive(signal);
      const config = this.#config();
      if (!sameSourceBinding(result, config)) throw new Error('更新源已变化');
      if (!result.configured) this.state = { phase: 'not-configured', received: 0, total: 0, message: '更新源尚未配置发布公钥' };
      else if (!result.available) this.state = { phase: 'current', received: 0, total: 0, message: '没有更高版本的已验证更新' };
      else {
        this.checked = validateRelease(result.release, this.target, this.currentVersion, config);
        this.state = { phase: 'available', received: 0, total: this.checked.bytes, message: '发现已验证的新版，可下载后校验' };
      }
    });
  }

  download(id, { authorize = async () => {} } = {}) {
    const selected = this.#requireId(id);
    return this.#run('download', async signal => {
      await authorize(); assertActive(signal);
      const release = await this.#resolve(selected, signal);
      this.downloaded = null;
      this.state = { phase: 'downloading', received: 0, total: release.bytes };
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      if (await realpath(this.directory) !== this.directory || (await lstat(this.directory)).isSymbolicLink()) throw new Error('更新缓存目录不可使用符号链接');
      const extension = release.format === 'portable-exe' ? '.exe' : '.tar.gz';
      const final = path.join(this.directory, `PetPal-${release.version}-${randomUUID()}${extension}`);
      const partial = `${final}.partial`;
      const watchdog = new AbortController();
      const combined = AbortSignal.any([signal, watchdog.signal, AbortSignal.timeout(this.downloadTimeoutMs)]);
      let handle, reader, stall;
      const resetStall = () => { clearTimeout(stall); stall = setTimeout(() => watchdog.abort(), this.stallTimeoutMs); };
      try {
        assertActive(combined);
        handle = await open(partial, 'wx', 0o600);
        const serverSource = release.source === 'server';
        let url = serverSource ? validateServerAssetUrl(release.url, release.manifestUrl) : validateDesktopAssetUrl(release.url, release.repository);
        let response;
        for (let hops = 0; ; hops++) {
          resetStall();
          response = await this.fetch(url, { method: 'GET', redirect: 'manual', credentials: 'omit', signal: combined,
            headers: { Accept: 'application/octet-stream', 'Accept-Encoding': 'identity', 'User-Agent': `PetPal/${this.currentVersion}` } });
          assertActive(combined);
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location || hops >= 4) throw new Error('更新重定向过多或缺少目标地址');
          // Preserve the raw Location for server path validation: URL parsing
          // would otherwise erase dot segments before the boundary sees them.
          if (serverSource) url = validateServerRedirect(url, location, release.manifestUrl);
          else {
            if (new URL(url).hostname !== 'github.com') throw new Error('更新 CDN 返回了新的跳转');
            url = validateDesktopAssetUrl(new URL(location, url).href, release.repository, { cdn: true });
          }
        }
        if (response.status !== 200 || !response.body) throw new Error('更新下载未成功');
        const length = response.headers.get('content-length');
        if (length !== null && (!/^\d+$/.test(length) || Number(length) !== release.bytes)) throw new Error('更新下载长度不匹配');
        const hash = createHash('sha256'); let received = 0;
        reader = response.body.getReader();
        for (;;) {
          resetStall();
          const { done, value } = await reader.read();
          assertActive(combined);
          if (done) break;
          received += value.byteLength;
          if (received > release.bytes || received > MAX_UPDATE_BYTES) throw new Error('更新文件超出已验证大小');
          hash.update(value);
          let offset = 0;
          while (offset < value.byteLength) {
            assertActive(combined);
            const { bytesWritten } = await handle.write(value, offset, value.byteLength - offset);
            if (!bytesWritten) throw new Error('更新缓存写入失败');
            offset += bytesWritten;
          }
          this.state.received = received;
        }
        if (received !== release.bytes || hash.digest('hex') !== release.sha256) throw new Error('更新文件校验失败');
        await authorize();
        assertActive(signal);
        if (!this.#configMatches(release)) throw new Error('更新源已变化');
        await handle.sync(); await handle.close(); handle = null;
        assertActive(signal);
        await rename(partial, final);
        assertActive(signal);
        this.downloaded = { file: final, release };
        this.state = { phase: 'downloaded', received, total: release.bytes, message: '下载和校验完成；尚未安装' };
      } finally {
        clearTimeout(stall);
        await reader?.cancel().catch(() => {});
        reader?.releaseLock();
        await handle?.close().catch(() => {});
        await unlink(partial).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
    });
  }

  install(id, { authorize = async () => {} } = {}) {
    const selected = this.#requireId(id);
    if (!this.downloaded || !sameRelease(this.downloaded.release, selected)) throw new Error('请先下载并校验这个版本');
    const cached = this.downloaded;
    return this.#run('install', async signal => {
      await authorize(); assertActive(signal);
      this.state = { ...this.state, message: '正在重新核验发布清单和下载文件', error: undefined };
      await verifyDownloadedUpdate(cached.file, selected, { directory: this.directory, signal });
      const release = await this.#resolve(selected, signal);
      await authorize();
      assertActive(signal);
      if (!this.#configMatches(release)) throw new Error('更新源已变化');
      if (this.installMode === 'launch-portable') {
        if (typeof this.launchPortable !== 'function') throw new Error('当前环境不支持打开新版');
        this.handoffController = this.operation.controller;
        try { await this.launchPortable({ file: cached.file, release: { ...release }, directory: this.directory, authorize, signal }); }
        catch (error) { this.handoffController = null; throw error; }
        assertActive(signal);
        this.state = { ...this.state, phase: 'downloaded', message: '已准备关闭当前版本并打开校验后的新版；旧程序文件保留' };
      } else {
        if (typeof this.revealArchive !== 'function') throw new Error('当前环境不支持定位归档');
        await this.revealArchive(cached.file);
        this.state = { ...this.state, phase: 'downloaded', message: '已定位已校验归档。请退出旧版，解压到新目录后运行 start-petpal.sh；尚未安装' };
      }
    });
  }

  async cancel() {
    this.handoffController?.abort(); this.handoffController = null;
    const operation = this.operation; operation?.controller.abort(); await operation?.done;
    return this.status();
  }
  async close({ preserveHandoff = false } = {}) {
    this.closed = true;
    if (!preserveHandoff) { await this.cancel(); return; }
    const operation = this.operation;
    if (operation?.controller !== this.handoffController) operation?.controller.abort();
    await operation?.done;
  }
}

/** Shared by the actual IPC registration and boundary tests; pet/child frames are excluded. */
export function createDesktopUpdateHandlers(manager, trusted, ownerSession = async () => {}) {
  return Object.fromEntries(['status', 'check', 'download', 'install', 'cancel'].map(action => [`petpal:updates:${action}`, async (event, token, ...args) => {
    if (!trusted(event)) throw new Error('更新操作仅允许可信主窗口');
    // Cancellation stays available after logout; it never installs or opens files.
    const authorize = async () => { if (!trusted(event)) throw new Error('更新主窗口已变化'); await ownerSession(event, token); };
    if (action !== 'cancel') await authorize();
    if (['download', 'install'].includes(action)) {
      if (args.length !== 1 || typeof args[0] !== 'string' || !/^[\w][\w.-]{0,127}$/.test(args[0])) throw new Error('更新 IPC 只接受已检查的发布 ID');
      return manager[action](args[0], { authorize });
    }
    if (args.length) throw new Error('更新 IPC 不接受 URL、路径或其他参数');
    return manager[action]({ authorize });
  }]));
}
