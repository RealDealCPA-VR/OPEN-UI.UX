import { z } from 'zod';
import { registerInvoke } from '../ipc/registry';
import { telemetrySetConfigRequestSchema } from '../../shared/telemetry';
import { getTelemetryConfig, updateTelemetryConfig } from './manager';

export function registerTelemetryHandlers(): void {
  registerInvoke('telemetry:get-config', z.void(), () => getTelemetryConfig());
  registerInvoke('telemetry:set-config', telemetrySetConfigRequestSchema, (req) => {
    const patch: { enabled?: boolean; apiKey?: string; host?: string | null } = {};
    if (req.enabled !== undefined) patch.enabled = req.enabled;
    if (req.apiKey !== undefined) patch.apiKey = req.apiKey;
    if (req.host !== undefined) patch.host = req.host;
    return updateTelemetryConfig(patch);
  });
}
