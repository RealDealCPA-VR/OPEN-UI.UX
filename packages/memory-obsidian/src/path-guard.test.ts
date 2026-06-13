import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureMarkdownExtension,
  resolveVaultPath,
  resolveVaultPathSync,
  VaultPathError,
} from './path-guard';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'opencodex-pg-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('resolveVaultPathSync (lexical)', () => {
  it('rejects empty paths', () => {
    expect(() => resolveVaultPathSync(root, '')).toThrow(VaultPathError);
  });

  it('rejects absolute paths', () => {
    expect(() => resolveVaultPathSync(root, path.resolve(root, 'a.md'))).toThrow(VaultPathError);
  });

  it('rejects path traversal', () => {
    expect(() => resolveVaultPathSync(root, '../escape.md')).toThrow(VaultPathError);
    expect(() => resolveVaultPathSync(root, 'a/../../b.md')).toThrow(VaultPathError);
  });

  it('accepts normal relative paths', () => {
    const out = resolveVaultPathSync(root, 'note.md');
    expect(out).toBe(path.join(root, 'note.md'));
  });
});

describe('resolveVaultPath (realpath)', () => {
  it('returns the resolved path for a valid relative input', async () => {
    const out = await resolveVaultPath(root, 'note.md');
    expect(out).toBe(path.join(root, 'note.md'));
  });

  it('rejects path traversal via the sync gate', async () => {
    await expect(resolveVaultPath(root, '../escape.md')).rejects.toBeInstanceOf(VaultPathError);
  });

  const symlinkSkip = process.platform === 'win32' ? it.skip : it;
  symlinkSkip('rejects a symlink inside the vault that points outside the vault', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencodex-outside-'));
    try {
      await fs.writeFile(path.join(outsideDir, 'secret.md'), 'secret', 'utf8');
      await fs.symlink(outsideDir, path.join(root, 'evil'));
      await expect(resolveVaultPath(root, 'evil/secret.md')).rejects.toBeInstanceOf(VaultPathError);
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});

describe('ensureMarkdownExtension', () => {
  it('appends .md when missing', () => {
    expect(ensureMarkdownExtension('foo')).toBe('foo.md');
  });
  it('leaves existing .md alone', () => {
    expect(ensureMarkdownExtension('bar.md')).toBe('bar.md');
  });
});
