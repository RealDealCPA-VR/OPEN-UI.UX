// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRun } from '../../shared/agent-runs';

vi.mock('../components/AgentRunRow', () => ({
  AgentRunRow: ({ run }: { run: AgentRun }) => (
    <li data-testid="agent-run-row" data-run-id={run.id}>
      {run.task}
    </li>
  ),
}));

vi.mock('../components/MergeReviewModal', () => ({
  MergeReviewModal: () => <div data-testid="merge-review-modal" />,
}));

import { InboxView } from './InboxView';

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    task: 'do the thing',
    providerId: 'openai',
    modelId: 'gpt-4o-mini',
    runnerId: 'internal',
    status: 'completed',
    startedAt: 1,
    completedAt: 2,
    inputTokens: 0,
    outputTokens: 0,
    iterations: 0,
    toolEvents: [],
    stopReason: 'end_turn',
    error: null,
    worktreePath: null,
    worktreeBranch: null,
    worktreeRepoRoot: null,
    mergeStatus: null,
    triggerSource: 'user',
    seen: false,
    scheduledTaskId: null,
    ...overrides,
  };
}

interface BridgeOpts {
  runs: AgentRun[];
}

function installBridge(opts: BridgeOpts) {
  const markRunsSeen = vi.fn(async (runIds: string[]) => ({
    ok: true as const,
    runs: opts.runs.map((r) => (runIds.includes(r.id) ? { ...r, seen: true } : r)),
  }));
  window.opencodex = {
    agent: {
      listRuns: vi.fn(async () => opts.runs),
      onRunsChanged: vi.fn(() => () => {}),
      markRunsSeen,
    },
  } as unknown as Window['opencodex'];
  return { markRunsSeen };
}

function renderView(): void {
  render(
    <MemoryRouter initialEntries={['/inbox']}>
      <InboxView />
    </MemoryRouter>,
  );
}

describe('InboxView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    delete (window as { opencodex?: unknown }).opencodex;
  });

  it('renders needs-review and done sections with the runs in each bucket', async () => {
    installBridge({
      runs: [
        makeRun({
          id: 'review-1',
          task: 'pending merge',
          seen: true,
          worktreePath: '/wt',
          worktreeBranch: 'b',
          worktreeRepoRoot: '/r',
          mergeStatus: 'pending',
        }),
        makeRun({ id: 'done-1', task: 'finished', seen: true }),
      ],
    });
    renderView();

    await waitFor(() => {
      expect(screen.getByText('Needs review (1)')).toBeTruthy();
    });
    expect(screen.getByText('Done (1)')).toBeTruthy();
    const rows = screen.getAllByTestId('agent-run-row');
    expect(rows.map((r) => r.getAttribute('data-run-id')).sort()).toEqual(['done-1', 'review-1']);
  });

  it('calls markRunsSeen with the unseen finished run ids on mount', async () => {
    const { markRunsSeen } = installBridge({
      runs: [
        makeRun({ id: 'unseen-done', seen: false }),
        makeRun({ id: 'seen-done', seen: true }),
        makeRun({ id: 'still-running', status: 'running', completedAt: null, seen: false }),
      ],
    });
    renderView();

    await waitFor(() => {
      expect(markRunsSeen).toHaveBeenCalledTimes(1);
    });
    expect(markRunsSeen).toHaveBeenCalledWith(['unseen-done']);
  });

  it('does not call markRunsSeen when every finished run is already seen', async () => {
    const { markRunsSeen } = installBridge({
      runs: [makeRun({ id: 'a', seen: true })],
    });
    renderView();

    await waitFor(() => {
      expect(screen.getByText('Done (1)')).toBeTruthy();
    });
    expect(markRunsSeen).not.toHaveBeenCalled();
  });
});
