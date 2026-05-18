import { z } from 'zod';

const toolCallDeltaSchema = z.object({
  index: z.number().int().nonnegative().optional(),
  id: z.string().optional(),
  type: z.literal('function').optional(),
  function: z
    .object({
      name: z.string().optional(),
      arguments: z.string().optional(),
    })
    .optional(),
});

const deltaSchema = z.object({
  role: z.string().optional(),
  content: z.string().nullable().optional(),
  tool_calls: z.array(toolCallDeltaSchema).optional(),
});

const choiceSchema = z.object({
  index: z.number().int(),
  delta: deltaSchema.optional(),
  finish_reason: z.string().nullable().optional(),
});

const usageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative().optional(),
});

export const chatChunkSchema = z.object({
  id: z.string().optional(),
  object: z.string().optional(),
  created: z.number().optional(),
  model: z.string().optional(),
  choices: z.array(choiceSchema),
  usage: usageSchema.nullable().optional(),
});

export type ChatChunk = z.infer<typeof chatChunkSchema>;

export const embeddingsResponseSchema = z.object({
  data: z.array(
    z.object({
      embedding: z.array(z.number()),
      index: z.number().int().nonnegative(),
    }),
  ),
  model: z.string(),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
  }),
});
