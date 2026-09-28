const { contextBridge, ipcRenderer } = require('electron');

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
  updates: Object.freeze({
    status: () => updateCall('status'),
    check: () => updateCall('check'),
    download: releaseId => updateCall('download', releaseId),
    install: releaseId => updateCall('install', releaseId),
    cancel: () => updateCall('cancel'),
  }),
}));
