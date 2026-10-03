const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, session, shell, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { canRequestMedia, canCheckMedia } = require('./media-permissions.cjs');
const { readDesktopServiceSettings } = require('./service-settings.cjs');
const { createDesktopRemoteHttp, isPetPalReleaseUrl } = require('./remote-http.cjs');
const { mainWindowLayout, petWindowLayout } = require('./window-layout.cjs');
const { createStartupDiagnostics, startupFailureMessage } = require('./startup-diagnostics.cjs');
const { createAppPreferences } = require('./app-preferences.cjs');
const { createAppPreferencesHandlers, verifyPreferencesSessionConnection } = require('./app-preferences-ipc.cjs');
const { createCentralServer } = require('./central-server.cjs');
const { createCentralServerHandlers } = require('./central-server-ipc.cjs');
const { spawn } = require('node:child_process');

let mainWindow, petWindow, mainLoaded, petLoaded, tray, backend, origin, quitting = false, exitCode = 0;
let updates, pendingUpdate, verifyDownloadedUpdate, remoteHttp, executor;
let appPreferences, centralServer;
let startupDiagnostics, startupPhase = 'electron-ready', startupFailed = false;
const root = path.resolve(__dirname, '..');
const iconPath = path.join(__dirname, 'assets', 'icon.png');
// Login-item lookup and writes must share the packaged application's fixed ID.
// This identifies the running process; it does not register a system startup item.
if (process.platform === 'win32' && app.isPackaged) app.setAppUserModelId('com.petpal.desktop');
if (process.argv.includes('--smoke-test') && process.env.PETPAL_SMOKE_PROFILE) {
  const profile = path.resolve(process.env.PETPAL_SMOKE_PROFILE);
  fsSync.mkdirSync(profile, { recursive: true });
  app.setPath('userData', profile);
}

function getStartupDiagnostics() {
  if (!startupDiagnostics) {
    let userData, appVersion;
    try { userData = app.getPath('userData'); } catch {}
    try { appVersion = app.getVersion(); } catch {}
    startupDiagnostics = createStartupDiagnostics({ userData, appVersion, electronVersion: process.versions.electron,
      isSmoke: process.argv.includes('--smoke-test'), smokeDir: process.env.PETPAL_SMOKE_DIR || '' });
  }
  return startupDiagnostics;
}

async function startupMilestone(phase) {
  startupPhase = phase;
  await getStartupDiagnostics().milestone(phase);
}

async function handleStartupFailure(error) {
  if (startupFailed || quitting) return;
  startupFailed = true;
  let result;
  try { result = await getStartupDiagnostics().failure(error, startupPhase); } catch {}
  // Arbitrary exception strings can contain private settings or HTTP credentials.
  console.error('PetPal startup failed:', JSON.stringify(result?.record || { phase: startupPhase, code: 'UNKNOWN' }));
  if (!process.argv.includes('--smoke-test')) {
    try { dialog.showErrorBox('小伴启动失败', startupFailureMessage(error, result?.logPath)); } catch {}
  }
  exitCode = 1;
  app.quit();
}

function rendererFailure(_event, details = {}) {
  if (quitting || details.reason === 'clean-exit') return;
  const reasons = { crashed: 'RENDERER_CRASHED', oom: 'RENDERER_OOM', 'launch-failed': 'RENDERER_LAUNCH_FAILED',
    'integrity-failure': 'RENDERER_INTEGRITY_FAILURE', 'abnormal-exit': 'RENDERER_ABNORMAL_EXIT', killed: 'RENDERER_KILLED' };
  startupPhase = 'renderer-run';
  const error = Object.assign(new Error('Renderer unavailable'), { code: reasons[details.reason] || 'RENDERER_UNAVAILABLE' });
  void handleStartupFailure(error);
}

function isTrusted(event) {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (owner !== mainWindow && owner !== petWindow) return false;
  try { return new URL(event.senderFrame.url).origin === origin && event.senderFrame === event.sender.mainFrame; }
  catch { return false; }
}

async function requireUpdateOwner(event, token) {
  if (!isTrusted(event) || event.sender !== mainWindow?.webContents) throw new Error('更新仅允许主窗口');
  if (typeof token !== 'string' || !token || token.length > 8192) throw new Error('请先登录本机管理员账号');
  backend.updates.assertOwnerSession(token, { allowClosing: quitting && Boolean(pendingUpdate) });
  const current = await event.sender.executeJavaScript(`(() => { try { return JSON.parse(sessionStorage.getItem('petpal.connection') || 'null')?.token || ''; } catch { return ''; } })()`);
  if (!isTrusted(event) || typeof current !== 'string') throw new Error('更新账号已变化');
  const left = Buffer.from(token), right = Buffer.from(current);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) throw new Error('更新账号已变化');
  backend.updates.assertOwnerSession(token, { allowClosing: quitting && Boolean(pendingUpdate) });
}

async function launchPreparedUpdate(prepared) {
  await verifyDownloadedUpdate(prepared.file, prepared.release, { directory: prepared.directory, signal: prepared.signal });
  await prepared.authorize();
  prepared.signal.throwIfAborted();
  const config = backend.updates.statusConfig();
  if (!config.configured || config.revision !== prepared.release.revision || config.repository !== prepared.release.repository || (config.source ?? 'github') !== (prepared.release.source ?? 'github') || (config.source === 'server' && config.manifestUrl !== prepared.release.manifestUrl)) throw new Error('更新源已变化，请重新检查');
  // The old backend is already closed. The new portable keeps the same app ID,
  // so release our lock before launch; neither old executable nor user data is replaced.
  app.releaseSingleInstanceLock();
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(?:ELECTRON_RUN_AS_NODE|PORTABLE_EXECUTABLE_|PETPAL_SMOKE_)/.test(key)) delete env[key];
  await new Promise((resolve, reject) => {
    const child = spawn(prepared.file, [], { detached: true, stdio: 'ignore', shell: false, windowsHide: false, env });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

function queuePortableUpdate(prepared) {
  if (pendingUpdate || quitting) throw new Error('更新交接已开始');
  pendingUpdate = prepared;
  // Finish IPC before shutdown waits on the manager, and allow an intervening
  // cancellation/logout to revoke the queued quit without closing the app.
  setImmediate(() => {
    if (pendingUpdate !== prepared) return;
    if (prepared.signal.aborted) { pendingUpdate = null; return; }
    app.quit();
  });
}

function secureWindow(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    const helpLinks = new Set(['https://www.google.com/chrome/', 'https://github.com/jackwener/opencli', 'https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk']);
    if (win === mainWindow && (helpLinks.has(url) || isPetPalReleaseUrl(url))) void shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    try { if (new URL(target).origin !== origin) { event.preventDefault(); if (win === mainWindow && isPetPalReleaseUrl(target)) void shell.openExternal(target).catch(() => {}); } }
    catch { event.preventDefault(); }
  });
}

function fitWindowToDisplay(win, isPet = false) {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const { minWidth, minHeight, ...next } = isPet ? petWindowLayout(area, bounds) : mainWindowLayout(area, bounds);
  if (!isPet) {
    const [currentMinWidth, currentMinHeight] = win.getMinimumSize();
    if (currentMinWidth !== minWidth || currentMinHeight !== minHeight) win.setMinimumSize(minWidth, minHeight);
  }
  // Let the window manager own maximized/fullscreen geometry. Restoration is
  // checked separately, including after a monitor was unplugged while hidden.
  if (win.isMinimized() || win.isMaximized() || win.isFullScreen()) return;
  if (['x', 'y', 'width', 'height'].some(key => next[key] !== bounds[key])) win.setBounds(next);
}

function trackWindowDisplay(win, isPet = false) {
  let timer;
  const update = () => fitWindowToDisplay(win, isPet);
  const schedule = () => { clearTimeout(timer); timer = setTimeout(update, 120); };
  // Debounce native move events so dragging between displays remains possible.
  for (const event of ['move', 'resize', 'restore', 'unmaximize', 'leave-full-screen']) win.on(event, schedule);
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, update);
  win.once('closed', () => {
    clearTimeout(timer);
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.removeListener(event, update);
  });
}

