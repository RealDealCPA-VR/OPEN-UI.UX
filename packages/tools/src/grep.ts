import { z } from 'zod';
import type { Tool } from '@opencodex/core';

const input = z.object({
  pattern: z.string(),
  path: z.string().optional(),
  glob: z.string().optional(),
  caseInsensitive: z.boolean().optional(),
});

export const grepTool: Tool<
  z.infer<typeof input>,
  { file: string; line: number; text: string }[]
> = {
  name: 'grep',
  description: 'Search file contents with a regex (ripgrep)',
  inputSchema: input.shape,
  inputZod: input,
  permissionTier: 'read',
  execute(_input, _ctx) {
    throw new Error('Not implemented — Phase 2 tool task');
  },
};
