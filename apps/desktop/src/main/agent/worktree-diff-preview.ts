import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../logger';
import type { WorktreePreviewFile, WorktreePreviewResponse } from '../../shared/agent-tree';
import { getRun } from './run-registry';

const execFileAsync = promisify(execFile);

const SNIPPET_MAX_LINES = 20;

interface ShortstatEntry {
  added: number;
  removed: number;
  path: string;
}

async function runGit(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

function parseNumstat(stdout: string): ShortstatEntry[] {
  const entries: ShortstatEntry[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\t/);
    if (parts.length < 3) continue;
    const addedStr = parts[0]!;
    const removedStr = parts[1]!;
    const filePath = parts[2]!;
    const added = addedStr === '-' ? 0 : Number.parseInt(addedStr, 10);
    const removed = removedStr === '-' ? 0 : Number.parseInt(removedStr, 10);
    if (!Number.isFinite(added) || !Number.isFinite(removed)) continue;
    entries.push({ added, removed, path: filePath });
  }
  return entries;
}

function pickLargest(entries: readonly ShortstatEntry[]): ShortstatEntry | null {
  let best: ShortstatEntry | null = null;
  for (const entry of entries) {
    const delta = entry.added + entry.removed;
    if (!best) {
      best = entry;
      continue;
    }
    if (delta > best.added + best.removed) best = entry;
  }
  return best;
}

function truncateSnippet(snippet: string): string {
  const lines = snippet.split(/\r?\n/);
  if (lines.length <= SNIPPET_MAX_LINES) return snippet;
  return lines.slice(0, SNIPPET_MAX_LINES).join('\n') + '\n…';
}

export async function getWorktreePreview(runId: string): Promise<WorktreePreviewResponse> {
  const run = getRun(runId);
  if (!run) {
    return {
      runId,
      worktreePath: null,
      largestFile: null,
      totalFilesChanged: 0,
      error: 'run not found',
    };
  }
  if (!run.worktreePath) {
    return {
      runId,
      worktreePath: null,
      largestFile: null,
      totalFilesChanged: 0,
    };
  }
  try {
    const numstat = await runGit(run.worktreePath, ['diff', '--numstat', 'HEAD']);
    const entries = parseNumstat(numstat);
    if (entries.length === 0) {
      return {
        runId,
        worktreePath: run.worktreePath,
        largestFile: null,
        totalFilesChanged: 0,
      };
    }
    const largest = pickLargest(entries);
    if (!largest) {
      return {
        runId,
        worktreePath: run.worktreePath,
        largestFile: null,
        totalFilesChanged: entries.length,
      };
    }
    let snippet = '';
    try {
      snippet = await runGit(run.worktreePath, [
        'diff',
        '--no-color',
        '-U2',
        'HEAD',
        '--',
        largest.path,
      ]);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), path: largest.path },
        'worktree-diff-preview: failed to render file diff',
      );
    }
    const largestFile: WorktreePreviewFile = {
      path: largest.path,
      added: largest.added,
      removed: largest.removed,
      hunkSnippet: truncateSnippet(snippet),
    };
    return {
      runId,
      worktreePath: run.worktreePath,
      largestFile,
      totalFilesChanged: entries.length,
    };
  } catch (err) {
    return {
      runId,
      worktreePath: run.worktreePath,
      largestFile: null,
      totalFilesChanged: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const __testOnly = { parseNumstat, pickLargest, truncateSnippet };