function createMain(showOnReady = true) {
  mainWindow = new BrowserWindow({
    ...mainWindowLayout(screen.getPrimaryDisplay().workArea),
    title: '小伴 PetPal', icon: iconPath, backgroundColor: '#f7f6f2', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  trackWindowDisplay(mainWindow);
  secureWindow(mainWindow);
  mainWindow.once('ready-to-show', () => { if (showOnReady || !tray) mainWindow.show(); });
  mainWindow.on('close', event => {
    if (!quitting && tray && appPreferences.current().closeToTray) { event.preventDefault(); mainWindow.hide(); return; }
    remoteHttp?.cancelOwner(mainWindow.webContents);
    if (!quitting) { event.preventDefault(); app.quit(); }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.on('render-process-gone', (event, details) => { void executor?.disconnect().catch(() => {}); rendererFailure(event, details); });
  mainWindow.webContents.on('destroyed', () => { void executor?.disconnect().catch(() => {}); });
  mainLoaded = mainWindow.loadURL(origin);
  // The boot sequence owns this rejection even if creating the other window fails first.
  void mainLoaded.catch(() => {});
}

function applyPetWindowPreferences() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const enabled = appPreferences.current().petAlwaysOnTop;
  petWindow.setAlwaysOnTop(enabled, enabled ? process.platform === 'win32' ? 'pop-up-menu' : 'floating' : 'normal');
}

function showMain() {
  if (!mainWindow) createMain();
  if (mainWindow.isMinimized()) mainWindow.restore();
  fitWindowToDisplay(mainWindow);
  mainWindow.show(); mainWindow.focus();
}

function showPet() {
  if (!petWindow) {
    const area = screen.getPrimaryDisplay().workArea;
    petWindow = new BrowserWindow({
      ...petWindowLayout(area),
      frame: false, transparent: true, resizable: false, hasShadow: false, alwaysOnTop: appPreferences.current().petAlwaysOnTop,
      skipTaskbar: true, show: false, title: '小伴桌宠', icon: iconPath,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    trackWindowDisplay(petWindow, true);
    // Windows requires pop-up-menu to retain the native WS_EX_TOPMOST flag.
    applyPetWindowPreferences();
    if (process.platform !== 'win32') petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    secureWindow(petWindow);
    petWindow.once('ready-to-show', () => petWindow?.showInactive());
    petWindow.on('closed', () => { petWindow = null; });
    petLoaded = petWindow.loadURL(`${origin}/?pet=1`);
    void petLoaded.catch(() => {});
  } else { fitWindowToDisplay(petWindow, true); petWindow.showInactive(); }
}

async function inspectAvatarWindow(win, requireWorld, kind, expectedCatEnabled) {
  return win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 25000;
    const check = () => {
      const canvases = document.querySelectorAll('canvas[data-renderer="webgl"]');
      const canvas = canvases[0];
      const bounds = canvas?.getBoundingClientRect(), style = canvas && getComputedStyle(canvas);
      const visible = bounds?.width > 0 && bounds?.height > 0 && bounds.right > 0 && bounds.bottom > 0 && bounds.left < innerWidth && bounds.top < innerHeight
        && canvas.getAttribute('aria-hidden') !== 'true' && style.display !== 'none' && style.visibility === 'visible' && !document.hidden;
      const ready = ${requireWorld ? `!!document.querySelector('.companion-world[data-ready="true"][data-companion-kind="${kind}"]')` : 'true'};
      const cubism = document.querySelector('.cubism-scene[data-avatar-mode="cubism"]');
      const modelLoaded = performance.getEntriesByType('resource').some(entry => new URL(entry.name).pathname === '/avatars/akari-cubism-v12/akari.moc3');
      const expectedRenderer = ${JSON.stringify(kind)} === 'anime'
        ? canvas?.dataset.avatarRenderer === 'cubism' && !!cubism && modelLoaded && Number(canvas.dataset.mocVersion) > 0
        : !['mesh2d', 'cubism'].includes(canvas?.dataset.avatarRenderer);
      let display; try { display = JSON.parse(localStorage.getItem('petpal.displayCompanion') || 'null'); } catch {}
      const displayReady = ${typeof expectedCatEnabled === 'boolean' ? `display?.version === 3 && display.kind === ${JSON.stringify(kind)} && display.catEnabled === ${JSON.stringify(expectedCatEnabled)}` : 'true'};
      if (ready && visible && expectedRenderer && displayReady && canvases.length === 1 && canvas.dataset.petCount === '1' && Number(canvas.dataset.renderFrames) >= 2) {
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (gl && !gl.isContextLost()) return resolve({
          is3d: ${JSON.stringify(kind)} === 'cat', kind: ${JSON.stringify(kind)}, renderer: canvas.dataset.avatarRenderer || 'three3d', petCount: 1, canvasCount: canvases.length,
          renderFrames: Number(canvas.dataset.renderFrames), glVersion: gl.getParameter(gl.VERSION),
          petAction: canvas.dataset.petAction || 'unknown',
          width: canvas.width, height: canvas.height, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
          canvasBounds: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }, visible: true,
          storedKind: localStorage.getItem('petpal.companionKind'),
          display: display && { version: display.version, kind: display.kind, catEnabled: display.catEnabled },
          blink: canvas.dataset.blink ?? canvas.dataset.blinkLeft, speaking: canvas.dataset.speaking,
          cubismModel: modelLoaded ? 'akari-cubism-v12' : null, mocVersion: canvas.dataset.mocVersion, coreVersion: canvas.dataset.coreVersion,
          expression: canvas.dataset.expression, mouthShape: canvas.dataset.mouthShape, mouthOpen: canvas.dataset.mouthOpen,
          phase: canvas.dataset.phase, speechSource: canvas.dataset.speechSource
        });
      }
      if (Date.now() >= deadline) reject(new Error('One visible live WebGL ${kind} avatar did not become ready'));
      else setTimeout(check, 50);
    };
    check();
  })`);
}

async function loginSmokeMain() {
  const guest = await mainWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 20000;
    const check = () => {
      if (document.querySelector('.companion-world,.app-shell,.workspace,.companion-voice,.speech-controls')) return reject(new Error('Fresh desktop mounted protected content before login'));
      const login = document.querySelector('.login-page'), button = document.querySelector('button.auth-owner');
      if (login && button && !button.disabled) {
        let saved; try { saved = JSON.parse(sessionStorage.getItem('petpal.connection') || 'null'); } catch {}
        if (saved?.token) return reject(new Error('Fresh desktop silently accepted an owner token'));
        return resolve({ loginVisible: true, protectedContentAbsent: true, noStoredToken: true });
      }
      if (Date.now() >= deadline) return reject(new Error('Fresh desktop login gate did not appear'));
      setTimeout(check, 40);
    }; check();
  })`);
  if (process.env.PETPAL_SMOKE_DIR) {
    await fs.mkdir(process.env.PETPAL_SMOKE_DIR, { recursive: true });
    await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR, 'login.png'), (await mainWindow.webContents.capturePage()).toPNG());
  }
  await clickSmokeButton('.login-form', '以本机管理员身份登录');
  const authenticated = await mainWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 20000;
    const check = async () => {
      if (document.querySelector('.companion-world')) {
        try {
          const saved = JSON.parse(sessionStorage.getItem('petpal.connection') || 'null');
          const response = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + (saved?.token || '') } });
          const value = await response.json();
          if (!response.ok || !value.instanceId || !value.user?.isOwner) throw new Error('Explicit desktop login did not authenticate the owner');
          return resolve({ explicitOwnerLogin: true, authenticated: true });
        } catch (error) { return reject(error); }
      }
      if (Date.now() >= deadline) return reject(new Error('Explicit desktop owner login timed out'));
      setTimeout(check, 40);
    }; check();
  })`);
  return { ...guest, ...authenticated };
}

async function clickSmokeButton(container, label) {
  return mainWindow.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(container + ' button')})].find(item => item.textContent.trim() === ${JSON.stringify(label)});
    if (!button || button.disabled) throw new Error('Smoke interaction is unavailable');
    button.click();
  })()`);
}

async function inspectSmokeAvatarPair(kind, catEnabled) {
  const [main, pet] = await Promise.all([inspectAvatarWindow(mainWindow, true, kind, catEnabled), inspectAvatarWindow(petWindow, false, kind, catEnabled)]);
  if ([main, pet].some(value => value.display?.version !== 3 || value.display.kind !== kind || value.display.catEnabled !== catEnabled)) {
    console.log(JSON.stringify({ event: 'desktop-smoke-check', check: 'avatar-display-pair', expected: { kind, catEnabled }, main: main.display, pet: pet.display }));
    throw new Error('Effective v3 avatar display did not synchronize between desktop windows');
  }
  return { main, pet };
}

async function inspectSmokeCatChoice(expectedVisible) {
  return mainWindow.webContents.executeJavaScript(`(() => {
    const choice = [...document.querySelectorAll('.companion-switch button')].find(button => button.textContent.trim() === '3D 小猫');
    const visible = !!choice && choice.getClientRects().length > 0;
    if (visible !== ${JSON.stringify(expectedVisible)}) throw new Error('Cat choice visibility does not match the explicit capability');
    return visible;
  })()`);
}

