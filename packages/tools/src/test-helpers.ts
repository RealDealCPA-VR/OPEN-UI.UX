import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ToolContext } from '@opencodex/core';

export interface TmpWorkspace {
  root: string;
  cleanup(): Promise<void>;
}

export async function createTmpWorkspace(
  files: Record<string, string | Uint8Array> = {},
): Promise<TmpWorkspace> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opencodex-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    if (typeof content === 'string') {
      await fs.writeFile(full, content, 'utf8');
    } else {
      await fs.writeFile(full, content);
    }
  }
  return {
    root,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

export function makeCtx(workspaceRoot: string): ToolContext {
  return {
    workspaceRoot,
    signal: new AbortController().signal,
    logger: { info: () => {}, error: () => {} },
  };
}
