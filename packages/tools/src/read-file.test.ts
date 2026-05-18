import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { readFileTool } from './read-file';
import { PathEscapesWorkspaceError } from './path-guard';
import { createTmpWorkspace, makeCtx, type TmpWorkspace } from './test-helpers';

describe('read_file tool', () => {
  let ws: TmpWorkspace;

  beforeEach(async () => {
    ws = await createTmpWorkspace({
      'hello.txt': 'line 1\nline 2\nline 3\nline 4\nline 5',
      'sub/nested.md': '# heading\n\nbody',
    });
  });

  afterEach(async () => {
    await ws.cleanup();
  });

  it('reads a whole file', async () => {
    const result = await readFileTool.execute({ path: 'hello.txt' }, makeCtx(ws.root));
    expect(result.content).toBe('line 1\nline 2\nline 3\nline 4\nline 5');
    expect(result.totalLines).toBe(5);
    expect(result.truncated).toBe(false);
  });

  it('slices by offset and limit', async () => {
    const result = await readFileTool.execute(
      { path: 'hello.txt', offset: 1, limit: 2 },
      makeCtx(ws.root),
    );
    expect(result.content).toBe('line 2\nline 3');
    expect(result.startLine).toBe(1);
    expect(result.endLine).toBe(3);
    expect(result.truncated).toBe(true);
  });

  it('reads nested paths', async () => {
    const result = await readFileTool.execute({ path: 'sub/nested.md' }, makeCtx(ws.root));
    expect(result.content).toContain('# heading');
  });

  it('refuses paths that escape the workspace', async () => {
    await expect(
      readFileTool.execute({ path: '../escape.txt' }, makeCtx(ws.root)),
    ).rejects.toBeInstanceOf(PathEscapesWorkspaceError);
  });

  it('honors signal abort before reading', async () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = { ...makeCtx(ws.root), signal: controller.signal };
    await expect(readFileTool.execute({ path: 'hello.txt' }, ctx)).rejects.toThrow();
  });
});
