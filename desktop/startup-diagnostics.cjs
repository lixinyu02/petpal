'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');

const MAX_LOG_BYTES = 128 * 1024;
const phases = new Set(['electron-ready', 'service-settings', 'workspace', 'backend-create', 'backend-listen',
  'executor-create', 'transport-create', 'updates-create', 'permissions', 'tray-create', 'window-create',
  'window-load', 'renderer-run', 'ready', 'smoke-login', 'smoke-executor', 'smoke-status', 'smoke-anime',
  'smoke-system-speech', 'smoke-anime-gestures', 'smoke-cat', 'smoke-cat-gestures',
  'smoke-avatar-return', 'smoke-app', 'smoke-evidence', 'smoke-complete']);
const codes = new Set(['EACCES', 'EPERM', 'EROFS', 'ENOENT', 'ENOSPC', 'EIO', 'EMFILE', 'ENFILE',
  'EADDRINUSE', 'EADDRNOTAVAIL', 'MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND', 'ERR_DLOPEN_FAILED',
  'ERR_FAILED', 'ERR_ABORTED', 'ERR_FILE_NOT_FOUND', 'ERR_CONNECTION_REFUSED',
  'PETPAL_DESKTOP_SERVICE_SETTINGS', 'RENDERER_CRASHED', 'RENDERER_OOM', 'RENDERER_LAUNCH_FAILED',
  'RENDERER_INTEGRITY_FAILURE', 'RENDERER_ABNORMAL_EXIT', 'RENDERER_KILLED', 'RENDERER_UNAVAILABLE']);
const version = value => typeof value === 'string' && /^\d+(?:\.\d+){0,3}(?:[-+][A-Za-z0-9.-]{1,32})?$/.test(value) && value.length <= 64 ? value : 'unknown';
const phaseOf = value => phases.has(value) ? value : 'unknown';
function errorCode(error) {
  try { return codes.has(error?.code) ? error.code : 'UNKNOWN'; } catch { return 'UNKNOWN'; }
}
function errorType(error) {
  // Names and constructor names are caller-controlled; classify only known built-in instances.
  try {
    if (error instanceof SyntaxError) return 'SyntaxError';
    if (error instanceof TypeError) return 'TypeError';
    if (error instanceof RangeError) return 'RangeError';
    if (error instanceof Error) return 'Error';
  } catch { /* even an exotic thrown value must not break startup reporting */ }
  return 'Unknown';
}

