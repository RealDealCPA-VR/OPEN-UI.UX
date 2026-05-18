import { z } from 'zod';
import { defineTool } from '@opencodex/core';

const input = z.object({ url: z.string().url(), method: z.enum(['GET', 'POST']).optional() });

export const webFetchTool = defineTool<z.infer<typeof input>, { status: number; body: string }>({
  name: 'web_fetch',
  description: 'Fetch a URL (with domain allow-list enforcement)',
  inputZod: input,
  permissionTier: 'network',
  execute() {
    throw new Error('Not implemented — Phase 2 network-tool task');
  },
});
