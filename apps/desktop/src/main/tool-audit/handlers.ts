import { join } from 'node:path';
import { app } from 'electron';
import { z } from 'zod';
import { TOOL_CALL_AUDIT_DECISIONS } from '../../shared/tool-audit';
import { registerInvoke } from '../ipc/registry';
import {
  getAuditRetentionDays,
  getAuditWormEnabled,
  setAuditRetentionDays,
  setAuditWormEnabledSetting,
} from '../storage/settings';
import { clearAllToolCalls, purgeToolCallsOlderThan, queryToolCalls } from '../storage/tool-audit';
import { exportAuditBundle } from './audit-export';
import { isWormEnabled, setWormEnabled } from './worm-mirror';

const decisionEnum = z.enum(
  TOOL_CALL_AUDIT_DECISIONS as [(typeof TOOL_CALL_AUDIT_DECISIONS)[number]],
);

const triggerSourceEnum = z.enum(['user', 'scheduled']);

const querySchema = z.object({
  toolNames: z.array(z.string().min(1)).optional(),
  decisions: z.array(decisionEnum).optional(),
  errorState: z.enum(['any', 'error', 'success']).optional(),
  since: z.string().min(1).nullable().optional(),
  until: z.string().min(1).nullable().optional(),
  limit: z.number().int().positive().max(500).optional(),
  offset: z.number().int().min(0).optional(),
  filePath: z.string().min(1).optional(),
  runnerIds: z.array(z.string().min(1)).optional(),
  triggerSource: triggerSourceEnum.optional(),
});

const exportRequestSchema = z.object({
  from: z.string().min(1).nullable().optional(),
  to: z.string().min(1).nullable().optional(),
  toolNames: z.array(z.string().min(1)).optional(),
  decisions: z.array(decisionEnum).optional(),
  errorState: z.enum(['any', 'error', 'success']).optional(),
  runnerIds: z.array(z.string().min(1)).optional(),
  triggerSource: triggerSourceEnum.optional(),
  filePath: z.string().min(1).optional(),
});

const setWormEnabledSchema = z.object({ enabled: z.boolean() });

const retentionSchema = z.object({
  retentionDays: z.number().int().min(1).max(36500).nullable(),
});

export function registerToolAuditHandlers(): void {
  registerInvoke('tool-audit:query', querySchema, (req) => queryToolCalls(req));

  registerInvoke('tool-audit:get-retention', z.void(), () => ({
    retentionDays: getAuditRetentionDays(),
  }));

  registerInvoke('tool-audit:set-retention', retentionSchema, (req) => {
    const retentionDays = setAuditRetentionDays(req.retentionDays);
    const { deletedCount } =
      retentionDays !== null ? purgeToolCallsOlderThan(retentionDays) : { deletedCount: 0 };
    return { retentionDays, deletedCount };
  });

  registerInvoke('tool-audit:clear', z.void(), () => clearAllToolCalls());

  registerInvoke('tool-audit:export-bundle', exportRequestSchema, async (req) => {
    const envelope = await exportAuditBundle(req);
    // Cast the envelope through unknown to match the shared ExportResult shape,
    // which intentionally leaves `entries` as `ReadonlyArray<unknown>` so the
    // renderer doesn't pull in the audit-verify package.
    return envelope as unknown as {
      bundle: {
        format: 'opencodex-audit-v1';
        generatedAt: string;
        deviceId: string;
        publicKey: string;
        entries: ReadonlyArray<unknown>;
      };
      signature: string;
    };
  });

  registerInvoke('tool-audit:get-worm', z.void(), () => ({
    enabled: getAuditWormEnabled() && isWormEnabled(),
    path: app.isReady() ? join(app.getPath('userData'), 'audit-worm.ndjson') : null,
    platformWarning:
      process.platform === 'win32'
        ? 'WORM file permissions cannot be enforced on Windows; rely on filesystem ACLs.'
        : null,
  }));

  registerInvoke('tool-audit:set-worm', setWormEnabledSchema, (req) => {
    const persisted = setAuditWormEnabledSetting(req.enabled);
    setWormEnabled(persisted);
    return {
      enabled: persisted && isWormEnabled(),
      path: app.isReady() ? join(app.getPath('userData'), 'audit-worm.ndjson') : null,
      platformWarning:
        process.platform === 'win32'
          ? 'WORM file permissions cannot be enforced on Windows; rely on filesystem ACLs.'
          : null,
    };
  });
}
