import { watch, type FSWatcher } from 'chokidar';
import { relative, sep } from 'node:path';
import { readIgnoreMatcherForWorkspace, type IgnoreMatcher } from '@opencodex/tools';

export interface WatcherBatch {
  added: string[];
  changed: string[];
  removed: string[];
}

export type WatcherChangeHandler = (batch: WatcherBatch) => void;

export interface WatcherOptions {
  /** Debounce window in ms before flushing a coalesced batch. */
  flushIntervalMs?: number;
}

const HEAVY_DIRS = new Set<string>([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  '.next',
  '.turbo',
  'coverage',
]);

const DEFAULT_FLUSH_MS = 250;

function toRelPosix(workspaceRoot: string, abs: string): string {
  return relative(workspaceRoot, abs).split(sep).join('/');
}

function isInHeavyDir(rel: string): boolean {
  if (rel.length === 0) return false;
  for (const segment of rel.split('/')) {
    if (HEAVY_DIRS.has(segment)) return true;
  }
  return false;
}

export class WorkspaceWatcher {
  private fsWatcher: FSWatcher | null = null;
  private workspaceRoot: string | null = null;
  private ignore: IgnoreMatcher | null = null;
  private handler: WatcherChangeHandler | null = null;
  private flushIntervalMs: number;
  private flushTimer: NodeJS.Timeout | null = null;
  private pendingAdded = new Set<string>();
  private pendingChanged = new Set<string>();
  private pendingRemoved = new Set<string>();

  constructor(options: WatcherOptions = {}) {
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_MS;
  }

  /** Returns true when a watcher is currently running. */
  get isWatching(): boolean {
    return this.fsWatcher !== null;
  }

  /** Currently watched workspace root, or null if stopped. */
  get root(): string | null {
    return this.workspaceRoot;
  }

  async start(workspaceRoot: string, onChange: WatcherChangeHandler): Promise<void> {
    await this.stop();
    this.workspaceRoot = workspaceRoot;
    this.handler = onChange;
    this.ignore = readIgnoreMatcherForWorkspace(workspaceRoot);

    const watcher = watch(workspaceRoot, {
      ignoreInitial: true,
      persistent: true,
      followSymlinks: false,
      ignorePermissionErrors: true,
      ignored: (path: string): boolean => this.shouldIgnore(path),
    });

    watcher.on('add', (p) => this.handleFsEvent('added', p));
    watcher.on('change', (p) => this.handleFsEvent('changed', p));
    watcher.on('unlink', (p) => this.handleFsEvent('removed', p));

    this.fsWatcher = watcher;
    await new Promise<void>((resolve) => watcher.once('ready', () => resolve()));
  }

  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.fsWatcher) {
      const w = this.fsWatcher;
      this.fsWatcher = null;
      await w.close();
    }
    this.pendingAdded.clear();
    this.pendingChanged.clear();
    this.pendingRemoved.clear();
    this.workspaceRoot = null;
    this.handler = null;
    this.ignore = null;
  }

  private shouldIgnore(path: string): boolean {
    if (!this.workspaceRoot) return false;
    if (path === this.workspaceRoot) return false;
    const rel = toRelPosix(this.workspaceRoot, path);
    if (rel.length === 0 || rel.startsWith('..')) return false;
    if (rel === '.gitignore' || rel === '.opencodexignore') return false;
    if (isInHeavyDir(rel)) return true;
    if (this.ignore?.matches(rel)) return true;
    return false;
  }

  private handleFsEvent(kind: 'added' | 'changed' | 'removed', abs: string): void {
    if (!this.workspaceRoot) return;
    const rel = toRelPosix(this.workspaceRoot, abs);
    if (rel === '.gitignore' || rel === '.opencodexignore') {
      this.ignore = readIgnoreMatcherForWorkspace(this.workspaceRoot);
      return;
    }
    this.queue(kind, abs);
  }

  private queue(kind: 'added' | 'changed' | 'removed', abs: string): void {
    if (!this.workspaceRoot) return;
    const rel = toRelPosix(this.workspaceRoot, abs);
    if (rel.length === 0 || rel.startsWith('..')) return;

    if (kind === 'added') {
      this.pendingRemoved.delete(rel);
      this.pendingAdded.add(rel);
    } else if (kind === 'changed') {
      if (!this.pendingAdded.has(rel)) this.pendingChanged.add(rel);
    } else {
      this.pendingAdded.delete(rel);
      this.pendingChanged.delete(rel);
      this.pendingRemoved.add(rel);
    }
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, this.flushIntervalMs);
  }

  private flush(): void {
    const handler = this.handler;
    if (!handler) return;
    if (
      this.pendingAdded.size === 0 &&
      this.pendingChanged.size === 0 &&
      this.pendingRemoved.size === 0
    ) {
      return;
    }
    const batch: WatcherBatch = {
      added: [...this.pendingAdded].sort(),
      changed: [...this.pendingChanged].sort(),
      removed: [...this.pendingRemoved].sort(),
    };
    this.pendingAdded.clear();
    this.pendingChanged.clear();
    this.pendingRemoved.clear();
    handler(batch);
  }
}

let activeWatcher: WorkspaceWatcher | null = null;
let activeRoot: string | null = null;
let pendingTransition: Promise<void> = Promise.resolve();

/**
 * Updates the singleton workspace watcher. Pass null to stop watching.
 * Safe to call repeatedly; no-ops when target matches the currently watched root.
 *
 * Concurrent calls are serialized so the prior watcher's `close()` always
 * resolves before the next watcher starts — otherwise chokidar handles leak.
 */
export async function setWatchedWorkspace(
  root: string | null,
  onChange: WatcherChangeHandler,
): Promise<void> {
  const next = pendingTransition.then(async () => {
    if (root === activeRoot && activeWatcher !== null) return;
    if (activeWatcher) {
      const prev = activeWatcher;
      activeWatcher = null;
      activeRoot = null;
      await prev.stop();
    }
    if (root === null) return;
    const w = new WorkspaceWatcher();
    await w.start(root, onChange);
    activeWatcher = w;
    activeRoot = root;
  });
  pendingTransition = next.catch(() => undefined);
  return next;
}

export async function stopWatchedWorkspace(): Promise<void> {
  const next = pendingTransition.then(async () => {
    if (!activeWatcher) return;
    const prev = activeWatcher;
    activeWatcher = null;
    activeRoot = null;
    await prev.stop();
  });
  pendingTransition = next.catch(() => undefined);
  return next;
}

export function getWatchedWorkspace(): string | null {
  return activeRoot;
}
