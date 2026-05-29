import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { defineTool } from '@opencodex/core';
import { resolveWithinWorkspace } from './path-guard';

const input = z.object({
  path: z.string().describe('Workspace-relative or absolute path inside the workspace'),
});

export interface DirEntry {
  name: string;
  type: 'file' | 'dir' | 'symlink' | 'other';
}

export const listDirTool = defineTool({
  name: 'list_dir',
  description: 'List immediate entries of a directory, sorted alphabetically (case-insensitive).',
  inputZod: input,
  permissionTier: 'read',
  async execute({ path: requested }, ctx): Promise<DirEntry[]> {
    const resolved = await resolveWithinWorkspace(ctx.workspaceRoot, requested);
    ctx.signal.throwIfAborted();
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    return entries
      .map((e): DirEntry => {
        const type: DirEntry['type'] = e.isDirectory()
          ? 'dir'
          : e.isFile()
            ? 'file'
            : e.isSymbolicLink()
              ? 'symlink'
              : 'other';
        return { name: e.name, type };
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  },
});
