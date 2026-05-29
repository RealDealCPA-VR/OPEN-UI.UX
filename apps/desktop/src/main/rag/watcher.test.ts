import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  WorkspaceWatcher,
  setWatchedWorkspace,
  stopWatchedWorkspace,
  getWatchedWorkspace,
  type WatcherBatch,
} from './watcher';

interface Tmp {
  root: string;
  cleanup(): Promise<void>;
}

async function createTmp(): Promise<Tmp> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opencodex-watcher-test-'));
  return {
    root,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('timed out'));
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

describe('WorkspaceWatcher', () => {
  let tmp: Tmp;
  let watcher: WorkspaceWatcher;

  beforeEach(async () => {
    tmp = await createTmp();
    watcher = new WorkspaceWatcher({ flushIntervalMs: 80 });
  });

  afterEach(async () => {
    await watcher.stop();
    await tmp.cleanup();
  });

  it('coalesces add, change, and unlink into batched callbacks', async () => {
    const batches: WatcherBatch[] = [];
    await watcher.start(tmp.root, (b) => {
      batches.push(b);
    });

    const target = path.join(tmp.root, 'hello.txt');
    await fs.writeFile(target, 'first');
    await waitFor(() => batches.some((b) => b.added.includes('hello.txt')));

    await delay(120);
    await fs.writeFile(target, 'second');
    await waitFor(() => batches.some((b) => b.changed.includes('hello.txt')));

    await delay(120);
    await fs.unlink(target);
    await waitFor(() => batches.some((b) => b.removed.includes('hello.txt')));

    const allAdded = batches.flatMap((b) => b.added);
    const allChanged = batches.flatMap((b) => b.changed);
    const allRemoved = batches.flatMap((b) => b.removed);
    expect(allAdded).toContain('hello.txt');
    expect(allChanged).toContain('hello.txt');
    expect(allRemoved).toContain('hello.txt');
  });

  it('ignores heavy directories like node_modules', async () => {
    const batches: WatcherBatch[] = [];
    await watcher.start(tmp.root, (b) => {
      batches.push(b);
    });

    await fs.mkdir(path.join(tmp.root, 'node_modules', 'foo'), { recursive: true });
    await fs.writeFile(path.join(tmp.root, 'node_modules', 'foo', 'index.js'), 'x');
    await fs.writeFile(path.join(tmp.root, 'kept.txt'), 'y');

    await waitFor(() => batches.some((b) => b.added.includes('kept.txt')));
    const seen = batches.flatMap((b) => [...b.added, ...b.changed, ...b.removed]);
    expect(seen.some((p) => p.startsWith('node_modules/'))).toBe(false);
  });

  it('respects .gitignore patterns', async () => {
    await fs.writeFile(path.join(tmp.root, '.gitignore'), 'secrets.txt\n');

    const batches: WatcherBatch[] = [];
    await watcher.start(tmp.root, (b) => {
      batches.push(b);
    });

    await fs.writeFile(path.join(tmp.root, 'secrets.txt'), 'hidden');
    await fs.writeFile(path.join(tmp.root, 'visible.txt'), 'seen');

    await waitFor(() => batches.some((b) => b.added.includes('visible.txt')));
    const seen = batches.flatMap((b) => [...b.added, ...b.changed, ...b.removed]);
    expect(seen).not.toContain('secrets.txt');
  });

  it('re-reads .gitignore when it changes', async () => {
    const batches: WatcherBatch[] = [];
    await watcher.start(tmp.root, (b) => {
      batches.push(b);
    });

    await fs.writeFile(path.join(tmp.root, 'first.log'), 'visible at first');
    await waitFor(() => batches.some((b) => b.added.includes('first.log')));

    await fs.writeFile(path.join(tmp.root, '.gitignore'), '*.log\n');
    await delay(300);

    await fs.writeFile(path.join(tmp.root, 'second.log'), 'should be ignored now');
    await fs.writeFile(path.join(tmp.root, 'kept.txt'), 'still visible');
    await waitFor(() => batches.some((b) => b.added.includes('kept.txt')));

    await delay(200);
    const allAdded = batches.flatMap((b) => b.added);
    expect(allAdded).toContain('first.log');
    expect(allAdded).not.toContain('second.log');
  });

  it('stops cleanly and emits no further events after stop', async () => {
    const batches: WatcherBatch[] = [];
    await watcher.start(tmp.root, (b) => {
      batches.push(b);
    });
    await watcher.stop();
    expect(watcher.isWatching).toBe(false);
    expect(watcher.root).toBe(null);

    await fs.writeFile(path.join(tmp.root, 'late.txt'), 'too late');
    await delay(200);
    const seen = batches.flatMap((b) => [...b.added, ...b.changed, ...b.removed]);
    expect(seen).not.toContain('late.txt');
  });
});

describe('setWatchedWorkspace singleton', () => {
  let tmpA: Tmp;
  let tmpB: Tmp;

  beforeEach(async () => {
    tmpA = await createTmp();
    tmpB = await createTmp();
  });

  afterEach(async () => {
    await stopWatchedWorkspace();
    await tmpA.cleanup();
    await tmpB.cleanup();
  });

  it('serializes concurrent transitions so prior close finishes before next start', async () => {
    const noop = (): void => undefined;
    const p1 = setWatchedWorkspace(tmpA.root, noop);
    const p2 = setWatchedWorkspace(tmpB.root, noop);
    await Promise.all([p1, p2]);
    expect(getWatchedWorkspace()).toBe(tmpB.root);
  });

  it('stop after rapid swaps still closes everything', async () => {
    const noop = (): void => undefined;
    await Promise.all([
      setWatchedWorkspace(tmpA.root, noop),
      setWatchedWorkspace(tmpB.root, noop),
      setWatchedWorkspace(null, noop),
    ]);
    await stopWatchedWorkspace();
    expect(getWatchedWorkspace()).toBeNull();
  });
});
