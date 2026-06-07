// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActiveRunCard } from './ActiveRunCard';
import type { AgentRun } from '../../shared/agent-runs';

const baseRun: AgentRun = {
  id: 'run-1',
  task: 'Refactor the auth module',
  providerId: 'openai',
  modelId: 'gpt-4o',
  runnerId: 'internal',
  status: 'running',
  startedAt: 0,
  completedAt: null,
  inputTokens: 1200,
  outputTokens: 340,
  iterations: 2,
  toolEvents: [],
  stopReason: null,
  error: null,
  worktreePath: null,
  worktreeBranch: null,
  worktreeRepoRoot: null,
  mergeStatus: null,
  triggerSource: 'user',
  seen: false,
  scheduledTaskId: null,
  budget: 8,
};

describe('ActiveRunCard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not expose the card article as a single role=button wrapping inner buttons', () => {
    render(<ActiveRunCard run={baseRun} now={1000} onSelect={() => {}} />);

    expect(screen.queryByRole('button', { name: /Refactor the auth module/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abort' })).toBeTruthy();
  });

  it('invokes onSelect from the Open button', () => {
    const onSelect = vi.fn();
    render(<ActiveRunCard run={baseRun} now={1000} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
