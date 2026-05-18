import { randomUUID } from 'node:crypto';
import type { ChatEvent, LLMProvider, Message } from '@opencodex/core';
import type { ChatStartResponse, ChatStreamEvent } from '../../shared/chat';
import { logger } from '../logger';
import { appendMessage, listMessages, updateAssistantMessage } from '../storage/conversations';

async function defaultBuildProvider(id: string): Promise<LLMProvider> {
  const mod = await import('./provider-builder');
  return mod.buildProviderForId(id);
}

export interface ChatStreamSink {
  emit(payload: ChatStreamEvent): void;
}

export interface StartChatStreamOptions {
  conversationId: string;
  providerId: string;
  modelId: string;
  userMessage: string;
  sink: ChatStreamSink;
  buildProvider?: (id: string) => Promise<LLMProvider>;
}

interface ActiveStream {
  controller: AbortController;
}

const active = new Map<string, ActiveStream>();

export async function startChatStream(opts: StartChatStreamOptions): Promise<ChatStartResponse> {
  const builder = opts.buildProvider ?? defaultBuildProvider;
  const provider = await builder(opts.providerId);

  const userRow = appendMessage({
    conversationId: opts.conversationId,
    role: 'user',
    content: opts.userMessage,
    providerId: opts.providerId,
    modelId: opts.modelId,
  });

  const assistantRow = appendMessage({
    conversationId: opts.conversationId,
    role: 'assistant',
    content: '',
    providerId: opts.providerId,
    modelId: opts.modelId,
  });

  const history = listMessages(opts.conversationId);
  const messages: Message[] = history
    .filter((m) => m.id !== assistantRow.id && m.content.length > 0)
    .map((m) => ({ role: m.role, content: m.content }));

  const streamId = randomUUID();
  const controller = new AbortController();
  active.set(streamId, { controller });

  void runStream({
    streamId,
    provider,
    modelId: opts.modelId,
    messages,
    assistantMessageId: assistantRow.id,
    sink: opts.sink,
    signal: controller.signal,
  }).finally(() => {
    active.delete(streamId);
  });

  return {
    streamId,
    userMessageId: userRow.id,
    assistantMessageId: assistantRow.id,
  };
}

export function cancelChatStream(streamId: string): void {
  const entry = active.get(streamId);
  if (!entry) return;
  entry.controller.abort();
}

export function activeStreamCount(): number {
  return active.size;
}

interface RunStreamArgs {
  streamId: string;
  provider: LLMProvider;
  modelId: string;
  messages: Message[];
  assistantMessageId: string;
  sink: ChatStreamSink;
  signal: AbortSignal;
}

async function runStream(args: RunStreamArgs): Promise<void> {
  let buffer = '';
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let costUsd: number | null = null;
  let emittedDoneOrError = false;

  const emit = (event: ChatEvent): void => {
    args.sink.emit({ streamId: args.streamId, event });
    if (event.type === 'done' || event.type === 'error') {
      emittedDoneOrError = true;
    }
  };

  try {
    const iter = args.provider.chat({
      model: args.modelId,
      messages: args.messages,
      signal: args.signal,
    });
    for await (const event of iter) {
      if (args.signal.aborted) break;
      if (event.type === 'text_delta') {
        buffer += event.delta;
      } else if (event.type === 'usage') {
        inputTokens = event.inputTokens;
        outputTokens = event.outputTokens;
        costUsd = event.costUsd ?? null;
      }
      emit(event);
    }
    if (args.signal.aborted && !emittedDoneOrError) {
      emit({ type: 'done', stopReason: 'end_turn' });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, streamId: args.streamId }, 'chat stream errored');
    if (!emittedDoneOrError) {
      emit({ type: 'error', message, retryable: false });
    }
  } finally {
    try {
      updateAssistantMessage(args.assistantMessageId, {
        content: buffer,
        inputTokens,
        outputTokens,
        costUsd,
      });
    } catch (err) {
      logger.error(
        { err, assistantMessageId: args.assistantMessageId },
        'failed to persist assistant message',
      );
    }
  }
}
