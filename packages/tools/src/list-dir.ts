import { z } from 'zod';
import type { Tool } from '@opencodex/core';

const input = z.object({ path: z.string() });

export const listDirTool: Tool<z.infer<typeof input>, { name: string; type: 'file' | 'dir' }[]> = {
  name: 'list_dir',
  description: 'List directory entries',
  inputSchema: input.shape,
  inputZod: input,
  permissionTier: 'read',
  execute(_input, _ctx) {
    throw new Error('Not implemented — Phase 2 tool task');
  },
};
