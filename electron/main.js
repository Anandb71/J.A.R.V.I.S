const { app, BrowserWindow, ipcMain, globalShortcut, session, Tray, Menu, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { PythonBridge } = require('./python-bridge');
const { CredentialStore } = require('./credential-store');

let mainWindow;
let hudVisible = true;
let clickThrough = false;
let tray = null;

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

  // Quick toggle: click-through + HUD focus mode
  globalShortcut.register('Control+K', () => {
    clickThrough = !clickThrough;
    if (!mainWindow) return;
    mainWindow.setIgnoreMouseEvents(clickThrough, { forward: true });
    mainWindow.webContents.send('jarvis:toggle-focus');
  });
}

function setupIpc() {
  ipcMain.handle('jarvis:toggle-clickthrough', (event) => {
    if (!isTrustedSender(event)) return { clickThrough };
    clickThrough = !clickThrough;
    mainWindow?.setIgnoreMouseEvents(clickThrough, { forward: true });
    return { clickThrough };
  });

  ipcMain.handle('jarvis:set-clickthrough', (event, enabled) => {
    if (!isTrustedSender(event)) return { clickThrough };
    clickThrough = Boolean(enabled);
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
    const allowedPermissions = new Set(['microphone', 'geolocation']);
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
            "connect-src 'self' ws://127.0.0.1:8765 http://127.0.0.1:8765 http://127.0.0.1:11434 https://api.open-meteo.com https://geocoding-api.open-meteo.com https://api.duckduckgo.com",
            "img-src 'self' data: blob:",
            "media-src 'self' blob:",
          ].join('; '),
        ],
      },
    });
  });

  setupIpc();
  createWindow();
  createTray();
  registerShortcuts();
  pythonBridge.start();

  if (app.isPackaged) {
    try {
      const { autoUpdater } = require('electron-updater');
      const updateConfigPath = path.join(process.resourcesPath, 'app-update.yml');
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on('error', (error) => {
        console.error('[updater:error]', error?.message || error);
      });
      if (fs.existsSync(updateConfigPath)) {
        autoUpdater.checkForUpdatesAndNotify().catch((error) => {
          console.error('[updater:check]', error?.message || error);
        });
      } else {
        console.log('[updater] app-update.yml missing, skipping update check');
      }
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
  if (tray) { tray.destroy(); tray = null; }
});

function createTray() {
  // Create a 16x16 blue circle icon
  const icon = nativeImage.createFromBuffer(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAe0lEQVQ4T2NkoBAwUqifgWoGMDIw/P/PwLCbgYHhMj5X' +
      'MDIw+DAyMNgzMDLcIeQKRgaGOYwMDMH4DGFkYPBhZGSwZ2BkuIvPEEYGhjmMDIxBhAxhZGCYw8jIGETIEEZGhjlASYIN' +
      'YWRkmMPIyBhEyBUMDAw+jIyM9gDaAi3bFiHK1gAAAABJRU5ErkJggg==',
      'base64'
    )
  );

  tray = new Tray(icon);
  tray.setToolTip('J.A.R.V.I.S.');

  const updateMenu = () => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'J.A.R.V.I.S.',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: hudVisible ? '⬛ Hide HUD' : '⬜ Show HUD',
        click: () => {
          hudVisible = !hudVisible;
          if (hudVisible) mainWindow?.show();
          else mainWindow?.hide();
          updateMenu();
        },
      },
      {
        label: clickThrough ? '🔓 Disable Click-through' : '🔒 Enable Click-through',
        click: () => {
          clickThrough = !clickThrough;
          mainWindow?.setIgnoreMouseEvents(clickThrough, { forward: true });
          updateMenu();
        },
      },
      { type: 'separator' },
      {
        label: '🔄 Restart Backend',
        click: () => {
          pythonBridge.stop();
          setTimeout(() => pythonBridge.start(), 500);
        },
      },
      { type: 'separator' },
      {
        label: '❌ Quit JARVIS',
        click: () => {
          pythonBridge.stop();
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(contextMenu);
  };

  updateMenu();

  tray.on('click', () => {
    hudVisible = !hudVisible;
    if (hudVisible) mainWindow?.show();
    else mainWindow?.hide();
    updateMenu();
  });
}
