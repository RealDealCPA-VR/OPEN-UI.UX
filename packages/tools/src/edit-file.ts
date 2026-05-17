import { z } from 'zod';
import type { Tool } from '@opencodex/core';

const input = z.object({ path: z.string(), oldString: z.string(), newString: z.string(), replaceAll: z.boolean().optional() });

export const editFileTool: Tool<z.infer<typeof input>, { replacements: number }> = {
  name: 'edit_file',
  description: 'Replace exact string in a file',
  inputSchema: input.shape,
  inputZod: input,
  permissionTier: 'write',
  execute(_input, _ctx) {
    throw new Error('Not implemented — Phase 2 tool task');
  },
};
