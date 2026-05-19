import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFilePreview } from './file-preview';

interface Tmp {
  root: string;
  cleanup(): Promise<void>;
}

async function createTmp(files: Record<string, string | Buffer> = {}): Promise<Tmp> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opencodex-preview-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
  return {
    root,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

describe('readFilePreview', () => {
  let ws: Tmp;

  beforeEach(async () => {
    ws = await createTmp({
      'small.txt': 'hello\nworld',
      'sub/nested.md': '# heading',
    });
  });

  afterEach(async () => {
    await ws.cleanup();
  });

  it('returns content for an existing file', async () => {
    const res = await readFilePreview(ws.root, 'small.txt');
    expect(res.exists).toBe(true);
    expect(res.content).toBe('hello\nworld');
    expect(res.truncated).toBe(false);
    expect(res.sizeBytes).toBe(Buffer.byteLength('hello\nworld', 'utf8'));
  });

  it('returns exists:false for a missing file', async () => {
    const res = await readFilePreview(ws.root, 'does-not-exist.txt');
    expect(res.exists).toBe(false);
    expect(res.content).toBe('');
    expect(res.sizeBytes).toBe(0);
  });

  it('returns exists:false for a directory', async () => {
    const res = await readFilePreview(ws.root, 'sub');
    expect(res.exists).toBe(false);
  });

  it('returns exists:false for a path escaping the workspace', async () => {
    const res = await readFilePreview(ws.root, '../escape.txt');
    expect(res.exists).toBe(false);
  });

  it('truncates files larger than the cap', async () => {
    const big = 'x'.repeat(1024);
    await fs.writeFile(path.join(ws.root, 'big.txt'), big);
    const res = await readFilePreview(ws.root, 'big.txt', 100);
    expect(res.exists).toBe(true);
    expect(res.truncated).toBe(true);
    expect(res.content.length).toBe(100);
    expect(res.sizeBytes).toBe(1024);
  });

  it('reads nested paths', async () => {
    const res = await readFilePreview(ws.root, 'sub/nested.md');
    expect(res.exists).toBe(true);
    expect(res.content).toBe('# heading');
  });
});
