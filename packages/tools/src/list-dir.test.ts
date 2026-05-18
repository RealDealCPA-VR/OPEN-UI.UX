import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { listDirTool } from './list-dir';
import { PathEscapesWorkspaceError } from './path-guard';
import { createTmpWorkspace, makeCtx, type TmpWorkspace } from './test-helpers';

describe('list_dir tool', () => {
  let ws: TmpWorkspace;

  beforeEach(async () => {
    ws = await createTmpWorkspace({
      'a.txt': 'a',
      'b.txt': 'b',
      'Z.txt': 'z',
      'sub/inner.txt': 'inner',
    });
  });

  afterEach(async () => {
    await ws.cleanup();
  });

  it('lists immediate entries sorted case-insensitively', async () => {
    const result = await listDirTool.execute({ path: '.' }, makeCtx(ws.root));
    expect(result.map((e) => e.name)).toEqual(['a.txt', 'b.txt', 'sub', 'Z.txt']);
  });

  it('classifies file vs dir', async () => {
    const result = await listDirTool.execute({ path: '.' }, makeCtx(ws.root));
    const types = new Map(result.map((e) => [e.name, e.type]));
    expect(types.get('a.txt')).toBe('file');
    expect(types.get('sub')).toBe('dir');
  });

  it('descends into named subdir', async () => {
    const result = await listDirTool.execute({ path: 'sub' }, makeCtx(ws.root));
    expect(result).toEqual([{ name: 'inner.txt', type: 'file' }]);
  });

  it('refuses paths that escape the workspace', async () => {
    await expect(listDirTool.execute({ path: '../..' }, makeCtx(ws.root))).rejects.toBeInstanceOf(
      PathEscapesWorkspaceError,
    );
  });
});
