const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  toggleClickThrough: () => ipcRenderer.invoke('jarvis:toggle-clickthrough'),
  setClickThrough: (enabled) => ipcRenderer.invoke('jarvis:set-clickthrough', enabled),
  toggleHud: () => ipcRenderer.invoke('jarvis:toggle-hud'),
  getBackendStatus: () => ipcRenderer.invoke('jarvis:get-backend-status'),
  getServiceHealth: () => ipcRenderer.invoke('jarvis:get-service-health'),
  requestMicrophoneAccess: () => ipcRenderer.invoke('jarvis:request-microphone-access'),
  getMicrophoneAccess: () => ipcRenderer.invoke('jarvis:get-microphone-access'),
  setCredential: (key, value) => ipcRenderer.invoke('jarvis:set-credential', key, value),
  getCredential: (key) => ipcRenderer.invoke('jarvis:get-credential', key),
  deleteCredential: (key) => ipcRenderer.invoke('jarvis:delete-credential', key),
  readAssetText: (relativePath) => ipcRenderer.invoke('jarvis:read-asset-text', relativePath),
  onBackendStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('jarvis:backend-status', listener);
    return () => ipcRenderer.removeListener('jarvis:backend-status', listener);
  },
  onToggleFocusShortcut: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('jarvis:toggle-focus', listener);
    return () => ipcRenderer.removeListener('jarvis:toggle-focus', listener);
  },
  onServiceHealth: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('jarvis:service-health', listener);
    return () => ipcRenderer.removeListener('jarvis:service-health', listener);
  },
});
