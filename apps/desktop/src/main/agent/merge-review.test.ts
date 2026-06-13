import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rmTmp } from '../../test/rm-tmp';
import { acceptMerge, parseChangedFiles, prepareMergeBundle, rejectMerge } from './merge-review';
import { __resetForTests, recordComplete, recordStart } from './run-registry';
import { createWorktree } from './worktrees';
import type { SubagentResult } from './subagent';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, windowsHide: true });
  return stdout;
}

function detectGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function fakeResult(): SubagentResult {
  return {
    text: 'done',
    toolEvents: [],
    inputTokens: 0,
    outputTokens: 0,
    stopReason: 'end_turn',
    iterations: 1,
  };
}

const gitAvailable = detectGit();
let baseTmp: string;

beforeAll(async () => {
  baseTmp = await mkdtemp(path.join(tmpdir(), 'opencodex-merge-review-'));
});

afterAll(async () => {
  if (baseTmp) await rmTmp(baseTmp);
});

describe('parseChangedFiles', () => {
  it('returns empty array for empty diff', () => {
    expect(parseChangedFiles('')).toEqual([]);
  });

  it('parses a single-file modify diff', () => {
    const diff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      'index abc..def 100644',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');
    expect(parseChangedFiles(diff)).toEqual(['src/foo.ts']);
  });

  it('parses multiple files', () => {
    const diff = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      'diff --git a/b/dir/c.ts b/b/dir/c.ts',
      '--- a/b/dir/c.ts',
      '+++ b/b/dir/c.ts',
    ].join('\n');
    expect(parseChangedFiles(diff)).toEqual(['a.ts', 'b/dir/c.ts']);
  });

  it('deduplicates repeated files', () => {
    const diff = [
      'diff --git a/x.ts b/x.ts',
      'diff --git a/x.ts b/x.ts',
      'diff --git a/y.ts b/y.ts',
    ].join('\n');
    expect(parseChangedFiles(diff)).toEqual(['x.ts', 'y.ts']);
  });

  it('handles CRLF line endings', () => {
    const diff = ['diff --git a/win.ts b/win.ts', 'diff --git a/lin.ts b/lin.ts'].join('\r\n');
    expect(parseChangedFiles(diff)).toEqual(['win.ts', 'lin.ts']);
  });

  it('ignores non-diff lines that look similar', () => {
    const diff = [
      'this is a header',
      'diff --git a/real.ts b/real.ts',
      '+ diff --git a/fake.ts b/fake.ts',
    ].join('\n');
    expect(parseChangedFiles(diff)).toEqual(['real.ts']);
  });

  it('returns empty for malformed diff --git lines', () => {
    expect(parseChangedFiles('diff --git\ndiff --git a/x\n')).toEqual([]);
  });
});

