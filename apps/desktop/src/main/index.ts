import { app, BrowserWindow, dialog, nativeTheme, screen, session, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join as pathJoin, join } from 'node:path';
import { z } from 'zod';
import { logger } from './logger';
import { validateDeepLink as validateDeepLinkImpl } from './security/deep-link';
import {
  checkOutbound,
  onNetworkPolicyChanged,
  snapshotNetworkPolicy,
} from './security/network-policy';
import { registerAgentHandlers } from './agent/handlers';
import { registerAntiSycophancyHandlers } from './agent/anti-sycophancy-handlers';
import { registerResumeHandlers } from './agent/resume-handlers';
import { hydrateRunRegistryFromStore, promptResumeIfNeeded } from './agent/run-resume';
import { reconcileInterruptedTurns } from './chat/turn-restore';
import { startRunNotifier, stopRunNotifier } from './agent/run-notifier';
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
import { RoutingEmbeddingResolver } from './rag/embedding-resolver';
import { astAwareChunkFn, registerBundledGrammars, resolveGrammarDir } from './rag/ast-chunk';
import { registerReplayHandlers } from './replay/handlers';
import { registerCheckpointHandlers } from './checkpoints/handlers';
import { gc as gcCheckpoints } from './checkpoints/manager';
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
import { closeDb, getDb, openDb, UnsupportedSchemaVersionError } from './storage/db';
import {
  getAuditRetentionDays,
  getAuditWormEnabled,
  getSchedulerEnabledInDev,
  getSettings,
  getTheme,
  getWindowBounds,
  setWindowBounds,
  settingsStore,
} from './storage/settings';
import { resolveInitialWindowPlacement } from './storage/window-state';
import { purgeToolCallsOlderThan } from './storage/tool-audit';
import { registerThemeHandlers } from './theme/handlers';
import { registerToolAuditHandlers } from './tool-audit/handlers';
import { initWormMirror } from './tool-audit/worm-mirror';
import { registerToolHandlers } from './tools/handlers';
import { bootstrapVoice, registerVoiceHandlers } from './voice/handlers';
import { unregisterPttShortcut } from './voice/global-shortcut';
import { registerMultiWorkspaceHandlers } from './workspace/multi-workspace-handlers';
import { installSearchWorkspaceResolver } from './workspace/search-resolver';
import { installCodeGraphResolver } from './workspace/code-graph-resolver';
import { resolveAppIconPath } from './app-icon';
import { createTray, destroyTray } from './tray';
import { initAutoUpdater, registerUpdateHandlers } from './updater';
import { registerWindowChromeHandlers } from './window/window-chrome-handlers';
import { titleBarOverlayForPreference } from './window/titlebar-overlay';
import { registerWorkspaceHandlers } from './workspace/handlers';
import { initTelemetry, shutdownTelemetry, track } from './telemetry/manager';
import { registerTelemetryHandlers } from './telemetry/handlers';
import { initCrashReporting, shutdownCrashReporting } from './crash/manager';
import { registerCrashReportingHandlers } from './crash/handlers';
import { INITIAL_THEME_ARG_PREFIX } from '../shared/theme';

const __dirname = dirname(fileURLToPath(import.meta.url));

const requireFromHere = createRequire(import.meta.url);

// In dev there is no packaged resources dir; resolve the tree-sitter-wasms
// package's own `out/` so AST chunking runs without a packaging step. Returns
// '' (a non-existent path resolveGrammarDir skips) if the package is absent.
function devGrammarDir(): string {
  try {
    return pathJoin(dirname(requireFromHere.resolve('tree-sitter-wasms/package.json')), 'out');
  } catch {
    return '';
  }
}

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

function validateDeepLink(raw: string): string | null {
  return validateDeepLinkImpl(raw, PROTOCOL);
}

function extractDeepLink(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (arg.startsWith(`${PROTOCOL}://`)) {
      const validated = validateDeepLink(arg);
      if (validated) return validated;
    }
  }
  return null;
}

