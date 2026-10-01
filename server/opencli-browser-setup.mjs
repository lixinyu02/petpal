import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, chmod, lstat, mkdir, mkdtemp, open, readFile, realpath, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXTENSION_URL = 'https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk';
const DOWNLOAD_PAGE = 'https://www.google.com/chrome/';
const WINDOWS_INSTALLER = 'https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi';
const REPOSITORY = 'https://dl.google.com/linux/chrome/deb/';
const SIGNING_KEY = 'https://dl.google.com/linux/linux_signing_key.pub';
// Google Linux Packages Signing Authority. A rotation requires a reviewed update.
const GOOGLE_PRIMARY_KEY = 'EB4C1BFD4F042F6DDDCCEC917721F63BD38B4796';
const PACKAGE_LIMIT = 256 * 1024 * 1024;
const METADATA_LIMIT = 2 * 1024 * 1024;
const NATIVE_SCRIPT = fileURLToPath(new URL('./native/opencli-browser-windows.ps1', import.meta.url)).replace(/\.asar([\\/])/i, '.asar.unpacked$1');
const abortError = () => Object.assign(new Error('浏览器准备已取消'), { name: 'AbortError' });
const checkAbort = (signal) => { if (signal?.aborted) throw abortError(); };

export function validateOpenCliSetup(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('浏览器准备参数无效');
  const keys = Reflect.ownKeys(input);
  const action = Object.getOwnPropertyDescriptor(input, 'action');
  if (keys.length !== 1 || keys[0] !== 'action' || !action || !Object.hasOwn(action, 'value') || !['status', 'install-browser', 'open-extension'].includes(action.value)) throw new Error('仅支持 status、install-browser 或 open-extension，不接受网址、路径或命令');
  return { action: action.value };
}

function setupEnvironment(platform, inherited = process.env) {
  const env = { LANG: 'C', LC_ALL: 'C', NO_COLOR: '1' };
  const names = platform === 'win32'
    ? ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'TEMP', 'TMP']
    : ['HOME', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS'];
  for (const key of names) if (inherited[key] !== undefined) env[key] = inherited[key];
  if (platform !== 'win32') env.PATH = '/usr/bin:/bin';
  return env;
}

/** Fixed executables, bounded output, and no shell or credential inheritance. */
function command(file, args, { signal, env, timeoutMs = 15000, maxOutputBytes = 65536, launch = spawn, terminationGraceMs = 1000, exitConfirmationMs = 3000 } = {}) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const child = launch(file, args, { shell: false, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', bytes = 0, failure = null, finished = false, escalation, confirmation;
    const terminate = (error) => {
      if (finished || failure) return; failure = error;
      try { child.kill('SIGTERM'); } catch { /* Escalation and exit confirmation still apply. */ }
      if (finished) return;
      escalation = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* Keep the instance blocked if exit cannot be confirmed. */ } }, terminationGraceMs);
      confirmation = setTimeout(() => {
        const unresolved = Object.assign(new Error('验证进程退出尚未确认，请重启小伴后再准备浏览器'), { processStillRunning: true });
        child.stdout?.destroy(); child.stderr?.destroy(); child.unref?.(); finish(unresolved, null, true);
      }, exitConfirmationMs);
    };
    const onAbort = () => terminate(abortError());
    const timer = setTimeout(() => terminate(new Error('浏览器验证工具超时')), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    const collect = (kind) => (chunk) => {
      if (finished) return;
      bytes += chunk.length;
      if (bytes > maxOutputBytes) { terminate(new Error('浏览器验证工具输出超出限制')); return; }
      if (kind === 'stdout') stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
    };
    child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
    const finish = (error, code, unconfirmed = false) => {
      if (finished) return; finished = true; clearTimeout(timer); clearTimeout(escalation); clearTimeout(confirmation); signal?.removeEventListener('abort', onAbort);
      if (unconfirmed) reject(error);
      else if (failure) reject(failure);
      else if (error || code !== 0) reject(new Error('浏览器验证工具未通过检查'));
      else resolve({ stdout, stderr, code });
    };
    child.once('error', (error) => finish(error)); child.once('close', (code) => finish(null, code));
    if (signal?.aborted) onAbort();
  });
}

