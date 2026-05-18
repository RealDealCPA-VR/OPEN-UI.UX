import { z } from 'zod';

export const roleSchema = z.enum(['system', 'user', 'assistant', 'tool']);

export const textBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export const imageBlockSchema = z.object({
  type: z.literal('image'),
  mimeType: z.string().min(1),
  data: z.string().min(1),
});

export const toolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.unknown(),
});

export const toolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  toolUseId: z.string().min(1),
  output: z.unknown(),
  isError: z.boolean().optional(),
});

export const contentBlockSchema = z.discriminatedUnion('type', [
  textBlockSchema,
  imageBlockSchema,
  toolUseBlockSchema,
  toolResultBlockSchema,
]);

export const messageSchema = z.object({
  role: roleSchema,
  content: z.union([z.string(), z.array(contentBlockSchema)]),
});

export type Role = z.infer<typeof roleSchema>;
export type TextBlock = z.infer<typeof textBlockSchema>;
export type ImageBlock = z.infer<typeof imageBlockSchema>;
export type ToolUseBlock = z.infer<typeof toolUseBlockSchema>;
export type ToolResultBlock = z.infer<typeof toolResultBlockSchema>;
export type ContentBlock = z.infer<typeof contentBlockSchema>;
export type Message = z.infer<typeof messageSchema>;
