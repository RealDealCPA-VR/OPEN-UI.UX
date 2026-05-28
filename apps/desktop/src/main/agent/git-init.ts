import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { GitInitRequest, GitInitResult } from '../../shared/runner-discovery';
import { isGitRepo } from './worktrees';

const execFileAsync = promisify(execFile);

const GIT = 'git';

async function runGit(cwd: string, args: readonly string[]): Promise<void> {
  await execFileAsync(GIT, [...args], { cwd, windowsHide: true });
}

export async function initGitRepo(req: GitInitRequest): Promise<GitInitResult> {
  const { workspacePath, initialCommit } = req;
  try {
    if (!path.isAbsolute(workspacePath)) {
      return { ok: false, error: `workspacePath must be absolute: ${workspacePath}` };
    }
    let st;
    try {
      st = await stat(workspacePath);
    } catch {
      return { ok: false, error: `workspacePath does not exist: ${workspacePath}` };
    }
    if (!st.isDirectory()) {
      return { ok: false, error: `workspacePath is not a directory: ${workspacePath}` };
    }
    if (await isGitRepo(workspacePath)) {
      return { ok: false, error: `path is already inside a git repo: ${workspacePath}` };
    }

    await runGit(workspacePath, ['init', '-b', 'main']);

    if (initialCommit) {
      await runGit(workspacePath, ['add', '.']);
      await runGit(workspacePath, ['commit', '--allow-empty', '-m', 'Initial commit']);
    }

    return { ok: true, branch: 'main' };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string | Buffer; stdout?: string | Buffer };
    const detail =
      (typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString()) ??
      (typeof e.stdout === 'string' ? e.stdout : e.stdout?.toString()) ??
      e.message ??
      'git init failed';
    return { ok: false, error: detail.toString().trim() };
  }
}
