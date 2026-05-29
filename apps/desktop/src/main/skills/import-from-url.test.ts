import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as LoaderModule from './loader';
import type { SkillRegistryEntry } from '../../shared/skills';

vi.mock('../storage/settings', () => ({
  getSettings: () => ({ activeWorkspace: '/tmp/workspace' }),
  getSkillRegistryUrl: () => 'https://example.test/registry.json',
}));

vi.mock('../scheduler/store', () => ({
  createTask: () => undefined,
  deleteTask: () => undefined,
  findTaskByLinkedSkill: () => null,
  listTasksLinkedToSkills: () => [],
  updateTask: () => undefined,
}));

vi.mock('../scheduler/scheduler', () => ({
  validateCronExpression: () => undefined,
  rescheduleNow: () => undefined,
}));

vi.mock('./loader', async () => {
  const actual = await vi.importActual<typeof LoaderModule>('./loader');
  return {
    ...actual,
    loadAllSkills: (): ReturnType<typeof LoaderModule.loadAllSkills> => ({
      skills: [],
      roots: { userRoot: '/tmp/non-existent-roots-test', projectRoot: null },
    }),
  };
});

vi.mock('./watcher', () => ({
  SkillsWatcher: class {
    start = (): Promise<void> => Promise.resolve();
    stop = (): Promise<void> => Promise.resolve();
  },
}));

const origFetch = globalThis.fetch;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  globalThis.fetch = origFetch;
});

const sha256Hex = async (s: string): Promise<string> => {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(s, 'utf8').digest('hex');
};

const validBody = `---
name: hello
description: a hello skill
---
hello body
`;

describe('importSkillFromUrl', () => {
  it('refuses non-https URLs', async () => {
    const { importSkillFromUrl } = await import('./manager');
    await expect(importSkillFromUrl({ url: 'http://example.test/SKILL.md' })).rejects.toThrow(
      /https/,
    );
  });

  it('refuses when the source host is not in the registry allowlist', async () => {
    const { importSkillFromUrl } = await import('./manager');
    const entries: SkillRegistryEntry[] = [
      {
        name: 'good',
        description: 'good',
        sourceUrl: 'https://allowed.test/SKILL.md',
      },
    ];
    await expect(
      importSkillFromUrl({
        url: 'https://evil.test/SKILL.md',
        registryEntriesOverride: entries,
      }),
    ).rejects.toThrow(/allowlist/);
  });

  it('refuses when the registry has no sha256 for the matched host', async () => {
    const { importSkillFromUrl } = await import('./manager');
    const entries: SkillRegistryEntry[] = [
      {
        name: 'good',
        description: 'good',
        sourceUrl: 'https://allowed.test/SKILL.md',
      },
    ];
    await expect(
      importSkillFromUrl({
        url: 'https://allowed.test/SKILL.md',
        registryEntriesOverride: entries,
      }),
    ).rejects.toThrow(/sha256/);
  });

  it('refuses when the downloaded body sha256 does not match the registry entry', async () => {
    const { importSkillFromUrl } = await import('./manager');
    const otherBody = 'totally different content';
    const entries: SkillRegistryEntry[] = [
      {
        name: 'good',
        description: 'good',
        sourceUrl: 'https://allowed.test/SKILL.md',
        sha256: await sha256Hex(otherBody),
      },
    ];
    globalThis.fetch = vi.fn(
      async () =>
        new Response(validBody, {
          status: 200,
          headers: { 'content-type': 'text/markdown' },
        }),
    ) as typeof fetch;
    await expect(
      importSkillFromUrl({
        url: 'https://allowed.test/SKILL.md',
        registryEntriesOverride: entries,
      }),
    ).rejects.toThrow(/checksum mismatch/);
  });

  it('refuses when no registry is configured (empty entries)', async () => {
    const { importSkillFromUrl } = await import('./manager');
    await expect(
      importSkillFromUrl({
        url: 'https://allowed.test/SKILL.md',
        registryEntriesOverride: [],
      }),
    ).rejects.toThrow(/registry/);
  });
});
