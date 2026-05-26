import { watch, type FSWatcher } from 'chokidar';
import { logger } from '../logger';

const DEFAULT_FLUSH_MS = 250;

export interface SkillsWatcherOptions {
  flushIntervalMs?: number;
  onChange: () => void;
}

export class SkillsWatcher {
  private fsWatcher: FSWatcher | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private flushIntervalMs: number;
  private onChange: () => void;

  constructor(options: SkillsWatcherOptions) {
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_MS;
    this.onChange = options.onChange;
  }

  get isWatching(): boolean {
    return this.fsWatcher !== null;
  }

  async start(roots: ReadonlyArray<string>): Promise<void> {
    await this.stop();
    const filtered = roots.filter((r): r is string => typeof r === 'string' && r.length > 0);
    if (filtered.length === 0) return;
    let watcher: FSWatcher;
    try {
      watcher = watch(filtered, {
        ignoreInitial: true,
        persistent: true,
        followSymlinks: false,
        ignorePermissionErrors: true,
        depth: 3,
      });
    } catch (err) {
      logger.warn({ err, roots: filtered }, 'skills watcher: failed to start');
      return;
    }
    const handler = (): void => this.schedule();
    watcher.on('add', handler);
    watcher.on('change', handler);
    watcher.on('unlink', handler);
    watcher.on('addDir', handler);
    watcher.on('unlinkDir', handler);
    watcher.on('error', (err) => logger.warn({ err }, 'skills watcher: error'));
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
      try {
        await w.close();
      } catch (err) {
        logger.warn({ err }, 'skills watcher: close failed');
      }
    }
  }

  private schedule(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      try {
        this.onChange();
      } catch (err) {
        logger.warn({ err }, 'skills watcher: onChange threw');
      }
    }, this.flushIntervalMs);
  }
}
