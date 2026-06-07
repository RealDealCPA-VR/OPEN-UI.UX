import { z } from 'zod';

const textPartSchema = z.object({
  text: z.string(),
});

const functionCallPartSchema = z.object({
  functionCall: z.object({
    id: z.string().optional(),
    name: z.string(),
    args: z.unknown().optional(),
  }),
});

const inlineDataPartSchema = z.object({
  inlineData: z.object({
    mimeType: z.string(),
    data: z.string(),
  }),
});

const partSchema = z.union([textPartSchema, functionCallPartSchema, inlineDataPartSchema]);

const contentSchema = z.object({
  role: z.string().optional(),
  parts: z.array(partSchema).optional(),
});

const candidateSchema = z.object({
  content: contentSchema.optional(),
  finishReason: z.string().optional(),
  index: z.number().int().optional(),
});

const usageMetadataSchema = z.object({
  promptTokenCount: z.number().int().nonnegative().optional(),
  candidatesTokenCount: z.number().int().nonnegative().optional(),
  totalTokenCount: z.number().int().nonnegative().optional(),
  cachedContentTokenCount: z.number().int().nonnegative().optional(),
});

const promptFeedbackSchema = z.object({
  blockReason: z.string().optional(),
});

export const streamChunkSchema = z.object({
  candidates: z.array(candidateSchema).optional(),
  usageMetadata: usageMetadataSchema.optional(),
  promptFeedback: promptFeedbackSchema.optional(),
});

export const embedContentResponseSchema = z.object({
  embedding: z.object({ values: z.array(z.number()) }),
});

export const batchEmbedContentsResponseSchema = z.object({
  embeddings: z.array(z.object({ values: z.array(z.number()) })),
});

export type StreamChunk = z.infer<typeof streamChunkSchema>;
export type GoogleUsageMetadata = z.infer<typeof usageMetadataSchema>;
export type GooglePart = z.infer<typeof partSchema>;
