import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../logger';
import { getRun, setMergeStatus } from './run-registry';
import { commitWorktree, getDiffBundle, removeWorktree } from './worktrees';

const execFileAsync = promisify(execFile);

export interface MergeBundle {
  runId: string;
  diff: string;
  files: string[];
  branch: string;
  repoRoot: string;
  worktreePath: string;
}

export interface MergeOutcome {
  ok: boolean;
  error?: string;
}

/**
 * Extract the list of changed file paths from a unified git diff.
 * Looks for lines that start with "diff --git a/<path> b/<path>" and returns
 * the "b/" path (the post-change path). Falls back to the "a/" path if "b/"
 * is missing. Returns paths in stable order, deduplicated.
 */
export function parseChangedFiles(diff: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /^diff --git a\/(.+?) b\/(.+)$/;
  for (const line of diff.split(/\r?\n/)) {
    if (!line.startsWith('diff --git')) continue;
    const m = re.exec(line);
    if (!m) continue;
    const file = m[2] ?? m[1];
    if (!file) continue;
    if (seen.has(file)) continue;
    seen.add(file);
    out.push(file);
  }
  return out;
}

export async function prepareMergeBundle(runId: string): Promise<MergeBundle> {
  const run = getRun(runId);
  if (!run) {
    throw new Error(`unknown subagent run: ${runId}`);
  }
  if (!run.worktreePath || !run.worktreeBranch || !run.worktreeRepoRoot) {
    throw new Error(`subagent run ${runId} has no associated worktree`);
  }
  const diff = await getDiffBundle(run.worktreePath);
  const files = parseChangedFiles(diff);
  return {
    runId,
    diff,
    files,
    branch: run.worktreeBranch,
    repoRoot: run.worktreeRepoRoot,
    worktreePath: run.worktreePath,
  };
}

async function runGit(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', [...args], {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const detail = (e.stderr ?? e.stdout ?? e.message ?? '').toString().trim();
    throw new Error(`git ${args.join(' ')} failed: ${detail}`);
  }
}

export async function acceptMerge(runId: string): Promise<MergeOutcome> {
  const run = getRun(runId);
  if (!run) {
    return { ok: false, error: `unknown subagent run: ${runId}` };
  }
  if (!run.worktreePath || !run.worktreeBranch || !run.worktreeRepoRoot) {
    return { ok: false, error: `subagent run ${runId} has no associated worktree` };
  }
  try {
    // Subagent tools write files directly and never commit, so the worktree
    // branch still points at base HEAD. Commit the worktree state first;
    // otherwise the merge below is a no-op ("Already up to date") and the
    // accepted work is silently dropped.
    await commitWorktree(run.worktreePath, `subagent ${runId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ runId, err: message }, 'commit of worktree before merge failed');
    return { ok: false, error: message };
  }
  try {
    await runGit(run.worktreeRepoRoot, ['merge', '--no-ff', run.worktreeBranch]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ runId, branch: run.worktreeBranch, err: message }, 'merge --no-ff failed');
    return { ok: false, error: message };
  }
  try {
    await removeWorktree(run.worktreeRepoRoot, run.worktreePath);
  } catch (err) {
    logger.warn(
      { runId, err: err instanceof Error ? err.message : String(err) },
      'removeWorktree after merge failed; continuing',
    );
  }
  setMergeStatus(runId, 'merged');
  return { ok: true };
}

export async function rejectMerge(runId: string): Promise<MergeOutcome> {
  const run = getRun(runId);
  if (!run) {
    return { ok: false, error: `unknown subagent run: ${runId}` };
  }
  if (!run.worktreePath || !run.worktreeRepoRoot) {
    return { ok: false, error: `subagent run ${runId} has no associated worktree` };
  }
  try {
    await removeWorktree(run.worktreeRepoRoot, run.worktreePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ runId, err: message }, 'removeWorktree on reject failed');
    return { ok: false, error: message };
  }
  setMergeStatus(runId, 'rejected');
  return { ok: true };
}
