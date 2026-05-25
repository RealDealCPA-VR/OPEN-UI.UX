import { z } from 'zod';

export const PROTOCOL_VERSION = '2025-03-26';

export const mcpToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.unknown().optional(),
});

export const mcpResourceSchema = z.object({
  uri: z.string(),
  name: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
});

export const mcpPromptArgSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
});

export const mcpPromptSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  arguments: z.array(mcpPromptArgSchema).optional(),
});

export const mcpServerInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
});

export const mcpServerCapabilitiesSchema = z.object({
  tools: z.object({ listChanged: z.boolean().optional() }).optional(),
  resources: z
    .object({ subscribe: z.boolean().optional(), listChanged: z.boolean().optional() })
    .optional(),
  prompts: z.object({ listChanged: z.boolean().optional() }).optional(),
  logging: z.object({}).optional(),
});

export const mcpInitializeResultSchema = z.object({
  protocolVersion: z.string(),
  serverInfo: mcpServerInfoSchema,
  capabilities: mcpServerCapabilitiesSchema.optional(),
});

export const mcpListToolsResultSchema = z.object({
  tools: z.array(mcpToolSchema),
  nextCursor: z.string().optional(),
});

export const mcpListResourcesResultSchema = z.object({
  resources: z.array(mcpResourceSchema),
  nextCursor: z.string().optional(),
});

export const mcpListPromptsResultSchema = z.object({
  prompts: z.array(mcpPromptSchema),
  nextCursor: z.string().optional(),
});

export const mcpContentBlockSchema = z.union([
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('image'),
    data: z.string(),
    mimeType: z.string(),
  }),
  z.object({
    type: z.literal('resource'),
    resource: z.object({
      uri: z.string(),
      mimeType: z.string().optional(),
      text: z.string().optional(),
      blob: z.string().optional(),
    }),
  }),
]);

export const mcpCallToolResultSchema = z.object({
  content: z.array(mcpContentBlockSchema),
  isError: z.boolean().optional(),
});

export const mcpReadResourceResultSchema = z.object({
  contents: z.array(
    z.object({
      uri: z.string(),
      mimeType: z.string().optional(),
      text: z.string().optional(),
      blob: z.string().optional(),
    }),
  ),
});

export type McpTool = z.infer<typeof mcpToolSchema>;
export type McpResource = z.infer<typeof mcpResourceSchema>;
export type McpPrompt = z.infer<typeof mcpPromptSchema>;
export type McpInitializeResult = z.infer<typeof mcpInitializeResultSchema>;
export type McpCallToolResult = z.infer<typeof mcpCallToolResultSchema>;
export type McpReadResourceResult = z.infer<typeof mcpReadResourceResultSchema>;
