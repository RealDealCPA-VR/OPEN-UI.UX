import { z } from 'zod';

const subagentBudgetSchema = z.object({
  maxTokens: z.number().int().min(1).optional(),
  maxToolIterations: z.number().int().min(1).optional(),
  maxWallTimeMs: z.number().int().min(1).optional(),
});

export const workerStartMessageSchema = z.object({
  kind: z.literal('start'),
  task: z.string().min(1),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  workspaceRoot: z.string().min(1),
  allowedToolNames: z.array(z.string()).optional(),
  budget: subagentBudgetSchema.optional(),
  systemPrompt: z.string().optional(),
});

const stopReasonSchema = z.enum([
  'end_turn',
  'tool_use',
  'max_tokens',
  'budget_exceeded',
  'error',
  'unauthorized_tool',
]);

const toolEventSchema = z.object({
  name: z.string(),
  input: z.unknown(),
  output: z.unknown(),
  isError: z.boolean(),
  durationMs: z.number(),
});

export const workerResultMessageSchema = z.object({
  kind: z.literal('result'),
  text: z.string(),
  toolEvents: z.array(toolEventSchema),
  inputTokens: z.number(),
  outputTokens: z.number(),
  stopReason: stopReasonSchema,
  error: z.string().optional(),
  iterations: z.number(),
});

export const workerEventMessageSchema = z.object({
  kind: z.literal('event'),
  event: toolEventSchema,
});

export const workerErrorMessageSchema = z.object({
  kind: z.literal('error'),
  message: z.string(),
});

export const workerReadyMessageSchema = z.object({
  kind: z.literal('ready'),
});

export const workerInboundMessageSchema = workerStartMessageSchema;

export const workerOutboundMessageSchema = z.discriminatedUnion('kind', [
  workerReadyMessageSchema,
  workerEventMessageSchema,
  workerResultMessageSchema,
  workerErrorMessageSchema,
]);

export type WorkerStartMessage = z.infer<typeof workerStartMessageSchema>;
export type WorkerResultMessage = z.infer<typeof workerResultMessageSchema>;
export type WorkerEventMessage = z.infer<typeof workerEventMessageSchema>;
export type WorkerErrorMessage = z.infer<typeof workerErrorMessageSchema>;
export type WorkerReadyMessage = z.infer<typeof workerReadyMessageSchema>;
export type WorkerOutboundMessage = z.infer<typeof workerOutboundMessageSchema>;
