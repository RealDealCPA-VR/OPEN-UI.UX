import type { z } from 'zod';
import { zodToJSONSchema, type JSONSchema } from './json-schema';

export type PermissionTier = 'read' | 'write' | 'execute' | 'network';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
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

export interface ToolDefineOptions<TInput, TOutput> {
  name: string;
  description: string;
  inputZod: z.ZodType<TInput>;
  permissionTier: PermissionTier;
  execute(input: TInput, ctx: ToolContext): Promise<TOutput>;
}

export function defineTool<TInput, TOutput>(
  options: ToolDefineOptions<TInput, TOutput>,
): Tool<TInput, TOutput> {
  return {
    name: options.name,
    description: options.description,
    inputZod: options.inputZod,
    inputSchema: zodToJSONSchema(options.inputZod as unknown as z.ZodTypeAny),
    permissionTier: options.permissionTier,
    execute: options.execute,
  };
}

export class ToolNotFoundError extends Error {
  constructor(public readonly toolName: string) {
    super(`Tool "${toolName}" is not registered`);
    this.name = 'ToolNotFoundError';
  }
}

export class ToolInputError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly issues: z.ZodIssue[],
  ) {
    super(
      `Invalid input for tool "${toolName}": ${issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')}`,
    );
    this.name = 'ToolInputError';
  }
}

export class ToolCancelledError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly reason?: unknown,
  ) {
    super(`Tool "${toolName}" execution was cancelled`);
    this.name = 'ToolCancelledError';
  }
}
