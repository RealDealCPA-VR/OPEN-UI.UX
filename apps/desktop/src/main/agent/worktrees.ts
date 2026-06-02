import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { logger } from '../logger';

const execFileAsync = promisify(execFile);

export interface WorktreeInfo {
  path: string;
  branch: string;
}

const GIT = 'git';
const WORKTREE_PARENT_DIR = '.opencodex';
const WORKTREE_DIR = 'worktrees';
const BRANCH_PREFIX = 'opencodex/subagent/';

async function ensureAbsoluteExistingDir(p: string): Promise<void> {
  if (!path.isAbsolute(p)) {
    throw new Error(`path must be absolute: ${p}`);
  }
  let s;
  try {
    s = await stat(p);
  } catch {
    throw new Error(`path does not exist: ${p}`);
  }
  if (!s.isDirectory()) {
    throw new Error(`path is not a directory: ${p}`);
  }
}

async function runGit(
  cwd: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(GIT, [...args], {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    return { stdout, stderr };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    const detail = (e.stderr ?? e.stdout ?? e.message ?? '').toString().trim();
    throw new Error(`git ${args.join(' ')} failed: ${detail}`);
  }
}

export async function isGitRepo(p: string): Promise<boolean> {
  if (!path.isAbsolute(p)) return false;
  try {
    const s = await stat(p);
    if (!s.isDirectory()) return false;
  } catch {
    return false;
  }
  try {
    await execFileAsync(GIT, ['rev-parse', '--git-dir'], {
      cwd: p,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

function randomSuffix(): string {
  return randomBytes(6).toString('hex');
}

export async function createWorktree(repoRoot: string, branch?: string): Promise<WorktreeInfo> {
  await ensureAbsoluteExistingDir(repoRoot);
  if (!(await isGitRepo(repoRoot))) {
    throw new Error(`not a git repo: ${repoRoot}`);
  }
  const id = randomSuffix();
  const branchName = branch ?? `${BRANCH_PREFIX}${id}`;
  const worktreePath = path.join(repoRoot, WORKTREE_PARENT_DIR, WORKTREE_DIR, id);

  await runGit(repoRoot, ['worktree', 'add', '-b', branchName, worktreePath, 'HEAD']);
  logger.debug({ worktreePath, branchName }, 'created git worktree');
  return { path: worktreePath, branch: branchName };
}

async function branchExists(repoRoot: string, branch: string): Promise<boolean> {
  try {
    await execFileAsync(GIT, ['rev-parse', '--verify', `refs/heads/${branch}`], {
      cwd: repoRoot,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

export async function removeWorktree(repoRoot: string, worktreePath: string): Promise<void> {
  await ensureAbsoluteExistingDir(repoRoot);
  if (!path.isAbsolute(worktreePath)) {
    throw new Error(`worktreePath must be absolute: ${worktreePath}`);
  }

  const list = await listWorktrees(repoRoot);
  const match = list.find((w) => path.resolve(w.path) === path.resolve(worktreePath));

  try {
    await runGit(repoRoot, ['worktree', 'remove', '--force', worktreePath]);
  } catch (err) {
    logger.debug({ err, worktreePath }, 'git worktree remove failed; continuing');
  }

  if (match && (await branchExists(repoRoot, match.branch))) {
    try {
      await runGit(repoRoot, ['branch', '-D', match.branch]);
    } catch (err) {
      logger.debug({ err, branch: match.branch }, 'git branch -D failed; continuing');
    }
  }
}

export async function listWorktrees(repoRoot: string): Promise<WorktreeInfo[]> {
  await ensureAbsoluteExistingDir(repoRoot);
  if (!(await isGitRepo(repoRoot))) {
    throw new Error(`not a git repo: ${repoRoot}`);
  }
  const { stdout } = await runGit(repoRoot, ['worktree', 'list', '--porcelain']);
  return parseWorktreePorcelain(stdout);
}

function parseWorktreePorcelain(stdout: string): WorktreeInfo[] {
  const result: WorktreeInfo[] = [];
  let currentPath: string | undefined;
  let currentBranch: string | undefined;
  let detached = false;

  const flush = () => {
    if (currentPath !== undefined) {
      const branch = currentBranch ?? (detached ? '(detached)' : '');
      result.push({ path: currentPath, branch });
    }
    currentPath = undefined;
    currentBranch = undefined;
    detached = false;
  };

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line === '') {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length);
    } else if (line.startsWith('branch ')) {
      const refName = line.slice('branch '.length);
      currentBranch = refName.startsWith('refs/heads/')
        ? refName.slice('refs/heads/'.length)
        : refName;
    } else if (line === 'detached') {
      detached = true;
    }
  }
  flush();
  return result;
}

/**
 * Stage every change in the worktree (modifications, deletions, and brand-new
 * untracked files) so they are visible to `git diff HEAD` and to a subsequent
 * commit/merge. Subagent tools write files directly to disk and never stage,
 * so without this step untracked files are invisible and the branch never
 * advances. Safe to call repeatedly; a no-op when the tree is clean.
 */
export async function stageWorktree(worktreePath: string): Promise<void> {
  await ensureAbsoluteExistingDir(worktreePath);
  if (!(await isGitRepo(worktreePath))) {
    throw new Error(`not a git repo: ${worktreePath}`);
  }
  await runGit(worktreePath, ['add', '-A']);
}

/**
 * Stage and commit the current worktree state so the worktree branch advances
 * past the base HEAD. Returns true when a commit was created, false when there
 * was nothing to commit (clean tree). The commit is what `acceptMerge` later
 * merges; without it the merge is a no-op ("Already up to date").
 */
export async function commitWorktree(worktreePath: string, message: string): Promise<boolean> {
  await stageWorktree(worktreePath);
  const { stdout } = await runGit(worktreePath, ['status', '--porcelain']);
  if (stdout.trim() === '') {
    return false;
  }
  await runGit(worktreePath, ['commit', '--no-gpg-sign', '-m', message]);
  return true;
}

export async function getDiffBundle(
  worktreePath: string,
  baseRef: string = 'HEAD',
): Promise<string> {
  await ensureAbsoluteExistingDir(worktreePath);
  if (!(await isGitRepo(worktreePath))) {
    throw new Error(`not a git repo: ${worktreePath}`);
  }
  // Stage first so untracked files written by subagent tools appear in the diff.
  await runGit(worktreePath, ['add', '-A']);
  const { stdout } = await runGit(worktreePath, ['diff', '--cached', baseRef]);
  return stdout;
}
