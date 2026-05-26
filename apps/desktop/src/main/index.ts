import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { logger } from './logger';
import { registerAgentHandlers } from './agent/handlers';
import { registerApprovalHandlers } from './chat/approval-handlers';
import { registerChatHandlers } from './chat/handlers';
import { registerReadOnlyChatHandlers } from './chat/read-only-handlers';
import { registerCodebaseHandlers } from './codebase/handlers';
import { registerFileTreeHandlers } from './file-tree/handlers';
import { registerInvoke } from './ipc/registry';
import { registerMcpHandlers } from './mcp/handlers';
import { onMcpServerConnected, shutdownAllServers as shutdownAllMcpServers } from './mcp/manager';
import { registerMemoryHandlers, startMemory, stopMemory } from './memory';
import { registerOnboardingHandlers } from './onboarding/handlers';
import { registerPluginHandlers } from './plugins/handlers';
import { shutdownAllPlugins } from './plugins/manager';
import { registerProviderHandlers } from './providers/handlers';
import { setWatchedWorkspace, stopWatchedWorkspace } from './rag/watcher';
import {
  registerSchedulerHandlers,
  startSchedulerForApp,
  stopSchedulerForApp,
} from './scheduler/handlers';
import { registerSkillHandlers } from './skills/handlers';
import { startSkills, stopSkills } from './skills/manager';
import { registerSelectedModelHandlers } from './selected-model/handlers';
import { openDb, closeDb } from './storage/db';
import {
  getAuditRetentionDays,
  getSchedulerEnabledInDev,
  getSettings,
  getTheme,
  settingsStore,
} from './storage/settings';
import { purgeToolCallsOlderThan } from './storage/tool-audit';
import { registerThemeHandlers } from './theme/handlers';
import { registerToolAuditHandlers } from './tool-audit/handlers';
import { registerToolHandlers } from './tools/handlers';
import { resolveAppIconPath } from './app-icon';
import { createTray, destroyTray } from './tray';
import { initAutoUpdater, registerUpdateHandlers } from './updater';
import { registerWorkspaceHandlers } from './workspace/handlers';
import { initTelemetry, shutdownTelemetry, track } from './telemetry/manager';
import { registerTelemetryHandlers } from './telemetry/handlers';
import { initCrashReporting } from './crash/manager';
import { registerCrashReportingHandlers } from './crash/handlers';
import { INITIAL_THEME_ARG_PREFIX } from '../shared/theme';

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
  const initialTheme = getTheme();
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    icon: resolveAppIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`${INITIAL_THEME_ARG_PREFIX}${initialTheme}`],
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

  try {
    const retentionDays = getAuditRetentionDays();
    if (retentionDays !== null) {
      const { deletedCount } = purgeToolCallsOlderThan(retentionDays);
      if (deletedCount > 0) {
        logger.info({ retentionDays, deletedCount }, 'audit log retention purge');
      }
    }
  } catch (err) {
    logger.warn({ err }, 'audit log retention purge failed');
  }

  registerIpcHandlers();
  initTelemetry();
  void initCrashReporting();
  void startMemory().catch((err: unknown) => {
    logger.warn({ err }, 'memory startup failed');
  });
  createWindow();
  createTray(() => mainWindow);

  initWorkspaceWatcher();

  try {
    startSchedulerForApp({ enabledInDev: getSchedulerEnabledInDev() });
  } catch (err) {
    logger.warn({ err }, 'scheduler failed to start');
  }

  void startSkills().catch((err: unknown) => {
    logger.warn({ err }, 'skills startup failed');
  });

  if (app.isPackaged) initAutoUpdater();

  try {
    track('app.launched', { platform: process.platform, version: app.getVersion() });
  } catch {
    // never let telemetry block app startup
  }

  onMcpServerConnected((serverId) => {
    try {
      track('mcp.server_connected', { serverId });
    } catch {
      // ignore
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  destroyTray();
  shutdownAllPlugins();
  void shutdownAllMcpServers();
  void stopMemory();
  void stopWatchedWorkspace();
  void shutdownTelemetry();
  stopSchedulerForApp();
  void stopSkills();
  closeDb();
});

function handleWatcherBatch(batch: {
  added: string[];
  changed: string[];
  removed: string[];
}): void {
  logger.debug(
    {
      added: batch.added.length,
      changed: batch.changed.length,
      removed: batch.removed.length,
    },
    'workspace watcher batch',
  );
}

function initWorkspaceWatcher(): void {
  const applyRoot = (root: string | null): void => {
    void setWatchedWorkspace(root, handleWatcherBatch).catch((err: unknown) => {
      logger.warn({ err, root }, 'workspace watcher failed to start');
    });
  };

  applyRoot(getSettings().activeWorkspace);

  settingsStore.onDidChange('activeWorkspace', (next) => {
    applyRoot(typeof next === 'string' ? next : null);
  });
}

function registerIpcHandlers(): void {
  registerInvoke('app:version', z.void(), () => app.getVersion());
  registerProviderHandlers();
  registerSelectedModelHandlers();
  registerApprovalHandlers();
  registerToolHandlers();
  registerToolAuditHandlers();
  registerThemeHandlers();
  registerWorkspaceHandlers();
  registerChatHandlers();
  registerReadOnlyChatHandlers();
  registerFileTreeHandlers();
  registerMcpHandlers();
  registerOnboardingHandlers();
  registerPluginHandlers();
  registerAgentHandlers();
  registerCodebaseHandlers();
  registerTelemetryHandlers();
  registerCrashReportingHandlers();
  registerUpdateHandlers();
  registerMemoryHandlers();
  registerSchedulerHandlers();
  registerSkillHandlers();
}