/** Main-process-only metadata. No exception text, stack, URL, config or credential is serialized. */
function createStartupDiagnostics({ userData, appVersion, electronVersion, platform = process.platform,
  arch = process.arch, osVersion = os.release(), isSmoke = false, smokeDir = '',
  tempRoot = os.tmpdir(), now = Date.now, maxBytes = MAX_LOG_BYTES } = {}) {
  const started = now();
  const limit = Math.max(2048, Math.min(MAX_LOG_BYTES, Number.isInteger(maxBytes) ? maxBytes : MAX_LOG_BYTES));
  const metadata = { app: 'PetPal', appVersion: version(appVersion), electronVersion: version(electronVersion),
    os: ['win32', 'linux', 'darwin'].includes(platform) ? platform : 'unknown',
    arch: ['x64', 'arm64', 'ia32'].includes(arch) ? arch : 'unknown', osVersion: version(osVersion) };
  let logPath = null, pending = Promise.resolve();
  const primary = typeof userData === 'string' && path.isAbsolute(userData) ? path.join(userData, 'logs') : null;
  const suffix = createHash('sha256').update(typeof userData === 'string' ? userData : '').digest('hex').slice(0, 16);
  const fallback = path.join(tempRoot, `petpal-startup-${suffix}`);
  function record(event, phase, error) {
    return { time: new Date(now()).toISOString(), event, phase: phaseOf(phase),
      elapsedMs: Math.max(0, Math.min(24 * 60 * 60 * 1000, Math.round(now() - started))), ...metadata,
      ...(event === 'failure' ? { code: errorCode(error), errorType: errorType(error) } : {}) };
  }
  async function privateDirectory(directory) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || process.getuid && stat.uid !== process.getuid()) throw new Error('Diagnostic directory is unavailable');
    await fs.chmod(directory, 0o700);
  }
  async function append(directory, line) {
    await privateDirectory(directory);
    const file = path.join(directory, 'startup.jsonl');
    const existing = await fs.lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (existing && (!existing.isFile() || existing.isSymbolicLink() || process.getuid && existing.uid !== process.getuid())) throw new Error('Diagnostic file is unavailable');
    // Windows append-only handles cannot be truncated reliably. Own a writable
    // handle and use explicit offsets for both append and bounded compaction.
    const handle = await fs.open(file, 'r+').catch(async error => {
      if (error.code !== 'ENOENT') throw error;
      return fs.open(file, 'wx+', 0o600);
    });
    try {
      await handle.chmod(0o600);
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('Diagnostic file is unavailable');
      const bytes = Buffer.from(line);
      let position = stat.size;
      if (stat.size + bytes.length > limit) {
        // Keep complete recent records; never allocate/read an unbounded old log.
        const length = Math.min(stat.size, limit - bytes.length);
        const recent = Buffer.alloc(length);
        await handle.read(recent, 0, length, stat.size - length);
        const text = recent.toString('utf8');
        const boundary = text.indexOf('\n');
        const tail = boundary < 0 ? '' : text.slice(boundary + 1);
        await handle.truncate(0);
        const kept = Buffer.from(tail);
        if (kept.length) await handle.write(kept, 0, kept.length, 0);
        position = kept.length;
      }
      await handle.write(bytes, 0, bytes.length, position);
      await handle.sync();
      return file;
    } finally { await handle.close(); }
  }
  async function write(entry) {
    const line = `${JSON.stringify(entry)}\n`;
    const directories = [...new Set([logPath && path.dirname(logPath), primary, fallback].filter(Boolean))];
    for (const directory of directories) {
      try { logPath = await append(directory, line); return; } catch { /* preserve app data and try a private temp log */ }
    }
    logPath = null;
  }
  function enqueue(entry) {
    const done = pending.catch(() => {}).then(() => write(entry));
    pending = done.catch(() => {});
    return done;
  }
  return {
    async milestone(phase) { await enqueue(record('milestone', phase)); return logPath; },
    async failure(error, phase) {
      const entry = record('failure', phase, error);
      await enqueue(entry);
      let smokeErrorPath = null;
      if (isSmoke && typeof smokeDir === 'string' && path.isAbsolute(smokeDir)) {
        try {
          await privateDirectory(smokeDir);
          smokeErrorPath = path.join(smokeDir, 'error.json');
          const existing = await fs.lstat(smokeErrorPath).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
          if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error('Smoke diagnostic is unavailable');
          await fs.writeFile(smokeErrorPath, `${JSON.stringify({ ...entry, logPath }, null, 2)}\n`, { mode: 0o600 });
          await fs.chmod(smokeErrorPath, 0o600);
        } catch { smokeErrorPath = null; }
      }
      return { record: entry, logPath, smokeErrorPath };
    },
  };
}

function startupFailureMessage(error, logPath) {
  const code = errorCode(error);
  let message = '小伴未能完成启动。请关闭后重试；如仍有问题，请下载最新版，并将启动日志提供给维护者。';
  if (code === 'PETPAL_DESKTOP_SERVICE_SETTINGS') {
    // This error is generated by our fixed settings reader; it never quotes file content.
    try { if (typeof error.message === 'string') message = error.message; } catch {}
  } else if (['EACCES', 'EPERM', 'EROFS'].includes(code)) message = '小伴无法读取或写入本机文件。请检查当前账户的目录权限与安全软件拦截记录，然后重新启动。';
  else if (code === 'ENOSPC') message = '磁盘空间不足，无法启动小伴。请释放系统盘与临时目录所在磁盘的空间，然后重新启动。';
  else if (['ENOENT', 'MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND', 'ERR_DLOPEN_FAILED'].includes(code)) message = '客户端文件缺失或未能加载。请从发布页面重新下载完整 Windows 客户端，并检查安全软件是否隔离了文件。';
  else if (code.startsWith('RENDERER_')) message = '小伴界面进程意外退出。请重新启动客户端；如反复出现，请更新显卡驱动和客户端，并将启动日志提供给维护者。';
  return `${message}\n\n现有账号和聊天数据已保留。\n${logPath ? `启动日志：${logPath}` : '启动日志无法写入，请检查应用数据目录和临时目录的权限。'}`;
}

module.exports = { createStartupDiagnostics, startupFailureMessage, MAX_LOG_BYTES };
