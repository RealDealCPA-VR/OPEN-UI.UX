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
  'cancelled',
  'budget_exceeded',
  'content_filter',
]);

export const doneEventSchema = z.object({
  type: z.literal('done'),
  stopReason: stopReasonSchema,
});

export const errorCodeSchema = z.enum([
  'rate_limit',
  'auth',
  'context_length',
  'invalid_request',
  'network',
  'server',
  'timeout',
  'content_filter',
  'cancelled',
  'unknown',
]);

export const errorEventSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
  retryable: z.boolean(),
  cause: z.unknown().optional(),
  code: errorCodeSchema.optional(),
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
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type ErrorEvent = z.infer<typeof errorEventSchema>;
export type ChatEvent = z.infer<typeof chatEventSchema>;

/**
 * Map an HTTP status (and optional provider-side error type label) to a
 * normalized ErrorCode. Providers SHOULD call this when emitting `error`
 * events so callers get a consistent classification across providers.
 */
export function mapHttpStatusToErrorCode(status: number, providerErrorType?: string): ErrorCode {
  const t = providerErrorType?.toLowerCase();
  if (t) {
    if (t.includes('rate') || t.includes('quota')) return 'rate_limit';
    if (t.includes('auth') || t.includes('permission') || t.includes('forbidden')) return 'auth';
    if (t.includes('context') || t.includes('length') || t.includes('token'))
      return 'context_length';
    if (t.includes('content_filter') || t.includes('safety') || t.includes('policy')) {
      return 'content_filter';
    }
    if (t.includes('cancel') || t.includes('abort')) return 'cancelled';
    if (t.includes('timeout')) return 'timeout';
    if (t.includes('invalid') || t.includes('bad_request')) return 'invalid_request';
  }
  if (status === 0) return 'network';
  if (status === 401 || status === 403) return 'auth';
  if (status === 408) return 'timeout';
  if (status === 413) return 'context_length';
  if (status === 429) return 'rate_limit';
  if (status === 499) return 'cancelled';
  if (status >= 400 && status < 500) return 'invalid_request';
  if (status >= 500) return 'server';
  return 'unknown';
}
