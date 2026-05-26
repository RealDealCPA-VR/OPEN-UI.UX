import { app, BrowserWindow } from 'electron';
import pkg from 'electron-updater';
import { z } from 'zod';
import { logger } from './logger';
import { registerInvoke } from './ipc/registry';
import { getAutoCheckForUpdates, setAutoCheckForUpdates, settingsStore } from './storage/settings';
import type { UpdateStatus, UpdatesCheckResult } from '../shared/updates';

const AUTO_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const AUTO_CHECK_STARTUP_DELAY_MS = 30 * 1000;

let initialized = false;
let listenersAttached = false;
let autoCheckTimer: ReturnType<typeof setTimeout> | null = null;
let autoCheckStartupTimer: ReturnType<typeof setTimeout> | null = null;

let currentStatus: UpdateStatus = {
  state: 'idle',
  version: null,
  percent: null,
  error: null,
  autoCheckEnabled: false,
};

function getAutoUpdater() {
  return pkg.autoUpdater;
}

function setStatus(patch: Partial<UpdateStatus>): void {
  currentStatus = {
    ...currentStatus,
    ...patch,
    autoCheckEnabled: getAutoCheckForUpdates(),
  };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('updates:status-changed', currentStatus);
    }
  }
}

function attachListeners(): void {
  if (listenersAttached) return;
  const autoUpdater = getAutoUpdater();
  autoUpdater.logger = logger;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => {
    logger.info({ version: info.version }, 'update available');
    setStatus({ state: 'available', version: info.version, error: null });
  });
  autoUpdater.on('update-not-available', (info) => {
    setStatus({ state: 'not-available', version: info?.version ?? null });
  });
  autoUpdater.on('download-progress', (p) => {
    setStatus({ state: 'downloading', percent: Math.round(p.percent ?? 0) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    logger.info({ version: info.version }, 'update downloaded');
    setStatus({ state: 'downloaded', version: info.version, percent: 100 });
  });
  autoUpdater.on('error', (err) => {
    logger.error({ err }, 'auto-updater error');
    setStatus({ state: 'error', error: err.message });
  });

  listenersAttached = true;
}

export function initAutoUpdater(): void {
  if (initialized) return;
  initialized = true;
  attachListeners();
  startAutoCheckLoop();
  settingsStore.onDidChange('autoCheckForUpdates', (next) => {
    setStatus({}); // refresh autoCheckEnabled
    if (next === true) startAutoCheckLoop();
    else stopAutoCheckLoop();
  });
}

export function startAutoCheckLoop(): void {
  if (!getAutoCheckForUpdates()) return;
  if (!app.isPackaged) return;
  stopAutoCheckLoop();
  autoCheckStartupTimer = setTimeout(() => {
    void runAutoCheck();
    autoCheckTimer = setInterval(() => void runAutoCheck(), AUTO_CHECK_INTERVAL_MS);
  }, AUTO_CHECK_STARTUP_DELAY_MS);
}

export function stopAutoCheckLoop(): void {
  if (autoCheckStartupTimer) {
    clearTimeout(autoCheckStartupTimer);
    autoCheckStartupTimer = null;
  }
  if (autoCheckTimer) {
    clearInterval(autoCheckTimer);
    autoCheckTimer = null;
  }
}

async function runAutoCheck(): Promise<void> {
  try {
    await getAutoUpdater().checkForUpdates();
  } catch (err) {
    logger.warn({ err }, 'auto update check failed');
  }
}

export async function checkForUpdates(): Promise<UpdatesCheckResult> {
  if (!app.isPackaged) {
    return {
      ok: false,
      state: 'error',
      version: null,
      error: 'Updates are only available in packaged builds.',
    };
  }
  attachListeners();
  try {
    setStatus({ state: 'checking', error: null });
    const result = await getAutoUpdater().checkForUpdates();
    const version = result?.updateInfo?.version ?? null;
    return {
      ok: true,
      state: currentStatus.state,
      version,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus({ state: 'error', error: message });
    return { ok: false, state: 'error', version: null, error: message };
  }
}

export async function downloadUpdate(): Promise<void> {
  attachListeners();
  await getAutoUpdater().downloadUpdate();
}

export function quitAndInstall(): void {
  getAutoUpdater().quitAndInstall();
}

export function getStatus(): UpdateStatus {
  return { ...currentStatus, autoCheckEnabled: getAutoCheckForUpdates() };
}

export function registerUpdateHandlers(): void {
  registerInvoke('updates:check', z.void(), () => checkForUpdates());
  registerInvoke('updates:download', z.void(), async () => {
    await downloadUpdate();
  });
  registerInvoke('updates:quit-and-install', z.void(), () => {
    quitAndInstall();
  });
  registerInvoke('updates:get-status', z.void(), () => getStatus());
  registerInvoke('updates:set-auto-check', z.object({ enabled: z.boolean() }), ({ enabled }) => {
    const value = setAutoCheckForUpdates(enabled);
    return { enabled: value };
  });
}
