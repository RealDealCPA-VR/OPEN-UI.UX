import { randomUUID } from 'node:crypto';
import type { LLMProvider, Message } from '@opencodex/core';
import type {
  AppliedDiff,
  ReplayConversationRequest,
  ReplayDiffRequest,
  ReplayDiffResult,
  ReplayMessagePair,
  ReplayProgressEvent,
  ReplayResult,
} from '../../shared/replay';
import { getConversation, listMessages } from '../storage/conversations';
import { getAppliedDiff } from '../storage/applied-diffs';

export type BuildProvider = (id: string) => Promise<LLMProvider>;

export type ReplayProgressSink = (event: ReplayProgressEvent) => void;

export interface ReplayConversationOptions {
  request: ReplayConversationRequest;
  buildProvider: BuildProvider;
  onProgress?: ReplayProgressSink;
}

interface CollectedUsage {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  error: string | null;
}

async function runOneTurn(
  provider: LLMProvider,
  modelId: string,
  messages: Message[],
): Promise<CollectedUsage> {
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let error: string | null = null;
  try {
    const iter = provider.chat({ model: modelId, messages });
    for await (const event of iter) {
      if (event.type === 'text_delta') {
        text += event.delta;
      } else if (event.type === 'usage') {
        inputTokens += event.inputTokens;
        outputTokens += event.outputTokens;
        if (event.costUsd !== undefined) costUsd += event.costUsd;
      } else if (event.type === 'error') {
        error = event.message;
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  return { text, inputTokens, outputTokens, costUsd, error };
}

export async function replayConversation(opts: ReplayConversationOptions): Promise<ReplayResult> {
  const { request, buildProvider, onProgress } = opts;
  const replayId = randomUUID();
  const startedAt = new Date().toISOString();
  const errors: string[] = [];

  const conversation = getConversation(request.conversationId);
  if (!conversation) {
    return {
      replayId,
      sourceConversationId: request.conversationId,
      clonedConversationId: null,
      targetProviderId: request.targetProviderId,
      targetModelId: request.targetModelId,
      startedAt,
      completedAt: new Date().toISOString(),
      messagesReplayed: 0,
      pairs: [],
      totalTokensInput: 0,
      totalTokensOutput: 0,
      totalCostUsd: 0,
      errors: [`Conversation ${request.conversationId} not found`],
    };
  }

  const stored = listMessages(request.conversationId);
  const userTurns = stored.filter((m) => m.role === 'user').map((m, idx) => ({ ...m, index: idx }));

  onProgress?.({
    replayId,
    stage: 'starting',
    totalMessages: userTurns.length,
  });

  let provider: LLMProvider;
  try {
    provider = await buildProvider(request.targetProviderId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onProgress?.({ replayId, stage: 'error', error: msg });
    return {
      replayId,
      sourceConversationId: request.conversationId,
      clonedConversationId: null,
      targetProviderId: request.targetProviderId,
      targetModelId: request.targetModelId,
      startedAt,
      completedAt: new Date().toISOString(),
      messagesReplayed: 0,
      pairs: [],
      totalTokensInput: 0,
      totalTokensOutput: 0,
      totalCostUsd: 0,
      errors: [`Failed to build target provider: ${msg}`],
    };
  }

  const pairs: ReplayMessagePair[] = [];
  let totalTokensInput = 0;
  let totalTokensOutput = 0;
  let totalCostUsd = 0;

  const transcript: Message[] = [];

  for (let i = 0; i < userTurns.length; i++) {
    const userMsg = userTurns[i];
    if (!userMsg) continue;
    transcript.push({ role: 'user', content: userMsg.content });

    const originalAssistant = stored.find(
      (m, idx) => m.role === 'assistant' && idx > stored.findIndex((s) => s.id === userMsg.id),
    );

    onProgress?.({
      replayId,
      stage: 'message',
      messageIndex: i,
      totalMessages: userTurns.length,
    });

    const turn = await runOneTurn(provider, request.targetModelId, transcript);
    if (turn.error) errors.push(`turn ${i}: ${turn.error}`);
    totalTokensInput += turn.inputTokens;
    totalTokensOutput += turn.outputTokens;
    totalCostUsd += turn.costUsd;

    transcript.push({ role: 'assistant', content: turn.text });

    pairs.push({
      originalMessageId: originalAssistant?.id ?? userMsg.id,
      originalContent: originalAssistant?.content ?? '',
      replayContent: turn.text,
      contentChanged: (originalAssistant?.content ?? '') !== turn.text,
    });
  }

  const completedAt = new Date().toISOString();
  onProgress?.({ replayId, stage: 'completed', totalMessages: userTurns.length });

  return {
    replayId,
    sourceConversationId: request.conversationId,
    clonedConversationId: null,
    targetProviderId: request.targetProviderId,
    targetModelId: request.targetModelId,
    startedAt,
    completedAt,
    messagesReplayed: userTurns.length,
    pairs,
    totalTokensInput,
    totalTokensOutput,
    totalCostUsd,
    errors,
  };
}

export interface ReplayDiffOptions {
  request: ReplayDiffRequest;
  buildProvider: BuildProvider;
}

export async function replayDiff(opts: ReplayDiffOptions): Promise<ReplayDiffResult> {
  const { request, buildProvider } = opts;
  const startedAt = new Date().toISOString();
  const applied = getAppliedDiff(request.appliedDiffId);
  if (!applied) {
    return {
      appliedDiffId: request.appliedDiffId,
      filePath: '',
      originalDiff: '',
      replayContent: '',
      targetProviderId: request.targetProviderId,
      targetModelId: request.targetModelId,
      tokensInput: 0,
      tokensOutput: 0,
      costUsd: 0,
      startedAt,
      completedAt: new Date().toISOString(),
      error: `Applied diff ${request.appliedDiffId} not found`,
    };
  }
  return replayAppliedDiff(applied, request, buildProvider, startedAt);
}

async function replayAppliedDiff(
  applied: AppliedDiff,
  request: ReplayDiffRequest,
  buildProvider: BuildProvider,
  startedAt: string,
): Promise<ReplayDiffResult> {
  let provider: LLMProvider;
  try {
    provider = await buildProvider(request.targetProviderId);
  } catch (err) {
    return {
      appliedDiffId: applied.id,
      filePath: applied.filePath,
      originalDiff: applied.diff,
      replayContent: '',
      targetProviderId: request.targetProviderId,
      targetModelId: request.targetModelId,
      tokensInput: 0,
      tokensOutput: 0,
      costUsd: 0,
      startedAt,
      completedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const prompt = applied.promptSnapshot ?? `Re-derive the edit for ${applied.filePath}.`;
  const turn = await runOneTurn(provider, request.targetModelId, [
    { role: 'user', content: prompt },
  ]);

  return {
    appliedDiffId: applied.id,
    filePath: applied.filePath,
    originalDiff: applied.diff,
    replayContent: turn.text,
    targetProviderId: request.targetProviderId,
    targetModelId: request.targetModelId,
    tokensInput: turn.inputTokens,
    tokensOutput: turn.outputTokens,
    costUsd: turn.costUsd,
    startedAt,
    completedAt: new Date().toISOString(),
    error: turn.error,
  };
}
