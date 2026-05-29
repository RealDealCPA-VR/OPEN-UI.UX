import { z } from 'zod';
import { promises as fs } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  readIgnoreMatcherForWorkspace,
  resolveWithinWorkspace,
  type IgnoreMatcher,
} from '@opencodex/tools';
import { registerInvoke } from '../ipc/registry';
import { getSettings } from '../storage/settings';

interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  hasChildren: boolean;
}

const MAX_ENTRIES = 500;
const IGNORE_CACHE_TTL_MS = 5_000;

interface IgnoreCacheEntry {
  matcher: IgnoreMatcher;
  expiresAt: number;
}

const ignoreCache = new Map<string, IgnoreCacheEntry>();

function getCachedIgnoreMatcher(workspaceRoot: string): IgnoreMatcher {
  const now = Date.now();
  const hit = ignoreCache.get(workspaceRoot);
  if (hit && hit.expiresAt > now) return hit.matcher;
  const matcher = readIgnoreMatcherForWorkspace(workspaceRoot);
  ignoreCache.set(workspaceRoot, { matcher, expiresAt: now + IGNORE_CACHE_TTL_MS });
  return matcher;
}

export function invalidateIgnoreCache(workspaceRoot?: string): void {
  if (workspaceRoot) ignoreCache.delete(workspaceRoot);
  else ignoreCache.clear();
}

export function registerFileTreeHandlers(): void {
  registerInvoke('file-tree:list', z.object({ path: z.string().optional() }), async (req) => {
    const workspaceRoot = getSettings().activeWorkspace;
    if (!workspaceRoot) {
      return { entries: [], workspaceRoot: null, truncated: false };
    }
    const dir = req.path ? await resolveWithinWorkspace(workspaceRoot, req.path) : workspaceRoot;
    const ignore = getCachedIgnoreMatcher(workspaceRoot);
    const out: FileTreeNode[] = [];
    let truncated = false;
    try {
      const dirents = await fs.readdir(dir, { withFileTypes: true });
      for (const dirent of dirents) {
        if (out.length >= MAX_ENTRIES) {
          truncated = true;
          break;
        }
        const abs = join(dir, dirent.name);
        const rel = relative(workspaceRoot, abs).split(sep).join('/');
        if (rel.length === 0) continue;
        if (ignore.matches(rel)) continue;
        if (dirent.name === '.git') continue;
        out.push({
          name: dirent.name,
          path: rel,
          isDirectory: dirent.isDirectory(),
          hasChildren: false,
        });
      }
    } catch {
      return { entries: [], workspaceRoot, truncated: false };
    }
    out.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { entries: out, workspaceRoot, truncated };
  });

  registerInvoke('file-tree:has-children', z.object({ path: z.string().min(1) }), async (req) => {
    const workspaceRoot = getSettings().activeWorkspace;
    if (!workspaceRoot) return { hasChildren: false };
    let dir: string;
    try {
      dir = await resolveWithinWorkspace(workspaceRoot, req.path);
    } catch {
      return { hasChildren: false };
    }
    const ignore = getCachedIgnoreMatcher(workspaceRoot);
    try {
      const dirents = await fs.readdir(dir, { withFileTypes: true });
      for (const dirent of dirents) {
        const abs = join(dir, dirent.name);
        const rel = relative(workspaceRoot, abs).split(sep).join('/');
        if (rel.length === 0) continue;
        if (dirent.name === '.git') continue;
        if (ignore.matches(rel)) continue;
        return { hasChildren: true };
      }
      return { hasChildren: false };
    } catch {
      return { hasChildren: false };
    }
  });
}
