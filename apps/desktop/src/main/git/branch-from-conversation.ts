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

async function isValidRefName(
  runGit: BranchFromConversationDeps['runGit'],
  repoRoot: string,
  ref: string,
): Promise<boolean> {
  if (ref.length === 0) return false;
  if (ref.startsWith('-')) return false;
  const fn = runGit ?? defaultRunGit;
  try {
    await fn(repoRoot, ['check-ref-format', '--allow-onelevel', ref]);
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
  if (req.baseRef !== undefined && !(await isValidRefName(runGit, repoRoot, req.baseRef))) {
    return { ok: false, error: `invalid baseRef: ${req.baseRef}` };
  }
  const baseBranchName = buildBranchName(conv.title);
  let branch: string;
  try {
    branch = await nextAvailableBranchName(runGit, repoRoot, baseBranchName);
    const baseArgs = req.baseRef
      ? ['checkout', '-b', branch, req.baseRef, '--']
      : ['checkout', '-b', branch, '--'];
    await runGit(repoRoot, baseArgs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err: scrubGitErrorMessage(message), repoRoot, conversationId: req.conversationId },
      'branchFromConversation failed',
    );
    return { ok: false, error: scrubGitErrorMessage(message) };
  }
  return { ok: true, branch, repoRoot };
}

export function scrubGitErrorMessage(raw: string): string {
  let out = raw;
  out = out.replace(/https?:\/\/[^\s:@]+:[^\s@]+@[^\s]+/g, (match) => {
    const at = match.lastIndexOf('@');
    const proto = match.indexOf('://');
    return at > 0 && proto >= 0
      ? `${match.slice(0, proto + 3)}***@${match.slice(at + 1)}`
      : '[redacted-url]';
  });
  out = out.replace(/(Authorization:|Bearer\s+)[^\s"']+/gi, '$1[redacted]');
  out = out.replace(
    /(password|token|secret)["'\s:=]+[^\s"']+/gi,
    (_m, k: string) => `${k}=[redacted]`,
  );
  return out;
}
