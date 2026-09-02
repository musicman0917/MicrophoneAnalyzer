const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, nativeImage, Notification, session } = require('electron');
const path = require('node:path');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const CALIBRATION_HOTKEY = 'CommandOrControl+Alt+N';
const CALIBRATION_TIMEOUT_MS = 8000;

let hudWindow = null;
let controlWindow = null;
let tray = null;
let lastStatus = { connected: false };

/** Surfaces renderer warnings/errors in the main process log - handy for bug reports
 * from a packaged app where the user can't easily open devtools themselves. */
function attachConsoleRelay(win, label) {
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level < 2) return; // 0=verbose/1=info are noisy; only relay warnings(2)/errors(3)
    console[level === 3 ? 'error' : 'warn'](`[renderer:${label}] ${message} (${sourceId}:${line})`);
  });
}

function createHudWindow() {
  const win = new BrowserWindow({
    width: 190,
    height: 480,
    minWidth: 150,
    minHeight: 130,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    icon: nativeImage.createFromPath(path.join(ASSETS_DIR, 'app-icon.png')),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'hud-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, '..', 'renderer', 'hud', 'hud.html'));
  attachConsoleRelay(win, 'hud');

  win.on('closed', () => {
    hudWindow = null;
  });

  return win;
}

function createControlWindow() {
  if (controlWindow) {
    controlWindow.show();
    controlWindow.focus();
    return controlWindow;
  }

  const win = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 760,
    minHeight: 560,
    title: 'Mic Level HUD - Control Center',
    icon: nativeImage.createFromPath(path.join(ASSETS_DIR, 'app-icon.png')),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'control-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'control', 'control.html'));
  attachConsoleRelay(win, 'control');

  win.on('closed', () => {
    controlWindow = null;
  });

  controlWindow = win;
  return win;
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ASSETS_DIR, 'tray-icon.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Mic Level HUD');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show/Hide HUD',
      click: () => {
        if (!hudWindow) return;
        hudWindow.isVisible() ? hudWindow.hide() : hudWindow.show();
      },
    },
    { label: 'Open Control Center', click: () => createControlWindow() },
    { type: 'separator' },
    { label: 'Run Noise Floor Check', click: () => runCalibration().catch(() => {}) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (!hudWindow) return;
    hudWindow.isVisible() ? hudWindow.hide() : hudWindow.show();
  });
}

/**
 * The HUD renderer owns the live microphone stream, so calibration has to run there.
 * This asks the HUD to sample the room, waits for its result over IPC, relays it to the
 * Control Center if that window is open, and pops a native notification either way so the
 * result is glanceable even if no window is visible.
 */
function runCalibration() {
  return new Promise((resolve, reject) => {
    if (!hudWindow) {
      reject(new Error('HUD window is not available.'));
      return;
    }

    const timeout = setTimeout(() => {
      ipcMain.removeAllListeners('calibration:result');
      reject(new Error('Calibration timed out.'));
    }, CALIBRATION_TIMEOUT_MS);

    ipcMain.once('calibration:result', (_event, result) => {
      clearTimeout(timeout);
      if (controlWindow) controlWindow.webContents.send('calibration:result', result);

      if (Notification.isSupported()) {
        const body = result?.error
          ? `Calibration failed: ${result.error}`
          : `Noise floor ${result.noiseFloorDb.toFixed(1)} dB - suggested gate ` +
            `${result.suggestedGateThresholdDb.toFixed(1)} dB.`;
        new Notification({ title: 'Mic Level HUD', body }).show();
      }

      result?.error ? reject(new Error(result.error)) : resolve(result);
    });

    hudWindow.webContents.send('calibration:start');
  });
}

app.whenReady().then(() => {
  // This app's entire purpose is microphone metering, so auto-grant mic access rather
  // than leaving Electron's default (which varies by version/platform) to chance.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');

  hudWindow = createHudWindow();
  createTray();

  globalShortcut.register(CALIBRATION_HOTKEY, () => {
    runCalibration().catch((err) => console.error('[calibration]', err.message));
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) hudWindow = createHudWindow();
  });

  // Lets CI/local smoke tests confirm the app boots without hanging around forever:
  // `electron . --smoke-test` opens both windows, then quits on its own after a few seconds.
  if (process.argv.includes('--smoke-test')) {
    createControlWindow();
    setTimeout(() => app.quit(), 4000);
  }
});

app.on('window-all-closed', () => {
  // Tray keeps the app resident even with no windows open - this is a background utility.
  if (process.platform !== 'darwin' && !tray) app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// --- IPC ---

ipcMain.handle('control:open', () => {
  createControlWindow();
});

ipcMain.handle('calibration:run', () => runCalibration());

// The Control Center enumerates/picks devices (it has more room for a proper UI), but the
// HUD window is the one holding the live microphone stream, so the selection is relayed.
ipcMain.handle('device:select', (_event, payload) => {
  hudWindow?.webContents.send('device:select', payload);
});

ipcMain.on('level:update', (_event, levels) => {
  if (controlWindow) controlWindow.webContents.send('level:update', levels);
});

ipcMain.on('status:update', (_event, status) => {
  lastStatus = status;
  if (controlWindow) controlWindow.webContents.send('status:update', status);
});

ipcMain.handle('status:get', () => lastStatus);

ipcMain.handle('hud:set-always-on-top', (_event, value) => {
  hudWindow?.setAlwaysOnTop(value, value ? 'screen-saver' : undefined);
});

ipcMain.handle('hud:resize', (_event, { width, height }) => {
  hudWindow?.setSize(Math.round(width), Math.round(height));
});

ipcMain.handle('app:quit', () => {
  app.quit();
});
