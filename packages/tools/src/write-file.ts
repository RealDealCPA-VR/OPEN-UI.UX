import { z } from 'zod';
import { defineTool } from '@opencodex/core';

const input = z.object({ path: z.string(), content: z.string() });

export const writeFileTool = defineTool<z.infer<typeof input>, { written: number }>({
  name: 'write_file',
  description: 'Write a file in the workspace (overwrites if exists)',
  inputZod: input,
  permissionTier: 'write',
  execute() {
    throw new Error('Not implemented — Phase 2 write-tool task');
  },
});
