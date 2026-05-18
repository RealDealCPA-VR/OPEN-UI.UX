import { z } from 'zod';

export const ollamaToolCallSchema = z.object({
  function: z.object({
    name: z.string(),
    arguments: z.union([z.record(z.unknown()), z.string()]),
  }),
});

const messageSchema = z.object({
  role: z.string().optional(),
  content: z.string().optional(),
  tool_calls: z.array(ollamaToolCallSchema).optional(),
});

export const chatChunkSchema = z.object({
  model: z.string().optional(),
  created_at: z.string().optional(),
  message: messageSchema.optional(),
  done: z.boolean().optional(),
  done_reason: z.string().optional(),
  prompt_eval_count: z.number().int().nonnegative().optional(),
  eval_count: z.number().int().nonnegative().optional(),
});

export type ChatChunk = z.infer<typeof chatChunkSchema>;

export const embeddingsResponseSchema = z.object({
  model: z.string(),
  embeddings: z.array(z.array(z.number())),
  prompt_eval_count: z.number().int().nonnegative().optional(),
  total_duration: z.number().nonnegative().optional(),
});