function officialDownload(value) {
  let url; try { url = new URL(value); } catch { throw new Error('官方下载地址无效'); }
  if (url.protocol !== 'https:' || url.hostname !== 'dl.google.com' || url.port || url.username || url.password || url.hash || !['/linux/', '/dl/chrome/install/', '/chrome/install/'].some((prefix) => url.pathname.startsWith(prefix))) throw new Error('下载只能来自 Google 官方 HTTPS 地址');
  return url.href;
}

function paragraphs(text) {
  return text.replace(/\r/g, '').trim().split(/\n\s*\n/).map((block) => {
    const fields = {};
    for (const line of block.split('\n')) {
      if (/^\s/.test(line)) continue;
      const match = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line);
      if (!match) throw new Error('Google 仓库元数据格式无效');
      if (Object.hasOwn(fields, match[1])) throw new Error('Google 仓库元数据存在重复字段');
      fields[match[1]] = match[2];
    }
    return fields;
  });
}

function signedPackages(release, architecture, now) {
  const fields = paragraphs(release)[0];
  if (fields.Origin !== 'Google LLC' || fields.Suite !== 'stable' || !fields.Architectures?.split(/\s+/).includes(architecture)) throw new Error('签名仓库不是预期的 Google stable 架构');
  const date = Date.parse(fields.Date);
  if (!Number.isFinite(date) || date > now + 86400000 || now - date > 14 * 86400000 || (fields['Valid-Until'] && (!Number.isFinite(Date.parse(fields['Valid-Until'])) || Date.parse(fields['Valid-Until']) < now))) throw new Error('Google 签名仓库已过期或日期无效，请使用官网手动安装');
  const wanted = `main/binary-${architecture}/Packages`;
  const section = /(?:^|\n)SHA256:\s*\n((?:[ \t]+[^\n]+\n?)+)/.exec(release.replace(/\r/g, ''))?.[1];
  const matches = (section || '').split('\n').map((line) => /^\s*([a-fA-F0-9]{64})\s+(\d+)\s+(\S+)\s*$/.exec(line)).filter((match) => match?.[3] === wanted);
  if (matches.length !== 1) throw new Error('签名仓库缺少唯一的 Packages SHA256');
  const size = Number(matches[0][2]);
  if (!Number.isSafeInteger(size) || size <= 0 || size > METADATA_LIMIT) throw new Error('Google Packages 长度超出限制');
  return { file: wanted, size, hash: matches[0][1].toLowerCase() };
}

function chromePackage(packages, architecture) {
  const matches = paragraphs(packages).filter((item) => item.Package === 'google-chrome-stable');
  if (matches.length !== 1) throw new Error('Google 仓库缺少唯一的 Chrome stable 安装包');
  const item = matches[0];
  const escapedArch = architecture === 'amd64' ? 'amd64' : 'arm64';
  if (item.Architecture !== architecture || !/^[0-9][A-Za-z0-9.+~:-]{0,127}$/.test(item.Version || '') || !new RegExp(`^pool/main/g/google-chrome-stable/google-chrome-stable_[0-9][A-Za-z0-9.+~:-]{0,127}_${escapedArch}\\.deb$`).test(item.Filename || '') || !/^[a-fA-F0-9]{64}$/.test(item.SHA256 || '')) throw new Error('Google Chrome 包名、版本、路径或架构无效');
  const size = Number(item.Size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > PACKAGE_LIMIT) throw new Error('Google Chrome 安装包超出长度限制');
  return { version: item.Version, file: item.Filename, size, hash: item.SHA256.toLowerCase() };
}

