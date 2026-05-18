import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { writeFileTool } from './write-file';
import { PathEscapesWorkspaceError } from './path-guard';
import { createTmpWorkspace, makeCtx, type TmpWorkspace } from './test-helpers';

describe('write_file tool', () => {
  let ws: TmpWorkspace;

  beforeEach(async () => {
    ws = await createTmpWorkspace({
      'existing.txt': 'old contents',
    });
  });

  afterEach(async () => {
    await ws.cleanup();
  });

  it('creates a new file', async () => {
    const result = await writeFileTool.execute(
      { path: 'new.txt', content: 'hello world' },
      makeCtx(ws.root),
    );
    expect(result.bytesWritten).toBe(11);
    const onDisk = await fs.readFile(path.join(ws.root, 'new.txt'), 'utf8');
    expect(onDisk).toBe('hello world');
  });

  it('creates parent directories for nested paths', async () => {
    await writeFileTool.execute(
      { path: 'deeply/nested/dir/file.md', content: '# hi' },
      makeCtx(ws.root),
    );
    const onDisk = await fs.readFile(path.join(ws.root, 'deeply/nested/dir/file.md'), 'utf8');
    expect(onDisk).toBe('# hi');
  });

  it('overwrites existing files', async () => {
    await writeFileTool.execute({ path: 'existing.txt', content: 'replaced' }, makeCtx(ws.root));
    const onDisk = await fs.readFile(path.join(ws.root, 'existing.txt'), 'utf8');
    expect(onDisk).toBe('replaced');
  });

  it('counts UTF-8 bytes, not code units', async () => {
    const content = 'café 🎉';
    const result = await writeFileTool.execute({ path: 'utf8.txt', content }, makeCtx(ws.root));
    expect(result.bytesWritten).toBe(Buffer.byteLength(content, 'utf8'));
  });

  it('refuses paths that escape the workspace', async () => {
    await expect(
      writeFileTool.execute({ path: '../escape.txt', content: 'x' }, makeCtx(ws.root)),
    ).rejects.toBeInstanceOf(PathEscapesWorkspaceError);
  });

  it('honors signal abort before writing', async () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = { ...makeCtx(ws.root), signal: controller.signal };
    await expect(
      writeFileTool.execute({ path: 'aborted.txt', content: 'x' }, ctx),
    ).rejects.toThrow();
    await expect(fs.access(path.join(ws.root, 'aborted.txt'))).rejects.toThrow();
  });

  it('leaves no .tmp residue after a successful write', async () => {
    await writeFileTool.execute({ path: 'clean.txt', content: 'ok' }, makeCtx(ws.root));
    const entries = await fs.readdir(ws.root);
    expect(entries.filter((e) => e.endsWith('.tmp'))).toEqual([]);
  });
});
