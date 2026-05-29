import { app, BrowserWindow } from 'electron';
import { closeCrash, initCrash, type CrashClient } from '@opencodex/crash-reporting';
import { logger } from '../logger';
import {
  getCrashReportingSettings,
  setCrashReportingSettings,
  type CrashReportingSettings,
} from '../storage/settings';
import type { CrashReportingConfig } from '../../shared/crash-reporting';

let client: CrashClient | null = null;
let currentConfig: CrashReportingConfig | null = null;

function resolveConfig(): CrashReportingConfig {
  const stored = getCrashReportingSettings();
  return {
    enabled: stored.enabled,
    dsn: stored.dsn,
    environment: stored.environment,
  };
}

function broadcastConfig(): void {
  const config = getCrashReportingConfig();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('crash-reporting:config-changed', { config });
    }
  }
}

export function getCrashReportingConfig(): CrashReportingConfig {
  return resolveConfig();
}

async function installClient(config: CrashReportingConfig): Promise<CrashClient | null> {
  const stored = getCrashReportingSettings();
  try {
    const next = await initCrash({
      enabled: config.enabled,
      dsn: config.dsn,
      environment: config.environment,
      release: app.getVersion(),
      ...(stored.allowedHosts.length > 0 ? { allowedHosts: stored.allowedHosts } : {}),
    });
    return next;
  } catch (err) {
    logger.warn({ err }, 'failed to init crash reporting');
    return null;
  }
}

async function teardownClient(): Promise<void> {
  if (!client) return;
  client = null;
  try {
    await closeCrash();
  } catch (err) {
    logger.warn({ err }, 'failed to close crash reporting');
  }
}

export async function initCrashReporting(): Promise<void> {
  currentConfig = resolveConfig();
  const next = await installClient(currentConfig);
  client = next;
  if (next?.enabled) {
    logger.info('crash reporting enabled');
  }
}

export async function updateCrashReportingConfig(
  patch: Partial<CrashReportingSettings>,
): Promise<CrashReportingConfig> {
  const next = setCrashReportingSettings(patch);
  const nextConfig: CrashReportingConfig = {
    enabled: next.enabled,
    dsn: next.dsn,
    environment: next.environment,
  };

  const wasEnabled = client?.enabled === true;
  const willBeEnabled = nextConfig.enabled && nextConfig.dsn.trim().length > 0;

  if (wasEnabled && !willBeEnabled) {
    await teardownClient();
  } else if (!wasEnabled && willBeEnabled) {
    const installed = await installClient(nextConfig);
    client = installed;
  } else if (wasEnabled && willBeEnabled) {
    await teardownClient();
    const installed = await installClient(nextConfig);
    client = installed;
  }

  currentConfig = nextConfig;
  broadcastConfig();
  return currentConfig;
}

export async function shutdownCrashReporting(): Promise<void> {
  await teardownClient();
}
