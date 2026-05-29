import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../storage/settings', () => {
  const state: {
    value: { activeWorkspace: string | null; memory: any; antiSycophancyEnabled: boolean };
  } = {
    value: {
      activeWorkspace: null,
      memory: {
        backends: {
          localFs: { enabled: false, prependToSystemPrompt: false, maxPrependBytes: 4096 },
        },
      },
      antiSycophancyEnabled: true,
    },
  };
  return {
    getSettings: () => state.value,
    updateSettings: (patch: Record<string, unknown>) => {
      state.value = { ...state.value, ...patch } as typeof state.value;
      return state.value;
    },
    __set: (next: Partial<typeof state.value>): void => {
      state.value = { ...state.value, ...next } as typeof state.value;
    },
  };
});

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const settingsModule = await import('../storage/settings');
const { buildChatSystemPrompt } = await import('./system-prompt-builder');
const { ANTI_SYCOPHANCY_CLAUSE } = await import('../agent/anti-sycophancy');

const __set = (settingsModule as unknown as { __set: (n: Record<string, unknown>) => void }).__set;

let tmpRoot: string | null = null;

async function makeWorkspace(memory: string | null): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sysprompt-build-test-'));
  if (memory !== null) {
    await fs.mkdir(path.join(root, '.opencodex'), { recursive: true });
    await fs.writeFile(path.join(root, '.opencodex', 'memory.md'), memory, 'utf8');
  }
  return root;
}

beforeEach(() => {
  __set({
    activeWorkspace: null,
    memory: {
      backends: {
        localFs: { enabled: false, prependToSystemPrompt: false, maxPrependBytes: 4096 },
      },
    },
    antiSycophancyEnabled: true,
  });
  tmpRoot = null;
});

afterEach(async () => {
  if (tmpRoot !== null) {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

describe('buildChatSystemPrompt', () => {
  it('returns just the anti-sycophancy clause when nothing else is configured', async () => {
    const result = await buildChatSystemPrompt({ basePrompt: '' });
    expect(result).toBe(ANTI_SYCOPHANCY_CLAUSE);
  });

  it('omits the anti-sycophancy clause when toggled off', async () => {
    __set({ antiSycophancyEnabled: false });
    const result = await buildChatSystemPrompt({ basePrompt: 'You are a helpful agent.' });
    expect(result).toBe('You are a helpful agent.');
  });

  it('appends the clause to a base prompt', async () => {
    const result = await buildChatSystemPrompt({ basePrompt: 'You are a helpful agent.' });
    expect(result).toContain('You are a helpful agent.');
    expect(result?.endsWith(ANTI_SYCOPHANCY_CLAUSE)).toBe(true);
  });

  it('prepends memory.md content when local-fs prepend is enabled', async () => {
    tmpRoot = await makeWorkspace('## Conventions\nTypeScript strict, no any.');
    __set({
      activeWorkspace: tmpRoot,
      memory: {
        backends: {
          localFs: { enabled: true, prependToSystemPrompt: true, maxPrependBytes: 4096 },
        },
      },
    });
    const result = await buildChatSystemPrompt({ basePrompt: 'Base.' });
    expect(result).toContain('<project_memory');
    expect(result).toContain('TypeScript strict');
    expect(result).toContain('Base.');
    expect(result?.endsWith(ANTI_SYCOPHANCY_CLAUSE)).toBe(true);
  });

  it('does not prepend when memory.md is empty / missing', async () => {
    tmpRoot = await makeWorkspace(null);
    __set({
      activeWorkspace: tmpRoot,
      memory: {
        backends: {
          localFs: { enabled: true, prependToSystemPrompt: true, maxPrependBytes: 4096 },
        },
      },
    });
    const result = await buildChatSystemPrompt({ basePrompt: 'Base.' });
    expect(result).not.toContain('<project_memory');
    expect(result).toContain('Base.');
  });

  it('returns null when there is no content at all', async () => {
    __set({ antiSycophancyEnabled: false });
    const result = await buildChatSystemPrompt({ basePrompt: '' });
    expect(result).toBeNull();
  });
});
