import type { McpClient, McpReadResourceResult } from '@opencodex/mcp-client';
import type { McpReindexResourcesResult, McpResourceEntry } from '../../shared/mcp';
import { logger } from '../logger';
import { upsertIndexedFile } from '../storage/codebase-index';
import {
  getAvailableResources as defaultGetAvailableResources,
  getClientForServer as defaultGetClientForServer,
  onMcpServerConnected as defaultOnMcpServerConnected,
} from './manager';

export const MCP_INDEX_PREFIX = 'mcp:';

export type UpsertIndexedFileFn = (
  path: string,
  content: string,
  mtime: number,
  size: number,
) => void;

export function mcpResourceIndexKey(serverId: string, uri: string): string {
  return `${MCP_INDEX_PREFIX}${serverId}:${uri}`;
}

export function parseMcpIndexKey(key: string): { serverId: string; uri: string } | null {
  if (!key.startsWith(MCP_INDEX_PREFIX)) return null;
  const rest = key.slice(MCP_INDEX_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep <= 0) return null;
  return { serverId: rest.slice(0, sep), uri: rest.slice(sep + 1) };
}

function extractText(result: McpReadResourceResult): string {
  const parts: string[] = [];
  for (const c of result.contents) {
    if (typeof c.text === 'string' && c.text.length > 0) parts.push(c.text);
  }
  return parts.join('\n');
}

export interface IndexAllMcpResourcesDeps {
  getAvailableResources?: () => McpResourceEntry[];
  getClientForServer?: (serverId: string) => McpClient | null;
  upsert?: UpsertIndexedFileFn;
  now?: () => number;
}

export async function indexAllMcpResources(
  deps: IndexAllMcpResourcesDeps = {},
): Promise<McpReindexResourcesResult> {
  const list = (deps.getAvailableResources ?? defaultGetAvailableResources)();
  const getClient = deps.getClientForServer ?? defaultGetClientForServer;
  const upsert = deps.upsert ?? upsertIndexedFile;
  const now = deps.now ?? Date.now;

  const result: McpReindexResourcesResult = { indexed: 0, failed: 0, failures: [] };

  for (const entry of list) {
    const client = getClient(entry.serverId);
    if (!client) {
      result.failed += 1;
      result.failures.push({
        serverId: entry.serverId,
        uri: entry.resource.uri,
        error: 'no connected client',
      });
      continue;
    }
    const key = mcpResourceIndexKey(entry.serverId, entry.resource.uri);
    try {
      const read = await client.readResource(entry.resource.uri);
      const text = extractText(read);
      const mtime = now();
      const size = Buffer.byteLength(text, 'utf8');
      upsert(key, text, mtime, size);
      result.indexed += 1;
    } catch (err) {
      result.failed += 1;
      result.failures.push({
        serverId: entry.serverId,
        uri: entry.resource.uri,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (result.failed > 0) {
    logger.warn({ failures: result.failures }, 'mcp resource indexing partial failure');
  }
  return result;
}

const DEBOUNCE_MS = 1_000;
let pendingTimer: NodeJS.Timeout | null = null;
let reindexInFlight: Promise<McpReindexResourcesResult> | null = null;

export function scheduleReindex(
  deps: IndexAllMcpResourcesDeps = {},
  debounceMs = DEBOUNCE_MS,
): void {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    reindexInFlight = indexAllMcpResources(deps).finally(() => {
      reindexInFlight = null;
    });
    void reindexInFlight.catch((err) => {
      logger.warn({ err }, 'mcp resource auto-reindex failed');
    });
  }, debounceMs);
}

export function getInFlightReindex(): Promise<McpReindexResourcesResult> | null {
  return reindexInFlight;
}

export function cancelPendingReindex(): void {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
}

export function startMcpResourceAutoIndexing(
  deps: IndexAllMcpResourcesDeps & {
    onConnect?: typeof defaultOnMcpServerConnected;
  } = {},
): () => void {
  const onConnect = deps.onConnect ?? defaultOnMcpServerConnected;
  return onConnect(() => {
    scheduleReindex(deps);
  });
}