describe('prepareMergeBundle / accept / reject', () => {
  let repoRoot: string;

  beforeEach(async () => {
    __resetForTests();
    if (!gitAvailable) return;
    repoRoot = await mkdtemp(path.join(baseTmp, 'repo-'));
    await git(repoRoot, ['init', '-q', '-b', 'main']);
    await git(repoRoot, ['config', 'user.email', 'test@opencodex.dev']);
    await git(repoRoot, ['config', 'user.name', 'OpenCodex Test']);
    await git(repoRoot, ['config', 'commit.gpgsign', 'false']);
    await writeFile(path.join(repoRoot, 'README.txt'), 'hello\n');
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-q', '-m', 'init']);
  });

  afterEach(async () => {
    __resetForTests();
    if (repoRoot) {
      // Detach any worktrees still registered under repoRoot before deleting
      // it — a live worktree keeps git metadata (and on Windows, handles)
      // pointing into the directory we are about to remove.
      try {
        const porcelain = await git(repoRoot, ['worktree', 'list', '--porcelain']);
        const worktreePaths = porcelain
          .split(/\r?\n/)
          .filter((line) => line.startsWith('worktree '))
          .map((line) => line.slice('worktree '.length))
          .filter((p) => path.resolve(p) !== path.resolve(repoRoot));
        for (const wtPath of worktreePaths) {
          await git(repoRoot, ['worktree', 'remove', '--force', wtPath]).catch(() => undefined);
        }
        await git(repoRoot, ['worktree', 'prune']);
      } catch {
        // repoRoot may already be gone or not a repo — nothing to detach.
      }
      await rmTmp(repoRoot);
    }
  });

  it('throws when runId unknown', async () => {
    await expect(prepareMergeBundle('does-not-exist')).rejects.toThrow(/unknown subagent run/i);
  });

  it('throws when run has no worktree', async () => {
    const id = recordStart({ task: 't', providerId: 'p', modelId: 'm' });
    await expect(prepareMergeBundle(id)).rejects.toThrow(/no associated worktree/i);
  });

  it.skipIf(!gitAvailable)('returns bundle with diff + files for a worktree run', async () => {
    const wt = await createWorktree(repoRoot);
    const id = recordStart({
      task: 'edit',
      providerId: 'p',
      modelId: 'm',
      worktreePath: wt.path,
      worktreeBranch: wt.branch,
      worktreeRepoRoot: repoRoot,
    });
    recordComplete(id, fakeResult());
    await writeFile(path.join(wt.path, 'README.txt'), 'hello\nnew line\n');
    await writeFile(path.join(wt.path, 'NEW.txt'), 'created\n');
    await git(wt.path, ['add', 'NEW.txt']);

    const bundle = await prepareMergeBundle(id);
    expect(bundle.runId).toBe(id);
    expect(bundle.branch).toBe(wt.branch);
    expect(bundle.diff).toContain('README.txt');
    expect(bundle.files).toContain('README.txt');
    expect(bundle.files).toContain('NEW.txt');
  });

  it.skipIf(!gitAvailable)(
    'prepareMergeBundle surfaces untracked files without a manual git add',
    async () => {
      const wt = await createWorktree(repoRoot);
      const id = recordStart({
        task: 'edit',
        providerId: 'p',
        modelId: 'm',
        worktreePath: wt.path,
        worktreeBranch: wt.branch,
        worktreeRepoRoot: repoRoot,
      });
      recordComplete(id, fakeResult());
      // Subagent writes files directly; nothing stages them.
      await writeFile(path.join(wt.path, 'README.txt'), 'hello\nnew line\n');
      await writeFile(path.join(wt.path, 'BRAND_NEW.txt'), 'created by subagent\n');

      const bundle = await prepareMergeBundle(id);
      expect(bundle.files).toContain('README.txt');
      expect(bundle.files).toContain('BRAND_NEW.txt');
      expect(bundle.diff).toContain('created by subagent');
    },
  );

  it.skipIf(!gitAvailable)(
    'acceptMerge commits and merges uncommitted subagent changes (incl. new files)',
    async () => {
      const wt = await createWorktree(repoRoot);
      const id = recordStart({
        task: 'edit',
        providerId: 'p',
        modelId: 'm',
        worktreePath: wt.path,
        worktreeBranch: wt.branch,
        worktreeRepoRoot: repoRoot,
      });
      recordComplete(id, fakeResult());
      // No manual commit/add: mirror the real subagent flow.
      await writeFile(path.join(wt.path, 'GENERATED.txt'), 'subagent output\n');
      await writeFile(path.join(repoRoot, 'README.txt'), 'hello\n'); // base unchanged

      const outcome = await acceptMerge(id);
      expect(outcome.ok).toBe(true);

      // The new file must exist on the base branch after merge.
      const merged = await git(repoRoot, ['show', 'HEAD:GENERATED.txt']);
      expect(merged).toContain('subagent output');

      const branches = await git(repoRoot, ['branch', '--list', wt.branch]);
      expect(branches.trim()).toBe('');
    },
  );

  it.skipIf(!gitAvailable)('acceptMerge merges branch and removes worktree', async () => {
    const wt = await createWorktree(repoRoot);
    const id = recordStart({
      task: 'edit',
      providerId: 'p',
      modelId: 'm',
      worktreePath: wt.path,
      worktreeBranch: wt.branch,
      worktreeRepoRoot: repoRoot,
    });
    await writeFile(path.join(wt.path, 'NEW.txt'), 'subagent change\n');
    await git(wt.path, ['add', '.']);
    await git(wt.path, ['commit', '-q', '-m', 'subagent edit']);

    const outcome = await acceptMerge(id);
    expect(outcome.ok).toBe(true);

    const log = await git(repoRoot, ['log', '--oneline']);
    expect(log).toMatch(/subagent edit/);

    const branches = await git(repoRoot, ['branch', '--list', wt.branch]);
    expect(branches.trim()).toBe('');
  });

  it.skipIf(!gitAvailable)('rejectMerge removes worktree without merging', async () => {
    const wt = await createWorktree(repoRoot);
    const id = recordStart({
      task: 'edit',
      providerId: 'p',
      modelId: 'm',
      worktreePath: wt.path,
      worktreeBranch: wt.branch,
      worktreeRepoRoot: repoRoot,
    });
    await writeFile(path.join(wt.path, 'NEW.txt'), 'discard\n');
    await git(wt.path, ['add', '.']);
    await git(wt.path, ['commit', '-q', '-m', 'subagent reject']);

    const beforeLog = await git(repoRoot, ['log', '--oneline']);
    const outcome = await rejectMerge(id);
    expect(outcome.ok).toBe(true);

    const afterLog = await git(repoRoot, ['log', '--oneline']);
    expect(afterLog).toBe(beforeLog);

    const branches = await git(repoRoot, ['branch', '--list', wt.branch]);
    expect(branches.trim()).toBe('');
  });

  it('acceptMerge returns error for unknown runId', async () => {
    const outcome = await acceptMerge('nope');
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/unknown/i);
  });

  it('rejectMerge returns error for unknown runId', async () => {
    const outcome = await rejectMerge('nope');
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/unknown/i);
  });

  it('acceptMerge fails when run has no worktree', async () => {
    const id = recordStart({ task: 't', providerId: 'p', modelId: 'm' });
    const outcome = await acceptMerge(id);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/no associated worktree/i);
  });
});
