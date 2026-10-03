'use strict';

const path = require('node:path');
const nativeFs = require('node:fs/promises');
const os = require('node:os');
const { randomUUID } = require('node:crypto');

const DEFAULTS = Object.freeze({ autoLaunch: false, startMinimized: false, showPetOnLaunch: true,
  closeToTray: true, petAlwaysOnTop: true });
const KEYS = new Set(Object.keys(DEFAULTS));
const MAX_BYTES = 8192;
const AUTOSTART_FILE = 'com.petpal.desktop.desktop';
const AUTOSTART_ARGS = ['--petpal-autostart'];
const WINDOWS_REGISTRATION_NAME = 'com.petpal.desktop';
const PRIVATE_TARGET_KEY = '_windowsAutoLaunchTarget';
const preferenceError = message => Object.assign(new Error(message), { code: 'PETPAL_APP_PREFERENCES' });

function validate(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw preferenceError('本机设置必须为布尔选项。');
  const patch = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !KEYS.has(key) || typeof value[key] !== 'boolean')
      throw preferenceError('本机设置包含不支持的选项或非布尔值。');
    patch[key] = value[key];
  }
  return patch;
}

// Desktop Entry string escaping is applied before Exec tokenization. A literal
// backslash therefore needs four backslashes; literal percent signs need %%. No
// shell is involved, and paths containing line/control characters are rejected.
function desktopExec(executable) {
  const escaped = executable.replace(/["`$\\]/g, '\\$&').replace(/\\/g, '\\\\').replace(/%/g, '%%');
  return `"${escaped}" ${AUTOSTART_ARGS.join(' ')}`;
}

function validWindowsPath(value) {
  return typeof value === 'string' && value.length <= 4096 && path.win32.isAbsolute(value) &&
    /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$))/.test(value) &&
    !/^[\\/]{2}[?.][\\/]/.test(value) && !/[\x00-\x1f\x7f"]/.test(value);
}

function windowsTarget(executable) {
  return { platform: 'win32', path: executable, name: WINDOWS_REGISTRATION_NAME, args: [...AUTOSTART_ARGS] };
}

function persistedSettings(value, platform) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Invalid persisted preferences');
  const publicValue = { ...value };
  let target = null;
  if (Object.hasOwn(publicValue, PRIVATE_TARGET_KEY)) {
    target = publicValue[PRIVATE_TARGET_KEY];
    if (platform !== 'win32' || !target || Array.isArray(target) || typeof target !== 'object' ||
        Object.keys(target).length !== 4 || !Object.keys(target).every(key => ['platform', 'path', 'name', 'args'].includes(key)) ||
        target.platform !== 'win32' || target.name !== WINDOWS_REGISTRATION_NAME || !validWindowsPath(target.path) ||
        !Array.isArray(target.args) || target.args.length !== AUTOSTART_ARGS.length ||
        !target.args.every((argument, index) => argument === AUTOSTART_ARGS[index])) throw new Error('Invalid private startup metadata');
    target = windowsTarget(target.path);
    delete publicValue[PRIVATE_TARGET_KEY];
  }
  return { preferences: validate(publicValue), target };
}

