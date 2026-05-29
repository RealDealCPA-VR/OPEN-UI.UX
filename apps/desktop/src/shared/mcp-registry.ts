import { z } from 'zod';
import { mcpTransportConfigSchema, type McpServerEntry } from './mcp';

export const DEFAULT_MCP_REGISTRY_URL = 'https://opencodex.dev/mcp-registry.json';

export const mcpRegistryEntrySchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().min(1),
  author: z.string().optional(),
  version: z.string().optional(),
  homepageUrl: z.string().url().optional(),
  permissionCategories: z.array(z.string()).optional(),
  template: z.object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    config: mcpTransportConfigSchema,
  }),
});

export const mcpRegistrySchema = z.array(mcpRegistryEntrySchema);

export type McpRegistryEntry = z.infer<typeof mcpRegistryEntrySchema>;

export interface McpFetchRegistryResponse {
  entries: McpRegistryEntry[];
  error: string | null;
  fetchedAt: string | null;
  cached: boolean;
}

export type McpPermissionCategoryId =
  | 'fs-read'
  | 'fs-write'
  | 'network'
  | 'git'
  | 'shell'
  | 'database'
  | 'search'
  | 'github'
  | 'browser'
  | 'memory'
  | 'unknown';

export interface McpPermissionCategory {
  id: McpPermissionCategoryId;
  label: string;
  humanReadable: string;
  severity: 'low' | 'medium' | 'high';
}

export interface McpServerGrant {
  serverId: string;
  serverDisplayName: string;
  categories: McpPermissionCategory[];
  toolNames: string[];
}

export interface McpPermissionsResponse {
  grants: McpServerGrant[];
}

export interface McpRevokePermissionRequest {
  serverId: string;
}

export interface McpRevokePermissionResponse {
  ok: boolean;
  error?: string;
}

export interface McpHealthEvent {
  at: string;
  kind: 'connected' | 'disconnected' | 'error' | 'reconnect';
  detail?: string;
}

export interface McpHealthStats {
  serverId: string;
  status: string;
  lastSeenAt: string | null;
  connectedAt: string | null;
  reconnectCount: number;
  errorCount: number;
  recentErrors: Array<{ at: string; message: string }>;
  events: McpHealthEvent[];
}

export interface McpHealthStatsResponse {
  stats: McpHealthStats[];
}

export interface McpRunToolRequest {
  serverId: string;
  toolName: string;
  argsJson: string;
}

export interface McpRunToolResponse {
  ok: boolean;
  isError?: boolean;
  resultJson?: string;
  error?: string;
}

export interface McpListServerToolsRequest {
  serverId: string;
}

export interface McpServerToolInfo {
  name: string;
  description?: string;
  inputSchemaJson?: string;
}

export interface McpListServerToolsResponse {
  tools: McpServerToolInfo[];
  error?: string;
}

export interface McpInstallRegistryEntryRequest {
  entryId: string;
}

export interface McpRegistryUrlResponse {
  url: string;
}

export type McpSetRegistryUrlRequest = { url: string | null };

export type McpTemplateForInstall = Pick<McpServerEntry, 'id' | 'displayName' | 'config'>;
