import { app, BrowserWindow } from 'electron';
import { initCrash, type CrashClient } from '@opencodex/crash-reporting';
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
  const dsn = process.env['OPENCODEX_SENTRY_DSN']?.trim() || stored.dsn;
  return {
    enabled: stored.enabled,
    dsn,
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

export async function initCrashReporting(): Promise<void> {
  currentConfig = resolveConfig();
  try {
    client = await initCrash({
      enabled: currentConfig.enabled,
      dsn: currentConfig.dsn,
      environment: currentConfig.environment,
      release: app.getVersion(),
    });
    if (client.enabled) {
      logger.info('crash reporting enabled');
    }
  } catch (err) {
    logger.warn({ err }, 'failed to init crash reporting');
  }
}

export async function updateCrashReportingConfig(
  patch: Partial<CrashReportingSettings>,
): Promise<CrashReportingConfig> {
  const next = setCrashReportingSettings(patch);
  currentConfig = {
    enabled: next.enabled,
    dsn: process.env['OPENCODEX_SENTRY_DSN']?.trim() || next.dsn,
    environment: next.environment,
  };
  // We do not re-init on toggle within the same process — Sentry's main client
  // cannot be cleanly torn down. The new config takes effect on next launch.
  // For first-time enable, we install live so the user gets coverage from this moment.
  if (currentConfig.enabled && !client?.enabled) {
    try {
      client = await initCrash({
        enabled: currentConfig.enabled,
        dsn: currentConfig.dsn,
        environment: currentConfig.environment,
        release: app.getVersion(),
      });
    } catch (err) {
      logger.warn({ err }, 'failed to enable crash reporting');
    }
  }
  broadcastConfig();
  return currentConfig;
}
