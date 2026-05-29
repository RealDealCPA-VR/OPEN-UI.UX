import { z } from 'zod';
import { registerInvoke } from '../ipc/registry';
import * as settingsModule from '../storage/settings';
import { getMcpServers } from '../storage/settings';
import { logger } from '../logger';
import {
  DEFAULT_MCP_REGISTRY_URL,
  type McpFetchRegistryResponse,
  type McpHealthStatsResponse,
  type McpListServerToolsResponse,
  type McpPermissionsResponse,
  type McpRegistryUrlResponse,
  type McpRunToolResponse,
  type McpServerGrant,
} from '../../shared/mcp-registry';
import { fetchMcpRegistry } from './registry-fetcher';
import { getAllHealthStats } from './health-stats';
import { categoriesForServer } from './permission-map';
import { getClientForServer, removeServer } from './manager';

interface RegistryUrlAccessor {
  getMcpRegistryUrl?: () => string | null;
  setMcpRegistryUrl?: (url: string | null) => string | null;
}

function getRegistryUrl(): string {
  const accessor = settingsModule as RegistryUrlAccessor;
  if (typeof accessor.getMcpRegistryUrl === 'function') {
    return accessor.getMcpRegistryUrl() ?? DEFAULT_MCP_REGISTRY_URL;
  }
  return DEFAULT_MCP_REGISTRY_URL;
}

function setRegistryUrl(url: string | null): string {
  const accessor = settingsModule as RegistryUrlAccessor;
  if (typeof accessor.setMcpRegistryUrl === 'function') {
    return accessor.setMcpRegistryUrl(url) ?? DEFAULT_MCP_REGISTRY_URL;
  }
  return DEFAULT_MCP_REGISTRY_URL;
}

export function registerMcpExtraHandlers(): void {
  registerInvoke(
    'mcp:get-registry-url',
    z.void(),
    (): McpRegistryUrlResponse => ({ url: getRegistryUrl() }),
  );

  registerInvoke(
    'mcp:set-registry-url',
    z.object({ url: z.string().url().nullable() }),
    (req): McpRegistryUrlResponse => ({ url: setRegistryUrl(req.url) }),
  );

  registerInvoke('mcp:fetch-registry', z.void(), async (): Promise<McpFetchRegistryResponse> => {
    const url = getRegistryUrl();
    return fetchMcpRegistry(url);
  });

  registerInvoke('mcp:get-health-stats', z.void(), (): McpHealthStatsResponse => {
    const servers = getMcpServers();
    return { stats: getAllHealthStats(servers.map((s) => s.id)) };
  });

  registerInvoke('mcp:get-permissions', z.void(), async (): Promise<McpPermissionsResponse> => {
    const servers = getMcpServers();
    const grants: McpServerGrant[] = [];
    for (const s of servers) {
      const client = getClientForServer(s.id);
      let toolNames: string[] = [];
      if (client) {
        try {
          const tools = await client.listTools();
          toolNames = tools.map((t) => t.name);
        } catch (err) {
          logger.debug({ err, serverId: s.id }, 'mcp listTools failed during permissions read');
        }
      }
      grants.push({
        serverId: s.id,
        serverDisplayName: s.displayName,
        categories: categoriesForServer(s.id, toolNames),
        toolNames,
      });
    }
    return { grants };
  });

  registerInvoke(
    'mcp:revoke-permission',
    z.object({ serverId: z.string().min(1) }),
    async (req): Promise<{ ok: boolean; error?: string }> => {
      try {
        await removeServer(req.serverId);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  registerInvoke(
    'mcp:run-tool',
    z.object({
      serverId: z.string().min(1),
      toolName: z.string().min(1),
      argsJson: z.string(),
    }),
    async (req): Promise<McpRunToolResponse> => {
      const client = getClientForServer(req.serverId);
      if (!client) return { ok: false, error: `server "${req.serverId}" is not connected` };
      let parsedArgs: unknown = {};
      if (req.argsJson.trim().length > 0) {
        try {
          parsedArgs = JSON.parse(req.argsJson);
        } catch (err) {
          return { ok: false, error: `invalid JSON args: ${(err as Error).message}` };
        }
      }
      try {
        const result = await client.callTool(req.toolName, parsedArgs);
        return {
          ok: true,
          isError: result.isError === true,
          resultJson: JSON.stringify(result),
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  registerInvoke(
    'mcp:list-server-tools',
    z.object({ serverId: z.string().min(1) }),
    async (req): Promise<McpListServerToolsResponse> => {
      const client = getClientForServer(req.serverId);
      if (!client) return { tools: [], error: `server "${req.serverId}" is not connected` };
      try {
        const tools = await client.listTools();
        return {
          tools: tools.map((t) => ({
            name: t.name,
            ...(t.description !== undefined ? { description: t.description } : {}),
            ...(t.inputSchema !== undefined
              ? { inputSchemaJson: JSON.stringify(t.inputSchema) }
              : {}),
          })),
        };
      } catch (err) {
        return { tools: [], error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
}
