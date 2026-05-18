import { z } from 'zod';
import type { Tool } from '@opencodex/core';

const input = z.object({ command: z.string(), timeoutMs: z.number().optional() });

export const runShellTool: Tool<
  z.infer<typeof input>,
  { stdout: string; stderr: string; exitCode: number }
> = {
  name: 'run_shell',
  description: 'Run a shell command sandboxed to the workspace',
  inputSchema: input.shape,
  inputZod: input,
  permissionTier: 'execute',
  execute(_input, _ctx) {
    throw new Error('Not implemented — Phase 2 tool task');
  },
};
