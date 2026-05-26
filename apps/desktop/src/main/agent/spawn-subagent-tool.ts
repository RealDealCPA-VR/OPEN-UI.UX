import { z } from 'zod';
import { defineTool } from '@opencodex/core';
import { anonymizeId } from '@opencodex/telemetry';
import { logger } from '../logger';
import { recordComplete, recordError, recordStart } from './run-registry';
import { runSubagent, type SubagentResult } from './subagent';
import { isUtilityProcessAvailable, runSubagentInWorker } from './worker-host';

// Lazy: avoid loading telemetry/manager (and through it, electron-store) at module-load time
// so unit tests that import this tool transitively don't crash in node env.
async function trackEvent(
  event: string,
  props?: Record<string, string | number | boolean | null>,
): Promise<void> {
  try {
    const mod = await import('../telemetry/manager');
    mod.track(event, props);
  } catch {
    // ignore
  }
}

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
    const budget = {
      maxToolIterations: input.maxToolIterations,
      ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
      ...(input.maxWallTimeMs !== undefined ? { maxWallTimeMs: input.maxWallTimeMs } : {}),
    };

    const runId = recordStart({
      task: input.task,
      providerId: input.providerId,
      modelId: input.modelId,
    });

    void trackEvent('agent.subagent_spawned', {
      providerHash: anonymizeId(input.providerId),
      modelHash: anonymizeId(input.modelId),
      allowedTools: input.allowedTools?.length ?? null,
    });

    let result: SubagentResult;
    try {
      const useWorker = await isUtilityProcessAvailable();
      if (useWorker) {
        try {
          result = await runSubagentInWorker({
            task: input.task,
            providerId: input.providerId,
            modelId: input.modelId,
            workspaceRoot: ctx.workspaceRoot,
            ...(input.allowedTools ? { allowedToolNames: input.allowedTools } : {}),
            budget,
            ...(ctx.signal ? { signal: ctx.signal } : {}),
          });
        } catch (err) {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'subagent worker failed; falling back to inline execution',
          );
          result = await runInline();
        }
      } else {
        result = await runInline();
      }
    } catch (err) {
      recordError(runId, err);
      throw err;
    }

    recordComplete(runId, result);

    return {
      summary: result.text,
      stopReason: result.stopReason,
      iterations: result.iterations,
      tokensUsed: { input: result.inputTokens, output: result.outputTokens },
      toolEventCount: result.toolEvents.length,
      ...(result.error ? { error: result.error } : {}),
    };

    async function runInline(): Promise<SubagentResult> {
      const [{ buildProviderForId }, { getToolRegistry }] = await Promise.all([
        import('../chat/provider-builder'),
        import('../tools/registry'),
      ]);
      const provider = await buildProviderForId(input.providerId);
      return runSubagent({
        task: input.task,
        provider,
        modelId: input.modelId,
        toolRegistry: getToolRegistry(),
        ...(input.allowedTools ? { allowedToolNames: input.allowedTools } : {}),
        workspaceRoot: ctx.workspaceRoot,
        signal: ctx.signal,
        budget,
      });
    }
  },
});
