import { z } from 'zod';
import { registerInvoke } from '../ipc/registry';
import { crashReportingSetConfigRequestSchema } from '../../shared/crash-reporting';
import { getCrashReportingConfig, updateCrashReportingConfig } from './manager';

export function registerCrashReportingHandlers(): void {
  registerInvoke('crash-reporting:get-config', z.void(), () => getCrashReportingConfig());
  registerInvoke(
    'crash-reporting:set-config',
    crashReportingSetConfigRequestSchema,
    async (req) => {
      const patch: { enabled?: boolean; dsn?: string; environment?: string } = {};
      if (req.enabled !== undefined) patch.enabled = req.enabled;
      if (req.dsn !== undefined) patch.dsn = req.dsn;
      if (req.environment !== undefined) patch.environment = req.environment;
      return updateCrashReportingConfig(patch);
    },
  );
}
