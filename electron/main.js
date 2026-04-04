const { app, BrowserWindow, ipcMain, globalShortcut, session } = require('electron');
const path = require('node:path');
const { PythonBridge } = require('./python-bridge');
const { CredentialStore } = require('./credential-store');

let mainWindow;
let hudVisible = true;
let clickThrough = true;

const pythonBridge = new PythonBridge();
let credentialStore = null;

function isTrustedSender(event) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const senderFrame = event?.senderFrame;
  if (!senderFrame) return false;
  const frameUrl = String(senderFrame.url || '');
  return frameUrl.startsWith('file://') && senderFrame === mainWindow.webContents.mainFrame;
}

function broadcastBackendStatus() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('jarvis:backend-status', {
    running: Boolean(pythonBridge.process),
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.resolve(__dirname, '..', 'src', 'index.html'));
  mainWindow.setIgnoreMouseEvents(clickThrough, { forward: true });

  // Security: block navigation away from app and disallow popups.
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerShortcuts() {
  globalShortcut.register('Control+Shift+J', () => {
    hudVisible = !hudVisible;
    if (!mainWindow) return;
    if (hudVisible) {
      mainWindow.show();
    } else {
      mainWindow.hide();
    }
  });

  globalShortcut.register('Control+Shift+K', () => {
    clickThrough = !clickThrough;
    if (!mainWindow) return;
    mainWindow.setIgnoreMouseEvents(clickThrough, { forward: true });
  });
}

function setupIpc() {
  ipcMain.handle('jarvis:toggle-clickthrough', (event) => {
    if (!isTrustedSender(event)) return { clickThrough };
    clickThrough = !clickThrough;
    mainWindow?.setIgnoreMouseEvents(clickThrough, { forward: true });
    return { clickThrough };
  });

  ipcMain.handle('jarvis:toggle-hud', (event) => {
    if (!isTrustedSender(event)) return { hudVisible };
    hudVisible = !hudVisible;
    if (hudVisible) mainWindow?.show();
    else mainWindow?.hide();
    return { hudVisible };
  });

  ipcMain.handle('jarvis:get-backend-status', (event) => {
    if (!isTrustedSender(event)) return { running: false };
    return {
    running: Boolean(pythonBridge.process),
    };
  });

  ipcMain.handle('jarvis:set-credential', (event, key, value) => {
    if (!isTrustedSender(event)) return false;
    if (!credentialStore || !key) return false;
    return credentialStore.save(String(key), String(value ?? ''));
  });

  ipcMain.handle('jarvis:get-credential', (event, key) => {
    if (!isTrustedSender(event)) return null;
    if (!credentialStore || !key) return null;
    return credentialStore.get(String(key));
  });

  ipcMain.handle('jarvis:delete-credential', (event, key) => {
    if (!isTrustedSender(event)) return false;
    if (!credentialStore || !key) return false;
    return credentialStore.delete(String(key));
  });
}

app.whenReady().then(() => {
  credentialStore = new CredentialStore(app.getPath('userData'));

  // Security: explicitly control permission requests.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const requestingUrl = String(details?.requestingUrl || '');
    const isLocalApp = requestingUrl.startsWith('file://');
    const allowedPermissions = new Set(['microphone']);
    callback(isLocalApp && allowedPermissions.has(permission));
  });

  // Security: enforce CSP at runtime for all responses/subresources.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            "script-src 'self'",
            "worker-src 'self' blob:",
            "style-src 'self' 'unsafe-inline'",
            "font-src 'self' data:",
            "connect-src 'self' ws://127.0.0.1:8765 http://127.0.0.1:8765 http://127.0.0.1:11434",
            "img-src 'self' data: blob:",
            "media-src 'self' blob:",
          ].join('; '),
        ],
      },
    });
  });

  setupIpc();
  createWindow();
  registerShortcuts();
  pythonBridge.start();

  if (app.isPackaged) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.checkForUpdatesAndNotify();
    } catch (error) {
      console.error('[updater]', error?.message || error);
    }
  }

  setInterval(broadcastBackendStatus, 5000);
});

app.on('window-all-closed', () => {
  pythonBridge.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
  pythonBridge.stop();
});
