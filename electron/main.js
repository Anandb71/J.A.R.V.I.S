const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const path = require('node:path');
const { PythonBridge } = require('./python-bridge');

let mainWindow;
let hudVisible = true;
let clickThrough = true;

const pythonBridge = new PythonBridge();

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
  ipcMain.handle('jarvis:toggle-clickthrough', () => {
    clickThrough = !clickThrough;
    mainWindow?.setIgnoreMouseEvents(clickThrough, { forward: true });
    return { clickThrough };
  });

  ipcMain.handle('jarvis:toggle-hud', () => {
    hudVisible = !hudVisible;
    if (hudVisible) mainWindow?.show();
    else mainWindow?.hide();
    return { hudVisible };
  });

  ipcMain.handle('jarvis:get-backend-status', () => ({
    running: Boolean(pythonBridge.process),
  }));
}

app.whenReady().then(() => {
  setupIpc();
  createWindow();
  registerShortcuts();
  pythonBridge.start();

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
