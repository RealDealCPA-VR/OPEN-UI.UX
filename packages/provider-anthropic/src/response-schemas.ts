import { z } from 'zod';

const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  cache_creation_input_tokens: z.number().int().nonnegative().optional(),
  cache_read_input_tokens: z.number().int().nonnegative().optional(),
});

const stopReasonSchema = z.enum(['end_turn', 'max_tokens', 'stop_sequence', 'tool_use']);

const messageStartSchema = z.object({
  type: z.literal('message_start'),
  message: z.object({
    id: z.string(),
    role: z.string(),
    model: z.string().optional(),
    usage: usageSchema.optional(),
  }),
});

const textContentBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

const toolUseContentBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.unknown().optional(),
});

const contentBlockSchema = z.discriminatedUnion('type', [
  textContentBlockSchema,
  toolUseContentBlockSchema,
]);

const contentBlockStartSchema = z.object({
  type: z.literal('content_block_start'),
  index: z.number().int().nonnegative(),
  content_block: contentBlockSchema,
});

const textDeltaSchema = z.object({
  type: z.literal('text_delta'),
  text: z.string(),
});

const inputJsonDeltaSchema = z.object({
  type: z.literal('input_json_delta'),
  partial_json: z.string(),
});

const blockDeltaSchema = z.discriminatedUnion('type', [textDeltaSchema, inputJsonDeltaSchema]);

const contentBlockDeltaSchema = z.object({
  type: z.literal('content_block_delta'),
  index: z.number().int().nonnegative(),
  delta: blockDeltaSchema,
});

const contentBlockStopSchema = z.object({
  type: z.literal('content_block_stop'),
  index: z.number().int().nonnegative(),
});

const messageDeltaSchema = z.object({
  type: z.literal('message_delta'),
  delta: z.object({
    stop_reason: stopReasonSchema.nullable().optional(),
    stop_sequence: z.string().nullable().optional(),
  }),
  usage: usageSchema.optional(),
});

const messageStopSchema = z.object({
  type: z.literal('message_stop'),
});

const pingSchema = z.object({
  type: z.literal('ping'),
});

const errorEventSchema = z.object({
  type: z.literal('error'),
  error: z.object({
    type: z.string(),
    message: z.string(),
  }),
});

export const streamEventSchema = z.discriminatedUnion('type', [
  messageStartSchema,
  contentBlockStartSchema,
  contentBlockDeltaSchema,
  contentBlockStopSchema,
  messageDeltaSchema,
  messageStopSchema,
  pingSchema,
  errorEventSchema,
]);

export type StreamEvent = z.infer<typeof streamEventSchema>;
export type AnthropicStopReason = z.infer<typeof stopReasonSchema>;
export type AnthropicUsage = z.infer<typeof usageSchema>;
