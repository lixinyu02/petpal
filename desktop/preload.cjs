const { contextBridge, ipcRenderer } = require('electron');

function initialAppearance() {
  const args = typeof process !== 'undefined' && Array.isArray(process.argv) ? process.argv : [];
  const seeds = args.filter(value => typeof value === 'string' && value.startsWith('--petpal-appearance='));
  const match = seeds.length === 1 && /^--petpal-appearance=(day|night|auto):(day|night):(0|1)$/.exec(seeds[0]);
  const sessions = args.filter(value => typeof value === 'string' && value.startsWith('--petpal-appearance-session='));
  const session = sessions.length === 1 && /^--petpal-appearance-session=([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.exec(sessions[0]);
  return Object.freeze(match && (match[1] === 'auto' || match[1] === match[2]) ? { preference: match[1], theme: match[2], saved: match[3] === '1', ...(session ? { sessionId: session[1] } : {}) }
    : { preference: 'day', theme: 'day', saved: false });
}

const remoteRequests = new Map();
let remoteListening = false;
const receiveRemoteEvent = (_event, id, payload) => {
  const request = remoteRequests.get(id);
  if (!request) return;
  // The Electron event and IPC sender are never exposed across contextIsolation.
  try { request.onEvent(payload); }
  catch (error) { request.error = error; request.finish(); void ipcRenderer.invoke('petpal:remote:abort', id).catch(() => {}); }
  if (payload?.type === 'end' || payload?.type === 'error') request.finish();
};
async function remoteRequest(request, onEvent) {
  if (!request || typeof request.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(request.id) || typeof onEvent !== 'function') throw new Error('远程请求格式无效。');
  if (remoteRequests.has(request.id)) throw new Error('远程请求标识重复。');
  if (!remoteListening) { ipcRenderer.on('petpal:remote:event', receiveRemoteEvent); remoteListening = true; }
  let finish;
  const terminal = new Promise(resolve => { finish = resolve; });
  const active = { onEvent, error: null, finish }; remoteRequests.set(request.id, active);
  // IPC invoke replies and streamed events use separate channels; retain callbacks until both finish.
  try { await ipcRenderer.invoke('petpal:remote:request', request); await terminal; if (active.error) throw active.error; }
  finally { if (remoteRequests.get(request.id) === active) remoteRequests.delete(request.id); }
}
globalThis.addEventListener?.('pagehide', () => {
  for (const [id, request] of remoteRequests) { request.finish(); void ipcRenderer.invoke('petpal:remote:abort', id).catch(() => {}); }
  remoteRequests.clear();
});

function updateCall(action, ...args) {
  let token = '';
  try { token = JSON.parse(sessionStorage.getItem('petpal.connection') || 'null')?.token || ''; } catch { /* logged out */ }
  return ipcRenderer.invoke(`petpal:updates:${action}`, token, ...args);
}

function preferenceCall(action, value) {
  let connection = null;
  try { const value = JSON.parse(sessionStorage.getItem('petpal.connection') || 'null'); if (value) connection = { url: value.url === '' ? location.origin : value.url, token: value.token }; } catch { /* logged out */ }
  return ipcRenderer.invoke(`petpal:app-preferences:${action}`, connection, value);
}

function centralServerCall(action, ...args) {
  let connection = null;
  try { const value = JSON.parse(sessionStorage.getItem('petpal.connection') || 'null'); if (value) connection = { url: value.url === '' ? location.origin : value.url, token: value.token }; } catch { /* logged out */ }
  return ipcRenderer.invoke(`petpal:central-server:${action}`, connection, ...args);
}

function officialAccountCall(action, value) {
  let connection = null;
  try { const saved = JSON.parse(sessionStorage.getItem('petpal.connection') || 'null'); if (saved) connection = { url: saved.url === '' ? location.origin : saved.url, token: saved.token }; } catch { /* logged out */ }
  return ipcRenderer.invoke(`petpal:official-account:${action}`, connection, value);
}

function appProxyCall(action, value) {
  let connection = null;
  try { const saved = JSON.parse(sessionStorage.getItem('petpal.connection') || 'null'); if (saved) connection = { url: saved.url === '' ? location.origin : saved.url, token: saved.token }; } catch { /* logged out */ }
  return ipcRenderer.invoke(`petpal:app-proxy:${action}`, connection, value);
}

function memoryRuntimeCall(action, value) {
  let connection = null;
  try { const saved = JSON.parse(sessionStorage.getItem('petpal.connection') || 'null'); if (saved) connection = { url: saved.url === '' ? location.origin : saved.url, token: saved.token }; } catch { /* logged out */ }
  return ipcRenderer.invoke(`petpal:memory-runtime:${action}`, connection, value);
}

contextBridge.exposeInMainWorld('petpal', Object.freeze({
  runtime: Object.freeze({ platform:typeof process !== 'undefined' && typeof process.platform === 'string' ? process.platform : '', arch:typeof process !== 'undefined' && typeof process.arch === 'string' ? process.arch : '' }),
  appearance: Object.freeze({ initial: initialAppearance(),
    status: () => ipcRenderer.invoke('petpal:appearance:status'),
    setPreference: preference => {
      if (!['day', 'night', 'auto'].includes(preference)) return Promise.reject(new TypeError('外观选项无效。'));
      return ipcRenderer.invoke('petpal:appearance:set-preference', preference);
    },
  }),
  connection: () => ipcRenderer.invoke('petpal:connection'),
  showPet: () => ipcRenderer.invoke('petpal:show-pet'),
  showMain: () => ipcRenderer.invoke('petpal:show-main'),
  hidePet: () => ipcRenderer.invoke('petpal:hide-pet'),
  preferences: Object.freeze({
    status: () => ipcRenderer.invoke('petpal:app-preferences:status'),
    update: patch => preferenceCall('update', patch),
    setFullscreen: enabled => preferenceCall('fullscreen', enabled),
    onWindowState: callback => {
      if (typeof callback !== 'function') throw new TypeError('Expected a window state callback');
      const listener = (_event, state) => {
        if (state && typeof state.fullscreen === 'boolean') callback({ fullscreen: state.fullscreen });
      };
      ipcRenderer.on('petpal:window-state', listener);
      return () => ipcRenderer.removeListener('petpal:window-state', listener);
    },
  }),
  centralServer: Object.freeze({
    status: () => centralServerCall('status'),
    update: patch => centralServerCall('update', patch),
  }),
  memoryRuntime: Object.freeze({
    status: () => memoryRuntimeCall('status'),
    prepare: () => memoryRuntimeCall('prepare'),
    start: () => memoryRuntimeCall('start'),
    stop: () => memoryRuntimeCall('stop'),
    preferences: input => memoryRuntimeCall('preferences', input),
  }),
  officialAccount: Object.freeze({
    status: () => officialAccountCall('status'),
    start: input => officialAccountCall('start', input),
    cancel: () => officialAccountCall('cancel'),
    select: profileId => officialAccountCall('select', profileId),
    logout: () => officialAccountCall('logout'),
    refresh: () => officialAccountCall('refresh'),
    resumeUsage: () => officialAccountCall('resumeUsage'),
  }),
  appProxy: Object.freeze({
    status: () => appProxyCall('status'),
    importFile: () => appProxyCall('importFile'),
    importText: input => appProxyCall('importText', input),
    importUrl: input => appProxyCall('importUrl', input),
    updateRemote: () => appProxyCall('updateRemote'),
    start: () => appProxyCall('start'),
    stop: () => appProxyCall('stop'),
    preferences: input => appProxyCall('preferences', input),
    select: input => appProxyCall('select', input),
  }),
  remoteRequest,
  remoteAbort: id => ipcRenderer.invoke('petpal:remote:abort', id),
  remoteAck: (id, sequence) => ipcRenderer.invoke('petpal:remote:ack', id, sequence),
  executor: Object.freeze({
    connect: input => ipcRenderer.invoke('petpal:executor:connect', input),
    disconnect: () => ipcRenderer.invoke('petpal:executor:disconnect'),
    status: () => ipcRenderer.invoke('petpal:executor:status'),
  }),
  musicMcp: Object.freeze({
    config: () => ipcRenderer.invoke('petpal:music-mcp:config'),
    status: () => ipcRenderer.invoke('petpal:music-mcp:status'),
    configure: body => ipcRenderer.invoke('petpal:music-mcp:configure', body),
    prepare: body => ipcRenderer.invoke('petpal:music-mcp:prepare', body),
    connect: body => ipcRenderer.invoke('petpal:music-mcp:connect', body),
    disconnect: body => ipcRenderer.invoke('petpal:music-mcp:disconnect', body),
    cancel: () => ipcRenderer.invoke('petpal:music-mcp:cancel'),
  }),
  computerUse: Object.freeze({
    config: () => ipcRenderer.invoke('petpal:computer-use:config'),
    status: () => ipcRenderer.invoke('petpal:computer-use:status'),
    configure: body => ipcRenderer.invoke('petpal:computer-use:configure',body),
    connect: () => ipcRenderer.invoke('petpal:computer-use:connect'),
    disconnect: () => ipcRenderer.invoke('petpal:computer-use:disconnect'),
    cancel: () => ipcRenderer.invoke('petpal:computer-use:cancel'),
  }),
  opencli: Object.freeze({
    config: () => ipcRenderer.invoke('petpal:opencli:config'),
    status: () => ipcRenderer.invoke('petpal:opencli:status'),
    configure: body => ipcRenderer.invoke('petpal:opencli:configure', body),
    action: body => ipcRenderer.invoke('petpal:opencli:action', body),
    sites: body => ipcRenderer.invoke('petpal:opencli:sites', body),
    cancel: () => ipcRenderer.invoke('petpal:opencli:cancel'),
  }),
  updates: Object.freeze({
    status: () => updateCall('status'),
    check: () => updateCall('check'),
    download: releaseId => updateCall('download', releaseId),
    install: releaseId => updateCall('install', releaseId),
    cancel: () => updateCall('cancel'),
  }),
}));
