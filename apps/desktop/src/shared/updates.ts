import { z } from 'zod';

export const updateStateSchema = z.enum([
  'idle',
  'checking',
  'available',
  'not-available',
  'downloading',
  'downloaded',
  'error',
]);

export type UpdateState = z.infer<typeof updateStateSchema>;

export const updateStatusSchema = z.object({
  state: updateStateSchema,
  version: z.string().nullable().default(null),
  percent: z.number().min(0).max(100).nullable().default(null),
  error: z.string().nullable().default(null),
  autoCheckEnabled: z.boolean(),
});

export type UpdateStatus = z.infer<typeof updateStatusSchema>;

export const updatesCheckResultSchema = z.object({
  ok: z.boolean(),
  state: updateStateSchema,
  version: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
});

export type UpdatesCheckResult = z.infer<typeof updatesCheckResultSchema>;

export const updatesSetAutoCheckRequestSchema = z.object({
  enabled: z.boolean(),
});

export type UpdatesSetAutoCheckRequest = z.infer<typeof updatesSetAutoCheckRequestSchema>;
