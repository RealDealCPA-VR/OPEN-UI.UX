import { BrowserWindow } from 'electron';
import {
  anonymizeId as anonymizeIdInternal,
  createTelemetry,
  generateInstallSalt,
  type TelemetryClient,
  type TelemetryEventProps,
} from '@opencodex/telemetry';
import { logger } from '../logger';
import {
  getTelemetryInstallSalt,
  getTelemetrySettings,
  setTelemetryInstallSalt,
  setTelemetrySettings,
  type TelemetrySettings,
} from '../storage/settings';
import type { TelemetryConfig } from '../../shared/telemetry';

let client: TelemetryClient | null = null;
let currentConfig: TelemetryConfig | null = null;
let cachedSalt: string | null = null;

function ensureInstallSalt(): string {
  if (cachedSalt) return cachedSalt;
  const existing = getTelemetryInstallSalt();
  if (existing && existing.length > 0) {
    cachedSalt = existing;
    return existing;
  }
  const fresh = generateInstallSalt();
  setTelemetryInstallSalt(fresh);
  cachedSalt = fresh;
  return fresh;
}

function resolveConfig(): TelemetryConfig {
  const stored = getTelemetrySettings();
  return {
    enabled: stored.enabled,
    apiKey: stored.apiKey,
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
  const salt = ensureInstallSalt();
  const stored = getTelemetrySettings();
  client = createTelemetry({
    enabled: currentConfig.enabled,
    apiKey: currentConfig.apiKey,
    host: currentConfig.host,
    salt,
    ...(stored.allowedHosts.length > 0 ? { allowedHosts: stored.allowedHosts } : {}),
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
    apiKey: next.apiKey,
    host: next.host,
  };
  const salt = ensureInstallSalt();
  client = createTelemetry({
    enabled: currentConfig.enabled,
    apiKey: currentConfig.apiKey,
    host: currentConfig.host,
    salt,
    ...(next.allowedHosts.length > 0 ? { allowedHosts: next.allowedHosts } : {}),
  });
  broadcastConfig();
  return currentConfig;
}

export function track(event: string, props?: TelemetryEventProps, distinctId?: string): void {
  if (!client) return;
  client.track(event, props, distinctId);
}

export function anonymizeId(input: string): string {
  return anonymizeIdInternal(input, ensureInstallSalt());
}

export async function shutdownTelemetry(): Promise<void> {
  if (!client) return;
  const c = client;
  client = null;
  await c.shutdown();
}
