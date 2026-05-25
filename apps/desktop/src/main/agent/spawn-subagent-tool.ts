import { z } from 'zod';
import { defineTool } from '@opencodex/core';
import { logger } from '../logger';
import { runSubagent } from './subagent';

const inputSchema = z.object({
  task: z.string().min(1).describe('What the subagent should accomplish — be specific'),
  providerId: z.string().min(1).describe('Provider id (e.g. "openai")'),
  modelId: z.string().min(1).describe('Model id (e.g. "gpt-4o-mini")'),
  allowedTools: z
    .array(z.string())
    .optional()
    .describe(
      'Optional whitelist of tool names the subagent can use. Defaults to all registered tools.',
    ),
  maxToolIterations: z.number().int().min(1).max(20).optional().default(6),
  maxTokens: z.number().int().min(1).optional(),
  maxWallTimeMs: z.number().int().min(1).optional(),
});

export const spawnSubagentTool = defineTool({
  name: 'spawn_subagent',
  description:
    "Spawn a focused subagent with its own provider, context, and tool subset. Returns the subagent's final text + tool-call summary. Use for parallel decomposable work.",
  permissionTier: 'execute',
  inputZod: inputSchema,
  async execute(input, ctx) {
    logger.info(
      { task: input.task.slice(0, 80), providerId: input.providerId, modelId: input.modelId },
      'spawning subagent',
    );
    const [{ buildProviderForId }, { getToolRegistry }] = await Promise.all([
      import('../chat/provider-builder'),
      import('../tools/registry'),
    ]);
    const provider = await buildProviderForId(input.providerId);
    const result = await runSubagent({
      task: input.task,
      provider,
      modelId: input.modelId,
      toolRegistry: getToolRegistry(),
      ...(input.allowedTools ? { allowedToolNames: input.allowedTools } : {}),
      workspaceRoot: ctx.workspaceRoot,
      signal: ctx.signal,
      budget: {
        maxToolIterations: input.maxToolIterations,
        ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
        ...(input.maxWallTimeMs !== undefined ? { maxWallTimeMs: input.maxWallTimeMs } : {}),
      },
    });
    return {
      summary: result.text,
      stopReason: result.stopReason,
      iterations: result.iterations,
      tokensUsed: { input: result.inputTokens, output: result.outputTokens },
      toolEventCount: result.toolEvents.length,
      ...(result.error ? { error: result.error } : {}),
    };
  },
});
