import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdir, lstat, open, rename, unlink, chmod } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const VERSION = '0.0.42';
const DEFAULT_ASSETS = fileURLToPath(new URL('./memobase-assets/', import.meta.url));
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (kind, message) => Object.assign(new Error(message), { code: `PETPAL_MEMOBASE_${kind}` });
const cancelled = () => fail('CANCELLED', '本机记忆操作已取消。');
const messages = Object.freeze({
  DOCKER_MISSING: '未找到 Docker，请先安装 Docker Desktop 或 Docker Engine 与 Compose，再重新准备。',
  DAEMON: 'Docker 尚未运行，请启动 Docker 后重试；聊天和待同步记忆仍可使用。',
  COMPOSE: '需要 Docker Compose 2.20 或更新版本，请更新 Docker 后重试。',
  ENGINE: '本机记忆需要 Linux 容器，请将 Docker 切换到 Linux 容器后重试。',
  MODEL: '尚未配置本机记忆提炼模型；现有记忆缓存和待同步记录已保留。',
  PORT: '本机记忆端口 8019 已被其他程序占用，请释放端口后重试。',
  PREPARE: '本机记忆镜像未能准备完成，请检查 Docker 网络后重试。',
  START: '本机记忆未能启动，请检查 Docker 状态后重试；已有记忆卷会保留。',
  HEALTH: '本机记忆启动后未能通过健康检查，请稍后重试。',
  STOP: '未能确认本机记忆已停止，请检查 Docker 状态；记忆卷未删除。',
  STORAGE: '本机记忆配置无法安全读取或保存，请保留原文件并检查权限。',
  ASSETS: '本机记忆组件校验失败，请重新安装小伴客户端。',
  CLOSED: '小伴正在退出，无法启动本机记忆。',
});
export const MEMOBASE_RUNTIME_PUBLIC_MESSAGES = Object.freeze([...Object.values(messages), '本机记忆操作已取消。', '本机记忆启动设置无效。', '本机记忆提炼模型配置无效。', '本机记忆暂不支持此系统或处理器。']);

async function privateRead(file, maxBytes = 131072) {
  let info;
  try { info = await lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) throw fail('STORAGE', messages.STORAGE);
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const current = await handle.stat();
    if (!current.isFile() || current.dev !== info.dev || current.ino !== info.ino || current.size > maxBytes) throw fail('STORAGE', messages.STORAGE);
    const bytes = Buffer.alloc(maxBytes + 1); let length = 0;
    while (length < bytes.length) { const result = await handle.read(bytes, length, bytes.length - length, null); if (!result.bytesRead) break; length += result.bytesRead; }
    if (length > maxBytes) throw fail('STORAGE', messages.STORAGE);
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}

async function privateWrite(directory, name, value, authorize = async () => {}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw fail('STORAGE', messages.STORAGE);
  if (process.platform !== 'win32') await chmod(directory, 0o700);
  const target = path.join(directory, name), temporary = path.join(directory, `.${name}-${randomUUID()}.tmp`);
  await privateRead(target);
  let handle, renamed = false;
  try {
    handle = await open(temporary, 'wx', 0o600); await handle.writeFile(value); await handle.sync(); await handle.close(); handle = null;
    await authorize(); await rename(temporary, target); renamed = true;
  } finally { await handle?.close().catch(() => {}); if (!renamed) await unlink(temporary).catch(() => {}); }
}

