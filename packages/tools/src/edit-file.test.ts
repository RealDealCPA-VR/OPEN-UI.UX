import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { editFileTool, EditFileAmbiguousError, OldStringNotFoundError } from './edit-file';
import { PathEscapesWorkspaceError } from './path-guard';
import { createTmpWorkspace, makeCtx, type TmpWorkspace } from './test-helpers';

describe('edit_file tool', () => {
  let ws: TmpWorkspace;

  beforeEach(async () => {
    ws = await createTmpWorkspace({
      'unique.txt': 'before MARKER after',
      'multi.txt': 'foo bar foo baz foo',
      'special.txt': 'literal: keep as-is',
    });
  });

  afterEach(async () => {
    await ws.cleanup();
  });

  it('replaces a single unique occurrence', async () => {
    const result = await editFileTool.execute(
      { path: 'unique.txt', oldString: 'MARKER', newString: 'REPLACED' },
      makeCtx(ws.root),
    );
    expect(result.replacements).toBe(1);
    const onDisk = await fs.readFile(path.join(ws.root, 'unique.txt'), 'utf8');
    expect(onDisk).toBe('before REPLACED after');
  });

  it('throws OldStringNotFoundError when no match', async () => {
    await expect(
      editFileTool.execute(
        { path: 'unique.txt', oldString: 'missing', newString: 'x' },
        makeCtx(ws.root),
      ),
    ).rejects.toBeInstanceOf(OldStringNotFoundError);
  });

  it('throws EditFileAmbiguousError on multiple matches without replaceAll', async () => {
    await expect(
      editFileTool.execute(
        { path: 'multi.txt', oldString: 'foo', newString: 'x' },
        makeCtx(ws.root),
      ),
    ).rejects.toBeInstanceOf(EditFileAmbiguousError);
    const onDisk = await fs.readFile(path.join(ws.root, 'multi.txt'), 'utf8');
    expect(onDisk).toBe('foo bar foo baz foo');
  });

  it('replaces every occurrence with replaceAll', async () => {
    const result = await editFileTool.execute(
      { path: 'multi.txt', oldString: 'foo', newString: 'qux', replaceAll: true },
      makeCtx(ws.root),
    );
    expect(result.replacements).toBe(3);
    const onDisk = await fs.readFile(path.join(ws.root, 'multi.txt'), 'utf8');
    expect(onDisk).toBe('qux bar qux baz qux');
  });

  it('treats newString as a literal — no $1/$&/$$ pattern expansion', async () => {
    await editFileTool.execute(
      { path: 'special.txt', oldString: 'literal', newString: '$&$1$$' },
      makeCtx(ws.root),
    );
    const onDisk = await fs.readFile(path.join(ws.root, 'special.txt'), 'utf8');
    expect(onDisk).toBe('$&$1$$: keep as-is');
  });

  it('refuses paths that escape the workspace', async () => {
    await expect(
      editFileTool.execute(
        { path: '../escape.txt', oldString: 'a', newString: 'b' },
        makeCtx(ws.root),
      ),
    ).rejects.toBeInstanceOf(PathEscapesWorkspaceError);
  });

  it('rejects empty oldString at the schema level', () => {
    const parsed = editFileTool.inputZod.safeParse({
      path: 'unique.txt',
      oldString: '',
      newString: 'x',
    });
    expect(parsed.success).toBe(false);
  });

  it('honors signal abort before reading', async () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = { ...makeCtx(ws.root), signal: controller.signal };
    await expect(
      editFileTool.execute({ path: 'unique.txt', oldString: 'MARKER', newString: 'x' }, ctx),
    ).rejects.toThrow();
  });
});
