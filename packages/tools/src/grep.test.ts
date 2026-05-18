import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { grepTool } from './grep';
import { createTmpWorkspace, makeCtx, type TmpWorkspace } from './test-helpers';

describe('grep tool (JS impl)', () => {
  let ws: TmpWorkspace;

  beforeEach(async () => {
    vi.stubEnv('OPENCODEX_NO_RIPGREP', '1');
    ws = await createTmpWorkspace({
      'a.ts': 'import { foo } from "bar";\nexport const x = 1;\n',
      'b.ts': 'export function foo() {\n  return 42;\n}\n',
      'README.md': 'Project intro\nMentions FOO sometimes\n',
      'binary.bin': new Uint8Array([0x00, 0x73, 0x65, 0x63, 0x72, 0x65, 0x74]),
    });
  });

  afterEach(async () => {
    await ws.cleanup();
    vi.unstubAllEnvs();
  });

  it('finds literal matches and reports 1-based line numbers', async () => {
    const result = await grepTool.execute({ pattern: 'foo' }, makeCtx(ws.root));
    const byFile = new Map(result.map((m) => [m.file, m]));
    expect(byFile.get('a.ts')?.line).toBe(1);
    expect(byFile.get('b.ts')?.line).toBe(1);
  });

  it('filters scanned files by glob', async () => {
    const result = await grepTool.execute({ pattern: 'foo', glob: '**/*.md' }, makeCtx(ws.root));
    expect(result.every((m) => m.file.endsWith('.md'))).toBe(true);
  });

  it('caseInsensitive matches both cases', async () => {
    const upper = await grepTool.execute(
      { pattern: 'FOO', caseInsensitive: true },
      makeCtx(ws.root),
    );
    const files = new Set(upper.map((m) => m.file));
    expect(files.has('a.ts')).toBe(true);
    expect(files.has('README.md')).toBe(true);
  });

  it('skips binary files (null-byte detection)', async () => {
    const result = await grepTool.execute({ pattern: 'secret' }, makeCtx(ws.root));
    expect(result.find((m) => m.file === 'binary.bin')).toBeUndefined();
  });

  it('respects maxMatches', async () => {
    const result = await grepTool.execute({ pattern: 'foo', maxMatches: 1 }, makeCtx(ws.root));
    expect(result).toHaveLength(1);
  });
});
