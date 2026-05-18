import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';

export interface WalkOptions {
  ignoreDirs?: ReadonlySet<string>;
  signal?: AbortSignal;
  maxFiles?: number;
}

export const DEFAULT_IGNORE_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.cache',
  '.next',
  '.turbo',
]);

export async function* walkFiles(root: string, options: WalkOptions = {}): AsyncGenerator<string> {
  const ignore = options.ignoreDirs ?? DEFAULT_IGNORE_DIRS;
  const max = options.maxFiles;
  let yielded = 0;

  async function* visit(dir: string): AsyncGenerator<string> {
    options.signal?.throwIfAborted();
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (max != null && yielded >= max) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (ignore.has(entry.name)) continue;
        yield* visit(full);
      } else if (entry.isFile()) {
        yield full;
        yielded++;
      }
    }
  }

  yield* visit(root);
}
