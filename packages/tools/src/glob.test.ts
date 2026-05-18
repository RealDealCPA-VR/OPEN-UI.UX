import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { globTool } from './glob';
import { createTmpWorkspace, makeCtx, type TmpWorkspace } from './test-helpers';

describe('glob tool', () => {
  let ws: TmpWorkspace;

  beforeEach(async () => {
    ws = await createTmpWorkspace({
      'a.ts': '',
      'b.js': '',
      'src/index.ts': '',
      'src/nested/deep.ts': '',
      'src/nested/deep.tsx': '',
      'node_modules/dep/index.js': '',
      'dist/out.js': '',
      '.git/HEAD': 'ref: refs/heads/main',
    });
  });

  afterEach(async () => {
    await ws.cleanup();
  });

  it('matches **/*.ts', async () => {
    const result = await globTool.execute({ pattern: '**/*.ts' }, makeCtx(ws.root));
    expect(result.sort()).toEqual(['a.ts', 'src/index.ts', 'src/nested/deep.ts']);
  });

  it('matches brace alternatives', async () => {
    const result = await globTool.execute({ pattern: '**/*.{ts,tsx}' }, makeCtx(ws.root));
    expect(result.sort()).toEqual([
      'a.ts',
      'src/index.ts',
      'src/nested/deep.ts',
      'src/nested/deep.tsx',
    ]);
  });

  it('skips node_modules and .git and dist by default', async () => {
    const result = await globTool.execute({ pattern: '**/*.js' }, makeCtx(ws.root));
    expect(result).toEqual(['b.js']);
  });

  it('honors cwd to scope the search', async () => {
    const result = await globTool.execute({ pattern: '**/*.ts', cwd: 'src' }, makeCtx(ws.root));
    expect(result.sort()).toEqual(['index.ts', 'nested/deep.ts']);
  });

  it('respects maxResults', async () => {
    const result = await globTool.execute({ pattern: '**/*.ts', maxResults: 1 }, makeCtx(ws.root));
    expect(result).toHaveLength(1);
  });
});
