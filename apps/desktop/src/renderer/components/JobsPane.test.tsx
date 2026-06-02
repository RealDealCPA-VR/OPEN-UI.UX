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

  it('renders runs fetched via the bridge without a function-as-child warning', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      setBridge({
        listRuns: vi.fn(async () => [
          makeRun({ id: 'fetched', task: 'fetched task', inputTokens: 1234, outputTokens: 567 }),
        ]),
        onRunsChanged: vi.fn(() => () => {}),
        abortRun: vi.fn(),
      });
      render(<JobsPane />);
      await waitFor(() => expect(screen.getByText('fetched task')).toBeTruthy());
      expect(screen.getByText(/1,234/)).toBeTruthy();
      expect(screen.getByText(/567/)).toBeTruthy();
      const sawFunctionChild = errorSpy.mock.calls.some((args) =>
        args.some(
          (a) => typeof a === 'string' && a.includes('Functions are not valid as a React child'),
        ),
      );
      expect(sawFunctionChild).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('tolerates a non-array listRuns result without rendering a function', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // Mirrors the preload test-shim (src/test/setup.ts), whose Proxy resolves
      // to a callable whose every property access / call returns another
      // callable Proxy — never an AgentRun[]. Before the Array.isArray guard this
      // leaked a function into the render tree as `running.length` /
      // `running.map(...)`, producing the "Functions are not valid as a React
      // child" warning seen via the bridge-fetch path.
      const makeShim = (): unknown => {
        const target = (() => undefined) as ((...a: unknown[]) => unknown) &
          Record<PropertyKey, unknown>;
        return new Proxy(target, {
          get(_t, prop): unknown {
            if (prop === 'then') return undefined;
            if (typeof prop === 'symbol') return undefined;
            return makeShim();
          },
          apply(): unknown {
            return makeShim();
          },
        });
      };
      setBridge({
        listRuns: vi.fn(async () => makeShim() as AgentRun[]),
        onRunsChanged: vi.fn(() => () => {}),
        abortRun: vi.fn(),
      });
      render(<JobsPane />);
      await waitFor(() => expect(screen.getByText('No active jobs.')).toBeTruthy());
      const sawFunctionChild = errorSpy.mock.calls.some((args) =>
        args.some(
          (a) => typeof a === 'string' && a.includes('Functions are not valid as a React child'),
        ),
      );
      expect(sawFunctionChild).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('shows scheduled pill for scheduled runs', () => {
    const run = makeRun({ triggerSource: 'scheduled' });
    render(<JobsPane initialRuns={[run]} />);
    expect(screen.getByText('scheduled')).toBeTruthy();
  });
});
