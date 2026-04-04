const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  toggleClickThrough: () => ipcRenderer.invoke('jarvis:toggle-clickthrough'),
  setClickThrough: (enabled) => ipcRenderer.invoke('jarvis:set-clickthrough', enabled),
  toggleHud: () => ipcRenderer.invoke('jarvis:toggle-hud'),
  getBackendStatus: () => ipcRenderer.invoke('jarvis:get-backend-status'),
  setCredential: (key, value) => ipcRenderer.invoke('jarvis:set-credential', key, value),
  getCredential: (key) => ipcRenderer.invoke('jarvis:get-credential', key),
  deleteCredential: (key) => ipcRenderer.invoke('jarvis:delete-credential', key),
  onBackendStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('jarvis:backend-status', listener);
    return () => ipcRenderer.removeListener('jarvis:backend-status', listener);
  },
  onToggleFocusShortcut: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('jarvis:toggle-focus', listener);
    return () => ipcRenderer.removeListener('jarvis:toggle-focus', listener);
  },
});
