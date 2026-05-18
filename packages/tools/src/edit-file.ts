import { z } from 'zod';
import { defineTool } from '@opencodex/core';

const input = z.object({
  path: z.string(),
  oldString: z.string(),
  newString: z.string(),
  replaceAll: z.boolean().optional(),
});

export const editFileTool = defineTool<z.infer<typeof input>, { replacements: number }>({
  name: 'edit_file',
  description: 'Replace exact string in a file',
  inputZod: input,
  permissionTier: 'write',
  execute() {
    throw new Error('Not implemented — Phase 2 write-tool task');
  },
});
