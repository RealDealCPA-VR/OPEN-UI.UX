import { BrowserWindow } from 'electron';
import {
  createTelemetry,
  type TelemetryClient,
  type TelemetryEventProps,
} from '@opencodex/telemetry';
import { logger } from '../logger';
import {
  getTelemetrySettings,
  setTelemetrySettings,
  type TelemetrySettings,
} from '../storage/settings';
import type { TelemetryConfig } from '../../shared/telemetry';

let client: TelemetryClient | null = null;
let currentConfig: TelemetryConfig | null = null;

function resolveConfig(): TelemetryConfig {
  const stored = getTelemetrySettings();
  const apiKey = process.env['OPENCODEX_TELEMETRY_KEY']?.trim() || stored.apiKey;
  return {
    enabled: stored.enabled,
    apiKey,
    host: stored.host,
  };
}

function broadcastConfig(): void {
  const config = getTelemetryConfig();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('telemetry:config-changed', { config });
    }
  }
}

export function getTelemetryConfig(): TelemetryConfig {
  return resolveConfig();
}

export function initTelemetry(): void {
  currentConfig = resolveConfig();
  client = createTelemetry({
    enabled: currentConfig.enabled,
    apiKey: currentConfig.apiKey,
    host: currentConfig.host,
  });
  if (client.enabled) {
    logger.info('telemetry enabled');
  }
}

export function updateTelemetryConfig(patch: Partial<TelemetrySettings>): TelemetryConfig {
  const next = setTelemetrySettings(patch);
  void shutdownTelemetry();
  currentConfig = {
    enabled: next.enabled,
    apiKey: process.env['OPENCODEX_TELEMETRY_KEY']?.trim() || next.apiKey,
    host: next.host,
  };
  client = createTelemetry({
    enabled: currentConfig.enabled,
    apiKey: currentConfig.apiKey,
    host: currentConfig.host,
  });
  broadcastConfig();
  return currentConfig;
}

export function track(event: string, props?: TelemetryEventProps): void {
  if (!client) return;
  client.track(event, props);
}

export async function shutdownTelemetry(): Promise<void> {
  if (!client) return;
  const c = client;
  client = null;
  await c.shutdown();
}
