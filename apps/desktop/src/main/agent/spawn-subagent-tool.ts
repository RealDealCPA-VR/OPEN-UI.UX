import { z } from 'zod';
import { defineTool } from '@opencodex/core';
import { logger } from '../logger';
import { fanoutGate } from './fanout-gate';
import { recordComplete, recordError, recordStart } from './run-registry';
import { type SubagentResult } from './subagent';
import { isUtilityProcessAvailable, runSubagentInline, runSubagentInWorker } from './worker-host';

// Fallback gate key for call paths that (defensively) arrive without a signal;
// they all share one consent scope for the life of the process.
const signallessGateKey: object = {};

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

async function anonymize(input: string): Promise<string | null> {
  try {
    const mod = await import('../telemetry/manager');
    return mod.anonymizeId(input);
  } catch {
    return null;
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
  runnerId: z
    .string()
    .min(1)
    .optional()
    .describe('Subagent runner id; defaults to "internal" (OpenCodex built-in).'),
});

export const spawnSubagentTool = defineTool({
  name: 'spawn_subagent',
  description:
    "Spawn a focused subagent with its own provider, context, and tool subset. Returns the subagent's final text + tool-call summary. Use for parallel decomposable work.",
  permissionTier: 'execute',
  inputZod: inputSchema,
  async execute(input, ctx) {
    const runnerId = input.runnerId ?? 'internal';
    const consent = await fanoutGate.ensureConsent(ctx.signal ?? signallessGateKey, {
      task: input.task,
      runnerId,
      modelId: input.modelId,
    });
    if (!consent.allowed) {
      throw new Error(
        `spawn_subagent denied: ${consent.reason ?? 'fan-out consent was not granted'}. ` +
          'Do not retry spawn_subagent in this run — do the work yourself or ask the user how to proceed.',
      );
    }
    const task = consent.editedTask ?? input.task;

    logger.info(
      { task: task.slice(0, 80), providerId: input.providerId, modelId: input.modelId },
      'spawning subagent',
    );
    const budget = {
      maxToolIterations: input.maxToolIterations,
      ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
      ...(input.maxWallTimeMs !== undefined ? { maxWallTimeMs: input.maxWallTimeMs } : {}),
    };

    const runId = recordStart({
      task,
      providerId: input.providerId,
      modelId: input.modelId,
      runnerId,
    });

    void (async () => {
      const [providerHash, modelHash] = await Promise.all([
        anonymize(input.providerId),
        anonymize(input.modelId),
      ]);
      void trackEvent('agent.subagent_spawned', {
        providerHash,
        modelHash,
        allowedTools: input.allowedTools?.length ?? null,
      });
    })();

    let result: SubagentResult;
    try {
      const useWorker = await isUtilityProcessAvailable();
      if (useWorker) {
        try {
          result = await runSubagentInWorker({
            task,
            providerId: input.providerId,
            modelId: input.modelId,
            workspaceRoot: ctx.workspaceRoot,
            ...(input.allowedTools ? { allowedToolNames: input.allowedTools } : {}),
            budget,
            ...(ctx.signal ? { signal: ctx.signal } : {}),
            runnerId,
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
      return runSubagentInline({
        task,
        providerId: input.providerId,
        modelId: input.modelId,
        workspaceRoot: ctx.workspaceRoot,
        ...(input.allowedTools ? { allowedToolNames: input.allowedTools } : {}),
        ...(ctx.signal ? { signal: ctx.signal } : {}),
        budget,
        runnerId,
      });
    }
  },
});