function deliverDeepLink(url: string): void {
  const validated = validateDeepLink(url);
  if (!validated) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send('app:deep-link', validated);
  } else {
    pendingDeepLink = validated;
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

function buildCsp(devMode: boolean): string {
  const connectSrc = devMode
    ? "connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:*"
    : "connect-src 'self'";
  const scriptSrc = devMode
    ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
    : "script-src 'self'";
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    connectSrc,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}

function installRendererSecurity(): void {
  const devMode = Boolean(process.env['ELECTRON_RENDERER_URL']);
  const csp = buildCsp(devMode);

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...(details.responseHeaders ?? {}) };
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-security-policy') delete headers[key];
    }
    headers['Content-Security-Policy'] = [csp];
    callback({ responseHeaders: headers });
  });

  session.defaultSession.setPermissionRequestHandler((_wc, _permission, deny) => {
    deny(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (details.url.startsWith('devtools://') || details.url.startsWith('chrome-extension://')) {
      callback({ cancel: false });
      return;
    }
    if (details.url.startsWith('file://') || details.url.startsWith('data:')) {
      callback({ cancel: false });
      return;
    }
    if (details.url.startsWith('blob:')) {
      callback({ cancel: false });
      return;
    }
    if (devMode && process.env['ELECTRON_RENDERER_URL']) {
      const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
      if (details.url.startsWith(rendererUrl)) {
        callback({ cancel: false });
        return;
      }
      try {
        const u = new URL(details.url);
        const r = new URL(rendererUrl);
        if (u.hostname === r.hostname && (u.protocol === 'ws:' || u.protocol === 'wss:')) {
          callback({ cancel: false });
          return;
        }
      } catch {
        // fall through to policy check
      }
    }
    const check = checkOutbound(details.url);
    if (!check.allowed) {
      logger.warn(
        { url: details.url, reason: check.reason },
        'outbound request blocked by network policy',
      );
      callback({ cancel: true });
      return;
    }
    callback({ cancel: false });
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, navigationUrl) => {
      const currentUrl = contents.getURL();
      try {
        const next = new URL(navigationUrl);
        if (currentUrl === '' || currentUrl === 'about:blank') {
          if (
            next.protocol === 'file:' ||
            (process.env['ELECTRON_RENDERER_URL'] &&
              navigationUrl.startsWith(process.env['ELECTRON_RENDERER_URL']))
          ) {
            return;
          }
        }
        const current = new URL(currentUrl);
        if (next.origin !== current.origin) {
          event.preventDefault();
          logger.warn(
            { from: currentUrl, to: navigationUrl },
            'blocked off-origin navigation in renderer',
          );
        }
      } catch {
        event.preventDefault();
        logger.warn({ navigationUrl }, 'blocked navigation: unparseable URL');
      }
    });

    contents.setWindowOpenHandler(({ url }) => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          void shell.openExternal(url);
        } else {
          logger.warn({ url, protocol: parsed.protocol }, 'blocked window.open with non-http URL');
        }
      } catch {
        logger.warn({ url }, 'blocked window.open with invalid URL');
      }
      return { action: 'deny' };
    });
  });
}

function warnIfPermissiveNetworkPolicy(): void {
  const policy = snapshotNetworkPolicy();
  if (!policy.localOnlyMode && policy.allowlist.length === 0) {
    logger.warn(
      'network policy is permissive: localOnlyMode=false and allowlist is empty — ' +
        'all outbound hosts are allowed. Set localOnlyMode or populate the allowlist in Settings → Privacy.',
    );
  }
}

const PERSIST_BOUNDS_DEBOUNCE_MS = 500;

