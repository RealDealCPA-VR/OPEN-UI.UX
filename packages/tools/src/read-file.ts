import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { defineTool } from '@opencodex/core';
import { resolveWithinWorkspace } from './path-guard';

const input = z.object({
  path: z.string().describe('Workspace-relative or absolute path inside the workspace'),
  offset: z.number().int().min(0).optional().describe('Zero-based starting line'),
  limit: z.number().int().min(1).optional().describe('Maximum number of lines to return'),
});

export interface ReadFileResult {
  content: string;
  totalLines: number;
  startLine: number;
  endLine: number;
  truncated: boolean;
}

export const readFileTool = defineTool({
  name: 'read_file',
  description: 'Read a UTF-8 text file from the workspace. Optionally slice by line offset/limit.',
  inputZod: input,
  permissionTier: 'read',
  async execute({ path: requested, offset, limit }, ctx): Promise<ReadFileResult> {
    const resolved = resolveWithinWorkspace(ctx.workspaceRoot, requested);
    ctx.signal.throwIfAborted();
    const raw = await fs.readFile(resolved, 'utf8');
    const lines = raw.split(/\r?\n/);
    const totalLines = lines.length;
    const start = offset ?? 0;
    const end = limit != null ? Math.min(totalLines, start + limit) : totalLines;
    const slice = lines.slice(start, end);
    return {
      content: slice.join('\n'),
      totalLines,
      startLine: start,
      endLine: end,
      truncated: end < totalLines,
    };
  },
});
