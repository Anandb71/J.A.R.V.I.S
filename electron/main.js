const { app, BrowserWindow, ipcMain, globalShortcut, session, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { PythonBridge } = require('./python-bridge');
const { CredentialStore } = require('./credential-store');

const execFileAsync = promisify(execFile);

let mainWindow;
let hudVisible = true;
let clickThrough = false;
let tray = null;
let isQuitting = false;
let backendStatusInterval = null;
let serviceHealthInterval = null;

const BACKEND_PORT = Number(process.env.JARVIS_BACKEND_PORT || 8765);
const AI_PORT = Number(process.env.JARVIS_AI_PORT || 11434);

const pythonBridge = new PythonBridge();
let credentialStore = null;
let ollamaProcess = null;
let ollamaRestartTimer = null;
let ollamaRestarts = 0;
const OLLAMA_MAX_RESTARTS = 8;

const serviceHealth = {
  ui: { up: true, latencyMs: 0 },
  api: { up: false, latencyMs: null, url: `http://127.0.0.1:${BACKEND_PORT}/api/health` },
  ai: { up: false, latencyMs: null, url: `http://127.0.0.1:${AI_PORT}/api/tags` },
};

let microphonePermissionDecision = 'unknown'; // unknown | granted | denied

async function promptMicrophonePermission() {
  if (microphonePermissionDecision === 'granted') return true;
  if (microphonePermissionDecision === 'denied') return false;

  const response = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Microphone Access Required',
    message: 'JARVIS needs microphone access for voice chat.',
    detail: 'Allow microphone access now? You can change this later from JARVIS settings / app restart.',
    buttons: ['Allow', 'Deny'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });

  const granted = response.response === 0;
  microphonePermissionDecision = granted ? 'granted' : 'denied';
  return granted;
}

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
    port: BACKEND_PORT,
  });
}

function broadcastServiceHealth() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('jarvis:service-health', {
    ...serviceHealth,
    backendPort: BACKEND_PORT,
    aiPort: AI_PORT,
  });
}

async function listListeningPids(port) {
  try {
    const { stdout } = await execFileAsync('cmd.exe', ['/d', '/s', '/c', `netstat -ano -p tcp | findstr /R /C:":${port} "`]);
    const pids = new Set();
    stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const cols = line.split(/\s+/);
        if (cols.length < 5) return;
        const state = cols[3]?.toUpperCase?.() || '';
        const pid = Number(cols[4]);
        if (state === 'LISTENING' && Number.isFinite(pid) && pid > 0) {
          pids.add(pid);
        }
      });
    return [...pids];
  } catch {
    return [];
  }
}

async function killProcessTree(pid) {
  if (!pid || pid === process.pid) return;
  try {
    await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F']);
  } catch {
    // Best-effort cleanup.
  }
}

async function cleanupGhostListeners() {
  const ports = [BACKEND_PORT, AI_PORT];
  for (const port of ports) {
    const pids = await listListeningPids(port);
    for (const pid of pids) {
      if (pid !== process.pid) {
        await killProcessTree(pid);
      }
    }
  }
}

async function probeUrl(url, timeoutMs = 1600) {
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return { up: false, latencyMs: null };
    }
    return { up: true, latencyMs: Date.now() - started };
  } catch {
    return { up: false, latencyMs: null };
  }
}

async function refreshServiceHealth() {
  const [apiProbe, aiProbe] = await Promise.all([
    probeUrl(`http://127.0.0.1:${BACKEND_PORT}/api/health`),
    probeUrl(`http://127.0.0.1:${AI_PORT}/api/tags`),
  ]);

  serviceHealth.ui = { up: true, latencyMs: 0 };
  serviceHealth.api = { ...serviceHealth.api, ...apiProbe };
  serviceHealth.ai = { ...serviceHealth.ai, ...aiProbe };
  broadcastServiceHealth();
}

function clearOllamaRestartTimer() {
  if (ollamaRestartTimer) {
    clearTimeout(ollamaRestartTimer);
    ollamaRestartTimer = null;
  }
}

