import { logger } from '../logger';
import { listStreamingAssistantMessages, setTurnStatus } from '../storage/conversations';

export interface InterruptedTurn {
  conversationId: string;
  assistantMessageId: string;
}

let interruptedTurns: InterruptedTurn[] = [];

/**
 * Boot reconcile (model on agent/run-resume.ts). Reads every assistant row left
 * in turn_status='streaming' by a hard crash, flips it back to 'final' with its
 * partial content preserved verbatim, and records it so the renderer can surface
 * an "interrupted — response was cut off" affordance. Called at app.ready before
 * any windows load.
 */
export function reconcileInterruptedTurns(): void {
  let rows;
  try {
    rows = listStreamingAssistantMessages();
  } catch (err) {
    logger.warn({ err }, 'turn-restore: failed to load streaming rows');
    return;
  }

  interruptedTurns = [];
  for (const row of rows) {
    try {
      setTurnStatus(row.id, 'final');
      interruptedTurns.push({
        conversationId: row.conversationId,
        assistantMessageId: row.id,
      });
      logger.info(
        { conversationId: row.conversationId, assistantMessageId: row.id },
        'turn-restore: reconciled interrupted streaming turn',
      );
    } catch (err) {
      logger.warn(
        { err, assistantMessageId: row.id },
        'turn-restore: failed to reconcile streaming turn',
      );
    }
  }
}

export function listInterruptedTurns(): readonly InterruptedTurn[] {
  return interruptedTurns;
}

/**
 * Removes (and returns) the interrupted record for a conversation, if any. Used
 * by chat:reattach once the renderer has surfaced the banner.
 */
export function consumeInterruptedTurn(conversationId: string): InterruptedTurn | null {
  const idx = interruptedTurns.findIndex((t) => t.conversationId === conversationId);
  if (idx === -1) return null;
  const [removed] = interruptedTurns.splice(idx, 1);
  return removed ?? null;
}

/** Test-only helper. */
export function __resetForTests(): void {
  interruptedTurns = [];
}
