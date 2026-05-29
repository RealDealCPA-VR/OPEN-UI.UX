import { ipcMain } from 'electron';
import {
  agentRespondResumeChannel,
  agentRespondResumeRequestSchema,
  type AgentRespondResumeResponse,
} from '../../shared/agent-resume';
import { logger } from '../logger';
import { consumePendingResume } from './run-resume';
import { markStatus } from './run-store';

export function registerResumeHandlers(): void {
  ipcMain.handle(agentRespondResumeChannel, async (_event, raw: unknown) => {
    const parsed = agentRespondResumeRequestSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn(
        { channel: agentRespondResumeChannel, issues: parsed.error.issues },
        'invalid IPC request',
      );
      throw new Error(`invalid request for ${agentRespondResumeChannel}: ${parsed.error.message}`);
    }
    const req = parsed.data;
    try {
      const wasPending = consumePendingResume(req.runId);
      if (req.decision === 'discard') {
        markStatus(req.runId, 'failed', 'runner_error', Date.now());
      } else if (!wasPending) {
        logger.info({ runId: req.runId }, 'resume requested for unknown pending id');
      }
      return { ok: true } satisfies AgentRespondResumeResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message } satisfies AgentRespondResumeResponse;
    }
  });
}
