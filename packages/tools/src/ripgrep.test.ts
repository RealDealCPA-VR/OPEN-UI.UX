import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { grepTool } from './grep';
import { ripgrepSearch } from './ripgrep';
import { createTmpWorkspace, makeCtx, type TmpWorkspace } from './test-helpers';

const rgInstalled = (() => {
  try {
    const r = spawnSync('rg', ['--version'], { stdio: 'ignore' });
    return r.status === 0;
  } catch {
    return false;
  }
})();

describe.runIf(rgInstalled)('ripgrep wrapper', () => {
  let ws: TmpWorkspace;

  beforeEach(async () => {
    ws = await createTmpWorkspace({
      'a.ts': 'import { foo } from "bar";\nexport const x = 1;\n',
      'b.ts': 'export function foo() {\n  return 42;\n}\n',
      'README.md': 'Project intro\nMentions FOO sometimes\n',
      'binary.bin': new Uint8Array([0x00, 0x73, 0x65, 0x63, 0x72, 0x65, 0x74]),
      'node_modules/skipme.ts': 'export const foo = "should-be-ignored";\n',
    });
  });

  afterEach(async () => {
    await ws.cleanup();
  });

  it('grep tool finds matches via rg with same shape as JS impl', async () => {
    const result = await grepTool.execute({ pattern: 'foo' }, makeCtx(ws.root));
    const byFile = new Map(result.map((m) => [m.file, m]));
    expect(byFile.get('a.ts')?.line).toBe(1);
    expect(byFile.get('b.ts')?.line).toBe(1);
  });

  it('grep tool respects DEFAULT_IGNORE_DIRS', async () => {
    const result = await grepTool.execute({ pattern: 'foo' }, makeCtx(ws.root));
    expect(result.find((m) => m.file.startsWith('node_modules/'))).toBeUndefined();
  });

  it('grep tool skips binary files', async () => {
    const result = await grepTool.execute({ pattern: 'secret' }, makeCtx(ws.root));
    expect(result.find((m) => m.file === 'binary.bin')).toBeUndefined();
  });

  it('grep tool honors caseInsensitive', async () => {
    const result = await grepTool.execute(
      { pattern: 'FOO', caseInsensitive: true },
      makeCtx(ws.root),
    );
    const files = new Set(result.map((m) => m.file));
    expect(files.has('README.md')).toBe(true);
  });

  it('grep tool respects maxMatches', async () => {
    const result = await grepTool.execute({ pattern: 'foo', maxMatches: 1 }, makeCtx(ws.root));
    expect(result).toHaveLength(1);
  });

  it('ripgrepSearch returns empty array when nothing matches', async () => {
    const ac = new AbortController();
    const result = await ripgrepSearch({
      pattern: 'definitely-not-in-any-file-xyzzy',
      cwd: ws.root,
      maxMatches: 1000,
      fileSizeLimit: 10 * 1024 * 1024,
      signal: ac.signal,
    });
    expect(result).toEqual([]);
  });

  it('ripgrepSearch filters by user glob', async () => {
    const ac = new AbortController();
    const result = await ripgrepSearch({
      pattern: 'foo',
      cwd: ws.root,
      glob: '**/*.md',
      maxMatches: 1000,
      fileSizeLimit: 10 * 1024 * 1024,
      signal: ac.signal,
    });
    expect(result.every((m) => m.file.endsWith('.md'))).toBe(true);
  });
});

describe.runIf(!rgInstalled)('ripgrep wrapper (skipped: rg not installed)', () => {
  it('skipped', () => {
    expect(true).toBe(true);
  });
});
