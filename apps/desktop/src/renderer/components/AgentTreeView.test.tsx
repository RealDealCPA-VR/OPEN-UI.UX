// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { WorktreePreviewResponse } from '../../shared/agent-tree';
import { AgentTreeView } from './AgentTreeView';
import type { AgentRunWithParent } from './agent-tree-derive';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function actWarnings(spy: MockInstance): string[] {
  return spy.mock.calls
    .map((args) => String(args[0]))
    .filter((msg) => msg.includes('not wrapped in act'));
}

function makeRun(partial: Partial<AgentRunWithParent> = {}): AgentRunWithParent {
  return {
    id: 'run-1',
    task: 'top-level task',
    providerId: 'openai',
    modelId: 'gpt-4o',
    runnerId: 'internal',
    status: 'running',
    startedAt: 1,
    completedAt: null,
    inputTokens: 0,
    outputTokens: 0,
    iterations: 0,
    toolEvents: [],
    stopReason: null,
    error: null,
    worktreePath: '/tmp/wt',
    worktreeBranch: 'feat/x',
    worktreeRepoRoot: '/tmp/repo',
    mergeStatus: null,
    triggerSource: 'manual',
    seen: true,
    scheduledTaskId: null,
    ...partial,
  } as AgentRunWithParent;
}

interface DeferredPreview {
  resolve: (value: WorktreePreviewResponse) => void;
  reject: (err: unknown) => void;
}

function installDeferredBridge(): DeferredPreview {
  let resolve!: (value: WorktreePreviewResponse) => void;
  let reject!: (err: unknown) => void;
  const pending = new Promise<WorktreePreviewResponse>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  (window as unknown as { opencodex: unknown }).opencodex = {
    agent: {
      getWorktreePreview: vi.fn(() => pending),
      onPausedChanged: vi.fn(() => () => {}),
    },
  };
  return { resolve, reject };
}

describe('AgentTreeView', () => {
  let errorSpy: MockInstance;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { opencodex?: unknown }).opencodex;
  });

  it('renders a row per root run', () => {
    installDeferredBridge();
    render(<AgentTreeView runs={[makeRun()]} now={2} onSelectRun={() => {}} />);
    expect(screen.getByText(/top-level task/)).toBeTruthy();
  });

  it('renders the worktree preview when it resolves while mounted (positive control)', async () => {
    const deferred = installDeferredBridge();
    render(<AgentTreeView runs={[makeRun()]} now={2} onSelectRun={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /Preview diff/i }));
    await act(async () => {
      deferred.resolve({
        runId: 'run-1',
        worktreePath: '/tmp/wt',
        largestFile: { path: 'src/a.ts', added: 3, removed: 1, hunkSnippet: 'snippet-here' },
        totalFilesChanged: 1,
      });
      await flushMicrotasks();
    });

    expect(screen.getByText('snippet-here')).toBeTruthy();
  });

  it('does not render preview or warn when a worktree preview resolves after unmount', async () => {
    const deferred = installDeferredBridge();
    const { unmount } = render(<AgentTreeView runs={[makeRun()]} now={2} onSelectRun={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /Preview diff/i }));
    unmount();

    // The mountedRef guard in loadPreview must short-circuit before setState.
    // No throw, no act warning, and nothing reattaches to the document.
    await act(async () => {
      deferred.resolve({
        runId: 'run-1',
        worktreePath: '/tmp/wt',
        largestFile: { path: 'src/a.ts', added: 3, removed: 1, hunkSnippet: 'late-snippet' },
        totalFilesChanged: 1,
      });
      await flushMicrotasks();
    });

    expect(screen.queryByText('late-snippet')).toBeNull();
    expect(actWarnings(errorSpy)).toEqual([]);
  });

  it('does not throw or warn when a worktree preview rejects after unmount', async () => {
    const deferred = installDeferredBridge();
    const { unmount } = render(<AgentTreeView runs={[makeRun()]} now={2} onSelectRun={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /Preview diff/i }));
    unmount();

    await act(async () => {
      deferred.reject(new Error('boom'));
      await flushMicrotasks();
    });

    expect(actWarnings(errorSpy)).toEqual([]);
  });

  it('ignores paused-changed events delivered after unmount', () => {
    type PausedListener = (payload: { runId: string; paused: boolean }) => void;
    const holder: { listener: PausedListener | null } = { listener: null };
    (window as unknown as { opencodex: unknown }).opencodex = {
      agent: {
        getWorktreePreview: vi.fn(() => Promise.resolve()),
        onPausedChanged: vi.fn((l: PausedListener) => {
          holder.listener = l;
          return () => {};
        }),
      },
    };

    const { unmount } = render(<AgentTreeView runs={[makeRun()]} now={2} onSelectRun={() => {}} />);
    unmount();

    holder.listener?.({ runId: 'run-1', paused: true });
    expect(actWarnings(errorSpy)).toEqual([]);
  });
});
