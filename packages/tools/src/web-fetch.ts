import { z } from 'zod';
import type { Tool } from '@opencodex/core';

const input = z.object({ url: z.string().url(), method: z.enum(['GET', 'POST']).optional() });

export const webFetchTool: Tool<z.infer<typeof input>, { status: number; body: string }> = {
  name: 'web_fetch',
  description: 'Fetch a URL (with domain allow-list enforcement)',
  inputSchema: input.shape,
  inputZod: input,
  permissionTier: 'network',
  execute(_input, _ctx) {
    throw new Error('Not implemented — Phase 2 tool task');
  },
};
