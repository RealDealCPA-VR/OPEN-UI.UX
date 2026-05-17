import { z } from 'zod';
import type { Tool } from '@opencodex/core';

const input = z.object({ path: z.string(), content: z.string() });

export const writeFileTool: Tool<z.infer<typeof input>, { written: number }> = {
  name: 'write_file',
  description: 'Write a file in the workspace (overwrites if exists)',
  inputSchema: input.shape,
  inputZod: input,
  permissionTier: 'write',
  execute(_input, _ctx) {
    throw new Error('Not implemented — Phase 2 tool task');
  },
};
