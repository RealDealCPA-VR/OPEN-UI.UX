import { z } from 'zod';
import { defineTool } from '@opencodex/core';

const input = z.object({ command: z.string(), timeoutMs: z.number().optional() });

export const runShellTool = defineTool<
  z.infer<typeof input>,
  { stdout: string; stderr: string; exitCode: number }
>({
  name: 'run_shell',
  description: 'Run a shell command sandboxed to the workspace',
  inputZod: input,
  permissionTier: 'execute',
  execute() {
    throw new Error('Not implemented — Phase 2 shell-sandbox task');
  },
});
