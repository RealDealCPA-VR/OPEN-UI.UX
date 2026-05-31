import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent, SubagentRunner } from '@opencodex/core';
import { abortSpawnedRun, spawnFromUiAsync } from './spawn-from-ui';
import { __resetForTests, listRuns as listAgentRuns } from './run-registry';
import { runnerRegistry } from './runner-registry-instance';

vi.mock('./worktrees', () => ({
  isGitRepo: vi.fn(async () => false),
  createWorktree: vi.fn(),
}));

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

interface FakeRunnerOptions {
  events?: ChatEvent[];
  onAbort?: () => void;
  delayMs?: number;
}

function makeFakeRunner(id: string, opts: FakeRunnerOptions = {}): SubagentRunner {
  const events = opts.events ?? [
    { type: 'text_delta', delta: 'fake' },
    { type: 'usage', inputTokens: 1, outputTokens: 2 },
    { type: 'done', stopReason: 'end_turn' },
  ];
  return {
    id,
    displayName: `Fake ${id}`,
    streaming: true,
    async *run(runOpts) {
      for (const e of events) {
        if (runOpts.signal?.aborted) {
          opts.onAbort?.();
          yield { type: 'error', message: 'aborted', retryable: false };
          yield { type: 'done', stopReason: 'error' };
          return;
        }
        if (opts.delayMs) {
          await new Promise<void>((resolve) => setTimeout(resolve, opts.delayMs));
        }
        yield e;
      }
    },
  };
}

async function waitForCompletion(runId: string, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = listAgentRuns().find((r) => r.id === runId);
    if (run && run.status !== 'running') return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`run ${runId} did not complete in ${timeoutMs}ms`);
}

const registeredIds: string[] = [];
function registerForTest(runner: SubagentRunner): void {
  if (runnerRegistry.has(runner.id)) runnerRegistry.unregister(runner.id);
  runnerRegistry.register(runner);
  registeredIds.push(runner.id);
}

describe('spawn-from-ui (basic)', () => {
  it('returns false for unknown run ids on abort', () => {
    expect(abortSpawnedRun('does-not-exist')).toBe(false);
  });
});

describe('spawnFromUiAsync — runner wiring', () => {
  beforeEach(() => {
    __resetForTests();
  });

  afterEach(() => {
    for (const id of registeredIds.splice(0)) {
      runnerRegistry.unregister(id);
    }
    __resetForTests();
    vi.clearAllMocks();
  });

  it('rejects unknown runner ids with a clear error', async () => {
    await expect(
      spawnFromUiAsync({
        task: 't',
        providerId: 'openai',
        modelId: 'gpt-4o',
        workspaceRoot: '/tmp/ws',
        useWorktree: false,
        runnerId: 'does-not-exist',
      }),
    ).rejects.toThrow(/Unknown runner: does-not-exist/);
  });

  it('runs an external runner directly on a non-git workspace (no worktree required)', async () => {
    const { isGitRepo } = await import('./worktrees');
    vi.mocked(isGitRepo).mockResolvedValue(false);
    registerForTest(makeFakeRunner('ext-no-git'));
    const { runId } = await spawnFromUiAsync({
      task: 't',
      providerId: 'openai',
      modelId: 'gpt-4o',
      workspaceRoot: '/tmp/ws-not-a-repo',
      useWorktree: false,
      runnerId: 'ext-no-git',
    });
    await waitForCompletion(runId);
    const run = listAgentRuns().find((r) => r.id === runId);
    expect(run).toBeDefined();
    expect(run!.runnerId).toBe('ext-no-git');
    expect(run!.worktreePath).toBeNull();
  });

  it("defaults runnerId to 'internal' when omitted and records it on the AgentRun", async () => {
    registerForTest(makeFakeRunner('internal'));
    const { runId } = await spawnFromUiAsync({
      task: 't',
      providerId: 'openai',
      modelId: 'gpt-4o',
      workspaceRoot: '/tmp/ws',
      useWorktree: false,
    });
    await waitForCompletion(runId);
    const run = listAgentRuns().find((r) => r.id === runId);
    expect(run).toBeDefined();
    expect(run!.runnerId).toBe('internal');
  });

  it('records the configured runnerId on the resulting AgentRun for git workspaces', async () => {
    const { isGitRepo } = await import('./worktrees');
    vi.mocked(isGitRepo).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    const { createWorktree } = await import('./worktrees');
    vi.mocked(createWorktree).mockResolvedValueOnce({
      path: '/tmp/wt',
      branch: 'opencodex/subagent/abc',
    } as Awaited<ReturnType<typeof createWorktree>>);

    registerForTest(makeFakeRunner('claude-code-fake'));
    const { runId } = await spawnFromUiAsync({
      task: 't',
      providerId: 'openai',
      modelId: 'gpt-4o',
      workspaceRoot: '/tmp/ws-git',
      useWorktree: true,
      runnerId: 'claude-code-fake',
    });
    await waitForCompletion(runId);
    const run = listAgentRuns().find((r) => r.id === runId);
    expect(run).toBeDefined();
    expect(run!.runnerId).toBe('claude-code-fake');
    expect(run!.status).toBe('completed');
  });

  it('abort signal terminates the runner iterator and marks the run failed', async () => {
    // External runner needs a git workspace — mock the check.
    // spawn-from-ui calls isGitRepo twice (once up-front and once via
    // bootstrapWorktreeOrSkip — duplicate check tracked separately in 15.x),
    // so both need to succeed.
    const { isGitRepo } = await import('./worktrees');
    vi.mocked(isGitRepo).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    let abortObserved = false;
    registerForTest(
      makeFakeRunner('slow', {
        delayMs: 50,
        onAbort: () => {
          abortObserved = true;
        },
        events: [
          { type: 'text_delta', delta: 'one' },
          { type: 'text_delta', delta: 'two' },
          { type: 'text_delta', delta: 'three' },
          { type: 'usage', inputTokens: 0, outputTokens: 0 },
          { type: 'done', stopReason: 'end_turn' },
        ],
      }),
    );
    const { runId } = await spawnFromUiAsync({
      task: 't',
      providerId: 'openai',
      modelId: 'gpt-4o',
      workspaceRoot: '/tmp/ws',
      useWorktree: false,
      runnerId: 'slow',
    });
    expect(abortSpawnedRun(runId)).toBe(true);
    await waitForCompletion(runId, 2000);
    const run = listAgentRuns().find((r) => r.id === runId);
    expect(run).toBeDefined();
    expect(abortObserved).toBe(true);
    // 15.5 distinguished cancellation from failure — the stopReason is
    // 'cancelled' (a clean user-driven termination), so status is 'completed'
    // rather than 'failed'.
    expect(run!.stopReason).toBe('cancelled');
    expect(run!.status).toBe('completed');
  });
});