async function inspectSmokeCatSettings(expected, next) {
  await mainWindow.loadURL(`${origin}/?chat=1&settings=1`);
  await mainWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 20000;
    const check = () => {
      const tab = [...document.querySelectorAll('.settings-tabs button')].find(button => button.textContent.trim() === '小伴个性');
      if (tab && !tab.disabled && tab.getClientRects().length) return resolve(true);
      if (Date.now() >= deadline) return reject(new Error('Companion settings tab did not become ready'));
      setTimeout(check, 40);
    }; check();
  })`);
  await clickSmokeButton('.settings-tabs', '小伴个性');
  return mainWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 20000; let clicked = false, before;
    const check = () => {
      const control = document.querySelector('.companion-cat-option[role="switch"][aria-label="启用 3D 小猫"]');
      if (control && !control.disabled && control.getClientRects().length) {
        const checked = control.getAttribute('aria-checked');
        if (checked !== 'true' && checked !== 'false') return reject(new Error('Cat settings switch has an invalid state'));
        if (before === undefined) {
          before = checked === 'true';
          if (before !== ${JSON.stringify(expected)}) return reject(new Error('Cat settings switch does not match the expected opt-in'));
          if (${typeof next === 'boolean'}) { clicked = true; control.click(); }
        }
        if (checked === ${JSON.stringify(String(typeof next === 'boolean' ? next : expected))}) return resolve({ before, checked: checked === 'true', clicked });
      }
      if (Date.now() >= deadline) return reject(new Error('Cat settings switch did not settle after its UI interaction'));
      setTimeout(check, 40);
    }; check();
  })`);
}

async function snapshotSmokeRawCompanionPreference() {
  // Compare exact preference records privately; only the pass/fail receipt is exported.
  const local = await mainWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 15000;
    const check = () => {
      const records = Object.keys(localStorage).filter(key => key === 'petpal.companionPreference' || key.startsWith('petpal.companionPreference:')).sort().map(key => [key, localStorage.getItem(key)]);
      if (!records.some(([, raw]) => { try { return JSON.parse(raw)?.dirty === true; } catch { return false; } })) {
        return resolve(JSON.stringify({ legacyKind: localStorage.getItem('petpal.companionKind'), records }));
      }
      if (Date.now() >= deadline) return reject(new Error('Raw companion preference did not finish its existing save'));
      setTimeout(check, 40);
    }; check();
  })`);
  const response = await fetch(`${origin}/api/state`, { headers: { Authorization: `Bearer ${backend.token}` } });
  if (!response.ok) throw new Error('Raw companion preference read failed');
  return { local, serverKind: (await response.json()).settings.companionKind };
}

async function assertSmokeRawCompanionPreference(previous) {
  const current = await snapshotSmokeRawCompanionPreference();
  if (current.local !== previous.local || current.serverKind !== previous.serverKind) {
    console.log(JSON.stringify({ event: 'desktop-smoke-check', check: 'raw-companion-preference', localEqual: current.local === previous.local, serverEqual: current.serverKind === previous.serverKind }));
    throw new Error('Cat capability changed a raw companion preference');
  }
  return true;
}

async function reloadSmokeWindow(win) {
  await new Promise((resolve, reject) => {
    const contents = win.webContents;
    const cleanup = () => { clearTimeout(timer); contents.removeListener('did-finish-load', loaded); contents.removeListener('did-fail-load', failed); };
    const loaded = () => { cleanup(); resolve(); };
    const failed = (_event, _code, _description, _url, isMainFrame) => { if (isMainFrame !== false) { cleanup(); reject(new Error('Smoke window reload failed')); } };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Smoke window reload timed out')); }, 20000);
    contents.once('did-finish-load', loaded); contents.on('did-fail-load', failed);
    try { contents.reload(); } catch (error) { cleanup(); reject(error); }
  });
}

async function expandSmokeAppCompanion() {
  return mainWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 20000; let clicked = false;
    const check = () => {
      const button = document.querySelector('button[aria-controls="workspace-companion-panel"]');
      const canvas = document.querySelector('#workspace-companion-panel canvas[data-pet-count="1"]');
      if (matchMedia('(max-width: 960px)').matches && canvas?.getClientRects().length) return resolve({ expanded: true, clicked, alwaysVisible: true });
      if (button && !button.disabled && button.getClientRects().length) {
        if (button.getAttribute('aria-expanded') === 'true') return resolve({ expanded: true, clicked });
        if (!clicked) { clicked = true; button.click(); }
      }
      if (Date.now() >= deadline) return reject(new Error('Chat companion panel did not expand'));
      setTimeout(check, 40);
    }; check();
  })`);
}

async function openSmokeSpeechOptions() {
  await mainWindow.webContents.executeJavaScript(`(() => {
    const disclosure = document.querySelector('.speech-controls details.speech-options'), summary = disclosure?.querySelector('summary');
    if (!summary || !summary.getClientRects().length) throw new Error('Chat speech options are unavailable');
    if (!disclosure.open) summary.click();
  })()`);
}

async function gestureSmokeCharacter(gesture) {
  if (!['tap', 'double-tap', 'hold'].includes(gesture)) throw new Error('Unknown smoke gesture');
  mainWindow.show(); mainWindow.focus();
  const point = await mainWindow.webContents.executeJavaScript(`(() => {
    const canvas = [...document.querySelectorAll('canvas[data-pet-count="1"]')].find(item => item.getAttribute('aria-hidden') !== 'true' && item.getBoundingClientRect().width > 0 && item.getBoundingClientRect().height > 0);
    if (!canvas) throw new Error('Interactive companion is unavailable');
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width * .5), y = Math.round(rect.top + rect.height * .62);
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) throw new Error('Companion gesture would be outside the window');
    const target = document.elementFromPoint?.(x, y), style = typeof getComputedStyle === 'function' ? getComputedStyle(canvas) : {};
    const container = canvas.parentElement, bounds = container?.getBoundingClientRect(), base = container?.querySelector('.anime-fallback-model > img');
    let portrait;
    if (bounds && base?.complete && base.naturalWidth) {
      const width = Math.max(1, bounds.width), height = Math.max(1, bounds.height), portraitWidth = height / Math.max(1.64, 1.04 / (width / height));
      const px = (x - bounds.left - width / 2) / portraitWidth + .5, py = (y - bounds.top - height / 2) / (portraitWidth * 1.5) + .5;
      let alpha; try { const probe = document.createElement('canvas'); probe.width = 96; probe.height = 144; const context = probe.getContext('2d'); context.drawImage(base, 0, 0, 96, 144); alpha = context.getImageData(Math.max(0, Math.min(95, Math.floor(px * 96))), Math.max(0, Math.min(143, Math.floor(py * 144))), 1, 1).data[3]; } catch {}
      portrait = { x: px, y: py, alpha, width: base.naturalWidth, height: base.naturalHeight };
    }
    return { x, y, canvasBounds: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      containerBounds: bounds && { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }, portrait,
      surface: { role: canvas.getAttribute('role'), ariaHidden: canvas.getAttribute('aria-hidden'), tabIndex: canvas.tabIndex },
      target: target && { tag: target.tagName, className: target.className, isCanvas: target === canvas },
      visible: { hidden: !!document.hidden, visibility: style.visibility, display: style.display, opacity: style.opacity } };
  })()`);
  if (point.visible.hidden || (point.target && !point.target.isCanvas)) throw new Error('Smoke gesture does not reach the visible companion canvas');
  const coordinates = { x: point.x, y: point.y };
  const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const count = gesture === 'double-tap' ? 2 : 1;
  mainWindow.webContents.sendInputEvent({ type: 'mouseMove', ...coordinates });
  for (let index = 0; index < count; index++) {
    mainWindow.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: index + 1, ...coordinates });
    try { await pause(gesture === 'hold' ? 800 : 60); }
    finally { mainWindow.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: index + 1, ...coordinates }); }
    if (index + 1 < count) await pause(100);
  }
  return { gesture, ...point, trustedInput: true };
}

