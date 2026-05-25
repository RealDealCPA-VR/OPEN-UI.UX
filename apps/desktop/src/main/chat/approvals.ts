import { randomUUID } from 'node:crypto';
import type { PermissionTier } from '@opencodex/core';
import type {
  ApprovalDecision,
  ApprovalPolicies,
  ApprovalRequest,
  ApprovalResponse,
} from '../../shared/approvals';
import { DEFAULT_TIER_POLICIES } from '../../shared/approvals';

export interface RequestApprovalArgs {
  streamId: string;
  toolName: string;
  toolDescription: string;
  permissionTier: PermissionTier;
  arguments: unknown;
  signal: AbortSignal;
}

export type ApprovalSource = 'policy' | 'prompt-once' | 'prompt-session' | 'prompt-always';

export interface ApprovalOutcome {
  decision: ApprovalDecision;
  source: ApprovalSource;
}

export type ApprovalBroadcaster = (req: ApprovalRequest) => void;
export type PolicyReader = () => ApprovalPolicies;
export type PolicyWriter = (next: ApprovalPolicies) => void;

interface Pending {
  resolve: (outcome: ApprovalOutcome) => void;
  reject: (err: Error) => void;
  streamId: string;
  toolName: string;
  onAbort: () => void;
  signal: AbortSignal;
}

export type ReadOnlyChecker = () => boolean;

export class ApprovalManager {
  private pending = new Map<string, Pending>();
  private sessionOverrides = new Map<string, Map<string, ApprovalDecision>>();

  constructor(
    private broadcast: ApprovalBroadcaster,
    private readPolicies: PolicyReader,
    private writePolicies: PolicyWriter,
    private readReadOnly: ReadOnlyChecker = () => false,
  ) {}

  async requestApproval(args: RequestApprovalArgs): Promise<ApprovalOutcome> {
    if (this.readReadOnly() && args.permissionTier !== 'read') {
      return { decision: 'deny', source: 'policy' };
    }

    const sessionDecision = this.sessionOverrides.get(args.streamId)?.get(args.toolName);
    if (sessionDecision) return { decision: sessionDecision, source: 'prompt-session' };

    const policy = effectivePolicy(this.readPolicies(), args.toolName, args.permissionTier);
    if (policy === 'auto') return { decision: 'allow', source: 'policy' };
    if (policy === 'deny') return { decision: 'deny', source: 'policy' };

    if (args.signal.aborted) throw abortError();

    const requestId = randomUUID();
    return new Promise<ApprovalOutcome>((resolve, reject) => {
      const onAbort = () => {
        const entry = this.pending.get(requestId);
        if (!entry) return;
        this.pending.delete(requestId);
        entry.reject(abortError());
      };
      const pending: Pending = {
        resolve,
        reject,
        streamId: args.streamId,
        toolName: args.toolName,
        onAbort,
        signal: args.signal,
      };
      this.pending.set(requestId, pending);
      args.signal.addEventListener('abort', onAbort, { once: true });
      this.broadcast({
        requestId,
        streamId: args.streamId,
        toolName: args.toolName,
        toolDescription: args.toolDescription,
        permissionTier: args.permissionTier,
        arguments: args.arguments,
      });
    });
  }

  respond(response: ApprovalResponse): void {
    const entry = this.pending.get(response.requestId);
    if (!entry) return;
    this.pending.delete(response.requestId);
    entry.signal.removeEventListener('abort', entry.onAbort);

    if (response.scope === 'session') {
      this.setSessionOverride(entry.streamId, entry.toolName, response.decision);
    } else if (response.scope === 'always') {
      const policies = this.readPolicies();
      const next: ApprovalPolicies = {
        tierDefaults: policies.tierDefaults,
        toolOverrides: {
          ...policies.toolOverrides,
          [entry.toolName]: response.decision === 'allow' ? 'auto' : 'deny',
        },
      };
      this.writePolicies(next);
    }
    entry.resolve({ decision: response.decision, source: scopeToSource(response.scope) });
  }

  clearSession(streamId: string): void {
    this.sessionOverrides.delete(streamId);
    for (const [requestId, entry] of this.pending) {
      if (entry.streamId !== streamId) continue;
      this.pending.delete(requestId);
      entry.signal.removeEventListener('abort', entry.onAbort);
      entry.reject(new Error('chat stream ended before approval was decided'));
    }
  }

  pendingCount(): number {
    return this.pending.size;
  }

  private setSessionOverride(streamId: string, toolName: string, decision: ApprovalDecision): void {
    let map = this.sessionOverrides.get(streamId);
    if (!map) {
      map = new Map();
      this.sessionOverrides.set(streamId, map);
    }
    map.set(toolName, decision);
  }
}

export function effectivePolicy(
  policies: ApprovalPolicies,
  toolName: string,
  tier: PermissionTier,
): 'auto' | 'prompt' | 'deny' {
  return (
    policies.toolOverrides[toolName] ?? policies.tierDefaults[tier] ?? DEFAULT_TIER_POLICIES[tier]
  );
}

function scopeToSource(scope: ApprovalResponse['scope']): ApprovalSource {
  switch (scope) {
    case 'once':
      return 'prompt-once';
    case 'session':
      return 'prompt-session';
    case 'always':
      return 'prompt-always';
  }
}

function abortError(): Error {
  const err = new Error('approval request aborted');
  err.name = 'AbortError';
  return err;
}

let singleton: ApprovalManager | null = null;

export function getApprovalManager(): ApprovalManager {
  if (singleton) return singleton;
  throw new Error('approval manager not initialized — call initApprovalManager() first');
}

export function initApprovalManager(
  broadcast: ApprovalBroadcaster,
  readPolicies: PolicyReader,
  writePolicies: PolicyWriter,
  readReadOnly?: ReadOnlyChecker,
): ApprovalManager {
  singleton = new ApprovalManager(broadcast, readPolicies, writePolicies, readReadOnly);
  return singleton;
}

export function setApprovalManagerForTesting(instance: ApprovalManager | null): void {
  singleton = instance;
}
