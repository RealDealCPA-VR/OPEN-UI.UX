import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent, ChatRequest, LLMProvider, Message } from '@opencodex/core';
import type { ChatStreamEvent } from '../../shared/chat';
import { createConversation } from '../storage/conversations';
import { applyMigrations, setDbForTesting } from '../storage/db';
import { listMessages } from '../storage/conversations';
import { activeStreamCount, cancelChatStream, startChatStream } from './runner';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  setDbForTesting(db);
});

afterEach(() => {
  setDbForTesting(null);
  db.close();
});

function fakeProvider(events: ChatEvent[], onChat?: (req: ChatRequest) => void): LLMProvider {
  return {
    id: 'fake',
    displayName: 'Fake',
    async *chat(req: ChatRequest): AsyncIterable<ChatEvent> {
      onChat?.(req);
      for (const e of events) {
        if (req.signal?.aborted) break;
        yield e;
      }
    },
    embed: vi.fn(),
    listModels: vi.fn(),
    capabilities: vi.fn(),
  } as unknown as LLMProvider;
}

function collectSink(): { events: ChatStreamEvent[]; sink: { emit(p: ChatStreamEvent): void } } {
  const events: ChatStreamEvent[] = [];
  return {
    events,
    sink: {
      emit(p) {
        events.push(p);
      },
    },
  };
}

describe('startChatStream', () => {
  it('persists user message, streams events, persists assistant text + usage', async () => {
    const conv = createConversation({});
    const { events, sink } = collectSink();
    const provider = fakeProvider([
      { type: 'text_delta', delta: 'Hello' },
      { type: 'text_delta', delta: ' world' },
      { type: 'usage', inputTokens: 5, outputTokens: 2, costUsd: 0.0001 },
      { type: 'done', stopReason: 'end_turn' },
    ]);

    const result = await startChatStream({
      conversationId: conv.id,
      providerId: 'fake',
      modelId: 'fake-1',
      userMessage: 'hi',
      sink,
      buildProvider: async () => provider,
    });

    expect(result.streamId).toBeTruthy();
    expect(result.userMessageId).toBeTruthy();
    expect(result.assistantMessageId).toBeTruthy();

    // wait for stream to drain
    await new Promise((r) => setTimeout(r, 20));

    expect(events.map((e) => e.event.type)).toEqual(['text_delta', 'text_delta', 'usage', 'done']);
    expect(events.every((e) => e.streamId === result.streamId)).toBe(true);

    const msgs = listMessages(conv.id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe('user');
    expect(msgs[0]?.content).toBe('hi');
    expect(msgs[1]?.role).toBe('assistant');
    expect(msgs[1]?.content).toBe('Hello world');
    expect(msgs[1]?.inputTokens).toBe(5);
    expect(msgs[1]?.outputTokens).toBe(2);
    expect(msgs[1]?.costUsd).toBeCloseTo(0.0001);
  });

  it('passes prior conversation history to provider.chat()', async () => {
    const conv = createConversation({});
    const seen: Message[] = [];
    const provider = fakeProvider([{ type: 'done', stopReason: 'end_turn' }], (req) => {
      seen.push(...req.messages);
    });
    const { sink } = collectSink();
    // Seed with a prior round of dialogue
    const { startChatStream: start1 } = await import('./runner');
    await start1({
      conversationId: conv.id,
      providerId: 'fake',
      modelId: 'fake-1',
      userMessage: 'first',
      sink,
      buildProvider: async () =>
        fakeProvider([
          { type: 'text_delta', delta: 'reply1' },
          { type: 'done', stopReason: 'end_turn' },
        ]),
    });
    await new Promise((r) => setTimeout(r, 20));

    await startChatStream({
      conversationId: conv.id,
      providerId: 'fake',
      modelId: 'fake-1',
      userMessage: 'second',
      sink,
      buildProvider: async () => provider,
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(seen.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(seen.map((m) => m.content)).toEqual(['first', 'reply1', 'second']);
  });

  it('emits an error event and persists partial text when the provider throws', async () => {
    const conv = createConversation({});
    const { events, sink } = collectSink();
    const provider: LLMProvider = {
      id: 'fake',
      displayName: 'Fake',
      async *chat() {
        yield { type: 'text_delta', delta: 'partial' };
        throw new Error('boom');
      },
      embed: vi.fn(),
      listModels: vi.fn(),
      capabilities: vi.fn(),
    } as unknown as LLMProvider;

    await startChatStream({
      conversationId: conv.id,
      providerId: 'fake',
      modelId: 'fake-1',
      userMessage: 'hi',
      sink,
      buildProvider: async () => provider,
    });
    await new Promise((r) => setTimeout(r, 20));

    const last = events[events.length - 1];
    expect(last?.event.type).toBe('error');
    if (last?.event.type === 'error') {
      expect(last.event.message).toContain('boom');
    }
    const msgs = listMessages(conv.id);
    expect(msgs[1]?.content).toBe('partial');
  });

  it('cancelChatStream aborts mid-stream', async () => {
    const conv = createConversation({});
    const { events, sink } = collectSink();
    const provider: LLMProvider = {
      id: 'fake',
      displayName: 'Fake',
      async *chat(req: ChatRequest): AsyncIterable<ChatEvent> {
        yield { type: 'text_delta', delta: 'before' };
        await new Promise<void>((resolve) => {
          if (req.signal?.aborted) return resolve();
          req.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      },
      embed: vi.fn(),
      listModels: vi.fn(),
      capabilities: vi.fn(),
    } as unknown as LLMProvider;

    const result = await startChatStream({
      conversationId: conv.id,
      providerId: 'fake',
      modelId: 'fake-1',
      userMessage: 'hi',
      sink,
      buildProvider: async () => provider,
    });
    await new Promise((r) => setTimeout(r, 10));
    cancelChatStream(result.streamId);
    await new Promise((r) => setTimeout(r, 20));

    expect(activeStreamCount()).toBe(0);
    expect(events.some((e) => e.event.type === 'text_delta')).toBe(true);
    const msgs = listMessages(conv.id);
    expect(msgs[1]?.content).toBe('before');
  });
});
