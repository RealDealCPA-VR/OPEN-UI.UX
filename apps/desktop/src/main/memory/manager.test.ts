import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryConfig } from '../../shared/memory';
import type { LocalFsBackendState } from './local-fs-backend';

const config: MemoryConfig = {
  backends: {
    obsidian: { enabled: false, vaultPath: '' },
    notion: { enabled: false },
    localFs: { enabled: true, prependToSystemPrompt: false, maxPrependBytes: 4096 },
  },
};

const localFsState: LocalFsBackendState = {
  enabled: true,
  configured: true,
  registered: true,
  toolCount: 3,
  workspaceRoot: '/ws/alpha',
};

const applyLocalFsBackend = vi.fn<[], LocalFsBackendState>(() => localFsState);
const getLocalFsBackendState = vi.fn<[], LocalFsBackendState>(() => localFsState);

vi.mock('../logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('./local-fs-runtime', () => ({
  applyLocalFsBackend: (): LocalFsBackendState => applyLocalFsBackend(),
  getLocalFsBackendState: (): LocalFsBackendState => getLocalFsBackendState(),
}));

vi.mock('../storage/settings', () => ({
  getMemoryConfig: (): MemoryConfig => config,
  setMemoryConfig: (next: MemoryConfig): MemoryConfig => next,
}));

vi.mock('../storage/secrets', () => ({
  getSecret: async (): Promise<string | null> => null,
  setSecret: async (): Promise<void> => undefined,
  deleteSecret: async (): Promise<void> => undefined,
}));

vi.mock('../tools/registry', () => ({
  getToolRegistry: () => ({
    has: () => false,
    register: () => undefined,
    unregister: () => undefined,
  }),
}));

vi.mock('@opencodex/memory-obsidian', () => ({
  ObsidianMemory: class {
    buildTools(): unknown[] {
      return [];
    }
  },
}));

vi.mock('@opencodex/memory-notion', () => ({
  NotionMemory: class {
    buildTools(): unknown[] {
      return [];
    }
  },
}));

import { getMemoryStatus, reloadMemory } from './manager';

describe('manager local-fs integration', () => {
  beforeEach(() => {
    applyLocalFsBackend.mockClear();
    getLocalFsBackendState.mockClear();
  });

  it('reloadMemory re-applies the local-fs backend', async () => {
    await reloadMemory();
    expect(applyLocalFsBackend).toHaveBeenCalledTimes(1);
  });

  it('getMemoryStatus exposes the local-fs backend in backends[]', async () => {
    const status = await getMemoryStatus();
    const localFs = status.backends.find((b) => b.id === 'local-fs');
    expect(localFs).toBeDefined();
    expect(localFs?.enabled).toBe(true);
    expect(localFs?.configured).toBe(true);
    expect(localFs?.registered).toBe(true);
    expect(localFs?.toolCount).toBe(3);
  });
});
