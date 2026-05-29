import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { defineTool, type ToolContext } from '@opencodex/core';
import { resolveWithinWorkspace } from './path-guard';
import { globToRegExp } from './glob-match';
import { walkFiles } from './walk';
import { isRipgrepAvailable, ripgrepSearch } from './ripgrep';

const input = z.object({
  pattern: z.string().describe('Regular expression to search for'),
  path: z
    .string()
    .optional()
    .describe('Workspace-relative directory to search (default: workspace root)'),
  glob: z
    .string()
    .optional()
    .describe('Filename glob to limit which files are scanned, e.g. "**/*.ts"'),
  caseInsensitive: z.boolean().optional(),
  maxMatches: z
    .number()
    .int()
    .min(1)
    .max(10000)
    .optional()
    .describe('Maximum matches to return (default: 1000)'),
});

export interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

const BINARY_PROBE_BYTES = 4096;
const FILE_SIZE_LIMIT = 10 * 1024 * 1024;

export const grepTool = defineTool({
  name: 'grep',
  description:
    'Search file contents in the workspace with a regular expression. Returns one entry per matching line. Skips binary and oversize files.',
  inputZod: input,
  permissionTier: 'read',
  async execute(
    { pattern, path: searchPath, glob, caseInsensitive, maxMatches },
    ctx,
  ): Promise<GrepMatch[]> {
    const base = searchPath
      ? await resolveWithinWorkspace(ctx.workspaceRoot, searchPath)
      : path.resolve(ctx.workspaceRoot);
    const limit = maxMatches ?? 1000;

    if (!process.env.OPENCODEX_NO_RIPGREP && (await isRipgrepAvailable())) {
      try {
        return await ripgrepSearch({
          pattern,
          cwd: base,
          glob,
          caseInsensitive,
          maxMatches: limit,
          fileSizeLimit: FILE_SIZE_LIMIT,
          signal: ctx.signal,
        });
      } catch (err) {
        if (ctx.signal.aborted) throw err;
        ctx.logger?.error?.('ripgrep failed, falling back to JS impl', { err });
      }
    }

    return grepWithJs(pattern, base, glob, caseInsensitive, limit, ctx);
  },
});

async function grepWithJs(
  pattern: string,
  base: string,
  glob: string | undefined,
  caseInsensitive: boolean | undefined,
  limit: number,
  ctx: ToolContext,
): Promise<GrepMatch[]> {
  const regex = new RegExp(pattern, caseInsensitive ? 'i' : '');
  const fileFilter = glob ? globToRegExp(glob) : null;
  const matches: GrepMatch[] = [];

  for await (const file of walkFiles(base, { signal: ctx.signal, maxFiles: 100_000 })) {
    ctx.signal.throwIfAborted();
    const rel = path.relative(base, file).split(path.sep).join('/');
    if (fileFilter && !fileFilter.test(rel)) continue;
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      continue;
    }
    if (stat.size > FILE_SIZE_LIMIT) continue;
    const buf = await fs.readFile(file);
    if (looksBinary(buf)) continue;
    const text = buf.toString('utf8');
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (regex.test(line)) {
        matches.push({ file: rel, line: i + 1, text: line });
        if (matches.length >= limit) return matches;
      }
    }
  }
  return matches;
}

function looksBinary(buf: Buffer): boolean {
  const probe = buf.subarray(0, Math.min(buf.length, BINARY_PROBE_BYTES));
  for (let i = 0; i < probe.length; i++) {
    if (probe[i] === 0) return true;
  }
  return false;
}