function createWindow(): void {
  const initialTheme = getTheme();
  const placement = resolveInitialWindowPlacement(
    getWindowBounds(),
    screen.getAllDisplays().map((d) => d.workArea),
  );
  mainWindow = new BrowserWindow({
    width: placement.width,
    height: placement.height,
    ...(placement.x !== undefined && placement.y !== undefined
      ? { x: placement.x, y: placement.y }
      : {}),
    minWidth: 900,
    minHeight: 600,
    show: false,
    icon: resolveAppIconPath(),
    // Frameless chrome per platform for an edge-to-edge, Claude-like flat top:
    // macOS tucks the traffic lights into an inset titlebar; Windows hides the
    // frame and lets Electron draw native caption buttons over web content
    // (overlay colors follow the persisted theme, double-click-to-maximize
    // stays native); Linux drops the frame entirely and the renderer supplies
    // WindowControls wired to the window:* IPC handlers.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    ...(process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: titleBarOverlayForPreference(
            initialTheme,
            nativeTheme.shouldUseDarkColors,
          ),
        }
      : {}),
    ...(process.platform === 'linux' ? { frame: false } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`${INITIAL_THEME_ARG_PREFIX}${initialTheme}`],
    },
  });

  const win = mainWindow;
  let persistBoundsTimer: NodeJS.Timeout | null = null;
  const persistBounds = (): void => {
    if (win.isDestroyed()) return;
    try {
      const bounds = win.getNormalBounds();
      setWindowBounds({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        maximized: win.isMaximized(),
      });
    } catch (err) {
      logger.warn({ err }, 'failed to persist window bounds');
    }
  };
  const schedulePersistBounds = (): void => {
    if (persistBoundsTimer) clearTimeout(persistBoundsTimer);
    persistBoundsTimer = setTimeout(persistBounds, PERSIST_BOUNDS_DEBOUNCE_MS);
  };
  win.on('resize', schedulePersistBounds);
  win.on('move', schedulePersistBounds);
  win.on('close', () => {
    if (persistBoundsTimer) clearTimeout(persistBoundsTimer);
    persistBounds();
  });

  mainWindow.on('ready-to-show', () => {
    if (placement.maximized) mainWindow?.maximize();
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

function showNativeAbiMismatchDialog(rawMessage: string): void {
  const detail = rawMessage.split('\n').slice(0, 6).join('\n');
  dialog.showErrorBox(
    'OpenCodex — native module ABI mismatch',
    `OpenCodex's local database (better-sqlite3) was built for a different Node.js ABI ` +
      `than the Electron runtime that just loaded it. ` +
      `Run\n\n    pnpm rebuild-native\n\nfrom apps/desktop, then relaunch OpenCodex.\n\n` +
      `Underlying error:\n${detail}`,
  );
}

app.whenReady().then(() => {
  try {
    openDb();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'failed to open database');
    // Every storage-backed IPC handler depends on the db, so ANY open failure
    // is fatal — falling through would launch a zombie app with db = null.
    if (message.includes('NODE_MODULE_VERSION') || message.includes('ERR_DLOPEN_FAILED')) {
      showNativeAbiMismatchDialog(message);
    } else if (err instanceof UnsupportedSchemaVersionError) {
      dialog.showErrorBox('OpenCodex — database from a newer version', err.message);
    } else {
      dialog.showErrorBox(
        'OpenCodex — failed to open local database',
        `OpenCodex could not open its local database and cannot start.\n\n` +
          `The database file may be corrupted or locked by another process.\n\n` +
          `Underlying error:\n${message}`,
      );
    }
    app.exit(1);
    return;
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

  // Unified checkpoint manager — retention + orphan-blob GC once at startup.
  void gcCheckpoints()
    .then((res) => {
      if (res.deletedCheckpoints > 0 || res.removedBlobs > 0) {
        logger.info(res, 'checkpoint gc at startup');
      }
    })
    .catch((err) => logger.warn({ err }, 'checkpoint gc at startup failed'));

  // Lane 2 — hydrate persisted agent runs and start the store->registry bridge.
  try {
    hydrateRunRegistryFromStore();
    startRunStoreBridge();
    startRunNotifier();
  } catch (err) {
    logger.warn({ err }, 'run-store hydration failed');
  }

  // Crash-restore — flip any assistant rows left mid-stream by a hard crash back
  // to 'final' (content preserved) and record them for an interrupted+Retry
  // affordance. Runs before windows load, alongside run-registry hydration.
  try {
    reconcileInterruptedTurns();
  } catch (err) {
    logger.warn({ err }, 'chat turn reconcile failed');
  }

  try {
    runnerRegistry.register(internalRunner);
  } catch (err) {
    logger.warn({ err }, 'internalRunner registration failed');
  }

  registerIpcHandlers();
  installRendererSecurity();
  warnIfPermissiveNetworkPolicy();
  onNetworkPolicyChanged(() => warnIfPermissiveNetworkPolicy());
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
    // Register any bundled tree-sitter grammars so the indexer can chunk along
    // AST symbol boundaries; absent assets degrade to size-based chunking.
    const resourcesBase = process.resourcesPath ?? app.getAppPath();
    const grammarDir = resolveGrammarDir([pathJoin(resourcesBase, 'tree-sitter'), devGrammarDir()]);
    if (grammarDir) registerBundledGrammars(grammarDir);
    const indexer = new MultiWorkspaceIndexer({
      baseDir: pathJoin(app.getPath('userData'), 'rag'),
      embeddingResolver: new RoutingEmbeddingResolver(),
      chunkFn: astAwareChunkFn,
      getDb,
    });
    setActiveMultiWorkspaceIndexer(indexer);
    void indexer.start().catch((err: unknown) => {
      logger.warn({ err }, 'multi-workspace indexer start failed');
    });
  } catch (err) {
    logger.warn({ err }, 'multi-workspace indexer init failed');
  }

  // Phase 14 tier2 — let search_codebase fan out across registered workspaces
  // and surface cross-workspace import follow-ups.
  try {
    installSearchWorkspaceResolver();
  } catch (err) {
    logger.warn({ err }, 'search workspace resolver install failed');
  }

  // Wire query_code_graph to the per-workspace persisted code graph.
  try {
    installCodeGraphResolver();
  } catch (err) {
    logger.warn({ err }, 'code graph resolver install failed');
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
  void shutdownCrashReporting();
  stopSchedulerForApp();
  void stopSkills();
  // Lane 2 — stop run-store bridge so we don't broadcast during shutdown.
  try {
    stopRunStoreBridge();
    stopRunNotifier();
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
    // Re-register local-fs memory tools against the new workspace so the agent's
    // memory_local_read/search/append tools point at the current workspace's memory.md.
    try {
      applyLocalFsBackend();
    } catch (err) {
      logger.warn({ err }, 'local-fs memory backend re-init on workspace switch failed');
    }
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
  registerCheckpointHandlers();
  registerReviewHandlers();
  registerRoutingHandlers();
  registerSchedulerHandlers();
  registerSkillHandlers();
  registerVoiceHandlers();
  registerWindowChromeHandlers();
}
