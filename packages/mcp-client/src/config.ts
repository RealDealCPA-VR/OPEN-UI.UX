import { z } from 'zod';

export const StdioServerConfigSchema = z.object({
  kind: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
});

export const SseServerConfigSchema = z.object({
  kind: z.literal('sse'),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  hostAllowlist: z.array(z.string()).optional(),
});

export const HttpServerConfigSchema = z.object({
  kind: z.literal('http'),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  hostAllowlist: z.array(z.string()).optional(),
});

export const McpServerConfigSchema = z.discriminatedUnion('kind', [
  StdioServerConfigSchema,
  SseServerConfigSchema,
  HttpServerConfigSchema,
]);

export type StdioServerConfig = z.infer<typeof StdioServerConfigSchema>;
export type SseServerConfig = z.infer<typeof SseServerConfigSchema>;
export type HttpServerConfig = z.infer<typeof HttpServerConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const McpServerEntrySchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  enabled: z.boolean().default(true),
  config: McpServerConfigSchema,
});

export type McpServerEntry = z.infer<typeof McpServerEntrySchema>;
