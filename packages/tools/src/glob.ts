import path from 'node:path';
import { z } from 'zod';
import { defineTool } from '@opencodex/core';
import { resolveWithinWorkspace } from './path-guard';
import { globToRegExp } from './glob-match';
import { walkFiles } from './walk';

const input = z.object({
  pattern: z.string().describe('Glob pattern, e.g. "**/*.ts" or "src/**/*.{ts,tsx}"'),
  cwd: z
    .string()
    .optional()
    .describe('Workspace-relative directory to search from (default: workspace root)'),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(10000)
    .optional()
    .describe('Maximum matches to return (default: 1000)'),
});

export const globTool = defineTool({
  name: 'glob',
  description:
    'Find files in the workspace matching a glob pattern. Supports *, **, ?, and {a,b} brace expansion. Ignores node_modules, .git, dist, build, out by default. Returns workspace-relative paths.',
  inputZod: input,
  permissionTier: 'read',
  async execute({ pattern, cwd, maxResults }, ctx): Promise<string[]> {
    const base = cwd
      ? resolveWithinWorkspace(ctx.workspaceRoot, cwd)
      : path.resolve(ctx.workspaceRoot);
    const regex = globToRegExp(pattern);
    const limit = maxResults ?? 1000;
    const matches: string[] = [];
    for await (const file of walkFiles(base, { signal: ctx.signal, maxFiles: 100_000 })) {
      const rel = path.relative(base, file).split(path.sep).join('/');
      if (regex.test(rel)) {
        matches.push(rel);
        if (matches.length >= limit) break;
      }
    }
    return matches;
  },
});
