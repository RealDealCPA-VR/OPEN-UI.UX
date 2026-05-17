import { z } from 'zod';

export const StdioServerConfig = z.object({
  kind: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
});

export const SseServerConfig = z.object({
  kind: z.literal('sse'),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
});

export const HttpServerConfig = z.object({
  kind: z.literal('http'),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
});

export const McpServerConfig = z.discriminatedUnion('kind', [
  StdioServerConfig,
  SseServerConfig,
  HttpServerConfig,
]);

export type McpServerConfig = z.infer<typeof McpServerConfig>;
