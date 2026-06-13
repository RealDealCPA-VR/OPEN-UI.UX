import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rmTmp } from '../../test/rm-tmp';
import { commitHunks } from './commit-hunks';

const execFileAsync = promisify(execFile);

async function hasGit(): Promise<boolean> {
  try {
    await execFileAsync('git', ['--version'], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

const gitAvailable = await hasGit();
const describeIfGit = gitAvailable ? describe : describe.skip;

describeIfGit('commitHunks (real git repo)', () => {
  let repoRoot: string;

  beforeAll(async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'oc-commit-hunks-'));
    const run = async (args: readonly string[]): Promise<void> => {
      await execFileAsync('git', [...args], { cwd: repoRoot, windowsHide: true });
    };
    await run(['init', '-b', 'main']);
    await run(['config', 'user.email', 'test@example.com']);
    await run(['config', 'user.name', 'test']);
    await run(['config', 'commit.gpgsign', 'false']);
    await writeFile(path.join(repoRoot, 'a.txt'), 'hello\n', 'utf8');
    await run(['add', 'a.txt']);
    await run(['commit', '-m', 'init']);
  });

  afterAll(async () => {
    if (repoRoot) {
      try {
        await rmTmp(repoRoot);
      } catch {
        // best-effort
      }
    }
  });

  it('applies a hunk patch and creates a commit', async () => {
    const patch = `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1 +1,2 @@
 hello
+world
`;
    const result = await commitHunks({
      repoRoot,
      message: 'add world line',
      hunks: [{ filePath: 'a.txt', patch }],
    });
    expect(result.ok).toBe(true);
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.rejectedFiles).toEqual([]);
  });

  it('reports rejected files when a patch does not apply', async () => {
    const badPatch = `diff --git a/missing.txt b/missing.txt
--- a/missing.txt
+++ b/missing.txt
@@ -1 +1 @@
-nothing
+something
`;
    const result = await commitHunks({
      repoRoot,
      message: 'bad patch',
      hunks: [{ filePath: 'missing.txt', patch: badPatch }],
    });
    expect(result.ok).toBe(false);
    expect(result.rejectedFiles).toContain('missing.txt');
  });
});
