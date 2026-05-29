import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../logger';
import { isGitRepo } from '../agent/worktrees';
import {
  slugifyConversationTitle,
  type GitBranchFromConversationRequest,
  type GitBranchFromConversationResponse,
} from '../../shared/git-workflow';

const execFileAsync = promisify(execFile);

export interface ConversationLookup {
  (id: string): { title: string } | undefined;
}

export interface BranchFromConversationDeps {
  lookupConversation: ConversationLookup;
  resolveRepoRoot: () => string | null;
  runGit?: (cwd: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;
}

async function defaultRunGit(
  cwd: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('git', [...args], {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return { stdout, stderr };
}

async function branchExists(
  runGit: BranchFromConversationDeps['runGit'],
  repoRoot: string,
  branch: string,
): Promise<boolean> {
  const fn = runGit ?? defaultRunGit;
  try {
    await fn(repoRoot, ['rev-parse', '--verify', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

async function nextAvailableBranchName(
  runGit: BranchFromConversationDeps['runGit'],
  repoRoot: string,
  base: string,
): Promise<string> {
  if (!(await branchExists(runGit, repoRoot, base))) return base;
  for (let n = 2; n <= 99; n++) {
    const candidate = `${base}-${n}`;
    if (!(await branchExists(runGit, repoRoot, candidate))) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export function buildBranchName(title: string): string {
  return `oc/${slugifyConversationTitle(title)}`;
}

export async function branchFromConversation(
  req: GitBranchFromConversationRequest,
  deps: BranchFromConversationDeps,
): Promise<GitBranchFromConversationResponse> {
  const conv = deps.lookupConversation(req.conversationId);
  if (!conv) {
    return { ok: false, error: `unknown conversation: ${req.conversationId}` };
  }
  const repoRoot = req.repoRoot ?? deps.resolveRepoRoot();
  if (!repoRoot) {
    return { ok: false, error: 'no active workspace / repoRoot' };
  }
  if (!(await isGitRepo(repoRoot))) {
    return { ok: false, error: `not a git repo: ${repoRoot}` };
  }
  const runGit = deps.runGit ?? defaultRunGit;
  const baseBranchName = buildBranchName(conv.title);
  let branch: string;
  try {
    branch = await nextAvailableBranchName(runGit, repoRoot, baseBranchName);
    const baseArgs = req.baseRef
      ? ['checkout', '-b', branch, req.baseRef]
      : ['checkout', '-b', branch];
    await runGit(repoRoot, baseArgs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err: message, repoRoot, conversationId: req.conversationId },
      'branchFromConversation failed',
    );
    return { ok: false, error: message };
  }
  return { ok: true, branch, repoRoot };
}
