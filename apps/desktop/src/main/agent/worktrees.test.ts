import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, stat, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rmTmp } from '../../test/rm-tmp';
import {
  createWorktree,
  getDiffBundle,
  isGitRepo,
  listWorktrees,
  removeWorktree,
} from './worktrees';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, windowsHide: true });
  return stdout;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function detectGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

const gitAvailable = detectGit();
let baseTmp: string;

beforeAll(async () => {
  baseTmp = await mkdtemp(path.join(tmpdir(), 'opencodex-worktrees-base-'));
});

afterAll(async () => {
  if (baseTmp) {
    await rmTmp(baseTmp);
  }
});

describe('worktrees', () => {
  let repoRoot: string;

  beforeEach(async () => {
    if (!gitAvailable) return;
    repoRoot = await mkdtemp(path.join(baseTmp, 'repo-'));
    await git(repoRoot, ['init', '-q', '-b', 'main']);
    await git(repoRoot, ['config', 'user.email', 'test@opencodex.dev']);
    await git(repoRoot, ['config', 'user.name', 'OpenCodex Test']);
    await git(repoRoot, ['config', 'commit.gpgsign', 'false']);
    await writeFile(path.join(repoRoot, 'README.txt'), 'hello world\n');
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-q', '-m', 'initial']);
  });

  afterEach(async () => {
    if (repoRoot) {
      await rmTmp(repoRoot);
    }
  });

  it.skipIf(!gitAvailable)('isGitRepo returns true inside a git repo', async () => {
    expect(await isGitRepo(repoRoot)).toBe(true);
  });

  it.skipIf(!gitAvailable)('isGitRepo returns false for a non-repo directory', async () => {
    const tmp = await mkdtemp(path.join(baseTmp, 'plain-'));
    try {
      expect(await isGitRepo(tmp)).toBe(false);
    } finally {
      await rmTmp(tmp);
    }
  });

  it.skipIf(!gitAvailable)(
    'isGitRepo returns false for non-absolute or missing paths',
    async () => {
      expect(await isGitRepo('relative/path')).toBe(false);
      expect(await isGitRepo(path.join(baseTmp, 'definitely-not-here-12345'))).toBe(false);
    },
  );

  it.skipIf(!gitAvailable)(
    'createWorktree creates a worktree directory + branch, listWorktrees finds it',
    async () => {
      const wt = await createWorktree(repoRoot);
      expect(path.isAbsolute(wt.path)).toBe(true);
      expect(wt.path.startsWith(path.join(repoRoot, '.opencodex', 'worktrees'))).toBe(true);
      expect(wt.branch).toMatch(/^opencodex\/subagent\/[a-f0-9]+$/);
      expect(await pathExists(wt.path)).toBe(true);
      expect(await pathExists(path.join(wt.path, 'README.txt'))).toBe(true);

      const list = await listWorktrees(repoRoot);
      const found = list.find((w) => path.resolve(w.path) === path.resolve(wt.path));
      expect(found).toBeDefined();
      expect(found?.branch).toBe(wt.branch);

      const branches = await git(repoRoot, ['branch', '--list', wt.branch]);
      expect(branches.trim().length).toBeGreaterThan(0);
    },
  );

  it.skipIf(!gitAvailable)('createWorktree accepts a custom branch name', async () => {
    const wt = await createWorktree(repoRoot, 'feature/custom-branch-name');
    expect(wt.branch).toBe('feature/custom-branch-name');
    const list = await listWorktrees(repoRoot);
    const found = list.find((w) => w.branch === 'feature/custom-branch-name');
    expect(found).toBeDefined();
  });

  it.skipIf(!gitAvailable)(
    'getDiffBundle returns the diff of uncommitted edits in the worktree',
    async () => {
      const wt = await createWorktree(repoRoot);
      const readme = path.join(wt.path, 'README.txt');
      await writeFile(readme, 'hello world\ngoodbye world\n');
      const newFile = path.join(wt.path, 'NEW.txt');
      await writeFile(newFile, 'brand new file\n');
      await git(wt.path, ['add', 'NEW.txt']);

      const diff = await getDiffBundle(wt.path);
      expect(diff).toContain('README.txt');
      expect(diff).toContain('+goodbye world');
      expect(diff).toContain('NEW.txt');
      expect(diff).toContain('+brand new file');
    },
  );

  it.skipIf(!gitAvailable)(
    'getDiffBundle surfaces untracked new files without a manual git add',
    async () => {
      const wt = await createWorktree(repoRoot);
      await writeFile(path.join(wt.path, 'README.txt'), 'hello world\nedited\n');
      await writeFile(path.join(wt.path, 'UNTRACKED.txt'), 'brand new untracked file\n');

      const diff = await getDiffBundle(wt.path);
      expect(diff).toContain('README.txt');
      expect(diff).toContain('+edited');
      expect(diff).toContain('UNTRACKED.txt');
      expect(diff).toContain('+brand new untracked file');
    },
  );

  it.skipIf(!gitAvailable)(
    'getDiffBundle against a prior ref includes committed changes too',
    async () => {
      const baseSha = (await git(repoRoot, ['rev-parse', 'HEAD'])).trim();
      const wt = await createWorktree(repoRoot);
      const newFile = path.join(wt.path, 'committed-in-worktree.txt');
      await writeFile(newFile, 'committed content\n');
      await git(wt.path, ['add', '.']);
      await git(wt.path, ['commit', '-q', '-m', 'subagent edit']);

      const diff = await getDiffBundle(wt.path, baseSha);
      expect(diff).toContain('committed-in-worktree.txt');
      expect(diff).toContain('+committed content');
    },
  );

  it.skipIf(!gitAvailable)(
    'removeWorktree deletes the worktree directory and its branch',
    async () => {
      const wt = await createWorktree(repoRoot);
      expect(await pathExists(wt.path)).toBe(true);

      await removeWorktree(repoRoot, wt.path);

      expect(await pathExists(wt.path)).toBe(false);
      const list = await listWorktrees(repoRoot);
      expect(list.find((w) => path.resolve(w.path) === path.resolve(wt.path))).toBeUndefined();
      const branches = await git(repoRoot, ['branch', '--list', wt.branch]);
      expect(branches.trim()).toBe('');
    },
  );

  it.skipIf(!gitAvailable)(
    'listWorktrees returns the main worktree even with no extras',
    async () => {
      const list = await listWorktrees(repoRoot);
      expect(list.length).toBeGreaterThanOrEqual(1);
      const main = list.find((w) => path.resolve(w.path) === path.resolve(repoRoot));
      expect(main).toBeDefined();
      expect(main?.branch).toBe('main');
    },
  );

  it.skipIf(!gitAvailable)(
    'multiple worktrees can coexist and be removed independently',
    async () => {
      const a = await createWorktree(repoRoot);
      const b = await createWorktree(repoRoot);
      expect(a.path).not.toBe(b.path);
      expect(a.branch).not.toBe(b.branch);

      const list = await listWorktrees(repoRoot);
      expect(list.find((w) => path.resolve(w.path) === path.resolve(a.path))).toBeDefined();
      expect(list.find((w) => path.resolve(w.path) === path.resolve(b.path))).toBeDefined();

      await removeWorktree(repoRoot, a.path);
      const list2 = await listWorktrees(repoRoot);
      expect(list2.find((w) => path.resolve(w.path) === path.resolve(a.path))).toBeUndefined();
      expect(list2.find((w) => path.resolve(w.path) === path.resolve(b.path))).toBeDefined();

      await removeWorktree(repoRoot, b.path);
    },
  );

  it.skipIf(!gitAvailable)('createWorktree rejects non-absolute repoRoot', async () => {
    await expect(createWorktree('relative')).rejects.toThrow(/absolute/i);
  });

  it.skipIf(!gitAvailable)('createWorktree rejects a non-git directory', async () => {
    const tmp = await mkdtemp(path.join(baseTmp, 'plain-'));
    try {
      await expect(createWorktree(tmp)).rejects.toThrow(/git repo/i);
    } finally {
      await rmTmp(tmp);
    }
  });

  it.skipIf(!gitAvailable)('createWorktree rejects a missing path', async () => {
    await expect(createWorktree(path.join(baseTmp, 'never-existed-here-987'))).rejects.toThrow(
      /does not exist/i,
    );
  });

  it.skipIf(!gitAvailable)('edited file content persists in the worktree filesystem', async () => {
    const wt = await createWorktree(repoRoot);
    const target = path.join(wt.path, 'NEW.txt');
    await writeFile(target, 'edited content\n');
    const back = await readFile(target, 'utf-8');
    expect(back).toBe('edited content\n');
  });
});

describe('worktrees (no-git fallback)', () => {
  it('test suite tolerates absence of git', async () => {
    if (gitAvailable) {
      expect(true).toBe(true);
      return;
    }
    const tmp = await mkdtemp(path.join(tmpdir(), 'opencodex-nogit-'));
    try {
      expect(await isGitRepo(tmp)).toBe(false);
    } finally {
      await rmTmp(tmp);
    }
  });
});
