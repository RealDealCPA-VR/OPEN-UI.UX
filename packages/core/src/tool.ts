import type { z } from 'zod';

export type PermissionTier = 'read' | 'write' | 'execute' | 'network';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  permissionTier: PermissionTier;
}

export interface ToolContext {
  workspaceRoot: string;
  signal: AbortSignal;
  logger: {
    info: (msg: string, meta?: unknown) => void;
    error: (msg: string, meta?: unknown) => void;
  };
}

export interface Tool<TInput = unknown, TOutput = unknown> extends ToolDefinition {
  inputZod: z.ZodType<TInput>;
  execute(input: TInput, ctx: ToolContext): Promise<TOutput>;
}

export interface ToolRegistry {
  register(tool: Tool): void;
  unregister(name: string): void;
  get(name: string): Tool | undefined;
  list(): ToolDefinition[];
}
