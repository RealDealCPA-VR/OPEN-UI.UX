import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileChangeWatcher, FileChangeWatcherRegistry } from './file-watcher';

function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = (): void => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('waitFor: timeout'));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

describe('FileChangeWatcher', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'opencodex-fwatch-'));
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('fires when a matching file is written, after the debounce window', async () => {
    const onFire = vi.fn();
    const watcher = new FileChangeWatcher({
      workspaceRoot: dir,
      glob: '**/*.ts',
      onFire,
      debounceMs: 100,
    });
    await watcher.start();
    try {
      writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
      await waitFor(() => onFire.mock.calls.length >= 1);
      expect(onFire).toHaveBeenCalled();
    } finally {
      await watcher.stop();
    }
  });

  it('does NOT fire for files outside the glob', async () => {
    const onFire = vi.fn();
    const watcher = new FileChangeWatcher({
      workspaceRoot: dir,
      glob: '**/*.ts',
      onFire,
      debounceMs: 100,
    });
    await watcher.start();
    try {
      writeFileSync(join(dir, 'a.md'), '# hi\n');
      // Wait past debounce + a safety margin.
      await new Promise((r) => setTimeout(r, 350));
      expect(onFire).not.toHaveBeenCalled();
    } finally {
      await watcher.stop();
    }
  });

  it('does NOT fire for files in heavy dirs (node_modules)', async () => {
    const onFire = vi.fn();
    const watcher = new FileChangeWatcher({
      workspaceRoot: dir,
      glob: '**/*.ts',
      onFire,
      debounceMs: 100,
    });
    await watcher.start();
    try {
      mkdirSync(join(dir, 'node_modules'), { recursive: true });
      writeFileSync(join(dir, 'node_modules', 'a.ts'), 'x;\n');
      await new Promise((r) => setTimeout(r, 350));
      expect(onFire).not.toHaveBeenCalled();
    } finally {
      await watcher.stop();
    }
  });

  it('debounces multiple writes into a single fire', async () => {
    const onFire = vi.fn();
    const watcher = new FileChangeWatcher({
      workspaceRoot: dir,
      glob: '**/*.ts',
      onFire,
      debounceMs: 200,
    });
    await watcher.start();
    try {
      writeFileSync(join(dir, 'a.ts'), '1;\n');
      writeFileSync(join(dir, 'b.ts'), '2;\n');
      writeFileSync(join(dir, 'c.ts'), '3;\n');
      await waitFor(() => onFire.mock.calls.length >= 1);
      // Give a generous gap to confirm we got exactly one.
      await new Promise((r) => setTimeout(r, 350));
      expect(onFire).toHaveBeenCalledTimes(1);
    } finally {
      await watcher.stop();
    }
  });
});

describe('FileChangeWatcherRegistry', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'opencodex-fwatch-reg-'));
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('starts watchers for desired tasks and stops removed ones', async () => {
    const reg = new FileChangeWatcherRegistry();
    const fired: string[] = [];
    await reg.reconcile(
      [
        { taskId: 't1', workspaceRoot: dir, glob: '**/*.ts' },
        { taskId: 't2', workspaceRoot: dir, glob: '**/*.md' },
      ],
      (id) => {
        fired.push(id);
      },
    );
    expect(reg.size()).toBe(2);

    // Remove t2.
    await reg.reconcile([{ taskId: 't1', workspaceRoot: dir, glob: '**/*.ts' }], (id) => {
      fired.push(id);
    });
    expect(reg.has('t1')).toBe(true);
    expect(reg.has('t2')).toBe(false);

    await reg.stopAll();
  });
});
