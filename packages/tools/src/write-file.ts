import { z } from 'zod';
import { defineTool } from '@opencodex/core';
import { atomicWrite } from './atomic-write';
import { resolveWithinWorkspace } from './path-guard';

const input = z.object({
  path: z.string().describe('Workspace-relative or absolute path inside the workspace'),
  content: z.string().describe('UTF-8 file contents. Overwrites if the file already exists.'),
});

export interface WriteFileResult {
  bytesWritten: number;
}

export const writeFileTool = defineTool({
  name: 'write_file',
  description:
    'Write a UTF-8 text file in the workspace. Creates parent directories. Overwrites if the file exists.',
  inputZod: input,
  permissionTier: 'write',
  async execute({ path: requested, content }, ctx): Promise<WriteFileResult> {
    const resolved = resolveWithinWorkspace(ctx.workspaceRoot, requested);
    await atomicWrite(resolved, content, ctx.signal);
    return { bytesWritten: Buffer.byteLength(content, 'utf8') };
  },
});
