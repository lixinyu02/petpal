const { contextBridge, ipcRenderer } = require('electron');

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

contextBridge.exposeInMainWorld('petpal', Object.freeze({
  connection: () => ipcRenderer.invoke('petpal:connection'),
  showPet: () => ipcRenderer.invoke('petpal:show-pet'),
  showMain: () => ipcRenderer.invoke('petpal:show-main'),
  hidePet: () => ipcRenderer.invoke('petpal:hide-pet'),
  remoteRequest,
  remoteAbort: id => ipcRenderer.invoke('petpal:remote:abort', id),
  updates: Object.freeze({
    status: () => updateCall('status'),
    check: () => updateCall('check'),
    download: releaseId => updateCall('download', releaseId),
    install: releaseId => updateCall('install', releaseId),
    cancel: () => updateCall('cancel'),
  }),
}));
