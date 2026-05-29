import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join as pathJoin, join } from 'node:path';
import { z } from 'zod';
import { logger } from './logger';
import { registerAgentHandlers } from './agent/handlers';
import { registerAntiSycophancyHandlers } from './agent/anti-sycophancy-handlers';
import { registerResumeHandlers } from './agent/resume-handlers';
import { hydrateRunRegistryFromStore, promptResumeIfNeeded } from './agent/run-resume';
import { startRunStoreBridge, stopRunStoreBridge } from './agent/run-store-bridge';
import { runnerRegistry } from './agent/runner-registry-instance';
import { internalRunner } from './agent/subagent';
import { registerAgentTreeHandlers } from './agent/tree-handlers';
import { registerApprovalHandlers } from './chat/approval-handlers';
import { registerBudgetHandlers } from './chat/budget-handlers';
import { registerChatHandlers } from './chat/handlers';
import { registerProviderSwitchHandlers } from './chat/provider-switch-handlers';
import { registerReadOnlyChatHandlers } from './chat/read-only-handlers';
import { registerCodebaseHandlers } from './codebase/handlers';
import { registerConversationSearchHandlers } from './storage/conversation-search-handlers';
import { registerFileTreeHandlers } from './file-tree/handlers';
import { registerGitWorkflowHandlers } from './git/handlers';
import { registerInvoke } from './ipc/registry';
import { registerMcpExtraHandlers } from './mcp/extra-handlers';
import { registerMcpHandlers } from './mcp/handlers';
import { onMcpServerConnected, shutdownAllServers as shutdownAllMcpServers } from './mcp/manager';
import { registerLocalFsMemoryHandlers } from './memory/local-fs-handlers';
import { applyLocalFsBackend } from './memory/local-fs-runtime';
import { registerMemoryHandlers, startMemory, stopMemory } from './memory';
import { registerOllamaHandlers } from './ollama/handlers';
import { registerOnboardingHandlers } from './onboarding/handlers';
import { notifyPairWatcherBatch, registerPairHandlers } from './pair/handlers';
import { registerPluginHandlers } from './plugins/handlers';
import { shutdownAllPlugins } from './plugins/manager';
import { registerProviderHandlers } from './providers/handlers';
import {
  MultiWorkspaceIndexer,
  setActiveMultiWorkspaceIndexer,
} from './rag/multi-workspace-indexer';
import { setWatchedWorkspace, stopWatchedWorkspace } from './rag/watcher';
import { registerReplayHandlers } from './replay/handlers';
import { registerReviewHandlers } from './review/handlers';
import { registerRoutingHandlers } from './routing/handlers';
import {
  registerSchedulerHandlers,
  startSchedulerForApp,
  stopSchedulerForApp,
} from './scheduler/handlers';
import { registerNetworkPolicyHandlers } from './security/handlers';
import { registerSkillHandlers } from './skills/handlers';
import { startSkills, stopSkills } from './skills/manager';
import { registerSelectedModelHandlers } from './selected-model/handlers';
import { closeDb, getDb, openDb } from './storage/db';
import {
  getAuditRetentionDays,
  getAuditWormEnabled,
  getSchedulerEnabledInDev,
  getSettings,
  getTheme,
  settingsStore,
} from './storage/settings';
import { purgeToolCallsOlderThan } from './storage/tool-audit';
import { registerThemeHandlers } from './theme/handlers';
import { registerToolAuditHandlers } from './tool-audit/handlers';
import { initWormMirror } from './tool-audit/worm-mirror';
import { registerToolHandlers } from './tools/handlers';
import { bootstrapVoice, registerVoiceHandlers } from './voice/handlers';
import { unregisterPttShortcut } from './voice/global-shortcut';
import { registerMultiWorkspaceHandlers } from './workspace/multi-workspace-handlers';
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

async function reportToCrashClientIfEnabled(err: unknown, kind: string): Promise<void> {
  try {
    const mod = await import('@opencodex/crash-reporting');
    mod.captureException(err, { kind });
  } catch {
    // crash-reporting opt-out path — nothing to do
  }
}

process.on('unhandledRejection', (reason: unknown) => {
  logger.error({ reason }, 'unhandledRejection');
  void reportToCrashClientIfEnabled(reason, 'unhandledRejection');
});

