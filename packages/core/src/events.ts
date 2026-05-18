import { z } from 'zod';

export const textDeltaSchema = z.object({
  type: z.literal('text_delta'),
  delta: z.string(),
});

export const toolCallEventSchema = z.object({
  type: z.literal('tool_call'),
  id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.unknown(),
});

export const toolResultEventSchema = z.object({
  type: z.literal('tool_result'),
  id: z.string().min(1),
  output: z.unknown(),
  isError: z.boolean().optional(),
});

export const usageEventSchema = z.object({
  type: z.literal('usage'),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
});

export const stopReasonSchema = z.enum([
  'end_turn',
  'max_tokens',
  'stop_sequence',
  'tool_use',
  'error',
]);

export const doneEventSchema = z.object({
  type: z.literal('done'),
  stopReason: stopReasonSchema,
});

export const errorEventSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
  retryable: z.boolean(),
  cause: z.unknown().optional(),
});

export const chatEventSchema = z.discriminatedUnion('type', [
  textDeltaSchema,
  toolCallEventSchema,
  toolResultEventSchema,
  usageEventSchema,
  doneEventSchema,
  errorEventSchema,
]);

export type TextDelta = z.infer<typeof textDeltaSchema>;
export type ToolCallEvent = z.infer<typeof toolCallEventSchema>;
export type ToolResultEvent = z.infer<typeof toolResultEventSchema>;
export type UsageEvent = z.infer<typeof usageEventSchema>;
export type StopReason = z.infer<typeof stopReasonSchema>;
export type DoneEvent = z.infer<typeof doneEventSchema>;
export type ErrorEvent = z.infer<typeof errorEventSchema>;
export type ChatEvent = z.infer<typeof chatEventSchema>;
