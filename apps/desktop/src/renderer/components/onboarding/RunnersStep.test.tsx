// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type * as ReactRouterDom from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { RunnersStep } from './RunnersStep';
import type { RunnerInfo, RunnerInstallCheck } from '../../../shared/ipc-types';

const navigateMock: Mock = vi.fn();

vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof ReactRouterDom>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

interface BridgeOpts {
  onRunnersChanged?: Mock;
}

function setBridge(opts: BridgeOpts = {}): { listenerRef: { fn: (() => void) | null } } {
  const listenerRef: { fn: (() => void) | null } = { fn: null };
  const onRunnersChanged =
    opts.onRunnersChanged ??
    vi.fn((cb: () => void) => {
      listenerRef.fn = cb;
      return () => {
        listenerRef.fn = null;
      };
    });
  window.opencodex = {
    agent: {
      listRunners: vi.fn(async () => []),
      checkRunnerInstalled: vi.fn(async () => ({ ok: true })),
      onRunnersChanged,
    },
  } as unknown as Window['opencodex'];
  return { listenerRef };
}

const internalRunner: RunnerInfo = {
  id: 'internal',
  displayName: 'Built-in',
  source: 'builtin',
  streaming: true,
};
const claudeRunner: RunnerInfo = {
  id: 'claude-code',
  displayName: 'Claude Code',
  source: 'plugin',
  pluginId: '@opencodex/runner-claude-code',
  streaming: true,
};
const opencodeRunner: RunnerInfo = {
  id: 'opencode',
  displayName: 'OpenCode',
  source: 'plugin',
  pluginId: '@opencodex/runner-opencode',
  streaming: true,
};

function renderStep(props: {
  runners: RunnerInfo[];
  installStatuses?: Map<string, RunnerInstallCheck>;
  onSkip?: () => void;
  onContinue?: () => void;
  onRefreshStatuses?: () => void;
}) {
  const onSkip = props.onSkip ?? vi.fn();
  const onContinue = props.onContinue ?? vi.fn();
  const onRefreshStatuses = props.onRefreshStatuses ?? vi.fn();
  return {
    onSkip,
    onContinue,
    onRefreshStatuses,
    ...render(
      <MemoryRouter>
        <RunnersStep
          runners={props.runners}
          installStatuses={props.installStatuses ?? new Map()}
          onSkip={onSkip}
          onContinue={onContinue}
          onRefreshStatuses={onRefreshStatuses}
        />
      </MemoryRouter>,
    ),
  };
}

describe('RunnersStep', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    setBridge();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // @ts-expect-error — window.opencodex is non-optional in production typings
    delete window.opencodex;
  });

  it('renders one card per external runner and hides the internal runner', () => {
    renderStep({
      runners: [internalRunner, claudeRunner, opencodeRunner],
      installStatuses: new Map([
        ['claude-code', { ok: false, hint: 'Install with npm' }],
        ['opencode', { ok: true, version: '0.1.2' }],
      ]),
    });
    expect(screen.getByText('Claude Code')).toBeTruthy();
    expect(screen.getByText('OpenCode')).toBeTruthy();
    expect(screen.queryByText('Built-in')).toBeNull();
  });

  it('Install button navigates to /runners?install=<id> for a not-installed runner', () => {
    renderStep({
      runners: [claudeRunner],
      installStatuses: new Map([['claude-code', { ok: false, hint: 'missing' }]]),
    });
    const installBtn = screen.getByRole('button', { name: /Install/i });
    act(() => {
      fireEvent.click(installBtn);
    });
    expect(navigateMock).toHaveBeenCalledWith('/runners?install=claude-code');
  });

  it('does not render an Install button when the runner is already installed', () => {
    renderStep({
      runners: [claudeRunner],
      installStatuses: new Map([['claude-code', { ok: true, version: '0.4.2' }]]),
    });
    expect(screen.queryByRole('button', { name: /^Install$/i })).toBeNull();
    expect(screen.getByText(/installed/i)).toBeTruthy();
  });

  it('Skip calls onSkip', () => {
    const { onSkip } = renderStep({ runners: [claudeRunner] });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Skip/i }));
    });
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('Continue calls onContinue', () => {
    const { onContinue } = renderStep({ runners: [claudeRunner] });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    });
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('firing onRunnersChanged invokes onRefreshStatuses', async () => {
    const listenerRef: { fn: (() => void) | null } = { fn: null };
    const onRunnersChanged: Mock = vi.fn((cb: () => void) => {
      listenerRef.fn = cb;
      return () => {
        listenerRef.fn = null;
      };
    });
    setBridge({ onRunnersChanged });
    const onRefreshStatuses = vi.fn();
    renderStep({ runners: [claudeRunner], onRefreshStatuses });
    await waitFor(() => expect(listenerRef.fn).not.toBeNull());
    act(() => {
      listenerRef.fn?.();
    });
    expect(onRefreshStatuses).toHaveBeenCalled();
  });
});
