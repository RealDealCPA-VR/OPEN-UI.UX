import { z } from 'zod';
import type { Tool } from '@opencodex/core';

const input = z.object({ path: z.string(), offset: z.number().optional(), limit: z.number().optional() });

export const readFileTool: Tool<z.infer<typeof input>, string> = {
  name: 'read_file',
  description: 'Read a file from the workspace',
  inputSchema: input.shape,
  inputZod: input,
  permissionTier: 'read',
  execute(_input, _ctx) {
    throw new Error('Not implemented — Phase 2 tool task');
  },
};
