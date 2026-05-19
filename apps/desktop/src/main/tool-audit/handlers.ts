import { z } from 'zod';
import { TOOL_CALL_AUDIT_DECISIONS } from '../../shared/tool-audit';
import { registerInvoke } from '../ipc/registry';
import { getAuditRetentionDays, setAuditRetentionDays } from '../storage/settings';
import { clearAllToolCalls, purgeToolCallsOlderThan, queryToolCalls } from '../storage/tool-audit';

const decisionEnum = z.enum(
  TOOL_CALL_AUDIT_DECISIONS as [(typeof TOOL_CALL_AUDIT_DECISIONS)[number]],
);

const querySchema = z.object({
  toolNames: z.array(z.string().min(1)).optional(),
  decisions: z.array(decisionEnum).optional(),
  errorState: z.enum(['any', 'error', 'success']).optional(),
  since: z.string().min(1).nullable().optional(),
  until: z.string().min(1).nullable().optional(),
  limit: z.number().int().positive().max(500).optional(),
  offset: z.number().int().min(0).optional(),
});

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
}
