import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { logger } from '../logger';
import { isGitRepo } from '../agent/worktrees';
import type {
  GitCommitHunksRequest,
  GitCommitHunksResponse,
  HunkPatch,
} from '../../shared/git-workflow';

const execFileAsync = promisify(execFile);

export interface CommitHunksDeps {
  runGit?: (cwd: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;
  workDir?: string;
}

async function defaultRunGit(
  cwd: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('git', [...args], {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return { stdout, stderr };
}

async function applyPatchToIndex(
  runGit: NonNullable<CommitHunksDeps['runGit']>,
  repoRoot: string,
  patch: HunkPatch,
  scratchDir: string,
): Promise<{ ok: boolean; error?: string }> {
  const safeBase = patch.filePath.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const file = path.join(scratchDir, `${Date.now()}-${safeBase}.patch`);
  await writeFile(file, ensureTrailingNewline(patch.patch), 'utf8');
  try {
    await runGit(repoRoot, ['apply', '--cached', '--whitespace=nowarn', file]);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith('\n') ? s : `${s}\n`;
}

export async function commitHunks(
  req: GitCommitHunksRequest,
  deps: CommitHunksDeps = {},
): Promise<GitCommitHunksResponse> {
  if (!(await isGitRepo(req.repoRoot))) {
    return { ok: false, error: `not a git repo: ${req.repoRoot}` };
  }
  const runGit = deps.runGit ?? defaultRunGit;
  const scratchDir = deps.workDir ?? (await mkdtemp(path.join(tmpdir(), 'opencodex-hunks-')));

  const rejectedFiles: string[] = [];
  const accepted: HunkPatch[] = [];

  try {
    for (const h of req.hunks) {
      const r = await applyPatchToIndex(runGit, req.repoRoot, h, scratchDir);
      if (r.ok) accepted.push(h);
      else {
        logger.warn({ filePath: h.filePath, err: r.error }, 'commitHunks: hunk apply failed');
        rejectedFiles.push(h.filePath);
      }
    }
    if (accepted.length === 0) {
      return {
        ok: false,
        rejectedFiles,
        error: 'no hunks applied successfully',
      };
    }
    const args = req.signoff
      ? ['commit', '--signoff', '-m', req.message]
      : ['commit', '-m', req.message];
    await runGit(req.repoRoot, args);
    const { stdout } = await runGit(req.repoRoot, ['rev-parse', 'HEAD']);
    const sha = stdout.trim();
    return { ok: true, commitSha: sha, rejectedFiles };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message }, 'commitHunks failed');
    return { ok: false, error: message, rejectedFiles };
  } finally {
    if (!deps.workDir) {
      try {
        await rm(scratchDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
}