export class OpenCliBrowserSetup {
  constructor({ dataDir, platform = process.platform, arch = process.arch, transport = fetch, runCommand, spawnCommand = spawn, inspectChrome, findTool, launchChrome, now = Date.now, timeoutMs = 240000, commandTimeoutMs = 15000, terminationGraceMs = 1000, exitConfirmationMs = 3000 } = {}) {
    if (typeof dataDir !== 'string' || !dataDir) throw new Error('浏览器准备需要独立数据目录');
    this.dataDir = path.resolve(dataDir); this.platform = platform; this.arch = arch;
    this.transport = transport; this.runCommand = runCommand || command; this.spawnCommand = spawnCommand; this.inspectChrome = inspectChrome; this.findTool = findTool; this.launchChrome = launchChrome; this.now = now;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw new Error('浏览器准备超时设置无效');
    for (const [name, value, max] of [['commandTimeoutMs', commandTimeoutMs, 15000], ['terminationGraceMs', terminationGraceMs, 1000], ['exitConfirmationMs', exitConfirmationMs, 3000]]) if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${name} 设置无效`);
    if (exitConfirmationMs <= terminationGraceMs) throw new Error('验证进程退出确认时间必须大于终止宽限');
    this.timeoutMs = timeoutMs; this.commandTimeoutMs = commandTimeoutMs; this.terminationGraceMs = terminationGraceMs; this.exitConfirmationMs = exitConfirmationMs;
    this.controller = null; this.closed = false; this.unconfirmedProcess = false; this.settled = null;
  }

  async #run(file, args, signal) {
    checkAbort(signal);
    let result;
    try {
      result = await this.runCommand(file, args, { signal, env: setupEnvironment(this.platform), shell: false, windowsHide: true, timeoutMs: this.commandTimeoutMs, maxOutputBytes: 65536, launch: this.spawnCommand, terminationGraceMs: this.terminationGraceMs, exitConfirmationMs: this.exitConfirmationMs });
    } catch (error) { if (error.processStillRunning) this.unconfirmedProcess = true; throw error; }
    checkAbort(signal);
    if (result?.code !== undefined && result.code !== 0) throw new Error('浏览器验证工具未通过检查');
    if (Buffer.byteLength(String(result?.stdout || '')) + Buffer.byteLength(String(result?.stderr || '')) > 65536) throw new Error('浏览器验证工具输出超出限制');
    return String(result?.stdout || '');
  }

  async #native(action, target, signal) {
    const executable = path.win32.join(process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', NATIVE_SCRIPT, '-Action', action];
    if (target) args.push('-TargetPath', target);
    const stdout = await this.#run(executable, args, signal);
    try { return JSON.parse(stdout.replace(/^\uFEFF/, '').trim()); } catch { throw new Error('Windows 浏览器验证结果无效'); }
  }

  async #chrome(signal) {
    if (this.unconfirmedProcess) return { installed: false, path: null };
    if (this.inspectChrome) return this.inspectChrome();
    if (this.platform === 'win32') {
      try { return await this.#native('status', null, signal); } catch (error) { if (signal?.aborted || error.processStillRunning) throw error; return { installed: false, path: null }; }
    }
    if (this.platform === 'linux') {
      for (const file of ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/opt/google/chrome/chrome']) {
        try { if ((await stat(file)).isFile()) { await access(file, constants.X_OK); return { installed: true, path: file }; } } catch { /* Try the next fixed installation path. */ }
      }
    }
    return { installed: false, path: null };
  }

  async #tools() {
    const result = {};
    for (const name of ['gpg', 'gpgv', 'dpkg-deb']) {
      if (this.findTool) result[name] = await this.findTool(name);
      else {
        const file = `/usr/bin/${name}`;
        try { await access(file, constants.X_OK); result[name] = (await stat(file)).isFile() ? file : null; } catch { result[name] = null; }
      }
    }
    return result;
  }

  async status() {
    const chrome = await this.#chrome();
    const supported = (this.platform === 'win32' || this.platform === 'linux') && ['x64', 'arm64'].includes(this.arch);
    const tools = this.platform === 'linux' && supported ? await this.#tools() : {};
    const installerSupported = !this.unconfirmedProcess && supported && (this.platform === 'win32' ? this.arch === 'x64' : Object.values(tools).every(Boolean));
    return { platform: this.platform, arch: this.arch, supported, chromeInstalled: chrome?.installed === true, installerSupported, extensionUrl: EXTENSION_URL, downloadPage: DOWNLOAD_PAGE,
      message: chrome?.installed === true ? 'Chrome 已安装；扩展安装与权限确认需要你在 Chrome 中完成。' : installerSupported ? '可以验证并准备 Google 官方安装包；下载后由你手动安装。' : '当前平台或验证工具不支持自动准备，请从 Google Chrome 官网手动安装，再安装 OpenCLI 扩展。' };
  }

  async #directory(signal) {
    // Reject a linked scope itself and existing linked ancestors before mkdir can follow them.
    const assertUnlinked = async (target) => {
      const root = path.parse(target).root;
      let current = root;
      for (const component of ['', ...target.slice(root.length).split(path.sep).filter(Boolean)]) {
        if (component) current = path.join(current, component);
        let info;
        try { info = await lstat(current); } catch (error) { if (error.code === 'ENOENT') break; throw error; }
        const canonical = await realpath(current);
        const equal = process.platform === 'win32' ? canonical.toLowerCase() === current.toLowerCase() : canonical === current;
        if (!info.isDirectory() || info.isSymbolicLink() || !equal) throw new Error('浏览器准备目录包含不安全的链接');
      }
    };
    await assertUnlinked(this.dataDir);
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    await assertUnlinked(this.dataDir);
    const root = await realpath(this.dataDir);
    let parent = root;
    for (const name of ['opencli', 'browser-setup']) {
      parent = path.join(parent, name);
      await mkdir(parent, { mode: 0o700 }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
      const info = await lstat(parent);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(parent) !== parent) throw new Error('浏览器准备目录包含不安全的链接');
    }
    checkAbort(signal);
    const directory = await mkdtemp(path.join(parent, 'google-chrome-'));
    try {
      if (this.platform === 'win32') {
        if ((await this.#native('secure-directory', directory, signal))?.secured !== true) throw new Error('无法建立私有浏览器准备目录');
      } else await chmod(directory, 0o700);
      return directory;
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  }

  async #download(url, destination, maxBytes, signal, expected) {
    let address = officialDownload(url), response;
    for (let redirects = 0; redirects <= 3; redirects++) {
      checkAbort(signal);
      response = await this.transport(address, { signal, redirect: 'manual', credentials: 'omit', headers: { Accept: 'application/octet-stream', 'Accept-Encoding': 'identity' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location'); await response.body?.cancel();
        if (!location || redirects === 3) throw new Error('Google 下载重定向超出限制');
        address = officialDownload(new URL(location, address).href); continue;
      }
      break;
    }
    if (response.status !== 200 || !response.body) { await response.body?.cancel(); throw new Error('Google 官方下载暂不可用'); }
    if (response.url && officialDownload(response.url) !== address) throw new Error('官方下载出现未经检查的重定向');
    if (response.headers.get('content-encoding') && response.headers.get('content-encoding').toLowerCase() !== 'identity') { await response.body.cancel(); throw new Error('Google 下载未返回原始安装包字节，请稍后重试'); }
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes || (expected && Number(declared) !== expected.size))) { await response.body.cancel(); throw new Error('Google 下载长度校验失败'); }
    const file = await open(destination, 'wx', 0o600), reader = response.body.getReader();
    const onAbort = () => { reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', onAbort, { once: true });
    let size = 0; const hash = createHash('sha256');
    try {
      for (;;) {
        checkAbort(signal);
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > maxBytes || (expected && size > expected.size)) throw new Error('Google 下载超出长度限制');
        hash.update(value);
        let offset = 0;
        while (offset < value.length) { const written = await file.write(value, offset, value.length - offset); if (!written.bytesWritten) throw new Error('无法保存 Google 安装包'); offset += written.bytesWritten; }
      }
      checkAbort(signal);
      const digest = hash.digest('hex');
      if (!size || (declared !== null && size !== Number(declared)) || (expected && (size !== expected.size || digest !== expected.hash))) throw new Error('Google 下载 SHA256 或长度校验失败');
      await file.sync(); return { size, sha256: digest };
    } finally { signal?.removeEventListener('abort', onAbort); await reader.cancel().catch(() => {}); reader.releaseLock(); await file.close(); }
  }

  async #linux(directory, tools, signal) {
    const architecture = this.arch === 'x64' ? 'amd64' : 'arm64';
    const key = path.join(directory, 'google-linux-signing-key.pub'), keyring = path.join(directory, 'google-keyring.gpg');
    const inRelease = path.join(directory, 'InRelease'), release = path.join(directory, 'Release'), packagesFile = path.join(directory, 'Packages');
    const home = path.join(directory, 'gpg'); await mkdir(home, { mode: 0o700 });
    await this.#download(SIGNING_KEY, key, METADATA_LIMIT, signal);
    const listing = await this.#run(tools.gpg, ['--batch', '--no-options', '--homedir', home, '--no-default-keyring', '--with-colons', '--fingerprint', '--show-keys', key], signal);
    const fingerprints = []; let primary = false;
    for (const line of listing.split(/\r?\n/)) {
      const fields = line.split(':'); if (fields[0] === 'pub') primary = true;
      else if (fields[0] === 'sub') primary = false;
      else if (fields[0] === 'fpr' && primary) { fingerprints.push(fields[9]); primary = false; }
    }
    if (fingerprints.filter((fingerprint) => fingerprint === GOOGLE_PRIMARY_KEY).length !== 1) throw new Error('Google Linux 官方签名密钥指纹不匹配，请改用官网手动安装');
    await this.#run(tools.gpg, ['--batch', '--no-options', '--homedir', home, '--dearmor', '--output', keyring, key], signal);
    await this.#download(`${REPOSITORY}dists/stable/InRelease`, inRelease, METADATA_LIMIT, signal);
    const signature = await this.#run(tools.gpgv, ['--homedir', home, '--keyring', keyring, '--status-fd', '1', '--output', release, inRelease], signal);
    const valid = signature.split(/\r?\n/).some((line) => {
      const fields = line.trim().split(/\s+/);
      return fields[0] === '[GNUPG:]' && fields[1] === 'VALIDSIG' && [fields[2], fields[11]].includes(GOOGLE_PRIMARY_KEY) && ['8', '9', '10', '11'].includes(fields[9]);
    });
    if (!valid) throw new Error('Google 仓库签名未由受信任的官方密钥确认');
    const releaseText = await readFile(release, 'utf8');
    if (Buffer.byteLength(releaseText) > METADATA_LIMIT) throw new Error('Google 签名仓库超出长度限制');
    const packages = signedPackages(releaseText, architecture, this.now());
    await this.#download(`${REPOSITORY}dists/stable/${packages.file}`, packagesFile, METADATA_LIMIT, signal, packages);
    const installer = chromePackage(await readFile(packagesFile, 'utf8'), architecture);
    const target = path.join(directory, `google-chrome-stable_${architecture}.deb`);
    const downloaded = await this.#download(`${REPOSITORY}${installer.file}`, target, PACKAGE_LIMIT, signal, installer);
    const metadata = await this.#run(tools['dpkg-deb'], ['--show', '--showformat=${Package}\t${Architecture}\t${Version}\n', target], signal);
    if (metadata.trim() !== `google-chrome-stable\t${architecture}\t${installer.version}`) throw new Error('Chrome DEB 内部包名、架构或版本校验失败');
    return { path: target, version: installer.version, ...downloaded };
  }

  async #openExtension(chrome, signal) {
    checkAbort(signal);
    if (this.launchChrome) await this.launchChrome(chrome, { signal, url: EXTENSION_URL });
    else if (this.platform === 'win32') {
      if ((await this.#native('open-extension', null, signal))?.opened !== true) throw new Error('Chrome 扩展页面未能打开');
    } else {
      // The browser is handed to the desktop; close() must not terminate it.
      await new Promise((resolve, reject) => {
        const child = spawn(chrome.path, ['--new-window', EXTENSION_URL], { shell: false, detached: true, env: setupEnvironment(this.platform), stdio: 'ignore' });
        child.once('error', () => reject(new Error('Chrome 扩展页面未能打开')));
        child.once('spawn', () => { child.unref(); resolve(); });
      });
    }
    return { state: 'opened', installed: true, userActionRequired: true, extensionUrl: EXTENSION_URL, message: '请在 Chrome 中点击安装 OpenCLI，并确认扩展权限；完成后返回小伴选择在线浏览器配置。' };
  }

  async execute(input, { signal } = {}) {
    const args = validateOpenCliSetup(input);
    if (args.action === 'status') return this.status();
    if (this.closed) throw new Error('浏览器准备已关闭');
    if (this.unconfirmedProcess) throw new Error('验证进程退出尚未确认，请重启小伴后再准备浏览器');
    if (this.controller) throw new Error('浏览器准备正在进行，请等待或取消');
    checkAbort(signal);
    const controller = new AbortController(); this.controller = controller;
    let settle; this.settled = new Promise((resolve) => { settle = resolve; });
    const onAbort = () => controller.abort(); signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let directory = null, prepared = false;
    try {
      const chrome = await this.#chrome(controller.signal); checkAbort(controller.signal);
      if (args.action === 'open-extension') {
        if (chrome?.installed !== true || !chrome.path || !['win32', 'linux'].includes(this.platform)) throw new Error('请先安装可用的 Google Chrome，再打开扩展商店');
        return await this.#openExtension(chrome, controller.signal);
      }
      if (chrome?.installed === true) return { state: 'installed', installed: true, userActionRequired: false, message: 'Chrome 已安装，无需重复下载；下一步打开 OpenCLI 扩展商店。' };
      const supported = (this.platform === 'win32' && this.arch === 'x64') || (this.platform === 'linux' && ['x64', 'arm64'].includes(this.arch));
      const tools = this.platform === 'linux' && supported ? await this.#tools() : null;
      if (!supported || (tools && !Object.values(tools).every(Boolean))) return { state: 'manual', installed: false, userActionRequired: true, downloadPage: DOWNLOAD_PAGE, message: '当前架构或 GPG/dpkg-deb 验证工具不可用。未下载或安装，请从 Google Chrome 官网手动安装。' };
      directory = await this.#directory(controller.signal);
      let installer;
      if (this.platform === 'win32') {
        const target = path.join(directory, 'GoogleChromeStandaloneEnterprise64.msi');
        const downloaded = await this.#download(WINDOWS_INSTALLER, target, PACKAGE_LIMIT, controller.signal);
        const signature = await this.#native('verify-installer', target, controller.signal);
        if (signature?.valid !== true || signature.publisher !== 'Google LLC') throw new Error('安装包未通过 Google LLC Authenticode 验证');
        installer = { path: target, ...downloaded };
      } else installer = await this.#linux(directory, tools, controller.signal);
      checkAbort(controller.signal); prepared = true;
      return { state: 'prepared', installed: false, userActionRequired: true, ...installer, downloadPage: DOWNLOAD_PAGE,
        message: 'Google 官方安装包已验证并准备好。请手动打开此文件完成安装、条款及管理员确认；小伴没有启动安装器。' };
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      try { if (directory && !prepared) await rm(directory, { recursive: true, force: true }); }
      finally { this.controller = null; settle(); }
    }
  }

  async close() { this.closed = true; this.controller?.abort(); await this.settled; }
}
