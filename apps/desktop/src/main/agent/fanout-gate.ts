import { randomUUID } from 'node:crypto';
import type { FanoutPlanTask } from '../../shared/agent-tree';
import {
  hasFanoutListeners,
  requestFanoutConsent,
  type RequestFanoutConsentOptions,
} from './fanout-consent';

export interface FanoutGateOutcome {
  allowed: boolean;
  /** Present when the user edited the task text before allowing. */
  editedTask?: string;
  /** Model-readable explanation when not allowed. */
  reason?: string;
}

export interface FanoutGateDeps {
  isAutoApproved(): Promise<boolean>;
  hasConsentListeners(): boolean;
  requestConsent(opts: RequestFanoutConsentOptions): ReturnType<typeof requestFanoutConsent>;
}

export interface FanoutGate {
  /**
   * Gate a spawn_subagent call. The first spawn for a given run key prompts
   * the user (unless policy auto-approves or no renderer is attached); once
   * allowed, subsequent spawns for the same key pass without re-prompting.
   */
  ensureConsent(runKey: object, task: FanoutPlanTask): Promise<FanoutGateOutcome>;
}

interface RunGateState {
  approved: boolean;
  inFlight: Promise<FanoutGateOutcome> | null;
}

export function createFanoutGate(deps: FanoutGateDeps): FanoutGate {
  // Keyed on the run's AbortSignal object identity: the chat runner creates one
  // AbortController per stream and threads the same signal into every tool call
  // of that run, so the signal is the narrowest per-parent-run handle available
  // to a tool without widening ToolContext in @opencodex/core. WeakMap entries
  // are reclaimed with the run's controller.
  const states = new WeakMap<object, RunGateState>();

  return {
    async ensureConsent(runKey, task) {
      let state = states.get(runKey);
      if (state?.approved) return { allowed: true };
      if (state?.inFlight) {
        // A concurrent spawn in the same run shares the pending decision but
        // must not adopt the other spawn's edited task text.
        const shared = await state.inFlight;
        return shared.allowed ? { allowed: true } : shared;
      }
      if (!state) {
        state = { approved: false, inFlight: null };
        states.set(runKey, state);
      }
      const inFlight = decide(deps, task);
      state.inFlight = inFlight;
      const outcome = await inFlight;
      state.inFlight = null;
      if (outcome.allowed) {
        state.approved = true;
      } else {
        // Drop denied state so a later, presumably revised, spawn re-prompts.
        states.delete(runKey);
      }
      return outcome;
    },
  };
}

async function decide(deps: FanoutGateDeps, task: FanoutPlanTask): Promise<FanoutGateOutcome> {
  if (await deps.isAutoApproved()) return { allowed: true };
  // Headless / no renderer attached: nothing can answer the consent IPC. The
  // modal flow's built-in fallback is auto-allow (autoAllowDelayMs), so mirror
  // that default rather than hanging the tool call forever.
  if (!deps.hasConsentListeners()) return { allowed: true };
  const { decision, editedPlan } = await deps.requestConsent({
    parentRunId: `fanout-${randomUUID()}`,
    plan: [task],
  });
  if (decision === 'deny') {
    return {
      allowed: false,
      reason: 'the user denied the fan-out consent request for this run',
    };
  }
  const editedTask = decision === 'edit' ? editedPlan?.[0]?.task : undefined;
  return { allowed: true, ...(editedTask !== undefined ? { editedTask } : {}) };
}

async function readAutoApprovedFromPolicies(): Promise<boolean> {
  // Dynamic imports keep this module loadable in unit tests without the
  // electron settings store; any failure falls back to prompting.
  try {
    const [settings, approvals] = await Promise.all([
      import('../storage/settings'),
      import('../chat/approvals'),
    ]);
    return (
      approvals.effectivePolicy(settings.getApprovalPolicies(), 'spawn_subagent', 'execute') ===
      'auto'
    );
  } catch {
    return false;
  }
}

export const fanoutGate: FanoutGate = createFanoutGate({
  isAutoApproved: readAutoApprovedFromPolicies,
  hasConsentListeners: hasFanoutListeners,
  requestConsent: requestFanoutConsent,
});
