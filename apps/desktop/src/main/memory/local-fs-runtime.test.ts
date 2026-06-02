import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool } from '@opencodex/core';

const settingsState = {
  activeWorkspace: null as string | null,
  localFsEnabled: false,
};

vi.mock('../logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../storage/settings', () => ({
  getSettings: (): unknown => ({
    activeWorkspace: settingsState.activeWorkspace,
    memory: { backends: { localFs: { enabled: settingsState.localFsEnabled } } },
  }),
}));

const buildLocalFsTools = vi.fn<[workspaceRoot: string], Tool[]>();

vi.mock('./local-fs-backend', () => ({
  buildLocalFsTools: (workspaceRoot: string): Tool[] => buildLocalFsTools(workspaceRoot),
}));

import { applyLocalFsBackend, getLocalFsBackendState } from './local-fs-runtime';
import { getToolRegistry, resetToolRegistryForTesting } from '../tools/registry';

function fakeTool(name: string): Tool {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ ok: true }),
  } as unknown as Tool;
}

describe('applyLocalFsBackend', () => {
  beforeEach(() => {
    resetToolRegistryForTesting();
    buildLocalFsTools.mockReset();
    settingsState.activeWorkspace = null;
    settingsState.localFsEnabled = false;
    // ensure no stale tools survive between cases
    applyLocalFsBackend();
  });

  it('registers tools against the active workspace when enabled', () => {
    settingsState.activeWorkspace = '/ws/alpha';
    settingsState.localFsEnabled = true;
    buildLocalFsTools.mockReturnValue([fakeTool('memory_local_read')]);

    const state = applyLocalFsBackend();

    expect(buildLocalFsTools).toHaveBeenCalledWith('/ws/alpha');
    expect(state.registered).toBe(true);
    expect(state.toolCount).toBe(1);
    expect(state.workspaceRoot).toBe('/ws/alpha');
    expect(getToolRegistry().has('memory_local_read')).toBe(true);
  });

  it('re-registers against the NEW workspace after a workspace switch', () => {
    settingsState.activeWorkspace = '/ws/alpha';
    settingsState.localFsEnabled = true;
    buildLocalFsTools.mockReturnValue([fakeTool('memory_local_read')]);
    applyLocalFsBackend();

    // simulate workspace switch
    settingsState.activeWorkspace = '/ws/beta';
    const state = applyLocalFsBackend();

    expect(buildLocalFsTools).toHaveBeenLastCalledWith('/ws/beta');
    expect(state.workspaceRoot).toBe('/ws/beta');
    // exactly one instance of the tool remains registered (old one was unregistered)
    expect(getToolRegistry().has('memory_local_read')).toBe(true);
  });

  it('unregisters tools when the backend is disabled', () => {
    settingsState.activeWorkspace = '/ws/alpha';
    settingsState.localFsEnabled = true;
    buildLocalFsTools.mockReturnValue([fakeTool('memory_local_read')]);
    applyLocalFsBackend();
    expect(getToolRegistry().has('memory_local_read')).toBe(true);

    settingsState.localFsEnabled = false;
    const state = applyLocalFsBackend();

    expect(state.registered).toBe(false);
    expect(state.toolCount).toBe(0);
    expect(getToolRegistry().has('memory_local_read')).toBe(false);
  });

  it('reports not configured when there is no active workspace', () => {
    settingsState.localFsEnabled = true;
    settingsState.activeWorkspace = null;

    const state = applyLocalFsBackend();

    expect(state.configured).toBe(false);
    expect(state.registered).toBe(false);
    expect(buildLocalFsTools).not.toHaveBeenCalled();
    expect(getLocalFsBackendState().registered).toBe(false);
  });
});
