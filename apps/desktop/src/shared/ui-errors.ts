import { z } from 'zod';

/**
 * One-shot user-visible error notification, dispatched from the main process to
 * the renderer's toast surface. Use for background subsystem failures (MCP,
 * scheduler, providers) that the user hasn't directly invoked but should know
 * about. Direct IPC handler errors should reject the invoke instead.
 */
export const uiErrorEventSchema = z.object({
  source: z.enum(['mcp', 'scheduler', 'provider', 'plugin', 'memory', 'updater']),
  severity: z.enum(['info', 'warning', 'error']).default('error'),
  message: z.string().min(1),
  detailId: z.string().optional(),
});

export type UiErrorEvent = z.infer<typeof uiErrorEventSchema>;
