import { describe, expect, it, vi } from 'vitest';
import { fetchReviewDiff, parseUnifiedDiffToFiles, parseHunks } from './review-engine';

const SAMPLE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index 1111111..2222222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 export function foo(): number {
-  return 1;
+  return 2;
+  // changed
 }
diff --git a/src/bar.ts b/src/bar.ts
index aaaaaaa..bbbbbbb 100644
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -10,2 +10,3 @@
 const x = 1;
+const y = 2;
 const z = 3;
`;

describe('parseUnifiedDiffToFiles', () => {
  it('extracts files with added/removed counts', () => {
    const files = parseUnifiedDiffToFiles(SAMPLE_DIFF);
    expect(files).toHaveLength(2);
    expect(files[0]?.path).toBe('src/foo.ts');
    expect(files[0]?.added).toBe(2);
    expect(files[0]?.removed).toBe(1);
    expect(files[1]?.path).toBe('src/bar.ts');
    expect(files[1]?.added).toBe(1);
    expect(files[1]?.removed).toBe(0);
  });

  it('infers language from extension', () => {
    const files = parseUnifiedDiffToFiles(SAMPLE_DIFF);
    expect(files[0]?.language).toBe('typescript');
  });

  it('returns empty array for empty diff', () => {
    expect(parseUnifiedDiffToFiles('')).toEqual([]);
    expect(parseUnifiedDiffToFiles('   \n  ')).toEqual([]);
  });

  it('extracts hunks with line ranges', () => {
    const files = parseUnifiedDiffToFiles(SAMPLE_DIFF);
    const hunks = files[0]?.hunks ?? [];
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.startLine).toBe(1);
    expect(hunks[0]?.newStartLine).toBe(1);
  });
});

describe('parseHunks', () => {
  it('handles multiple hunks in one file body', () => {
    const body = `@@ -1,2 +1,2 @@
 a
-b
+B
@@ -10,2 +10,2 @@
 x
-y
+Y
`;
    const hunks = parseHunks(body);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]?.startLine).toBe(1);
    expect(hunks[1]?.startLine).toBe(10);
  });
});

describe('fetchReviewDiff', () => {
  it('calls git for local-branch source', async () => {
    const execGit = vi.fn().mockResolvedValue(SAMPLE_DIFF);
    const execGh = vi.fn();
    const diff = await fetchReviewDiff(
      { kind: 'local-branch', base: 'main', head: 'HEAD', cwd: '/tmp/repo' },
      { execGit, execGh },
    );
    expect(execGit).toHaveBeenCalledWith('/tmp/repo', ['diff', 'main...HEAD']);
    expect(execGh).not.toHaveBeenCalled();
    expect(diff.files).toHaveLength(2);
    expect(diff.baseRef).toBe('main');
    expect(diff.headRef).toBe('HEAD');
  });

  it('calls gh for github-pr-number source', async () => {
    const execGit = vi.fn();
    const execGh = vi.fn().mockResolvedValue(SAMPLE_DIFF);
    const diff = await fetchReviewDiff(
      { kind: 'github-pr-number', number: 42, cwd: '/tmp/repo' },
      { execGit, execGh },
    );
    expect(execGh).toHaveBeenCalledWith('/tmp/repo', ['pr', 'diff', '42']);
    expect(diff.prNumber).toBe(42);
    expect(diff.files).toHaveLength(2);
  });

  it('parses PR number from URL and calls gh', async () => {
    const execGit = vi.fn();
    const execGh = vi.fn().mockResolvedValue(SAMPLE_DIFF);
    const diff = await fetchReviewDiff(
      {
        kind: 'gh-pr-url',
        url: 'https://github.com/acme/repo/pull/123',
        cwd: '/tmp/repo',
      },
      { execGit, execGh },
    );
    expect(execGh).toHaveBeenCalledWith('/tmp/repo', ['pr', 'diff', '123']);
    expect(diff.prNumber).toBe(123);
    expect(diff.prUrl).toBe('https://github.com/acme/repo/pull/123');
  });

  it('throws on unparseable PR URL', async () => {
    const execGh = vi.fn();
    await expect(
      fetchReviewDiff(
        { kind: 'gh-pr-url', url: 'https://github.com/acme/repo/issues/1', cwd: '/x' },
        { execGh, execGit: vi.fn() },
      ),
    ).rejects.toThrow(/Could not parse PR number/);
  });
});