process.on('uncaughtException', (err: Error) => {
  logger.error({ err }, 'uncaughtException');
  void reportToCrashClientIfEnabled(err, 'uncaughtException');
});

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
    mainWindow.webContents.openDevTools({ mode: 'right' });
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

  // Lane 12 — initialise WORM mirror once the user-data dir + setting exist.
  try {
    initWormMirror(getAuditWormEnabled(), app.getPath('userData'));
  } catch (err) {
    logger.warn({ err }, 'WORM mirror init failed');
  }

  // Lane 2 — hydrate persisted agent runs and start the store->registry bridge.
  try {
    hydrateRunRegistryFromStore();
    startRunStoreBridge();
  } catch (err) {
    logger.warn({ err }, 'run-store hydration failed');
  }

  try {
    runnerRegistry.register(internalRunner);
  } catch (err) {
    logger.warn({ err }, 'internalRunner registration failed');
  }

  registerIpcHandlers();
  initTelemetry();
  void initCrashReporting();
  void startMemory().catch((err: unknown) => {
    logger.warn({ err }, 'memory startup failed');
  });
  try {
    applyLocalFsBackend();
  } catch (err) {
    logger.warn({ err }, 'local-fs memory backend init failed');
  }
  createWindow();
  // Lane 13 — register global PTT shortcut once the window exists
  bootstrapVoice();
  createTray(() => mainWindow);

  // Lane 4 — start multi-workspace RAG indexer once the app is ready
  try {
    const indexer = new MultiWorkspaceIndexer({
      baseDir: pathJoin(app.getPath('userData'), 'rag'),
    });
    setActiveMultiWorkspaceIndexer(indexer);
    void indexer.start().catch((err: unknown) => {
      logger.warn({ err }, 'multi-workspace indexer start failed');
    });
  } catch (err) {
    logger.warn({ err }, 'multi-workspace indexer init failed');
  }

  // Lane 2 — defer resume prompt until renderer's webContents have loaded
  if (mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => promptResumeIfNeeded());
  } else {
    promptResumeIfNeeded();
  }

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

let beforeQuitRan = false;

app.on('before-quit', () => {
  if (beforeQuitRan) return;
  beforeQuitRan = true;
  destroyTray();
  shutdownAllPlugins();
  void shutdownAllMcpServers();
  void stopMemory();
  void stopWatchedWorkspace();
  void shutdownTelemetry();
  stopSchedulerForApp();
  void stopSkills();
  // Lane 2 — stop run-store bridge so we don't broadcast during shutdown.
  try {
    stopRunStoreBridge();
  } catch {
    // best-effort
  }
  // Lane 13 — release the global push-to-talk accelerator
  try {
    unregisterPttShortcut();
  } catch {
    // best-effort
  }
  // Lane 4 — stop multi-workspace indexer (best-effort)
  void (async () => {
    try {
      const mod = await import('./rag/multi-workspace-indexer');
      const idx = mod.getActiveMultiWorkspaceIndexer();
      if (idx) await idx.stop();
    } catch {
      // ignore — best-effort during shutdown
    }
  })();
  try {
    getDb().pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    logger.warn({ err }, 'wal_checkpoint on quit failed');
  }
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
  // Lane 15 — feed every watcher batch into the pair-suggestions engine.
  try {
    notifyPairWatcherBatch(batch);
  } catch (err) {
    logger.warn({ err }, 'pair suggestions failed to process watcher batch');
  }
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
  registerBudgetHandlers();
  registerProviderSwitchHandlers();
  registerReadOnlyChatHandlers();
  registerConversationSearchHandlers();
  registerFileTreeHandlers();
  registerGitWorkflowHandlers();
  registerMcpHandlers();
  registerMcpExtraHandlers();
  registerOnboardingHandlers();
  registerOllamaHandlers();
  registerPluginHandlers();
  registerAgentHandlers();
  registerAgentTreeHandlers();
  registerResumeHandlers();
  registerAntiSycophancyHandlers();
  registerCodebaseHandlers();
  registerTelemetryHandlers();
  registerCrashReportingHandlers();
  registerNetworkPolicyHandlers();
  registerUpdateHandlers();
  registerMemoryHandlers();
  registerLocalFsMemoryHandlers();
  registerMultiWorkspaceHandlers();
  registerPairHandlers();
  registerReplayHandlers();
  registerReviewHandlers();
  registerRoutingHandlers();
  registerSchedulerHandlers();
  registerSkillHandlers();
  registerVoiceHandlers();
}
