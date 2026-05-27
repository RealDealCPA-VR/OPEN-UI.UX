// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSpawnModal } from './AgentSpawnModal';

interface Runner {
  id: string;
  displayName: string;
  source: 'builtin' | 'plugin';
  pluginId?: string;
}

function mockSelectedModel(providers: Array<{ id: string; models: string[] }>): void {
  vi.doMock('../state/selected-model-context', () => ({
    useSelectedModel: () => ({
      selected: providers[0]
        ? { providerId: providers[0].id, modelId: providers[0].models[0] }
        : null,
      configuredProviders: providers.map((p) => ({
        info: {
          id: p.id,
          displayName: p.id,
          models: p.models.map((m) => ({ id: m, displayName: m, embeddings: false })),
        },
      })),
    }),
  }));
}

function mockOpencodexBridge(opts: { runners: Runner[]; isRepo: boolean }): void {
  const onRunnersChanged = vi.fn(() => () => {});
  window.opencodex = {
    workspace: {
      get: vi.fn(async () => ({ active: '/tmp/ws' })),
      browse: vi.fn(async () => ({ active: '/tmp/ws' })),
    },
    git: { isRepo: vi.fn(async () => ({ isRepo: opts.isRepo })) },
    agent: {
      listRunners: vi.fn(async () => opts.runners),
      checkRunnerInstalled: vi.fn(async () => ({ ok: true })),
      onRunnersChanged,
      spawnFromUi: vi.fn(async () => ({ runId: 'run-1' })),
    },
  } as unknown as Window['opencodex'];
}

const builtinRunner: Runner = {
  id: 'internal',
  displayName: 'Built-in',
  source: 'builtin',
};
const externalRunner: Runner = {
  id: 'claude-code',
  displayName: 'Claude Code',
  source: 'plugin',
  pluginId: '@opencodex/runner-claude-code',
};

describe('AgentSpawnModal', () => {
  beforeEach(() => {
    mockSelectedModel([{ id: 'openai', models: ['gpt-4o', 'gpt-4o-mini'] }]);
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    // @ts-expect-error — window.opencodex is non-optional in production typings
    delete window.opencodex;
  });

  it('shows provider + model controls when the internal runner is selected', async () => {
    mockOpencodexBridge({ runners: [builtinRunner, externalRunner], isRepo: true });
    render(
      <AgentSpawnModal
        initialTask="do the thing"
        initialWorkspaceRoot="/tmp/ws"
        onClose={() => {}}
        onSpawned={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText(/Provider/i)).toBeTruthy());
    expect(screen.getByText(/Model/i)).toBeTruthy();
  });

  it('hides provider + model selects and forces useWorktree on when an external runner is selected', async () => {
    mockOpencodexBridge({ runners: [builtinRunner, externalRunner], isRepo: true });
    render(
      <AgentSpawnModal
        initialTask="do x"
        initialWorkspaceRoot="/tmp/ws"
        onClose={() => {}}
        onSpawned={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(1));

    const runnerSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    act(() => {
      fireEvent.change(runnerSelect, { target: { value: 'claude-code' } });
    });

    expect(screen.queryByText(/Provider/i)).toBeNull();
    expect(screen.queryByText(/Model/i)).toBeNull();

    const worktreeCheckbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(worktreeCheckbox.checked).toBe(true);
    expect(worktreeCheckbox.disabled).toBe(true);
  });

  it('restores provider + model and unlocks worktree when switching back to internal', async () => {
    mockOpencodexBridge({ runners: [builtinRunner, externalRunner], isRepo: true });
    render(
      <AgentSpawnModal
        initialTask="x"
        initialWorkspaceRoot="/tmp/ws"
        onClose={() => {}}
        onSpawned={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(1));
    const runnerSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    act(() => {
      fireEvent.change(runnerSelect, { target: { value: 'claude-code' } });
    });
    act(() => {
      fireEvent.change(runnerSelect, { target: { value: 'internal' } });
    });
    await waitFor(() => expect(screen.getByText(/Provider/i)).toBeTruthy());
    const worktreeCheckbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(worktreeCheckbox.disabled).toBe(false);
  });

  it('keeps the submit button enabled with an external runner even if provider/model are unset', async () => {
    mockSelectedModel([]); // no providers configured
    mockOpencodexBridge({ runners: [builtinRunner, externalRunner], isRepo: true });
    render(
      <AgentSpawnModal
        initialTask="do x"
        initialWorkspaceRoot="/tmp/ws"
        onClose={() => {}}
        onSpawned={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(1));
    const runnerSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    act(() => {
      fireEvent.change(runnerSelect, { target: { value: 'claude-code' } });
    });
    const spawnBtn = screen.getByRole('button', { name: /Spawn task/i }) as HTMLButtonElement;
    expect(spawnBtn.disabled).toBe(false);
  });
});
