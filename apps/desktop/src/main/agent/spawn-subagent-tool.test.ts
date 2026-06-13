import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@opencodex/core';
import { DEFAULT_TIER_POLICIES, type ApprovalPolicies } from '../../shared/approvals';
import type { FanoutConsentRequestedEvent } from '../../shared/agent-tree';
import {
  __resetForTests as resetFanoutConsent,
  onFanoutRequested,
  resolveFanoutConsent,
} from './fanout-consent';
import { spawnSubagentTool } from './spawn-subagent-tool';

const mocks = vi.hoisted(() => ({
  runSubagentInline: vi.fn(),
  getApprovalPolicies: vi.fn(),
}));

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('./worker-host', () => ({
  isUtilityProcessAvailable: vi.fn(async () => false),
  runSubagentInWorker: vi.fn(),
  runSubagentInline: mocks.runSubagentInline,
}));

vi.mock('../telemetry/manager', () => ({
  track: vi.fn(),
  anonymizeId: vi.fn(async (s: string) => s),
}));

vi.mock('../storage/settings', () => ({
  getApprovalPolicies: mocks.getApprovalPolicies,
}));

function promptPolicies(overrides: Partial<ApprovalPolicies> = {}): ApprovalPolicies {
  return {
    tierDefaults: DEFAULT_TIER_POLICIES,
    toolOverrides: {},
    ...overrides,
  };
}

function makeCtx(): ToolContext {
  return {
    workspaceRoot: 'C:\\tmp\\ws',
    signal: new AbortController().signal,
    logger: { info: vi.fn(), error: vi.fn() },
  };
}

function makeInput(task = 'summarize the changelog') {
  return {
    task,
    providerId: 'openai',
    modelId: 'gpt-4o-mini',
    maxToolIterations: 6,
  };
}

const subagentResult = {
  text: 'sub done',
  toolEvents: [],
  inputTokens: 10,
  outputTokens: 5,
  stopReason: 'end_turn' as const,
  iterations: 1,
};

describe('spawnSubagentTool fan-out consent gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFanoutConsent();
    mocks.runSubagentInline.mockResolvedValue(subagentResult);
    mocks.getApprovalPolicies.mockReturnValue(promptPolicies());
  });

  function answerConsent(
    decision: 'allow' | 'deny',
    onRequest?: (event: FanoutConsentRequestedEvent) => void,
  ): FanoutConsentRequestedEvent[] {
    const seen: FanoutConsentRequestedEvent[] = [];
    onFanoutRequested((event) => {
      seen.push(event);
      onRequest?.(event);
      resolveFanoutConsent(event.parentRunId, decision);
    });
    return seen;
  }

  it('gates the first spawn in a run and proceeds on allow', async () => {
    const seen = answerConsent('allow');
    const ctx = makeCtx();

    const result = await spawnSubagentTool.execute(makeInput('audit pkg a'), ctx);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.plan).toEqual([
      { task: 'audit pkg a', runnerId: 'internal', modelId: 'gpt-4o-mini' },
    ]);
    expect(mocks.runSubagentInline).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ summary: 'sub done', stopReason: 'end_turn' });
  });

  it('does not re-prompt for the second spawn in the same approved run', async () => {
    const seen = answerConsent('allow');
    const ctx = makeCtx();

    await spawnSubagentTool.execute(makeInput('first'), ctx);
    await spawnSubagentTool.execute(makeInput('second'), ctx);

    expect(seen).toHaveLength(1);
    expect(mocks.runSubagentInline).toHaveBeenCalledTimes(2);
  });

  it('prompts again for a different parent run (new signal)', async () => {
    const seen = answerConsent('allow');

    await spawnSubagentTool.execute(makeInput(), makeCtx());
    await spawnSubagentTool.execute(makeInput(), makeCtx());

    expect(seen).toHaveLength(2);
  });

  it('denial fails the tool call with a model-readable error and skips the spawn', async () => {
    answerConsent('deny');

    await expect(spawnSubagentTool.execute(makeInput(), makeCtx())).rejects.toThrow(
      /spawn_subagent denied: .*denied.*Do not retry spawn_subagent/s,
    );
    expect(mocks.runSubagentInline).not.toHaveBeenCalled();
  });

  it('runs the edited task when the user edits before allowing', async () => {
    onFanoutRequested((event) => {
      resolveFanoutConsent(event.parentRunId, 'edit', [{ task: 'edited task' }]);
    });

    await spawnSubagentTool.execute(makeInput('original task'), makeCtx());

    expect(mocks.runSubagentInline).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'edited task' }),
    );
  });

  it('falls back to allow when no renderer listener is attached (headless/test path)', async () => {
    const result = await spawnSubagentTool.execute(makeInput(), makeCtx());

    expect(mocks.runSubagentInline).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ summary: 'sub done' });
  });

  it('skips the prompt when approval policy auto-approves spawn_subagent', async () => {
    mocks.getApprovalPolicies.mockReturnValue(
      promptPolicies({ toolOverrides: { spawn_subagent: 'auto' } }),
    );
    const seen = answerConsent('deny');

    const result = await spawnSubagentTool.execute(makeInput(), makeCtx());

    expect(seen).toHaveLength(0);
    expect(result).toMatchObject({ summary: 'sub done' });
  });
});