function normalizeModel(value) {
  if (!plain(value) || Object.keys(value).length !== 3 || !['baseUrl', 'apiKey', 'model'].every(key => typeof value[key] === 'string') ||
      !value.apiKey || value.apiKey.length > 4096 || /[\x00-\x20\x7f]/.test(value.apiKey) || !value.model.trim() || value.model.length > 200 || /[\x00-\x1f\x7f]/.test(value.model) ||
      !value.baseUrl || value.baseUrl.length > 2048 || /[\x00-\x20\x7f\\]/.test(value.baseUrl)) throw fail('MODEL_INVALID', '本机记忆提炼模型配置无效。');
  let url; try { url = new URL(value.baseUrl); } catch { throw fail('MODEL_INVALID', '本机记忆提炼模型配置无效。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw fail('MODEL_INVALID', '本机记忆提炼模型配置无效。');
  // A container's localhost is not the user's computer.
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) url.hostname = 'host.docker.internal';
  return { baseUrl: url.href.replace(/\/+$/, ''), apiKey: value.apiKey, model: value.model.trim() };
}

async function portIsFree(port) {
  const server = net.createServer(); server.unref();
  return new Promise(resolve => {
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

export function memobaseWslPath(value) {
  if (typeof value !== 'string' || !/^[A-Za-z]:[\\/]/.test(value) || /[\x00-\x1f\x7f]/.test(value)) throw fail('STORAGE', messages.STORAGE);
  const normalized = path.win32.normalize(value);
  return `/mnt/${normalized[0].toLowerCase()}/${normalized.slice(3).replace(/\\/g, '/')}`;
}

function normalizeTransport({ wslDistro, imageMirror, networkSubnet = '' }, platform) {
  if (typeof wslDistro !== 'string' || wslDistro && (platform !== 'win32' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(wslDistro))) throw fail('STORAGE', messages.STORAGE);
  if (typeof imageMirror !== 'string' || imageMirror && (!/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*(?::[1-9][0-9]{0,4})?$/.test(imageMirror) ||
      imageMirror.length > 253 || Number(imageMirror.split(':')[1] || 443) > 65535)) throw fail('STORAGE', messages.STORAGE);
  if (typeof networkSubnet !== 'string') throw fail('STORAGE', messages.STORAGE);
  if (networkSubnet) {
    const match = /^(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.0\/24$/.exec(networkSubnet);
    if (!match) throw fail('STORAGE', messages.STORAGE);
    const [first, second, third] = match.slice(1).map(Number);
    if (second > 255 || third > 255 || !(first === 10 || first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168)) throw fail('STORAGE', messages.STORAGE);
  }
  return { version: 1, wslDistro, imageMirror: imageMirror.toLowerCase(), ...(networkSubnet ? { networkSubnet } : {}) };
}

/** Optional Docker sidecar. No Docker command, image pull or network request runs at construction. */
export async function createMemobaseRuntime({ directory, assetDirectory = DEFAULT_ASSETS, fetchImpl = globalThis.fetch,
  spawnImpl = spawn, platform = process.platform, arch = process.arch, canBindPort = portIsFree,
  wslDistro, imageMirror, networkSubnet,
  commandTimeoutMs = 30000, pullTimeoutMs = 600000, startTimeoutMs = 120000, healthTimeoutMs = 45000,
  // This delay belongs to an active, bounded start operation. Keep it referenced
  // so headless callers can await startup without another server/window handle.
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || typeof assetDirectory !== 'string' || !path.isAbsolute(assetDirectory) ||
      typeof fetchImpl !== 'function' || typeof spawnImpl !== 'function' || typeof canBindPort !== 'function') throw fail('STORAGE', messages.STORAGE);
  const selectedWsl = wslDistro !== undefined ? wslDistro : platform === 'win32' ? process.env.PETPAL_MEMOBASE_WSL_DISTRO : undefined;
  const selectedMirror = imageMirror !== undefined ? imageMirror : process.env.PETPAL_MEMOBASE_DOCKER_MIRROR;
  const selectedSubnet = networkSubnet !== undefined ? networkSubnet : process.env.PETPAL_MEMOBASE_SUBNET;
  // Trusted explicit options/environment are validated even if a private file
  // exists; neither an invalid override nor a linked file can be silently used.
  normalizeTransport({ wslDistro: selectedWsl === undefined ? '' : selectedWsl, imageMirror: selectedMirror === undefined ? '' : selectedMirror,
    networkSubnet: selectedSubnet === undefined ? '' : selectedSubnet }, platform);
  let storedTransport = null, transportInvalid = false;
  try {
    let info; try { info = await lstat(directory); } catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw fail('STORAGE', messages.STORAGE);
    const bytes = await privateRead(path.join(directory, 'transport.json'), 4096);
    if (bytes) { const value = JSON.parse(bytes); if (!plain(value) || ![3, 4].includes(Object.keys(value).length) || Object.keys(value).some(key => !['version', 'wslDistro', 'imageMirror', 'networkSubnet'].includes(key)) ||
        value.version !== 1 || !['wslDistro', 'imageMirror'].every(key => Object.hasOwn(value, key))) throw fail('STORAGE', messages.STORAGE);
      storedTransport = normalizeTransport(value, platform); }
  } catch { transportInvalid = true; }
  const transport = normalizeTransport({ wslDistro: selectedWsl === undefined ? storedTransport?.wslDistro || '' : selectedWsl,
    imageMirror: selectedMirror === undefined ? storedTransport?.imageMirror || '' : selectedMirror,
    networkSubnet: selectedSubnet === undefined ? storedTransport?.networkSubnet || '' : selectedSubnet }, platform);
  wslDistro = transport.wslDistro; imageMirror = transport.imageMirror; networkSubnet = transport.networkSubnet || '';
  if (!transportInvalid && (selectedWsl !== undefined || selectedMirror !== undefined || selectedSubnet !== undefined)) {
    try { await privateWrite(directory, 'transport.json', `${JSON.stringify(transport)}\n`); }
    catch { transportInvalid = true; }
  }
  const dockerPath = value => wslDistro ? memobaseWslPath(value) : value;
  const dockerDirectory = dockerPath(directory);
  const supported = ['win32', 'linux'].includes(platform) && ['x64', 'arm64'].includes(arch);
  const project = `petpal-memory-${digest(path.resolve(directory)).slice(0, 16)}`;
  const composeFile = path.join(directory, 'compose.json'), envFile = path.join(directory, 'runtime.env');
  let settings = { version: 1, autoStart: true }, model = null, secrets = null, manifest = null, resolvedImages = null;
  let state = 'stopped', prepared = false, running = false, error = '', dockerAvailable = null, daemonAvailable = null;
  let closed = false, storageInvalid = transportInvalid, current = null, pending = Promise.resolve(), closePromise;
  if (transportInvalid) { state = 'error'; error = messages.STORAGE; }
  try {
    if (storageInvalid) throw fail('STORAGE', messages.STORAGE);
    const stored = await privateRead(path.join(directory, 'settings.json'), 4096);
    if (stored) { const value = JSON.parse(stored); if (!plain(value) || Object.keys(value).length !== 2 || value.version !== 1 || typeof value.autoStart !== 'boolean') throw new Error(); settings = value; }
    const savedModel = await privateRead(path.join(directory, 'model.json'), 8192);
    if (savedModel) model = normalizeModel(JSON.parse(savedModel));
    const savedSecrets = await privateRead(path.join(directory, 'secrets.json'), 8192);
    if (savedSecrets) { secrets = JSON.parse(savedSecrets); if (!plain(secrets) || Object.keys(secrets).length !== 4 || secrets.version !== 1 || !['accessToken', 'databasePassword', 'redisPassword'].every(key => typeof secrets[key] === 'string' && /^[0-9a-f]{64}$/.test(secrets[key]))) throw new Error(); }
  } catch { state = 'error'; error = messages.STORAGE; storageInvalid = true; }

  const status = () => ({ supported, platform, arch, version: VERSION, state, running: running && state === 'running', prepared, configured: Boolean(model), needsModel: !model,
    autoStart: settings.autoStart, port: 8019, dockerAvailable, daemonAvailable, error });
  const queue = work => { const task = pending.catch(() => {}).then(work); pending = task.catch(() => {}); return task; };
  const assertOpen = () => { if (closed) throw fail('CLOSED', messages.CLOSED); if (storageInvalid) throw fail('STORAGE', messages.STORAGE); if (!supported) throw fail('UNSUPPORTED', '本机记忆暂不支持此系统或处理器。'); };
  const publicFailure = (failure, fallback) => /^PETPAL_MEMOBASE_/.test(failure?.code || '') ? failure : fail(fallback, messages[fallback]);
  async function assets() {
    const bytes = await privateRead(path.join(assetDirectory, 'PROVENANCE.json'), 16384);
    let value; try { value = JSON.parse(bytes); } catch { throw fail('ASSETS', messages.ASSETS); }
    if (value?.version !== 1 || value?.upstream?.version !== VERSION || !plain(value.images) || Object.keys(value.images).length !== 3 ||
        !['api', 'db', 'redis'].every(key => typeof value.images[key] === 'string' && /^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(value.images[key])) ||
        !plain(value.files) || !['env.py', 'open_telemetry.py', 'LICENSE'].every(key => /^[a-f0-9]{64}$/.test(value.files[key] || ''))) throw fail('ASSETS', messages.ASSETS);
    for (const name of ['env.py', 'open_telemetry.py', 'LICENSE']) { const content = await privateRead(path.join(assetDirectory, name)); if (!content || digest(content) !== value.files[name]) throw fail('ASSETS', messages.ASSETS); }
    manifest = value; return value;
  }

  async function command(args, { timeout = commandTimeoutMs, signal } = {}) {
    if (signal?.aborted) throw cancelled();
    return new Promise((resolve, reject) => {
      let child, stdout = '', stderr = '', settled = false, timer;
      const finish = (failure, result) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); failure ? reject(failure) : resolve(result); };
      const abort = () => { child?.kill(); finish(cancelled()); };
      const executable = wslDistro ? 'wsl.exe' : 'docker';
      const commandArgs = wslDistro ? ['-d', wslDistro, '--cd', dockerDirectory, '--exec', 'docker', ...args] : args;
      try { child = spawnImpl(executable, commandArgs, { cwd: directory, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (failure) { if (failure?.code === 'ENOENT') { dockerAvailable = false; daemonAvailable = false; finish(fail('DOCKER_MISSING', messages.DOCKER_MISSING)); } else finish(failure); return; }
      const chunk = target => value => { if (settled) return; if (target === 'out') stdout += value.toString(); else stderr += value.toString(); if (stdout.length + stderr.length > 131072) { child.kill(); finish(fail('OUTPUT', messages.START)); } };
      child.stdout?.on('data', chunk('out')); child.stderr?.on('data', chunk('err'));
      child.once('error', failure => { if (failure?.code === 'ENOENT') { dockerAvailable = false; daemonAvailable = false; finish(fail('DOCKER_MISSING', messages.DOCKER_MISSING)); } else finish(failure); });
      child.once('close', code => {
        if (code !== 0) {
          if (/cannot connect|daemon is not running|docker_engine|dockerDesktopLinuxEngine|error during connect|is the docker daemon running/i.test(stderr)) { dockerAvailable = true; daemonAvailable = false; finish(fail('DAEMON', messages.DAEMON)); }
          else finish(Object.assign(new Error('Docker operation failed'), { code: 'DOCKER_COMMAND', output: stderr }));
        } else finish(null, stdout.trim());
      });
      timer = setTimeout(() => { child.kill(); finish(fail('TIMEOUT', messages.START)); }, timeout); timer.unref?.();
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    });
  }
  const compose = args => ['compose', '--project-name', project, '--project-directory', dockerDirectory, '--env-file', dockerPath(envFile), '--file', dockerPath(composeFile), ...args];
  async function inspectDocker(signal) {
    const version = await command(['version', '--format', '{{json .Server.Os}}'], { signal }); dockerAvailable = daemonAvailable = true;
    if (version !== '"linux"' && version !== 'linux') throw fail('ENGINE', messages.ENGINE);
    let versionText; try { versionText = await command(['compose', 'version', '--short'], { signal }); } catch (failure) { if (/^PETPAL_MEMOBASE_/.test(failure.code || '')) throw failure; throw fail('COMPOSE', messages.COMPOSE); }
    const match = /^v?(\d+)\.(\d+)/.exec(versionText); if (!match || Number(match[1]) < 2 || Number(match[1]) === 2 && Number(match[2]) < 20) throw fail('COMPOSE', messages.COMPOSE);
  }
  async function writeConfiguration(authorize) {
    await assets();
    const images = resolvedImages || manifest.images;
    if (!secrets) { const candidate = { version: 1, accessToken: randomBytes(32).toString('hex'), databasePassword: randomBytes(32).toString('hex'), redisPassword: randomBytes(32).toString('hex') };
      await privateWrite(directory, 'secrets.json', `${JSON.stringify(candidate)}\n`, authorize); secrets = candidate; }
    const config = { persistent_chat_blobs: true, enable_event_embedding: false, language: 'zh', use_timezone: 'Asia/Shanghai',
      ...(model ? { llm_base_url: model.baseUrl, llm_api_key: model.apiKey, best_llm_model: model.model, thinking_llm_model: model.model, summary_llm_model: model.model } : {}) };
    await privateWrite(directory, 'config.yaml', `${JSON.stringify(config, null, 2)}\n`, authorize);
    await privateWrite(directory, 'runtime.env', `PETPAL_MEMOBASE_ACCESS_TOKEN=${secrets.accessToken}\nPETPAL_MEMOBASE_DATABASE_PASSWORD=${secrets.databasePassword}\nPETPAL_MEMOBASE_REDIS_PASSWORD=${secrets.redisPassword}\n`, authorize);
    // Assets may live in Electron ASAR. Docker cannot mount archive members, so
    // copy verified adapters to ordinary private files before constructing binds.
    for (const name of ['env.py', 'open_telemetry.py']) await privateWrite(directory, name, await privateRead(path.join(assetDirectory, name)), authorize);
    const mount = (source, target) => ({ type: 'bind', source: dockerPath(source), target, read_only: true, bind: { create_host_path: false } });
    const configFile = path.join(directory, 'config.yaml');
    const document = { name: project, services: {
      db: { image: images.db, restart: 'no', environment: { POSTGRES_USER: 'memobase', POSTGRES_PASSWORD: '${PETPAL_MEMOBASE_DATABASE_PASSWORD}', POSTGRES_DB: 'memobase' },
        volumes: ['database:/var/lib/postgresql/data'], healthcheck: { test: ['CMD-SHELL', 'pg_isready -U memobase -d memobase'], interval: '3s', timeout: '3s', retries: 20 } },
      redis: { image: images.redis, restart: 'no', environment: { REDIS_PASSWORD: '${PETPAL_MEMOBASE_REDIS_PASSWORD}' },
        command: ['redis-server', '--requirepass', '${PETPAL_MEMOBASE_REDIS_PASSWORD}', '--appendonly', 'yes'], volumes: ['redis:/data'],
        healthcheck: { test: ['CMD-SHELL', 'redis-cli -a "$$REDIS_PASSWORD" --no-auth-warning ping | grep -q PONG'], interval: '3s', timeout: '3s', retries: 20 } },
      api: { image: images.api, restart: 'no', environment: {
        DATABASE_URL: 'postgresql://memobase:${PETPAL_MEMOBASE_DATABASE_PASSWORD}@db:5432/memobase', REDIS_URL: 'redis://:${PETPAL_MEMOBASE_REDIS_PASSWORD}@redis:6379/0',
        ACCESS_TOKEN: '${PETPAL_MEMOBASE_ACCESS_TOKEN}', PROJECT_ID: project, API_HOSTS: 'http://127.0.0.1:8019', USE_CORS: 'false', OTEL_SDK_DISABLED: 'true', PYTHONDONTWRITEBYTECODE: '1',
      }, extra_hosts: ['host.docker.internal:host-gateway'], depends_on: { db: { condition: 'service_healthy' }, redis: { condition: 'service_healthy' } },
      ports: [{ target: 8000, published: '8019', host_ip: '127.0.0.1', protocol: 'tcp' }],
      volumes: [mount(configFile, '/app/config.yaml'), mount(path.join(directory, 'env.py'), '/app/memobase_server/env.py'), mount(path.join(directory, 'open_telemetry.py'), '/app/memobase_server/telemetry/open_telemetry.py')],
      logging: { driver: 'local', options: { 'max-size': '2m', 'max-file': '2' } } },
    }, volumes: { database: {}, redis: {} }, ...(networkSubnet ? { networks: { default: { ipam: { config: [{ subnet: networkSubnet }] } } } } : {}) };
    await privateWrite(directory, 'compose.json', `${JSON.stringify(document, null, 2)}\n`, authorize);
  }
  async function withOperation(nextState, work, { authorize = async () => {} } = {}) {
    assertOpen(); await authorize(); const controller = new AbortController(); current = controller; state = nextState; error = '';
    try { const result = await work(controller.signal, authorize); await authorize(); return result; }
    catch (failure) { const safe = publicFailure(failure, nextState === 'preparing' ? 'PREPARE' : 'START'); state = closed ? 'stopped' : 'error'; error = safe.message; throw safe; }
    finally { if (current === controller) current = null; }
  }
  async function prepareNow(signal, authorize) {
    await writeConfiguration(authorize); await inspectDocker(signal); await authorize();
    await ensurePrepared(signal, authorize);
  }
  async function verifiedImage(image, signal) {
    try {
      const repoDigests = JSON.parse(await command(['image', 'inspect', '--format', '{{json .RepoDigests}}', image], { signal }));
      return Array.isArray(repoDigests) && repoDigests.some(value => typeof value === 'string' && value.endsWith(`@${image.split('@')[1]}`));
    } catch (failure) {
      if (/^PETPAL_MEMOBASE_(?:CANCELLED|DOCKER_MISSING|DAEMON|TIMEOUT)$/.test(failure.code || '')) throw failure;
      return false;
    }
  }
  async function ensurePrepared(signal, authorize) {
    const next = {};
    for (const [name, canonical] of Object.entries(manifest.images)) {
      let reference = canonical;
      if (!await verifiedImage(canonical, signal)) {
        // Only Docker Hub dependencies may use an explicitly configured mirror.
        // Preserve the original registry's verified manifest digest verbatim.
        if (imageMirror && name !== 'api') reference = `${imageMirror}/${name === 'redis' ? 'library/' : ''}${canonical}`;
        if (reference === canonical || !await verifiedImage(reference, signal)) {
          await command(['pull', reference], { signal, timeout: pullTimeoutMs }); await authorize();
          if (!await verifiedImage(reference, signal)) throw fail('PREPARE', messages.PREPARE);
        }
      }
      next[name] = reference; await authorize();
    }
    resolvedImages = next; prepared = true; await writeConfiguration(authorize);
  }
  async function ownedApi(signal) {
    const id = await command(compose(['ps', '--all', '--quiet', 'api']), { signal });
    if (!id) return false; if (!/^[a-f0-9]{12,64}$/.test(id)) throw fail('START', messages.START);
    const value = JSON.parse(await command(['inspect', '--format', '{"labels":{{json .Config.Labels}},"ports":{{json .NetworkSettings.Ports}},"running":{{json .State.Running}}}', id], { signal }));
    const bindings = value.ports?.['8000/tcp'];
    return value.labels?.['com.docker.compose.project'] === project && value.labels?.['com.docker.compose.service'] === 'api' && value.running === true &&
      Array.isArray(bindings) && bindings.length === 1 && bindings[0].HostIp === '127.0.0.1' && bindings[0].HostPort === '8019';
  }
  async function healthy(signal) {
    const response = await fetchImpl('http://127.0.0.1:8019/api/v1/healthcheck', { redirect: 'error', credentials: 'omit', headers: { Authorization: `Bearer ${secrets.accessToken}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(2500)]) });
    if (!response.ok || response.redirected) { await response.body?.cancel().catch(() => {}); return false; }
    const bytes = await response.text(); if (bytes.length > 8192) return false;
    let value; try { value = JSON.parse(bytes); } catch { return false; }
    return value?.errno === 0;
  }
  async function stopNow({ authorize = async () => {}, closing = false } = {}) {
    await authorize(); const prior = running; state = 'stopping'; error = '';
    try {
      if (await privateRead(composeFile)) await command(compose(['stop', '--timeout', '10']), { timeout: 30000 });
      running = false; state = 'stopped'; if (!closing) await authorize(); return status();
    } catch (failure) { running = prior; state = 'error'; const safe = publicFailure(failure, 'STOP'); error = safe.message; throw safe; }
  }
  return {
    status,
    async connection() {
      if (!running || state !== 'running' || !secrets || closed) return null;
      try {
        if (!await ownedApi()) throw fail('PORT', messages.PORT);
        if (closed || !running || state !== 'running') return null;
        return { baseUrl: 'http://127.0.0.1:8019', apiKey: secrets.accessToken };
      } catch (failure) { if (!closed && state === 'running') { running = false; state = 'error'; error = publicFailure(failure, 'START').message; } return null; }
    },
    prepare(options) { return queue(() => withOperation('preparing', async (signal, authorize) => { await prepareNow(signal, authorize); state = running ? 'running' : 'stopped'; return status(); }, options)); },
    configureModel(value, { authorize = async () => {} } = {}) { return queue(async () => { assertOpen(); const next = normalizeModel(value); await authorize();
      if (model && JSON.stringify(model) === JSON.stringify(next)) return status();
      if (running) await stopNow({ authorize });
      await privateWrite(directory, 'model.json', `${JSON.stringify(next)}\n`, authorize); model = next; error = ''; return status(); }); },
    preferences(value, { authorize = async () => {} } = {}) { return queue(async () => { assertOpen(); if (!plain(value) || Object.keys(value).length !== 1 || typeof value.autoStart !== 'boolean') throw fail('SETTINGS', '本机记忆启动设置无效。');
      const next = { version: 1, autoStart: value.autoStart }; await privateWrite(directory, 'settings.json', `${JSON.stringify(next)}\n`, authorize); settings = next; return status(); }); },
    start(options) { return queue(() => withOperation('starting', async (signal, authorize) => {
      if (!model) throw fail('MODEL', messages.MODEL);
      await writeConfiguration(authorize); await inspectDocker(signal); await authorize();
      const owned = await ownedApi(signal); if (!owned && !await canBindPort(8019)) throw fail('PORT', messages.PORT);
      if (!owned) {
        await ensurePrepared(signal, authorize);
        await authorize(); await command(compose(['up', '--detach', '--wait', '--wait-timeout', String(Math.ceil(startTimeoutMs / 1000)), '--pull', 'never']), { signal, timeout: startTimeoutMs + 5000 });
      }
      if (!await ownedApi(signal)) throw fail('PORT', messages.PORT);
      const deadline = Date.now() + healthTimeoutMs;
      while (!signal.aborted) {
        await authorize(); let ready = false; try { ready = await healthy(signal); } catch {}
        if (ready) { running = true; state = 'running'; error = ''; return status(); }
        if (Date.now() >= deadline) throw fail('HEALTH', messages.HEALTH);
        await sleep(Math.min(500, Math.max(1, deadline - Date.now())));
      }
      throw cancelled();
    }, options)).catch(async failure => { running = false; if (!closed) { try { await stopNow(); } catch {} state = 'error'; error = failure.message; } throw failure; }); },
    stop(options) { current?.abort(); return queue(() => stopNow(options)); },
    close() { if (closePromise) return closePromise; closed = true; current?.abort(); closePromise = queue(() => stopNow({ closing: true })); return closePromise; },
  };
}