function startOllama() {
  if (ollamaProcess) return;
  clearOllamaRestartTimer();

  ollamaProcess = spawn('ollama', ['serve'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  ollamaProcess.stdout.on('data', (chunk) => {
    console.log(`[ollama] ${chunk.toString().trim()}`);
  });

  ollamaProcess.stderr.on('data', (chunk) => {
    console.error(`[ollama:err] ${chunk.toString().trim()}`);
  });

  ollamaProcess.on('error', (error) => {
    console.error(`[ollama:spawn:error] ${error?.message || error}`);
  });

  ollamaProcess.on('exit', () => {
    ollamaProcess = null;
    if (isQuitting) return;
    if (ollamaRestarts >= OLLAMA_MAX_RESTARTS) return;
    ollamaRestarts += 1;
    const backoffMs = Math.min(1000 * (2 ** (ollamaRestarts - 1)), 10000);
    ollamaRestartTimer = setTimeout(() => {
      ollamaRestartTimer = null;
      startOllama();
    }, backoffMs);
  });
}

function stopOllama() {
  clearOllamaRestartTimer();
  if (!ollamaProcess) return;

  const pid = ollamaProcess.pid;
  ollamaProcess = null;
  if (pid) {
    spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      shell: false,
    });
  }
}

function stopIntervals() {
  if (backendStatusInterval) {
    clearInterval(backendStatusInterval);
    backendStatusInterval = null;
  }
  if (serviceHealthInterval) {
    clearInterval(serviceHealthInterval);
    serviceHealthInterval = null;
  }
}

function shutdownServices() {
  stopIntervals();
  pythonBridge.stop();
  stopOllama();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    transparent: false,
    frame: false,
    alwaysOnTop: true,
    hasShadow: true,
    backgroundColor: '#020812',
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
    port: BACKEND_PORT,
    };
  });

  ipcMain.handle('jarvis:get-service-health', (event) => {
    if (!isTrustedSender(event)) {
      return {
        ui: { up: false, latencyMs: null },
        api: { up: false, latencyMs: null },
        ai: { up: false, latencyMs: null },
        backendPort: BACKEND_PORT,
        aiPort: AI_PORT,
      };
    }
    return {
      ...serviceHealth,
      backendPort: BACKEND_PORT,
      aiPort: AI_PORT,
    };
  });

  ipcMain.handle('jarvis:request-microphone-access', async (event) => {
    if (!isTrustedSender(event)) return { granted: false };
    const granted = await promptMicrophonePermission();
    return { granted };
  });

  ipcMain.handle('jarvis:get-microphone-access', (event) => {
    if (!isTrustedSender(event)) return { state: 'unknown', granted: false };
    return {
      state: microphonePermissionDecision,
      granted: microphonePermissionDecision === 'granted',
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

app.whenReady().then(async () => {
  credentialStore = new CredentialStore(app.getPath('userData'));

  // Security + UX: explicitly control permission checks/requests.
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    const isLocalApp = String(requestingOrigin || '').startsWith('file://');
    if (!isLocalApp) return false;
    if (permission === 'microphone') return microphonePermissionDecision === 'granted';
    if (permission === 'geolocation') return true;
    return false;
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const requestingUrl = String(details?.requestingUrl || '');
    const isLocalApp = requestingUrl.startsWith('file://');
    if (!isLocalApp) {
      callback(false);
      return;
    }

    if (permission === 'microphone') {
      void promptMicrophonePermission().then((granted) => callback(granted));
      return;
    }

    if (permission === 'geolocation') {
      callback(true);
      return;
    }

    callback(false);
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

  // Ironclad lifecycle: clear stale listeners before clean service boot.
  await cleanupGhostListeners();
  startOllama();
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

  backendStatusInterval = setInterval(broadcastBackendStatus, 3000);
  serviceHealthInterval = setInterval(refreshServiceHealth, 2500);
  await refreshServiceHealth();
});

app.on('window-all-closed', () => {
  shutdownServices();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  shutdownServices();
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
          shutdownServices();
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
