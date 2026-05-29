// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRun } from '../../shared/agent-runs';
import { JobsPane } from './JobsPane';

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    task: 'do the thing',
    providerId: 'openai',
    modelId: 'gpt-4o-mini',
    runnerId: 'internal',
    status: 'running',
    startedAt: Date.now() - 5000,
    completedAt: null,
    inputTokens: 100,
    outputTokens: 50,
    iterations: 1,
    toolEvents: [{ name: 'read_file', isError: false, durationMs: 10 }],
    stopReason: null,
    error: null,
    worktreePath: null,
    worktreeBranch: null,
    worktreeRepoRoot: null,
    mergeStatus: null,
    triggerSource: 'user',
    scheduledTaskId: null,
    ...overrides,
  };
}

interface AgentMock {
  listRuns: (...args: unknown[]) => unknown;
  onRunsChanged: (...args: unknown[]) => unknown;
  abortRun: (...args: unknown[]) => unknown;
}

function setBridge(agent: AgentMock): void {
  (window as unknown as { opencodex: { agent: AgentMock } }).opencodex = { agent };
}

beforeEach(() => {
  // jsdom does not implement matchMedia; some derive utilities check it.
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
      writable: true,
    });
  }
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as unknown as { opencodex?: unknown }).opencodex;
});

describe('JobsPane', () => {
  it('shows the empty state when there are no runs', () => {
    render(<JobsPane initialRuns={[]} />);
    expect(screen.getByText('No active jobs.')).toBeTruthy();
  });

  it('lists each running run and skips non-running statuses', () => {
    const running = makeRun({ id: 'a', task: 'building feature' });
    const completed = makeRun({
      id: 'b',
      task: 'old completed',
      status: 'completed',
      completedAt: Date.now(),
    });
    render(<JobsPane initialRuns={[running, completed]} />);
    expect(screen.getByText('building feature')).toBeTruthy();
    expect(screen.queryByText('old completed')).toBeNull();
  });

  it('shows current tool, token meter, and elapsed cells', () => {
    const run = makeRun({
      inputTokens: 1234,
      outputTokens: 567,
      toolEvents: [{ name: 'shell_exec', isError: false, durationMs: 30 }],
    });
    render(<JobsPane initialRuns={[run]} />);
    expect(screen.getByText('shell_exec')).toBeTruthy();
    expect(screen.getByText(/1,234/)).toBeTruthy();
    expect(screen.getByText(/567/)).toBeTruthy();
  });

  it('calls agent.abortRun when Cancel is pressed', async () => {
    const abortRun = vi.fn(async () => ({ ok: true }) as { ok: true });
    setBridge({
      listRuns: vi.fn(),
      onRunsChanged: vi.fn(() => () => {}),
      abortRun,
    });
    const run = makeRun({ id: 'run-xyz' });
    render(<JobsPane initialRuns={[run]} />);
    const btn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(btn);
    await waitFor(() => expect(abortRun).toHaveBeenCalledWith('run-xyz'));
  });

  it('renders the abort error when abortRun returns ok=false', async () => {
    const abortRun = vi.fn(async () => ({ ok: false, error: 'already done' }));
    setBridge({
      listRuns: vi.fn(),
      onRunsChanged: vi.fn(() => () => {}),
      abortRun,
    });
    render(<JobsPane initialRuns={[makeRun({ id: 'r' })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByText('already done')).toBeTruthy());
  });

  it('subscribes to onRunsChanged when no initialRuns are provided', async () => {
    const onRunsChanged = vi.fn(() => () => {});
    setBridge({
      listRuns: vi.fn(async () => [makeRun()]),
      onRunsChanged,
      abortRun: vi.fn(),
    });
    render(<JobsPane />);
    await waitFor(() => expect(onRunsChanged).toHaveBeenCalledTimes(1));
  });

  it('shows scheduled pill for scheduled runs', () => {
    const run = makeRun({ triggerSource: 'scheduled' });
    render(<JobsPane initialRuns={[run]} />);
    expect(screen.getByText('scheduled')).toBeTruthy();
  });
});
