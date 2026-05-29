import type {
  FanoutConsentDecision,
  FanoutConsentRequestedEvent,
  FanoutPlanTask,
} from '../../shared/agent-tree';

interface PendingFanout {
  parentRunId: string;
  plan: FanoutPlanTask[];
  requestedAt: number;
  autoAllowDelayMs: number | null;
  resolve: (decision: { decision: FanoutConsentDecision; editedPlan?: FanoutPlanTask[] }) => void;
  autoAllowTimer: ReturnType<typeof setTimeout> | null;
}

type RequestedListener = (event: FanoutConsentRequestedEvent) => void;

const pending = new Map<string, PendingFanout>();
const listeners = new Set<RequestedListener>();

export function onFanoutRequested(listener: RequestedListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(event: FanoutConsentRequestedEvent): void {
  for (const l of listeners) l(event);
}

export interface RequestFanoutConsentOptions {
  parentRunId: string;
  plan: FanoutPlanTask[];
  autoAllowDelayMs?: number | null;
}

export function requestFanoutConsent(
  opts: RequestFanoutConsentOptions,
): Promise<{ decision: FanoutConsentDecision; editedPlan?: FanoutPlanTask[] }> {
  return new Promise((resolve) => {
    const requestedAt = Date.now();
    const autoAllowDelayMs = opts.autoAllowDelayMs ?? null;
    const entry: PendingFanout = {
      parentRunId: opts.parentRunId,
      plan: opts.plan,
      requestedAt,
      autoAllowDelayMs,
      resolve,
      autoAllowTimer: null,
    };
    if (autoAllowDelayMs !== null && autoAllowDelayMs > 0) {
      entry.autoAllowTimer = setTimeout(() => {
        const cur = pending.get(opts.parentRunId);
        if (cur === entry) {
          pending.delete(opts.parentRunId);
          resolve({ decision: 'allow' });
        }
      }, autoAllowDelayMs);
    }
    pending.set(opts.parentRunId, entry);
    emit({
      parentRunId: opts.parentRunId,
      plan: opts.plan,
      requestedAt,
      autoAllowDelayMs,
    });
  });
}

export function resolveFanoutConsent(
  parentRunId: string,
  decision: FanoutConsentDecision,
  editedPlan?: FanoutPlanTask[],
): { ok: boolean; error?: string } {
  const entry = pending.get(parentRunId);
  if (!entry) return { ok: false, error: 'no pending fan-out for this run' };
  pending.delete(parentRunId);
  if (entry.autoAllowTimer) clearTimeout(entry.autoAllowTimer);
  if (decision === 'edit' && editedPlan && editedPlan.length > 0) {
    entry.resolve({ decision, editedPlan });
  } else {
    entry.resolve({ decision });
  }
  return { ok: true };
}

export function listPendingFanouts(): FanoutConsentRequestedEvent[] {
  const out: FanoutConsentRequestedEvent[] = [];
  for (const entry of pending.values()) {
    out.push({
      parentRunId: entry.parentRunId,
      plan: entry.plan,
      requestedAt: entry.requestedAt,
      autoAllowDelayMs: entry.autoAllowDelayMs,
    });
  }
  return out;
}

export function __resetForTests(): void {
  for (const entry of pending.values()) {
    if (entry.autoAllowTimer) clearTimeout(entry.autoAllowTimer);
  }
  pending.clear();
  listeners.clear();
}
