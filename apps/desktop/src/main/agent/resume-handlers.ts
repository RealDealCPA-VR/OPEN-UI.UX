import {
  agentRespondResumeRequestSchema,
  type AgentRespondResumeResponse,
} from '../../shared/agent-resume';
import { logger } from '../logger';
import { registerInvoke } from '../ipc/registry';
import { consumePendingResume } from './run-resume';
import { markStatus } from './run-store';

export function registerResumeHandlers(): void {
  registerInvoke('agent:respond-resume', agentRespondResumeRequestSchema, (req) => {
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
