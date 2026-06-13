import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PathEscapesWorkspaceError,
  resolveWithinWorkspace,
  resolveWithinWorkspaceSync,
} from './path-guard';

describe('resolveWithinWorkspaceSync', () => {
  it('returns the resolved path when requested stays under the workspace', () => {
    const resolved = resolveWithinWorkspaceSync('/ws', 'sub/file.txt');
    expect(resolved).toBe(path.resolve('/ws', 'sub/file.txt'));
  });

  it('rejects parent-traversal', () => {
    expect(() => resolveWithinWorkspaceSync('/ws', '../escape')).toThrow(PathEscapesWorkspaceError);
  });

  it('rejects absolute paths that fall outside the workspace', () => {
    expect(() => resolveWithinWorkspaceSync('/ws', '/etc/passwd')).toThrow(
      PathEscapesWorkspaceError,
    );
  });
});

describe('resolveWithinWorkspace (async, realpath-checked)', () => {
  let tmpRoot: string;
  let workspace: string;
  let outside: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'opencodex-pg-'));
    workspace = path.join(tmpRoot, 'ws');
    outside = path.join(tmpRoot, 'outside');
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('returns the resolved path for plain in-workspace requests', async () => {
    await fs.writeFile(path.join(workspace, 'a.txt'), 'x');
    const resolved = await resolveWithinWorkspace(workspace, 'a.txt');
    expect(resolved).toBe(path.join(workspace, 'a.txt'));
  });

  it('rejects parent-traversal lexically (no I/O needed)', async () => {
    await expect(resolveWithinWorkspace(workspace, '../outside/x')).rejects.toThrow(
      PathEscapesWorkspaceError,
    );
  });

  it('rejects a symlink inside the workspace that points outside it', async () => {
    await fs.writeFile(path.join(outside, 'secret.txt'), 'pwned');
    try {
      await fs.symlink(path.join(outside, 'secret.txt'), path.join(workspace, 'leak'));
    } catch (err) {
      // Windows may refuse to create symlinks without admin / developer mode.
      // Skip the test rather than fail with an irrelevant EPERM.
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
      throw err;
    }
    await expect(resolveWithinWorkspace(workspace, 'leak')).rejects.toThrow(
      PathEscapesWorkspaceError,
    );
  });

  it('accepts a not-yet-existing file under the workspace (for writes)', async () => {
    const resolved = await resolveWithinWorkspace(workspace, 'nested/dir/new-file.txt');
    expect(resolved).toBe(path.join(workspace, 'nested/dir/new-file.txt'));
  });

  it('rejects a not-yet-existing path whose existing parent is a symlink pointing outside', async () => {
    try {
      await fs.symlink(outside, path.join(workspace, 'linkdir'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
      throw err;
    }
    await expect(resolveWithinWorkspace(workspace, 'linkdir/new-file.txt')).rejects.toThrow(
      PathEscapesWorkspaceError,
    );
  });
});
