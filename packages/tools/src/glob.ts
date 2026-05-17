import { z } from 'zod';
import type { Tool } from '@opencodex/core';

const input = z.object({ pattern: z.string(), cwd: z.string().optional() });

export const globTool: Tool<z.infer<typeof input>, string[]> = {
  name: 'glob',
  description: 'Find files matching a glob pattern',
  inputSchema: input.shape,
  inputZod: input,
  permissionTier: 'read',
  execute(_input, _ctx) {
    throw new Error('Not implemented — Phase 2 tool task');
  },
};
