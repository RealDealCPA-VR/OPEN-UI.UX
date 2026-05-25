import { z } from 'zod';
import { promises as fs } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { readIgnoreMatcherForWorkspace, resolveWithinWorkspace } from '@opencodex/tools';
import { registerInvoke } from '../ipc/registry';
import { getSettings } from '../storage/settings';

interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  hasChildren: boolean;
}

const MAX_ENTRIES = 500;

export function registerFileTreeHandlers(): void {
  registerInvoke('file-tree:list', z.object({ path: z.string().optional() }), async (req) => {
    const workspaceRoot = getSettings().activeWorkspace;
    if (!workspaceRoot) return { entries: [], workspaceRoot: null };
    const dir = req.path ? resolveWithinWorkspace(workspaceRoot, req.path) : workspaceRoot;
    const ignore = readIgnoreMatcherForWorkspace(workspaceRoot);
    const out: FileTreeNode[] = [];
    try {
      const dirents = await fs.readdir(dir, { withFileTypes: true });
      for (const dirent of dirents) {
        if (out.length >= MAX_ENTRIES) break;
        const abs = join(dir, dirent.name);
        const rel = relative(workspaceRoot, abs).split(sep).join('/');
        if (rel.length === 0) continue;
        if (ignore.matches(rel)) continue;
        if (dirent.name === '.git') continue;
        const hasChildren = dirent.isDirectory();
        out.push({
          name: dirent.name,
          path: rel,
          isDirectory: dirent.isDirectory(),
          hasChildren,
        });
      }
    } catch {
      return { entries: [], workspaceRoot };
    }
    out.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { entries: out, workspaceRoot };
  });
}
