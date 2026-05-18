import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { logger } from './logger';
import { registerChatHandlers } from './chat/handlers';
import { registerInvoke } from './ipc/registry';
import { registerProviderHandlers } from './providers/handlers';
import { registerSelectedModelHandlers } from './selected-model/handlers';
import { openDb, closeDb } from './storage/db';
import { createTray, destroyTray } from './tray';
import { initAutoUpdater } from './updater';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROTOCOL = 'opencodex';

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [join(process.argv[1] ?? '')]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
let pendingDeepLink: string | null = null;

function extractDeepLink(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (arg.startsWith(`${PROTOCOL}://`)) return arg;
  }
  return null;
}

function deliverDeepLink(url: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send('app:deep-link', url);
  } else {
    pendingDeepLink = url;
  }
}

pendingDeepLink = extractDeepLink(process.argv);

app.on('second-instance', (_event, argv) => {
  const url = extractDeepLink(argv);
  if (url) deliverDeepLink(url);
  else if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  deliverDeepLink(url);
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
    if (pendingDeepLink) {
      const url = pendingDeepLink;
      pendingDeepLink = null;
      mainWindow?.webContents.send('app:deep-link', url);
    }
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  try {
    openDb();
  } catch (err) {
    logger.error({ err }, 'failed to open database');
  }

  registerIpcHandlers();
  createWindow();
  createTray(() => mainWindow);

  if (app.isPackaged) initAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  destroyTray();
  closeDb();
});

function registerIpcHandlers(): void {
  registerInvoke('app:version', z.void(), () => app.getVersion());
  registerProviderHandlers();
  registerSelectedModelHandlers();
  registerChatHandlers();
}
