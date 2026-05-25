import { z } from 'zod';

export const mcpStdioConfigSchema = z.object({
  kind: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
});

export const mcpSseConfigSchema = z.object({
  kind: z.literal('sse'),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
});

export const mcpHttpConfigSchema = z.object({
  kind: z.literal('http'),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
});

export const mcpTransportConfigSchema = z.discriminatedUnion('kind', [
  mcpStdioConfigSchema,
  mcpSseConfigSchema,
  mcpHttpConfigSchema,
]);

export const mcpServerEntrySchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  enabled: z.boolean().default(true),
  config: mcpTransportConfigSchema,
});

export type McpStdioConfig = z.infer<typeof mcpStdioConfigSchema>;
export type McpSseConfig = z.infer<typeof mcpSseConfigSchema>;
export type McpHttpConfig = z.infer<typeof mcpHttpConfigSchema>;
export type McpTransportConfig = z.infer<typeof mcpTransportConfigSchema>;
export type McpServerEntry = z.infer<typeof mcpServerEntrySchema>;
export type McpServerEntryInput = z.input<typeof mcpServerEntrySchema>;

export type McpConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'disabled';

export interface McpServerStatus {
  id: string;
  status: McpConnectionStatus;
  serverInfo?: { name: string; version: string };
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  lastError?: string;
  connectedAt?: string;
}

export interface McpState {
  servers: McpServerEntry[];
  status: Record<string, McpServerStatus>;
}

export type AddMcpServerRequest = McpServerEntryInput;
export type RemoveMcpServerRequest = { id: string };
export type SetMcpServerEnabledRequest = { id: string; enabled: boolean };
export type McpServerChangedEvent = McpState;

export interface McpServerPreset {
  id: string;
  displayName: string;
  description: string;
  template: Omit<McpServerEntry, 'enabled'>;
}

export interface McpPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface McpPromptInfo {
  name: string;
  description?: string;
  arguments?: McpPromptArgument[];
}

export interface McpPromptEntry {
  serverId: string;
  serverDisplayName: string;
  prompt: McpPromptInfo;
}

export interface McpResourceInfo {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceEntry {
  serverId: string;
  serverDisplayName: string;
  resource: McpResourceInfo;
}

export interface McpReindexResourcesResult {
  indexed: number;
  failed: number;
  failures: Array<{ serverId: string; uri: string; error: string }>;
}
