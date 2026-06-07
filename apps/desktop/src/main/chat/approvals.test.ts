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

  it('carries a partial override on allow and resolves with prompt-once source', async () => {
    const ac = new AbortController();
    const promise = manager.requestApproval({
      streamId: 's1',
      toolName: 'edit_file',
      toolDescription: 'edit',
      permissionTier: 'write',
      arguments: { path: 'x', oldString: 'a', newString: 'b' },
      signal: ac.signal,
    });
    manager.respond({
      requestId: broadcasts[0]!.requestId,
      decision: 'allow',
      scope: 'once',
      override: { toolName: 'write_file', arguments: { path: 'x', content: 'final' } },
    });
    expect(await promise).toEqual({
      decision: 'allow',
      source: 'prompt-once',
      override: { toolName: 'write_file', arguments: { path: 'x', content: 'final' } },
    });
  });

  it('override + session scope MUST NOT cache a session override', async () => {
    const ac = new AbortController();
    const p1 = manager.requestApproval({
      streamId: 's1',
      toolName: 'edit_file',
      toolDescription: 'edit',
      permissionTier: 'write',
      arguments: { path: 'x', oldString: 'a', newString: 'b' },
      signal: ac.signal,
    });
    manager.respond({
      requestId: broadcasts[0]!.requestId,
      decision: 'allow',
      scope: 'session',
      override: { toolName: 'write_file', arguments: { path: 'x', content: 'final' } },
    });
    await p1;

    // A subsequent same-tool/same-stream call must still PROMPT — the partial
    // was never cached as a session override.
    broadcasts = [];
    const p2 = manager.requestApproval({
      streamId: 's1',
      toolName: 'edit_file',
      toolDescription: 'edit',
      permissionTier: 'write',
      arguments: { path: 'y', oldString: 'a', newString: 'b' },
      signal: ac.signal,
    });
    expect(broadcasts).toHaveLength(1);
    manager.respond({ requestId: broadcasts[0]!.requestId, decision: 'deny', scope: 'once' });
    await p2;
  });

  it('override + always scope MUST NOT write a tool policy', async () => {
    const ac = new AbortController();
    const promise = manager.requestApproval({
      streamId: 's1',
      toolName: 'edit_file',
      toolDescription: 'edit',
      permissionTier: 'write',
      arguments: { path: 'x', oldString: 'a', newString: 'b' },
      signal: ac.signal,
    });
    manager.respond({
      requestId: broadcasts[0]!.requestId,
      decision: 'allow',
      scope: 'always',
      override: { toolName: 'write_file', arguments: { path: 'x', content: 'final' } },
    });
    await promise;
    expect(stored.toolOverrides.edit_file).toBeUndefined();
    expect(stored.toolOverrides.write_file).toBeUndefined();
  });

  it('ignores an override on a deny decision', async () => {
    const ac = new AbortController();
    const promise = manager.requestApproval({
      streamId: 's1',
      toolName: 'edit_file',
      toolDescription: 'edit',
      permissionTier: 'write',
      arguments: { path: 'x', oldString: 'a', newString: 'b' },
      signal: ac.signal,
    });
    manager.respond({
      requestId: broadcasts[0]!.requestId,
      decision: 'deny',
      scope: 'once',
      override: { toolName: 'write_file', arguments: { path: 'x', content: 'final' } },
    });
    const outcome = await promise;
    expect(outcome.decision).toBe('deny');
    expect(outcome.override).toBeUndefined();
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
