import { z } from 'zod';
import type { McpClient, McpTool } from '@opencodex/mcp-client';
import type { Tool, PermissionTier } from '@opencodex/core';

const passthroughSchema = z.record(z.unknown());

export function mcpToolName(serverId: string, toolName: string): string {
  return `mcp__${serverId}__${toolName}`;
}

export function adaptMcpTool(
  serverId: string,
  client: McpClient,
  remote: McpTool,
  tier: PermissionTier = 'network',
): Tool<Record<string, unknown>, unknown> {
  const name = mcpToolName(serverId, remote.name);
  const description = remote.description ?? `MCP tool ${remote.name} on server ${serverId}`;
  const inputSchema =
    remote.inputSchema && typeof remote.inputSchema === 'object'
      ? (remote.inputSchema as Record<string, unknown>)
      : { type: 'object', additionalProperties: true };

  return {
    name,
    description,
    inputSchema,
    permissionTier: tier,
    inputZod: passthroughSchema,
    async execute(input) {
      const result = await client.callTool(remote.name, input);
      const text = result.content
        .map((block) => {
          if (block.type === 'text') return block.text;
          if (block.type === 'image') return `[image:${block.mimeType}]`;
          if (block.type === 'resource') return block.resource.text ?? block.resource.uri;
          return '';
        })
        .filter((s) => s.length > 0)
        .join('\n');
      return {
        ok: !(result.isError ?? false),
        content: text,
        raw: result,
      };
    },
  };
}
