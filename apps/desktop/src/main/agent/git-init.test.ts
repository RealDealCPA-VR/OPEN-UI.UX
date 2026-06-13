import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rmTmp } from '../../test/rm-tmp';
import { initGitRepo } from './git-init';

const execFileAsync = promisify(execFile);

function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, windowsHide: true });
  return stdout;
}

const gitAvailable = hasGit();
let baseTmp: string;

beforeAll(async () => {
  baseTmp = await mkdtemp(path.join(tmpdir(), 'opencodex-git-init-base-'));
});

afterAll(async () => {
  if (baseTmp) {
    await rmTmp(baseTmp);
  }
});

describe('initGitRepo', () => {
  let workspace: string;

  beforeEach(async () => {
    if (!gitAvailable) return;
    workspace = await mkdtemp(path.join(baseTmp, 'ws-'));
  });

  afterEach(async () => {
    if (workspace) {
      await rmTmp(workspace);
    }
  });

  it.skipIf(!gitAvailable)('refuses a non-absolute workspacePath', async () => {
    const res = await initGitRepo({ workspacePath: 'relative/path' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/absolute/i);
  });

  it.skipIf(!gitAvailable)('refuses a path that does not exist', async () => {
    const phantom = path.join(baseTmp, 'never-existed-here-9876');
    const res = await initGitRepo({ workspacePath: phantom });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/does not exist/i);
  });

  it.skipIf(!gitAvailable)('refuses a workspace already inside a git repo', async () => {
    await git(workspace, ['init', '-q', '-b', 'main']);
    const res = await initGitRepo({ workspacePath: workspace });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already/i);
  });

  it.skipIf(!gitAvailable)('happy path creates .git and reports branch=main', async () => {
    const res = await initGitRepo({ workspacePath: workspace });
    expect(res.ok).toBe(true);
    expect(res.branch).toBe('main');
    expect(await pathExists(path.join(workspace, '.git'))).toBe(true);
  });

  it.skipIf(!gitAvailable)('with initialCommit=true also creates an initial commit', async () => {
    await writeFile(path.join(workspace, 'README.txt'), 'hello\n');
    const prevEmail = process.env.GIT_AUTHOR_EMAIL;
    const prevName = process.env.GIT_AUTHOR_NAME;
    const prevCEmail = process.env.GIT_COMMITTER_EMAIL;
    const prevCName = process.env.GIT_COMMITTER_NAME;
    const prevCfgCount = process.env.GIT_CONFIG_COUNT;
    const prevCfgK = process.env.GIT_CONFIG_KEY_0;
    const prevCfgV = process.env.GIT_CONFIG_VALUE_0;
    process.env.GIT_AUTHOR_EMAIL = 'test@opencodex.dev';
    process.env.GIT_AUTHOR_NAME = 'OpenCodex Test';
    process.env.GIT_COMMITTER_EMAIL = 'test@opencodex.dev';
    process.env.GIT_COMMITTER_NAME = 'OpenCodex Test';
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'commit.gpgsign';
    process.env.GIT_CONFIG_VALUE_0 = 'false';
    try {
      const res = await initGitRepo({ workspacePath: workspace, initialCommit: true });
      expect(res.ok).toBe(true);
      const log = await git(workspace, ['log', '--oneline']);
      expect(log.trim().length).toBeGreaterThan(0);
      expect(log.trim().split('\n').length).toBe(1);
    } finally {
      if (prevEmail === undefined) delete process.env.GIT_AUTHOR_EMAIL;
      else process.env.GIT_AUTHOR_EMAIL = prevEmail;
      if (prevName === undefined) delete process.env.GIT_AUTHOR_NAME;
      else process.env.GIT_AUTHOR_NAME = prevName;
      if (prevCEmail === undefined) delete process.env.GIT_COMMITTER_EMAIL;
      else process.env.GIT_COMMITTER_EMAIL = prevCEmail;
      if (prevCName === undefined) delete process.env.GIT_COMMITTER_NAME;
      else process.env.GIT_COMMITTER_NAME = prevCName;
      if (prevCfgCount === undefined) delete process.env.GIT_CONFIG_COUNT;
      else process.env.GIT_CONFIG_COUNT = prevCfgCount;
      if (prevCfgK === undefined) delete process.env.GIT_CONFIG_KEY_0;
      else process.env.GIT_CONFIG_KEY_0 = prevCfgK;
      if (prevCfgV === undefined) delete process.env.GIT_CONFIG_VALUE_0;
      else process.env.GIT_CONFIG_VALUE_0 = prevCfgV;
    }
  });
});

describe('initGitRepo (no-git fallback)', () => {
  it('test suite tolerates absence of git', () => {
    expect(true).toBe(true);
  });
});