async function waitForPose(action, stableMilliseconds = 120) {
  return mainWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 25000;
    let since = 0;
    const check = () => {
      const canvas = document.querySelector('canvas[data-renderer="webgl"]');
      if (canvas?.dataset.petAction === ${JSON.stringify(action)}) {
        since ||= Date.now();
        if (Date.now() - since >= ${JSON.stringify(stableMilliseconds)}) return resolve({ action: canvas.dataset.petAction, renderFrames: Number(canvas.dataset.renderFrames), x: canvas.dataset.petX, blink: canvas.dataset.blink ?? canvas.dataset.blinkLeft, speaking: canvas.dataset.speaking });
      } else since = 0;
      if (Date.now() >= deadline) reject(new Error('Expected review pose did not appear'));
      else setTimeout(check, 40);
    };
    check();
  })`);
}

async function inspectNaturalGestures(kind) {
  await mainWindow.webContents.executeJavaScript(`(() => {
    const events = [], record = event => { if (events.length >= 24) return; const item = { type: event.type, trusted: event.isTrusted, pointerType: event.pointerType,
      button: event.button, x: event.clientX, y: event.clientY, target: event.target?.tagName }; events.push(item);
      queueMicrotask(() => { const feedback = document.querySelector('.companion-hand-feedback'), canvas = document.querySelector('canvas[data-pet-count="1"]'); item.after = { hidden: feedback?.hidden, phase: feedback?.dataset.phase, cursor: canvas?.style.cursor, action: canvas?.dataset.petAction }; });
    };
    for (const type of ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'pointerleave', 'blur']) document.addEventListener(type, record, true);
    window.__petpalSmokePointerTrace = { events, record };
  })()`);
  let tapped, inputTrace;
  try { tapped = await gestureSmokeCharacter('tap'); }
  finally {
    inputTrace = await mainWindow.webContents.executeJavaScript(`(() => {
      const trace = window.__petpalSmokePointerTrace;
      if (trace) for (const type of ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'pointerleave', 'blur']) document.removeEventListener(type, trace.record, true);
      delete window.__petpalSmokePointerTrace;
      const feedback = document.querySelector('.companion-hand-feedback');
      return { events: trace?.events || [], focused: document.hasFocus(), hidden: document.hidden, feedback: { hidden: feedback?.hidden, phase: feedback?.dataset.phase } };
    })()`);
    console.log(JSON.stringify({ event: 'desktop-smoke-gesture', kind, ...tapped, inputTrace }));
  }
  const touch = await waitForPose('pet');
  await gestureSmokeCharacter('double-tap'); const greeting = await waitForPose('jump');
  await gestureSmokeCharacter('hold'); const sleep = await waitForPose('sleep', 700);
  if (kind === 'anime' && Number(sleep.blink) < .9) throw new Error('Resting anime eyes did not close');
  if (process.env.PETPAL_SMOKE_DIR) await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR, `${kind}-sleep.png`), (await mainWindow.webContents.capturePage()).toPNG());
  await gestureSmokeCharacter('tap'); const awake = await waitForPose('idle');
  return { trustedInput: true, input: tapped, touch, greeting, sleep, awake };
}

async function inspectSystemSpeech(win) {
  // Real browser events only: no synthetic onstart/onboundary/onend callbacks.
  return win.webContents.executeJavaScript(`(async () => {
    const result = { supported: 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function', voices: [], events: [], audioAudibilityVerified: false };
    if (!result.supported) return { ...result, outcome: 'unsupported' };
    if (!speechSynthesis.getVoices().length) await new Promise(resolve => {
      const done = () => { speechSynthesis.removeEventListener('voiceschanged', done); clearTimeout(timer); resolve(); };
      const timer = setTimeout(done, 3000); speechSynthesis.addEventListener('voiceschanged', done);
    });
    const voices = speechSynthesis.getVoices();
    result.voices = voices.map(voice => ({ name: voice.name, lang: voice.lang, localService: voice.localService }));
    const voice = voices.find(voice => voice.localService === true && /^zh(?:-|_)/i.test(voice.lang));
    if (!voice) return { ...result, outcome: 'no-local-chinese-voice' };
    result.voice = { name: voice.name, lang: voice.lang }; result.text = '你好，我是小伴。';
    return new Promise(resolve => {
      const utterance = new SpeechSynthesisUtterance(result.text), start = performance.now();
      utterance.voice = voice; utterance.lang = voice.lang;
      let complete = false;
      const finish = outcome => { if (complete) return; complete = true; clearTimeout(timer); utterance.onstart = utterance.onboundary = utterance.onend = utterance.onerror = null; speechSynthesis.cancel(); resolve({ ...result, outcome }); };
      const record = (type, event) => result.events.push({ type, milliseconds: Math.round(performance.now()-start), charIndex: event.charIndex, charLength: event.charLength, name: event.name, error: event.error });
      utterance.onstart = event => record('start', event); utterance.onboundary = event => record('boundary', event);
      utterance.onend = event => { record('end', event); finish('ended'); };
      utterance.onerror = event => { record('error', event); finish('error'); };
      const timer = setTimeout(() => finish('timeout'), 12000);
      try { speechSynthesis.speak(utterance); } catch (error) { result.error = error.message; finish('threw'); }
    });
  })()`, true);
}

async function inspectAppFixture({ expressions = false } = {}) {
  // Isolated renderer fixture: a single SSE read deliberately contains delta + done.
  // This does not call a model and is not evidence of a live upstream provider.
  await fetch(`${origin}/api/providers`, { method:'POST', headers:{Authorization:`Bearer ${backend.token}`,'Content-Type':'application/json'},body:JSON.stringify({name:'Isolated UI fixture',protocol:'chat-completions',baseUrl:'http://127.0.0.1:1/v1',model:'fixture',apiKey:''}) }).then(async response=>{if(!response.ok)throw new Error(await response.text());});
  await mainWindow.loadURL(`${origin}/?chat=1`); mainWindow.show();mainWindow.focus();
  const companionPanel = await expandSmokeAppCompanion();
  await inspectAvatarWindow(mainWindow,false,'anime');
  await mainWindow.webContents.executeJavaScript(`(async()=>{
    const nativeFetch=window.fetch.bind(window), connection=await window.petpal.connection();
    const state=await nativeFetch(connection.url+'/api/state',{headers:{Authorization:'Bearer '+connection.token}}).then(r=>r.json());
    window.__appFixture={state,chunks:[],speechEvents:[],utterances:0,nextReply:'谢谢你。',nativeFetch:window.fetch,originalSpeak:window.speechSynthesis?.speak};
    const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
    window.fetch=async(input,options={})=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href), fixture=window.__appFixture;
      if(url.origin!==location.origin)return nativeFetch(input,options);
      if(url.pathname==='/api/state')return json(fixture.state);
      if(url.pathname==='/api/conversations'&&options.method==='POST'){
        const values=JSON.parse(options.body),conversation={id:'app-fixture',title:'Fixture',mode:'chat',providerId:values.providerId,messages:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};fixture.state.conversations=[conversation];return json(conversation);
      }
      if(url.pathname==='/api/conversations/app-fixture/messages'){
        const values=JSON.parse(options.body),conversation=fixture.state.conversations[0],index=conversation.messages.length;
        const reply={id:'fixture-assistant-'+index,role:'assistant',content:fixture.nextReply,status:'complete'};
        conversation.messages.push({id:'fixture-user-'+index,role:'user',content:values.content,status:'complete'},reply);
        const payload='event: meta\\ndata: {}\\n\\nevent: delta\\ndata: '+JSON.stringify({text:reply.content})+'\\n\\nevent: done\\ndata: '+JSON.stringify({conversation})+'\\n\\n';
        const stream=new ReadableStream({start(controller){fixture.chunks.push({request:values.content,chunks:1,events:['meta','delta','done']});controller.enqueue(new TextEncoder().encode(payload));controller.close();}});
        return new Response(stream,{headers:{'Content-Type':'text/event-stream'}});
      }
      return nativeFetch(input,options);
    };
    if('speechSynthesis' in window){const original=speechSynthesis.speak,fixture=window.__appFixture;speechSynthesis.speak=function(utterance){const index=++fixture.utterances;for(const type of ['start','boundary','end','error'])utterance.addEventListener(type,event=>fixture.speechEvents.push({type,index,charIndex:event.charIndex,error:event.error}));return original.call(this,utterance);};}
  })()`);
  const send = async (text, reply = '谢谢你。') => {
    await mainWindow.webContents.executeJavaScript(`(()=>{window.__appFixture.nextReply=${JSON.stringify(reply)};const field=document.querySelector('textarea[aria-label="消息"]');if(!field||field.disabled)throw new Error('Chat composer unavailable');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,${JSON.stringify(text)});field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await mainWindow.webContents.executeJavaScript(`(()=>{const button=document.querySelector('button[aria-label="发送消息"]');if(!button||button.disabled)throw new Error('Chat send unavailable');button.click();})()`);
  };
  const observe = async expression => {
    try {
      return await mainWindow.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const started=performance.now();const check=()=>{const canvas=document.querySelector('canvas[data-avatar-renderer="mesh2d"]');const fixture=window.__appFixture;if(${expression})return resolve({phase:canvas?.dataset.phase,action:canvas?.dataset.petAction,expression:canvas?.dataset.expression,mouthShape:canvas?.dataset.mouthShape,mouthOpen:Number(canvas?.dataset.mouthOpen),source:canvas?.dataset.speechSource,speaking:window.speechSynthesis?.speaking,utterances:fixture.utterances,events:fixture.speechEvents.slice(),chunks:fixture.chunks.slice(),hidden:document.hidden});if(performance.now()-started>25000)return reject(new Error('App fixture condition timed out'));setTimeout(check,20);};check();})`);
    } catch (error) {
      const state = await mainWindow.webContents.executeJavaScript(`(() => { const canvas = document.querySelector('canvas[data-avatar-renderer="mesh2d"]'), fixture = window.__appFixture; return { hidden: document.hidden, phase: canvas?.dataset.phase, action: canvas?.dataset.petAction, mouthOpen: canvas?.dataset.mouthOpen, source: canvas?.dataset.speechSource, speaking: speechSynthesis.speaking, pending: speechSynthesis.pending, utterances: fixture?.utterances, events: fixture?.speechEvents, chunkCount: fixture?.chunks.length }; })()`);
      console.log(JSON.stringify({ event: 'desktop-smoke-check', check: 'app-fixture', condition: expression, state }));
      throw error;
    }
  };
  const capture = async name => {
    if(process.env.PETPAL_SMOKE_DIR)await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR,name),(await mainWindow.webContents.capturePage()).toPNG());
  };
  try {
    const defaultOff = await mainWindow.webContents.executeJavaScript(`document.querySelector('.speech-toggle input')?.checked===false`);
    if(!defaultOff)throw new Error('Chat speech must be off by default');
    await send('单块完成测试');
    const singleChunk = await observe(`fixture.chunks.length===1&&!document.querySelector('button[aria-label="停止生成"]')&&Number(canvas?.dataset.mouthOpen)>.15&&canvas?.dataset.expression==='warm'`);
    if(singleChunk.utterances!==0)throw new Error('Default-off app spoke automatically');
    await capture('app-singlechunk-response.png');
    const settled = await observe(`fixture.chunks.length===1&&canvas?.dataset.phase==='idle'&&Number(canvas?.dataset.mouthOpen)===0`);
    const responses = [];
    if(expressions) {
      const replies = { warm:'谢谢你，今天有你陪着很开心。', curious:'为什么天空会这样变化呢？', thoughtful:'让我想一想，也许可以慢慢整理。', surprised:'哇，没想到有这样的惊喜！', shy:'不好意思，这样说有点害羞呢。' };
      for(const [expression,text] of Object.entries(replies)) {
        const before = await mainWindow.webContents.executeJavaScript('window.__appFixture.chunks.length');
        await send(`对话表情验收 ${expression}`,text);
        const rendered = await observe(`fixture.chunks.length===${before+1}&&canvas?.dataset.expression===${JSON.stringify(expression)}&&Number(canvas?.dataset.mouthOpen)>.15`);
        await capture(`anime-${expression}.png`);
        const ended = await observe(`canvas?.dataset.phase==='idle'&&Number(canvas?.dataset.mouthOpen)===0`);
        responses.push({expression,transportFixture:true,rendered,settled:ended});
      }
    }
    const localVoice=await mainWindow.webContents.executeJavaScript(`'speechSynthesis' in window&&speechSynthesis.getVoices().some(v=>v.localService&&/^zh(?:-|_)/i.test(v.lang))`);
    if(!localVoice)return{fixture:true,upstreamModelCalled:false,companionPanel,singleChunk,settled,responses,speechUi:{available:false,defaultOff,reason:'no-local-chinese-voice',audioAudibilityVerified:false}};
    await openSmokeSpeechOptions();
    await mainWindow.webContents.executeJavaScript(`(()=>{const toggle=document.querySelector('.speech-toggle input');if(!toggle||toggle.disabled)throw new Error('Chat speech toggle unavailable');if(!toggle.checked)toggle.click();})()`,true);
    const longReply='谢谢你，今天也一起慢慢度过。想到开心的事情，可以随时告诉我。我们还有很多时间。';
    await send('真实语音与口型验收',longReply);
    const live=await observe(`canvas?.dataset.speechSource==='playback-progress'&&Number(canvas?.dataset.mouthOpen)>.15&&fixture.speechEvents.some(event=>event.type==='boundary'&&event.charIndex>0)`);
    await capture('anime-system-speech.png');
    const completed=await observe(`fixture.speechEvents.some(event=>event.type==='end')&&!speechSynthesis.speaking&&!speechSynthesis.pending&&canvas?.dataset.phase==='idle'&&Number(canvas?.dataset.mouthOpen)===0`);
    if(completed.events.some(event=>event.type==='error'))throw new Error('System speech emitted an error');
    await openSmokeSpeechOptions();
    await clickSmokeButton('.speech-controls','朗读上一条');
    const manual=await observe(`fixture.utterances>${completed.utterances}&&speechSynthesis.speaking&&fixture.speechEvents.some(event=>event.type==='start'&&event.index>${completed.utterances})`);
    await gestureSmokeCharacter('hold');
    const sleepCancelled=await observe(`canvas?.dataset.petAction==='sleep'&&Number(canvas?.dataset.mouthOpen)===0&&!speechSynthesis.speaking&&!speechSynthesis.pending`);
    const beforeSleepReply=manual.chunks.length;
    await send('睡眠期间完成测试',longReply);
    await observe(`fixture.chunks.length===${beforeSleepReply+1}&&!document.querySelector('button[aria-label="停止生成"]')`);
    await mainWindow.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,1200))');
    const sleepingReply=await observe(`canvas?.dataset.petAction==='sleep'&&Number(canvas?.dataset.mouthOpen)===0&&!speechSynthesis.speaking&&!speechSynthesis.pending`);
    if(sleepingReply.utterances!==manual.utterances)throw new Error('Sleeping app auto-read a completed reply');
    await capture('app-sleep-quiet.png');
    await gestureSmokeCharacter('tap'); await waitForPose('idle');
    await openSmokeSpeechOptions();
    await clickSmokeButton('.speech-controls','朗读上一条');
    const resumed=await observe(`fixture.utterances>${sleepingReply.utterances}&&speechSynthesis.speaking`);
    await mainWindow.webContents.executeJavaScript(`(() => { const button = document.querySelector('.speech-controls button.speech-stop'); if (!button || button.disabled || !button.getClientRects().length) throw new Error('Current speech stop control is unavailable'); button.click(); })()`);
    await mainWindow.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,600))');
    const stopped=await observe(`!speechSynthesis.speaking&&!speechSynthesis.pending&&canvas?.dataset.phase==='idle'&&Number(canvas?.dataset.mouthOpen)===0`);
    if(stopped.utterances!==resumed.utterances)throw new Error('Stopped speech restarted');
    await openSmokeSpeechOptions();
    await clickSmokeButton('.speech-controls','朗读上一条');
    await observe(`fixture.utterances>${stopped.utterances}&&speechSynthesis.speaking`);
    mainWindow.hide();
    const hidden=await mainWindow.webContents.executeJavaScript(`new Promise(resolve=>setTimeout(()=>resolve({hidden:document.hidden,speaking:speechSynthesis.speaking,pending:speechSynthesis.pending}),700))`);
    mainWindow.show();mainWindow.focus();
    if(!hidden.hidden||hidden.speaking||hidden.pending)throw new Error('Hidden window did not cancel system speech');
    await observe(`canvas?.dataset.phase==='idle'&&Number(canvas?.dataset.mouthOpen)===0`);
    return{fixture:true,upstreamModelCalled:false,companionPanel,singleChunk,settled,responses,manual,sleepCancelled,sleepingReply,speechUi:{available:true,defaultOff,live,completed,stopped,hidden,audioAudibilityVerified:false}};
  } finally {
    mainWindow.show();mainWindow.focus();
    await mainWindow.webContents.executeJavaScript(`(()=>{document.querySelector('.speech-stop')?.click();const toggle=document.querySelector('.speech-toggle input');if(toggle?.checked)toggle.click();const fixture=window.__appFixture;if(fixture){window.fetch=fixture.nativeFetch;if(fixture.originalSpeak)speechSynthesis.speak=fixture.originalSpeak;delete window.__appFixture;}})()`);
  }
}

function isBrowserSafePort(port) {
  // Chromium net/base/port_util.cc and Fetch's bad-port list also apply to loopback.
  // Some Windows dynamic port ranges include these values; listen(0) alone is insufficient.
  const restricted = [1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080];
  return Number.isInteger(port) && port > 0 && port <= 65535 && !restricted.includes(port);
}

async function listenDesktopBackend(server, maximumAttempts = 20) {
  if (!Number.isInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 20) throw new RangeError('Invalid desktop port attempt limit');
  for (let attempt = 0; attempt < maximumAttempts; attempt++) {
    await new Promise((resolve, reject) => {
      const clean = () => { server.removeListener('error', failed); server.removeListener('listening', listening); };
      const failed = error => { clean(); reject(error); };
      const listening = () => { clean(); resolve(); };
      server.once('error', failed); server.once('listening', listening);
      try { server.listen(0, '127.0.0.1'); } catch (error) { failed(error); }
    });
    const port = server.address()?.port;
    if (isBrowserSafePort(port)) return port;
    // Close only the listening socket; the backend's services remain usable for the next attempt.
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  throw new Error('未能分配浏览器可访问的本机端口，请重新启动小伴。');
}

async function boot() {
  const { createPetServer } = await import(pathToFileURL(path.join(root, 'server', 'app.mjs')).href);
  await startupMilestone('service-settings');
  const serviceSettings = await readDesktopServiceSettings(app.getPath('userData'));
  appPreferences = createAppPreferences({ app });
  await appPreferences.load();
  await startupMilestone('workspace');
  const workspaceRoot = process.env.PETPAL_WORKSPACE || path.join(app.getPath('userData'), 'workspace');
  await fs.mkdir(workspaceRoot, { recursive: true });
  await startupMilestone('backend-create');
  backend = await createPetServer({
    dataDir: path.join(app.getPath('userData'), 'data'),
    token: crypto.randomBytes(32).toString('hex'),
    staticDir: process.argv.includes('--smoke-test') && process.env.PETPAL_SMOKE_DIST ? path.resolve(process.env.PETPAL_SMOKE_DIST) : path.join(root, 'dist'),
    allowedOrigins: [],
    workspaceRoot,
    codexHttpOrigins: serviceSettings.codexHttpOrigins,
  });
  await startupMilestone('backend-listen');
  const port = await listenDesktopBackend(backend.server);
  origin = `http://127.0.0.1:${port}`;
  centralServer = createCentralServer({ userData: app.getPath('userData'), hosting: backend.hosting, reservedPorts: [port] });
  await centralServer.load();
  for (const [channel, handler] of Object.entries(createCentralServerHandlers(centralServer, {
    isAllowed: event => isTrusted(event) && event.sender === mainWindow?.webContents && !quitting,
    readConnection: event => event.sender.executeJavaScript(`(() => { try { const value = JSON.parse(sessionStorage.getItem('petpal.connection') || 'null'); return value && { url: value.url === '' ? location.origin : value.url, token: value.token }; } catch { return null; } })()`),
    origin,
    assertOwnerSession: token => backend.hosting.assertOwnerSession(token),
  }))) ipcMain.handle(channel, handler);
  for (const [channel, handler] of Object.entries(createAppPreferencesHandlers(appPreferences, {
    isAllowed: event => isTrusted(event) && event.sender === mainWindow?.webContents && !quitting,
    readConnection: event => event.sender.executeJavaScript(`(() => { try { const value = JSON.parse(sessionStorage.getItem('petpal.connection') || 'null'); return value && { url: value.url === '' ? location.origin : value.url, token: value.token }; } catch { return null; } })()`),
    verifyConnection: verifyPreferencesSessionConnection,
    onUpdated: applyPetWindowPreferences,
  }))) ipcMain.handle(channel, handler);
  await startupMilestone('executor-create');
  const executorModule = await import(pathToFileURL(path.join(__dirname, 'executor.mjs')).href);
  executor = new executorModule.DesktopExecutor({ dataDir: path.join(app.getPath('userData'), 'executor'), musicMcpDataDir: path.join(app.getPath('userData'), 'data') });
  for (const [channel, handler] of Object.entries(executorModule.createExecutorHandlers(executor,
    event => isTrusted(event) && event.sender === mainWindow?.webContents && !quitting))) ipcMain.handle(channel, handler);
  for (const [channel, handler] of Object.entries(executorModule.createMusicMcpHandlers(executor,
    event => isTrusted(event) && event.sender === mainWindow?.webContents && !quitting))) ipcMain.handle(channel, handler);
  for (const [channel, handler] of Object.entries(executorModule.createComputerUseMcpHandlers(executor,
    event => isTrusted(event) && event.sender === mainWindow?.webContents && !quitting))) ipcMain.handle(channel, handler);
  for (const [channel, handler] of Object.entries(executorModule.createOpenCliHandlers(executor,
    event => isTrusted(event) && event.sender === mainWindow?.webContents && !quitting))) ipcMain.handle(channel, handler);
  await startupMilestone('transport-create');
  remoteHttp = createDesktopRemoteHttp({ isAllowed: event => isTrusted(event) && event.sender === mainWindow?.webContents });
  ipcMain.handle('petpal:remote:request', (event, request) => remoteHttp.request(event, request));
  ipcMain.handle('petpal:remote:abort', (event, id) => remoteHttp.abort(event, id));
  ipcMain.handle('petpal:remote:ack', (event, id, sequence) => remoteHttp.acknowledge(event, id, sequence));
  await startupMilestone('updates-create');
  const updaterModule = await import(pathToFileURL(path.join(__dirname, 'updates.mjs')).href);
  verifyDownloadedUpdate = updaterModule.verifyDownloadedUpdate;
  updates = new updaterModule.DesktopUpdateManager({
    service: backend.updates, dataDir: app.getPath('userData'), currentVersion: app.getVersion(),
    platform: process.platform, arch: process.arch,
    launchPortable: queuePortableUpdate,
    revealArchive: file => shell.showItemInFolder(file),
  });
  for (const [channel, handler] of Object.entries(updaterModule.createDesktopUpdateHandlers(updates,
    event => isTrusted(event) && event.sender === mainWindow?.webContents, requireUpdateOwner))) ipcMain.handle(channel, handler);
  await startupMilestone('permissions');
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) =>
    callback(canRequestMedia({webContents, mainWindow, origin}, permission, details)));
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) =>
    canCheckMedia({webContents, mainWindow, origin}, permission, requestingOrigin, details));
  for (const [channel, handler] of Object.entries({
    'petpal:connection': () => ({ url: origin, token: backend.token }),
    'petpal:show-pet': showPet,
    'petpal:show-main': showMain,
    'petpal:hide-pet': () => petWindow?.hide(),
  })) ipcMain.handle(channel, (event) => {
    if (!isTrusted(event)) throw new Error('Untrusted window');
    if (channel === 'petpal:connection' && event.sender !== mainWindow?.webContents) throw new Error('Credentials belong to the main window');
    return handler();
  });
  await startupMilestone('tray-create');
  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 }));
  tray.setToolTip('小伴 PetPal');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开小伴', click: showMain },
    { label: '显示桌宠', click: showPet },
    { label: '隐藏桌宠', click: () => petWindow?.hide() },
    { type: 'separator' },
    { label: '退出小伴', click: () => app.quit() },
  ]));
  tray.on('double-click', showMain);
  await startupMilestone('window-create');
  const launchPreferences = appPreferences.current(), smoke = process.argv.includes('--smoke-test');
  createMain(smoke || !launchPreferences.startMinimized);
  if ((smoke && !process.argv.includes('--smoke-central-server')) || (!smoke && launchPreferences.showPetOnLaunch)) showPet();
  await startupMilestone('window-load');
  await Promise.all([mainLoaded, petLoaded]);
  await startupMilestone('ready');
  if (process.argv.includes('--smoke-test')) {
    if (process.argv.includes('--smoke-central-server')) {
      await startupMilestone('smoke-central-server');
      const centralSmoke = require('./central-server-smoke.cjs');
      const receipt = await centralSmoke({ backend, centralServer, origin, mainWindow, loginSmokeMain, clickSmokeButton,
        directory: process.env.PETPAL_SMOKE_DIR, restore: process.env.PETPAL_CENTRAL_SMOKE_RESTORE === '1' });
      console.log(JSON.stringify({ event: 'central-server-smoke', ...receipt }));
      app.quit(); return;
    }
    await startupMilestone('smoke-login');
    const loginGate = await loginSmokeMain();
    const health = await fetch(`${origin}/api/health`).then(r => r.json());
    const bridge = await mainWindow.webContents.executeJavaScript('window.petpal.connection().then(c => ({url: c.url, hasToken: !!c.token}))');
    await startupMilestone('smoke-executor');
    const executorBridge = await mainWindow.webContents.executeJavaScript(`(async () => {
      const value = window.petpal.executor;
      if (!value || !['connect', 'disconnect', 'status'].every(key => typeof value[key] === 'function')) throw new Error('Executor preload facade is unavailable');
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const status = await value.status();
        if (status.state === 'online' && status.hostId) return { available: true, ...status };
        if (status.state === 'error') throw new Error('Executor registration failed in isolated smoke profile');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Executor registration did not become online in isolated smoke profile');
    })()`);
    const registeredHosts = await fetch(`${origin}/api/agent/hosts`, { headers: { Authorization: `Bearer ${backend.token}` } }).then(response => response.json());
    if (!registeredHosts.hosts?.some(host => host.id === executorBridge.hostId && host.online && host.kind === 'desktop' && host.platform === process.platform)) throw new Error('Executor is not visible in the authenticated host list');
    executorBridge.listedOnline = true;
    const musicMcpBridge = await mainWindow.webContents.executeJavaScript(`(async () => {
      const value = window.petpal.musicMcp;
      if (!value || !['config','status','configure','prepare','connect','disconnect','cancel'].every(key => typeof value[key] === 'function')) throw new Error('Music MCP preload facade is unavailable');
      const status = await value.status();
      if (!status.config || !Array.isArray(status.servers) || status.servers.length !== 2) throw new Error('Music MCP native status is unavailable');
      return { available:true, enabled:status.servers.some(server => server.enabled), connected:status.servers.some(server => server.connected), tools:status.servers.reduce((n,server)=>n+server.tools.length,0) };
    })()`);
    await startupMilestone('smoke-status');
    const codex = await fetch(`${origin}/api/codex/status`, { headers: { Authorization: `Bearer ${backend.token}` } }).then(r => r.json());
    const desktopTools = await fetch(`${origin}/api/desktop-tools/status`, { headers: { Authorization: `Bearer ${backend.token}` } }).then(async response => {
      if (!response.ok) throw new Error('Desktop tools status is unavailable');
      return response.json();
    });
    if (process.argv.includes('--startup-only')) {
      let preferencesEvidence;
      if (process.argv.includes('--preferences-smoke')) {
        if (!process.env.PETPAL_SMOKE_PROFILE || app.isPackaged) throw new Error('Preferences smoke requires an isolated development profile');
        const before = await mainWindow.webContents.executeJavaScript('window.petpal.preferences.status()');
        if (before.autoLaunchSupported || before.autoLaunch) throw new Error('Development smoke must not register a system startup item');
        const changed = await mainWindow.webContents.executeJavaScript('window.petpal.preferences.update({startMinimized:true,showPetOnLaunch:false,closeToTray:false,petAlwaysOnTop:false})');
        const written = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'app-preferences.json'), 'utf8'));
        if (!changed.startMinimized || changed.showPetOnLaunch || changed.closeToTray || changed.petAlwaysOnTop || petWindow.isAlwaysOnTop() || !written.startMinimized || written.showPetOnLaunch || written.closeToTray || written.petAlwaysOnTop)
          throw new Error('Preferences did not persist or update the native window');
        const restored = await mainWindow.webContents.executeJavaScript(`window.petpal.preferences.update(${JSON.stringify({startMinimized:before.startMinimized,showPetOnLaunch:before.showPetOnLaunch,closeToTray:before.closeToTray,petAlwaysOnTop:before.petAlwaysOnTop})})`);
        if (petWindow.isAlwaysOnTop() !== before.petAlwaysOnTop) throw new Error('Native topmost preference did not restore');
        await mainWindow.loadURL(`${origin}/?chat=1&settings=1`);
        const ui = await mainWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
          const deadline = Date.now() + 20000; let opened = false;
          const check = () => {
            const tab = [...document.querySelectorAll('.settings-tabs button')].find(button => button.textContent.trim() === '设备连接');
            if (!opened && tab && !tab.disabled) { opened = true; tab.click(); }
            const panel = document.querySelector('.client-behavior-settings');
            const inputs = panel && [...panel.querySelectorAll('input[role="switch"]')];
            if (inputs?.length === 5 && !panel.querySelector('[role="alert"]') && panel.getAttribute('aria-busy') === 'false') {
              if (!inputs.find(input => input.getAttribute('aria-label') === '开机自启')?.disabled) return reject(new Error('Development UI must disable system autostart'));
              panel.scrollIntoView({ block: 'start' });
              return resolve({ switches: inputs.map(input => ({ label: input.getAttribute('aria-label'), checked: input.checked, disabled: input.disabled })), realBridge: true });
            }
            if (Date.now() >= deadline) return reject(new Error('Native preferences UI did not become ready'));
            setTimeout(check, 40);
          }; check();
        })`);
        await mainWindow.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        if (process.env.PETPAL_SMOKE_DIR) await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR, 'preferences.png'), (await mainWindow.webContents.capturePage()).toPNG());
        preferencesEvidence = { before, changed, restored, ui, realBridge: true, persisted: true, nativeTopmostChanged: true, systemAutoLaunchChanged: false };
      }
      const result = { event: 'desktop-startup-smoke', startupReady: true, health, loginGate,
        ...(preferencesEvidence ? { preferences: preferencesEvidence } : {}),
        bridge: { url: bridge.url, hasToken: bridge.hasToken }, executor: executorBridge, musicMcp: musicMcpBridge,
        runtimeRoot: path.dirname(process.execPath), electronVersion: process.versions.electron,
        codex: { available: codex.available, running: codex.running, authenticated: codex.authenticated },
        desktopTools: { music: desktopTools.music, opencli: { available: desktopTools.opencli.available,
          version: desktopTools.opencli.version, runtime: desktopTools.opencli.runtime,
          daemonState: desktopTools.opencli.daemon?.state, readOnlyProbe: true } } };
      if (!health.ok || !bridge.hasToken || !codex.available || !desktopTools.opencli.available || desktopTools.opencli.version !== '1.8.8') throw new Error('Startup smoke prerequisite failed');
      await startupMilestone('smoke-evidence');
      if (process.env.PETPAL_SMOKE_DIR) {
        await fs.mkdir(process.env.PETPAL_SMOKE_DIR, { recursive: true });
        await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR, 'startup-result.json'), JSON.stringify(result, null, 2));
      }
      await startupMilestone('smoke-complete');
      console.log(JSON.stringify(result));
      app.quit();
      return;
    }
    await startupMilestone('smoke-anime');
    const { main: animeMain, pet: animePet } = await inspectSmokeAvatarPair('anime', false);
    const defaultChoiceHidden = !(await inspectSmokeCatChoice(false));
    await mainWindow.webContents.executeJavaScript(`(async () => {
      await document.fonts.ready;
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`);
    const result = { event: 'desktop-smoke', health, loginGate, bridge: { url: bridge.url, hasToken: bridge.hasToken }, executor: executorBridge, musicMcp: musicMcpBridge, uiReady: true,
      runtimeRoot: path.dirname(process.execPath), electronVersion: process.versions.electron,
      desktopTools: { toolVersion: desktopTools.toolVersion, music: desktopTools.music,
        opencli: { available: desktopTools.opencli.available, version: desktopTools.opencli.version,
          runtime: desktopTools.opencli.runtime, daemonState: desktopTools.opencli.daemon?.state,
          extensionConnected: desktopTools.opencli.extension?.connected, readOnlyProbe: true } },
      avatars: { anime: { main: animeMain, pet: animePet } }, defaultAvatar: 'anime',
      catCapability: { defaultOff: { main: animeMain, pet: animePet, choiceHidden: defaultChoiceHidden } },
      codex: { available: codex.available, running: codex.running, authenticated: codex.authenticated, sandbox: codex.sandbox },
      pet: { alwaysOnTop: petWindow.isAlwaysOnTop(), transparent: true } };
    await startupMilestone('smoke-system-speech');
    result.systemSpeech = await inspectSystemSpeech(mainWindow);
    if (process.env.PETPAL_SMOKE_DIR) {
      await fs.mkdir(process.env.PETPAL_SMOKE_DIR, { recursive: true });
      await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR, 'main.png'), (await mainWindow.webContents.capturePage()).toPNG());
      await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR, 'pet.png'), (await petWindow.webContents.capturePage()).toPNG());
      if (process.env.PETPAL_SMOKE_POSES === '1') {
        const desktopBounds = mainWindow.getBounds();
        mainWindow.setMinimumSize(0, 0);
        let requestedWidth = 390, requestedHeight = 844;
        for (let attempt = 0; attempt < 3; attempt++) {
          mainWindow.setContentSize(requestedWidth, requestedHeight);
          const viewport = await mainWindow.webContents.executeJavaScript('new Promise(resolve => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve({width:innerWidth,height:innerHeight}))), 250))');
          if (viewport.width === 390 && viewport.height === 844) break;
          requestedWidth += 390 - viewport.width; requestedHeight += 844 - viewport.height;
        }
        const mobile = await inspectAvatarWindow(mainWindow, true, 'anime');
        if (mobile.viewport.width !== 390 || mobile.viewport.height !== 844) throw new Error(`Mobile viewport differs: ${JSON.stringify(mobile.viewport)}`);
        await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR, 'anime-mobile.png'), (await mainWindow.webContents.capturePage()).toPNG());
        mainWindow.setBounds(desktopBounds);
        fitWindowToDisplay(mainWindow);
        await mainWindow.webContents.executeJavaScript('new Promise(resolve => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 250))');
        result.poses = { mobile };
      }
    }
    await startupMilestone('smoke-anime-gestures');
    result.gestures = { anime: await inspectNaturalGestures('anime') };
    await startupMilestone('smoke-cat');
    const initialRawPreference = await snapshotSmokeRawCompanionPreference();
    const enabledSettings = await inspectSmokeCatSettings(false, true);
    result.catCapability.defaultOff.settingsChecked = enabledSettings.before;
    const enablePreservedPreference = await assertSmokeRawCompanionPreference(initialRawPreference);
    await mainWindow.loadURL(origin);
    await inspectSmokeAvatarPair('anime', true);
    const enabledChoiceVisible = await inspectSmokeCatChoice(true);
    await clickSmokeButton('.companion-switch', '3D 小猫');
    const { main: catMain, pet: catPet } = await inspectSmokeAvatarPair('cat', true);
    result.catCapability.enabled = { main: catMain, pet: catPet, settingsChecked: enabledSettings.checked,
      clickedSettingsSwitch: enabledSettings.clicked, choiceVisible: enabledChoiceVisible, rawPreferenceUnchanged: enablePreservedPreference };
    result.is3d = true; result.renderer = { main: catMain, pet: catPet }; result.avatars.cat = result.renderer;
    if (process.env.PETPAL_SMOKE_DIR) {
      await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR, 'cat-main.png'), (await mainWindow.webContents.capturePage()).toPNG());
      await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR, 'cat-pet.png'), (await petWindow.webContents.capturePage()).toPNG());
      if (process.env.PETPAL_SMOKE_POSES === '1') {
        result.poses.walk = await waitForPose('walk');
        await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR, 'cat-walk.png'), (await mainWindow.webContents.capturePage()).toPNG());
      }
    }
    await startupMilestone('smoke-cat-gestures');
    result.gestures.cat = await inspectNaturalGestures('cat');
    await startupMilestone('smoke-avatar-return');
    await clickSmokeButton('.companion-switch', '二次元伙伴');
    const returned = await inspectSmokeAvatarPair('anime', true);
    result.catCapability.returned = returned;
    result.switchSynced = true;
    // Disable while the saved choice is cat: gating must not replace that raw preference with anime.
    await clickSmokeButton('.companion-switch', '3D 小猫');
    await inspectSmokeAvatarPair('cat', true);
    const selectedCatPreference = await snapshotSmokeRawCompanionPreference();
    if (selectedCatPreference.serverKind !== 'cat') throw new Error('Explicit cat choice did not finish saving before the disable check');
    const disabledSettings = await inspectSmokeCatSettings(true, false);
    const disablePreservedPreference = await assertSmokeRawCompanionPreference(selectedCatPreference);
    await mainWindow.loadURL(origin);
    const disabledAvatars = await inspectSmokeAvatarPair('anime', false);
    result.catCapability.disabled = { ...disabledAvatars, settingsChecked: disabledSettings.checked,
      clickedSettingsSwitch: disabledSettings.clicked, choiceHidden: !(await inspectSmokeCatChoice(false)),
      rawKindPreserved: selectedCatPreference.serverKind, rawPreferenceUnchanged: disablePreservedPreference };
    await Promise.all([reloadSmokeWindow(mainWindow), reloadSmokeWindow(petWindow)]);
    const reloadedAvatars = await inspectSmokeAvatarPair('anime', false);
    const reloadChoiceHidden = !(await inspectSmokeCatChoice(false));
    const reloadedSettings = await inspectSmokeCatSettings(false);
    result.catCapability.reloaded = { ...reloadedAvatars, settingsChecked: reloadedSettings.checked,
      choiceHidden: reloadChoiceHidden, bothWindowsReloaded: true, rawKindPreserved: selectedCatPreference.serverKind,
      rawPreferenceUnchanged: await assertSmokeRawCompanionPreference(selectedCatPreference) };
    await mainWindow.loadURL(origin);
    await inspectSmokeAvatarPair('anime', false);
    result.catCapability.legacyPreferenceUnchanged = [catMain, returned.main, disabledAvatars.main, reloadedAvatars.main].every(value => value.storedKind === animeMain.storedKind)
      && [catPet, returned.pet, disabledAvatars.pet, reloadedAvatars.pet].every(value => value.storedKind === animePet.storedKind);
    if (!result.catCapability.legacyPreferenceUnchanged) throw new Error('Avatar capability or selection overwrote the legacy global preference');
    if (process.env.PETPAL_SMOKE_APP === '1' || process.env.PETPAL_SMOKE_POSES === '1') {
      await startupMilestone('smoke-app');
      result.appFixture = await inspectAppFixture({ expressions: process.env.PETPAL_SMOKE_POSES === '1' });
      result.responsePerformance = result.appFixture.responses;
      result.speechUi = result.appFixture.speechUi;
    }
    await startupMilestone('smoke-evidence');
    const hashBundle = async relative => {
      const absolute = path.join(root, relative);
      if ((await fs.stat(absolute)).isDirectory()) {
        return (await Promise.all((await fs.readdir(absolute)).sort().map(name => hashBundle(path.join(relative, name))))).flat();
      }
      const bytes = await fs.readFile(absolute);
      return [{ path: relative.split(path.sep).join('/'), bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }];
    };
    result.bundleFiles = (await Promise.all(['dist', 'server', 'desktop/main.cjs', 'desktop/preload.cjs', 'desktop/window-layout.cjs', 'desktop/updates.mjs', 'desktop/media-permissions.cjs', 'desktop/service-settings.cjs', 'desktop/startup-diagnostics.cjs', 'desktop/app-preferences.cjs', 'desktop/app-preferences-ipc.cjs', 'desktop/central-server.cjs', 'desktop/central-server-ipc.cjs', 'desktop/central-server-smoke.cjs', 'desktop/remote-http.cjs', 'desktop/executor.mjs', 'package.json', 'node_modules/@jackwener/opencli/package.json', 'node_modules/@jackwener/opencli/dist/src/main.js', 'node_modules/@jackwener/opencli/dist/src/daemon.js', 'node_modules/@jackwener/opencli/LICENSE'].map(hashBundle))).flat();
    if (process.env.PETPAL_SMOKE_DIR) await fs.writeFile(path.join(process.env.PETPAL_SMOKE_DIR, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    if (!health.ok || !bridge.hasToken || !codex.available || !desktopTools.opencli.available || desktopTools.opencli.version !== '1.8.8') throw new Error('Desktop smoke prerequisite failed');
    await startupMilestone('smoke-complete');
    app.quit();
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, argv = []) => { if (origin && !argv.includes('--petpal-autostart')) showMain(); });
  app.whenReady().then(async () => { await startupMilestone('electron-ready'); await boot(); }).catch(handleStartupFailure);
  app.on('activate', () => { if (origin) showMain(); });
  app.on('window-all-closed', () => { if (!tray) app.quit(); });
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault(); quitting = true;
    tray?.destroy(); tray = null;
    (async () => {
      const centralOutcome = await Promise.allSettled([centralServer?.close()]);
      const outcomes = await Promise.allSettled([appPreferences?.close(), executor?.close(), remoteHttp?.close(), updates?.close({ preserveHandoff: Boolean(pendingUpdate) }), backend?.close()]);
      const failed = [...centralOutcome, ...outcomes].find(outcome => outcome.status === 'rejected');
      if (failed) throw failed.reason;
      if (pendingUpdate) await launchPreparedUpdate(pendingUpdate);
    })().catch(error => { console.error('PetPal shutdown/update handoff:', error.message); exitCode = 1; }).finally(() => app.exit(exitCode));
  });
}
