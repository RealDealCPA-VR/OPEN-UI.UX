import type { Tool } from '@opencodex/core';
import type { McpServerConfig } from './config';

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface McpClient {
  readonly serverId: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<Tool[]>;
  listResources(): Promise<McpResource[]>;
  listPrompts(): Promise<McpPrompt[]>;
  readResource(uri: string): Promise<{ mimeType: string; text?: string; blob?: Uint8Array }>;
}

export function createMcpClient(_serverId: string, _config: McpServerConfig): McpClient {
  throw new Error('Not implemented — Phase 2.5 MCP task');
}
