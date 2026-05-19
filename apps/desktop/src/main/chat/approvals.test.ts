import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApprovalPolicies, ApprovalRequest } from '../../shared/approvals';
import { DEFAULT_TIER_POLICIES } from '../../shared/approvals';
import { ApprovalManager, effectivePolicy } from './approvals';

function makePolicies(overrides: Partial<ApprovalPolicies> = {}): ApprovalPolicies {
  return {
    tierDefaults: { ...DEFAULT_TIER_POLICIES, ...(overrides.tierDefaults ?? {}) },
    toolOverrides: { ...(overrides.toolOverrides ?? {}) },
  };
}

describe('effectivePolicy', () => {
  it('tool override wins over tier default', () => {
    const p = makePolicies({
      tierDefaults: { read: 'auto', write: 'prompt', execute: 'prompt', network: 'prompt' },
      toolOverrides: { write_file: 'deny' },
    });
    expect(effectivePolicy(p, 'write_file', 'write')).toBe('deny');
  });

  it('falls back to tier default when no override', () => {
    const p = makePolicies();
    expect(effectivePolicy(p, 'unknown', 'execute')).toBe('prompt');
    expect(effectivePolicy(p, 'unknown', 'read')).toBe('auto');
  });
});

describe('ApprovalManager', () => {
  let manager: ApprovalManager;
  let broadcasts: ApprovalRequest[];
  let stored: ApprovalPolicies;

  beforeEach(() => {
    broadcasts = [];
    stored = makePolicies();
    manager = new ApprovalManager(
      (req) => broadcasts.push(req),
      () => stored,
      (next) => {
        stored = next;
      },
    );
  });

  afterEach(() => {
    // ensure no stuck pending entries
    expect(manager.pendingCount()).toBe(0);
  });

  it('auto-allows when policy is auto (no broadcast)', async () => {
    const ac = new AbortController();
    const outcome = await manager.requestApproval({
      streamId: 's1',
      toolName: 'read_file',
      toolDescription: 'read',
      permissionTier: 'read',
      arguments: { path: 'x' },
      signal: ac.signal,
    });
    expect(outcome).toEqual({ decision: 'allow', source: 'policy' });
    expect(broadcasts).toHaveLength(0);
  });

  it('auto-denies when policy is deny (no broadcast)', async () => {
    stored = makePolicies({ tierDefaults: { ...DEFAULT_TIER_POLICIES, execute: 'deny' } });
    const ac = new AbortController();
    const outcome = await manager.requestApproval({
      streamId: 's1',
      toolName: 'run_shell',
      toolDescription: 'shell',
      permissionTier: 'execute',
      arguments: { command: 'ls' },
      signal: ac.signal,
    });
    expect(outcome).toEqual({ decision: 'deny', source: 'policy' });
    expect(broadcasts).toHaveLength(0);
  });

  it('prompts and resolves with user decision', async () => {
    const ac = new AbortController();
    const promise = manager.requestApproval({
      streamId: 's1',
      toolName: 'write_file',
      toolDescription: 'write',
      permissionTier: 'write',
      arguments: { path: 'x' },
      signal: ac.signal,
    });
    expect(broadcasts).toHaveLength(1);
    const requestId = broadcasts[0]!.requestId;
    manager.respond({ requestId, decision: 'allow', scope: 'once' });
    expect(await promise).toEqual({ decision: 'allow', source: 'prompt-once' });
  });

  it('prompt source reflects the scope the user picked', async () => {
    const ac = new AbortController();
    const promise = manager.requestApproval({
      streamId: 's1',
      toolName: 'write_file',
      toolDescription: 'write',
      permissionTier: 'write',
      arguments: { path: 'x' },
      signal: ac.signal,
    });
    manager.respond({ requestId: broadcasts[0]!.requestId, decision: 'allow', scope: 'always' });
    expect(await promise).toEqual({ decision: 'allow', source: 'prompt-always' });
  });

  it('session scope: subsequent calls for same tool/stream skip the prompt', async () => {
    const ac = new AbortController();
    const p1 = manager.requestApproval({
      streamId: 's1',
      toolName: 'write_file',
      toolDescription: 'write',
      permissionTier: 'write',
      arguments: { path: 'x' },
      signal: ac.signal,
    });
    manager.respond({ requestId: broadcasts[0]!.requestId, decision: 'allow', scope: 'session' });
    await p1;

    // Second call: no broadcast, returns immediately, source preserved as prompt-session
    broadcasts = [];
    const outcome2 = await manager.requestApproval({
      streamId: 's1',
      toolName: 'write_file',
      toolDescription: 'write',
      permissionTier: 'write',
      arguments: { path: 'y' },
      signal: ac.signal,
    });
    expect(outcome2).toEqual({ decision: 'allow', source: 'prompt-session' });
    expect(broadcasts).toHaveLength(0);

    // Different stream should still prompt
    const p3 = manager.requestApproval({
      streamId: 's2',
      toolName: 'write_file',
      toolDescription: 'write',
      permissionTier: 'write',
      arguments: { path: 'z' },
      signal: ac.signal,
    });
    expect(broadcasts).toHaveLength(1);
    manager.respond({ requestId: broadcasts[0]!.requestId, decision: 'deny', scope: 'once' });
    expect(await p3).toEqual({ decision: 'deny', source: 'prompt-once' });
  });

  it('always scope: writes tool override into policies', async () => {
    const ac = new AbortController();
    const promise = manager.requestApproval({
      streamId: 's1',
      toolName: 'write_file',
      toolDescription: 'write',
      permissionTier: 'write',
      arguments: { path: 'x' },
      signal: ac.signal,
    });
    manager.respond({ requestId: broadcasts[0]!.requestId, decision: 'allow', scope: 'always' });
    await promise;
    expect(stored.toolOverrides.write_file).toBe('auto');
  });

  it('abort rejects the pending request', async () => {
    const ac = new AbortController();
    const promise = manager.requestApproval({
      streamId: 's1',
      toolName: 'write_file',
      toolDescription: 'write',
      permissionTier: 'write',
      arguments: { path: 'x' },
      signal: ac.signal,
    });
    expect(broadcasts).toHaveLength(1);
    ac.abort();
    await expect(promise).rejects.toThrow(/abort/i);
  });

  it('clearSession drops session overrides and rejects pending requests', async () => {
    const ac = new AbortController();
    const promise = manager.requestApproval({
      streamId: 's1',
      toolName: 'write_file',
      toolDescription: 'write',
      permissionTier: 'write',
      arguments: { path: 'x' },
      signal: ac.signal,
    });
    expect(broadcasts).toHaveLength(1);
    manager.clearSession('s1');
    await expect(promise).rejects.toThrow();
  });
});