function createAppPreferences({ app, platform = process.platform, env = process.env, fs = nativeFs } = {}) {
  let preferences = { ...DEFAULTS }, loadReason = '', launchIntent = false, registeredTarget = null,
    closing = false, pending = Promise.resolve();
  const queue = work => {
    const task = pending.then(work);
    pending = task.catch(() => {});
    return task;
  };
  const current = () => ({ ...preferences });
  const missing = error => error?.code === 'ENOENT';

  function settingsFile() {
    const directory = app.getPath('userData');
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('Invalid userData');
    return path.join(directory, 'app-preferences.json');
  }

  function autoLaunchTarget() {
    if (!app?.isPackaged) return { supported: false, reason: '开发环境不写入开机启动项，请使用安装包。' };
    if (!['win32', 'linux'].includes(platform)) return { supported: false, reason: '此系统暂不支持本机开机自启。' };
    let executable;
    try {
      if (platform === 'win32') {
        if (env.PORTABLE_EXECUTABLE_DIR && !env.PORTABLE_EXECUTABLE_FILE)
          return { supported: false, reason: '便携客户端未提供启动外壳，无法安全设置开机自启。' };
        executable = env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe') || process.execPath;
        if (!validWindowsPath(executable))
          throw new Error('Invalid executable');
        if (!env.PORTABLE_EXECUTABLE_FILE && [env.TEMP, env.TMP, os.tmpdir()].some(directory => {
          if (typeof directory !== 'string' || !path.win32.isAbsolute(directory)) return false;
          const relative = path.win32.relative(directory, executable);
          return relative && !relative.startsWith('..') && !path.win32.isAbsolute(relative);
        })) return { supported: false, reason: '客户端从临时目录运行，无法安全设置开机自启；请使用固定位置的便携外壳。' };
        if (typeof app.getLoginItemSettings !== 'function' || typeof app.setLoginItemSettings !== 'function')
          throw new Error('Missing login item API');
        return { supported: true, executable };
      }
      executable = env.APPIMAGE || app.getPath('exe') || process.execPath;
      const home = env.HOME || app.getPath('home');
      const configHome = env.XDG_CONFIG_HOME || (typeof home === 'string' ? path.posix.join(home, '.config') : '');
      if (typeof executable !== 'string' || !path.posix.isAbsolute(executable) || /[\x00-\x1f\x7f]/.test(executable) ||
          typeof configHome !== 'string' || !path.posix.isAbsolute(configHome) || /[\x00-\x1f\x7f]/.test(configHome))
        throw new Error('Invalid autostart path');
      return { supported: true, executable, file: path.join(configHome, 'autostart', AUTOSTART_FILE) };
    } catch { return { supported: false, reason: '无法确定客户端启动位置，请重新安装或移动客户端后重试。' }; }
  }

  async function readFile(file) {
    let info;
    try { info = await fs.lstat(file); } catch (error) { if (missing(error)) return null; throw error; }
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES) throw new Error('Invalid settings file');
    const bytes = await fs.readFile(file);
    if (bytes.length > MAX_BYTES) throw new Error('Oversized settings file');
    return { bytes, mode: info.mode & 0o777 };
  }

  async function atomicWrite(file, bytes, mode = 0o600, beforeCommit) {
    const directory = path.dirname(file), temporary = path.join(directory, `.${path.basename(file)}-${randomUUID()}.tmp`);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const directoryInfo = await fs.lstat(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error('Invalid settings directory');
    // Only our leaf directory is tightened, never the user's HOME/config root.
    if (platform !== 'win32') await fs.chmod(directory, 0o700);
    await readFile(file); // Refuse existing special files without following links.
    let handle, renamed = false;
    try {
      handle = await fs.open(temporary, 'wx', mode);
      await handle.writeFile(bytes);
      if (platform !== 'win32') await handle.chmod(mode);
      await handle.sync();
      await handle.close();
      handle = null;
      if (beforeCommit) await beforeCommit();
      await fs.rename(temporary, file);
      renamed = true;
    } finally {
      if (handle) await handle.close().catch(() => {});
      if (!renamed) await fs.unlink(temporary).catch(() => {});
    }
  }

  function desktopEntry(target) {
    return Buffer.from(`[Desktop Entry]\nType=Application\nVersion=1.0\nName=PetPal\nComment=PetPal desktop companion\nExec=${desktopExec(target.executable)}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`);
  }

  function readWindowsTarget(executable) {
    // Electron's registry iterator tokenizes options.path as a command line.
    // Quote query paths so a portable wrapper containing spaces is not truncated.
    const settings = app.getLoginItemSettings({ path: `"${executable}"`, args: [...AUTOSTART_ARGS] });
    if (!Array.isArray(settings?.launchItems)) throw new Error('Missing Windows startup snapshot');
    const owned = settings.launchItems.filter(item => item?.name === WINDOWS_REGISTRATION_NAME && item.scope === 'user' &&
      typeof item.path === 'string' && path.win32.normalize(item.path).toLowerCase() === path.win32.normalize(executable).toLowerCase());
    if (owned.length > 1 || owned.some(item => typeof item.enabled !== 'boolean' || !Array.isArray(item.args) ||
        item.args.length !== AUTOSTART_ARGS.length || !item.args.every((arg, index) => arg === AUTOSTART_ARGS[index])))
      return { enabled: false, registered: false, unverified: true };
    const item = owned[0], registered = Boolean(item), enabled = item?.enabled === true;
    return { enabled, registered, snapshot: { registered, approved: enabled, target: windowsTarget(executable) } };
  }

  async function readAutoLaunch(target) {
    if (!target.supported) return { enabled: false, reason: target.reason };
    if (platform === 'win32') {
      let launch = readWindowsTarget(target.executable);
      if (!launch.registered && !launch.unverified && registeredTarget &&
          path.win32.normalize(registeredTarget.path).toLowerCase() !== path.win32.normalize(target.executable).toLowerCase()) {
        const previous = readWindowsTarget(registeredTarget.path);
        if (previous.registered) launch = { ...previous, oldTarget: true };
        else if (previous.unverified) launch = previous;
      }
      if (!launch.registered && (launch.unverified || launchIntent || registeredTarget)) return {
        ...launch, unverified: true, reason: '无法核对旧位置的开机启动项；请在 Windows 设置的启动应用中清理旧小伴，并重置本机自启设置后重试。' };
      return { ...launch,
        ...(launch.oldTarget ? { reason: '开机启动项仍指向旧位置；可关闭它，或重新开启以登记当前版本。' } :
          launch.registered && !launch.enabled ? { reason: 'Windows 已在系统启动应用中禁用小伴；重新开启可恢复。' } : {}) };
    }
    const snapshot = await readFile(target.file);
    if (!snapshot) return { enabled: false, snapshot: null };
    const text = new TextDecoder('utf-8', { fatal: true }).decode(snapshot.bytes);
    const values = new Map();
    let activeGroup = false;
    for (const line of text.split(/\r?\n/)) {
      if (/^\[.*\]$/.test(line.trim())) { activeGroup = line.trim() === '[Desktop Entry]'; continue; }
      if (!activeGroup || /^\s*#/.test(line)) continue;
      const split = line.indexOf('=');
      if (split > 0) values.set(line.slice(0, split).trim(), line.slice(split + 1).trim());
    }
    const matches = values.get('Type') === 'Application' && values.get('Exec') === desktopExec(target.executable);
    const disabled = values.get('Hidden') === 'true' || values.get('X-GNOME-Autostart-enabled') === 'false';
    return { enabled: matches && !disabled, snapshot,
      ...(!matches ? { reason: '已有启动项指向旧位置，重新开启开机自启可更新。' } : {}) };
  }

  async function applyAutoLaunch(target, enabled) {
    if (platform === 'win32') {
      app.setLoginItemSettings({ name: WINDOWS_REGISTRATION_NAME, openAtLogin: enabled, enabled,
        path: target.executable, args: [...AUTOSTART_ARGS] });
      const current = readWindowsTarget(target.executable);
      const previous = registeredTarget && registeredTarget.path !== target.executable ? readWindowsTarget(registeredTarget.path) : null;
      if (current.enabled !== enabled || current.unverified || !enabled &&
          (current.registered || previous?.registered || previous?.unverified)) throw new Error('System refused login item');
      return;
    }
    if (enabled) await atomicWrite(target.file, desktopEntry(target));
    else { await readFile(target.file); await fs.unlink(target.file).catch(error => { if (!missing(error)) throw error; }); }
  }

  async function restoreAutoLaunch(target, snapshot) {
    if (platform === 'win32') {
      app.setLoginItemSettings({ name: WINDOWS_REGISTRATION_NAME, openAtLogin: snapshot.registered, enabled: snapshot.approved,
        path: snapshot.target.path, args: [...AUTOSTART_ARGS] });
      const restored = readWindowsTarget(snapshot.target.path);
      if (restored.registered !== snapshot.registered || restored.enabled !== snapshot.approved)
        throw new Error('System refused login item rollback');
    }
    else if (snapshot) await atomicWrite(target.file, snapshot.bytes, snapshot.mode);
    else await fs.unlink(target.file).catch(error => { if (!missing(error)) throw error; });
  }

  async function statusNow() {
    const target = autoLaunchTarget();
    let launch, readFailed = false;
    try { launch = await readAutoLaunch(target); }
    catch { readFailed = true; launch = { enabled: false, reason: '无法读取系统开机启动项，请检查本机权限后重试。' }; }
    preferences.autoLaunch = launch.enabled;
    if (target.supported && launchIntent && !launch.enabled && !launch.reason)
      launch.reason = '系统开机自启当前未启用；更新或移动便携客户端后，请重新开启。';
    const reason = [launch.reason, loadReason].filter(Boolean).join(' ');
    return { platform, autoLaunchSupported: target.supported && !readFailed && !launch.unverified,
      ...current(), ...(reason ? { autoLaunchReason: reason } : {}) };
  }

  async function loadNow() {
    preferences = { ...DEFAULTS };
    loadReason = '';
    registeredTarget = null;
    try {
      const file = await readFile(settingsFile());
      if (file) {
        const loaded = persistedSettings(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes)), platform);
        preferences = { ...DEFAULTS, ...loaded.preferences };
        registeredTarget = loaded.target;
      }
    } catch { loadReason = '本机偏好文件暂不可读取，已使用默认窗口设置；原文件保留。'; }
    launchIntent = preferences.autoLaunch;
    return statusNow();
  }

  async function updateNow(value, options = {}) {
    const patch = validate(value), target = autoLaunchTarget();
    if (patch.autoLaunch === true && !target.supported) throw preferenceError(target.reason);
    let authorizationFailed = false;
    const authorize = async () => {
      if (closing) throw preferenceError('客户端正在退出，设置未保存。');
      if (typeof options.authorize !== 'function') return;
      try { await options.authorize(); }
      catch { authorizationFailed = true; throw preferenceError('登录状态已变化，设置未保存；请重新登录后重试。'); }
      if (closing) throw preferenceError('客户端正在退出，设置未保存。');
    };
    await authorize();
    let before;
    try { before = await readAutoLaunch(target); }
    catch {
      if (Object.hasOwn(patch, 'autoLaunch')) throw preferenceError('无法读取系统开机启动项，设置未保存；请检查本机权限。');
      before = { enabled: false };
    }
    if (Object.hasOwn(patch, 'autoLaunch') && before.unverified) throw preferenceError(before.reason);
    const previous = { ...preferences, autoLaunch: before.enabled };
    const next = { ...previous, ...patch };
    const changeLaunch = target.supported && Object.hasOwn(patch, 'autoLaunch') &&
      (next.autoLaunch !== before.enabled || next.autoLaunch && before.oldTarget || !next.autoLaunch &&
        (platform === 'win32' ? before.registered : Boolean(before.snapshot)));
    let nextTarget = null;
    if (platform === 'win32') {
      if (changeLaunch && next.autoLaunch) nextTarget = windowsTarget(target.executable);
      else if (!changeLaunch && before.snapshot?.registered) nextTarget = before.snapshot.target;
      else if (before.unverified) nextTarget = registeredTarget;
    }
    const written = { ...next, ...(before.unverified ? { autoLaunch: launchIntent } : {}),
      ...(nextTarget ? { [PRIVATE_TARGET_KEY]: nextTarget } : {}) };
    let attempted = false;
    try {
      if (changeLaunch) { attempted = true; await applyAutoLaunch(target, next.autoLaunch); }
      if (attempted) await authorize();
      await atomicWrite(settingsFile(), Buffer.from(JSON.stringify(written, null, 2) + '\n'), 0o600, authorize);
    } catch {
      let restored = true;
      if (attempted) {
        try { await restoreAutoLaunch(target, before.snapshot); } catch { restored = false; }
      }
      preferences = previous;
      if (authorizationFailed && restored) throw preferenceError('登录状态已变化，设置未保存；请重新登录后重试。');
      if (closing && restored) throw preferenceError('客户端正在退出，设置未保存；变更已撤销。');
      throw preferenceError(restored ? '无法保存本机设置，变更已撤销；请检查本机权限或可用空间。' :
        '无法保存本机设置，启动项回滚未完成；请检查系统开机启动项后重试。');
    }
    preferences = next;
    launchIntent = written.autoLaunch;
    registeredTarget = nextTarget;
    loadReason = '';
    return statusNow();
  }

  return { load: () => queue(loadNow), status: () => queue(statusNow),
    update: (patch, options) => closing ? Promise.reject(preferenceError('客户端正在退出，无法更改设置。')) :
      queue(() => updateNow(patch, options)), current,
    close: () => { closing = true; return pending; } };
}

module.exports = { createAppPreferences };
