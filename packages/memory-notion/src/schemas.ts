import { z } from 'zod';

export const richTextSchema = z
  .array(
    z.object({
      type: z.string().optional(),
      plain_text: z.string().optional(),
      text: z
        .object({
          content: z.string().optional(),
        })
        .partial()
        .optional(),
    }),
  )
  .default([]);

export const titlePropertySchema = z.object({
  type: z.literal('title'),
  title: richTextSchema,
});

export const userSchema = z.object({
  object: z.literal('user').optional(),
  id: z.string(),
  name: z.string().nullable().optional(),
  type: z.string().optional(),
});

export const pageObjectSchema = z.object({
  object: z.literal('page'),
  id: z.string(),
  url: z.string().nullable().optional(),
  last_edited_time: z.string().nullable().optional(),
  properties: z.record(z.unknown()).default({}),
});

export const databaseObjectSchema = z.object({
  object: z.literal('database'),
  id: z.string(),
  url: z.string().nullable().optional(),
  last_edited_time: z.string().nullable().optional(),
  title: richTextSchema.optional(),
});

export const searchResultSchema = z.discriminatedUnion('object', [
  pageObjectSchema,
  databaseObjectSchema,
]);

export const searchResponseSchema = z.object({
  object: z.literal('list'),
  results: z.array(z.unknown()),
  next_cursor: z.string().nullable().optional(),
  has_more: z.boolean().optional(),
});

export const blockBaseSchema = z.object({
  object: z.literal('block'),
  id: z.string(),
  type: z.string(),
  has_children: z.boolean().optional(),
});

export const blockChildrenResponseSchema = z.object({
  object: z.literal('list'),
  results: z.array(z.record(z.unknown())),
  next_cursor: z.string().nullable().optional(),
  has_more: z.boolean().optional(),
});

export const notionErrorSchema = z.object({
  object: z.literal('error').optional(),
  status: z.number().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
});

export const appendBlockResponseSchema = z.object({
  object: z.literal('list'),
  results: z.array(z.record(z.unknown())),
});

export const createPageResponseSchema = pageObjectSchema;
