import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent, ChatRequest, LLMProvider } from '@opencodex/core';
import type { ReplayProgressEvent } from '../../shared/replay';
import { appendMessage, createConversation } from '../storage/conversations';
import { recordAppliedDiff } from '../storage/applied-diffs';
import { applyMigrations, setDbForTesting } from '../storage/db';
import { replayConversation, replayDiff } from './replay-engine';

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

function makeProvider(eventsPerCall: ChatEvent[][]): LLMProvider {
  let call = 0;
  return {
    id: 'fake',
    displayName: 'Fake',
    async *chat(_req: ChatRequest): AsyncIterable<ChatEvent> {
      const events = eventsPerCall[call] ?? [];
      call++;
      for (const e of events) {
        yield e;
      }
    },
    embed: vi.fn(),
    listModels: vi.fn(),
    capabilities: vi.fn(),
  } as unknown as LLMProvider;
}

describe('replayConversation', () => {
  it('returns an empty result with an error when the conversation is missing', async () => {
    const result = await replayConversation({
      request: {
        conversationId: 'does-not-exist',
        targetProviderId: 'p',
        targetModelId: 'm',
      },
      buildProvider: vi.fn(),
    });
    expect(result.errors[0]).toMatch(/not found/);
    expect(result.messagesReplayed).toBe(0);
    expect(result.pairs).toHaveLength(0);
  });

  it('replays user turns and emits progress events', async () => {
    const conv = createConversation({});
    appendMessage({
      conversationId: conv.id,
      role: 'user',
      content: 'first question',
    });
    appendMessage({
      conversationId: conv.id,
      role: 'assistant',
      content: 'original answer 1',
    });
    appendMessage({
      conversationId: conv.id,
      role: 'user',
      content: 'second question',
    });
    appendMessage({
      conversationId: conv.id,
      role: 'assistant',
      content: 'original answer 2',
    });

    const provider = makeProvider([
      [
        { type: 'text_delta', delta: 'new answer 1' },
        { type: 'usage', inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
        { type: 'done', stopReason: 'end_turn' },
      ],
      [
        { type: 'text_delta', delta: 'new answer 2' },
        { type: 'usage', inputTokens: 12, outputTokens: 6, costUsd: 0.002 },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ]);

    const progressEvents: ReplayProgressEvent[] = [];
    const result = await replayConversation({
      request: {
        conversationId: conv.id,
        targetProviderId: 'p',
        targetModelId: 'm',
        diffAgainstOriginal: true,
      },
      buildProvider: async () => provider,
      onProgress: (e) => progressEvents.push(e),
    });

    expect(result.messagesReplayed).toBe(2);
    expect(result.pairs).toHaveLength(2);
    expect(result.pairs[0]?.replayContent).toBe('new answer 1');
    expect(result.pairs[0]?.contentChanged).toBe(true);
    expect(result.pairs[1]?.replayContent).toBe('new answer 2');
    expect(result.totalTokensInput).toBe(22);
    expect(result.totalTokensOutput).toBe(11);
    expect(result.totalCostUsd).toBeCloseTo(0.003, 5);
    expect(result.errors).toEqual([]);
    expect(progressEvents.some((e) => e.stage === 'starting')).toBe(true);
    expect(progressEvents.some((e) => e.stage === 'message')).toBe(true);
    expect(progressEvents.some((e) => e.stage === 'completed')).toBe(true);
  });

  it('detects identical replays and records errors per turn', async () => {
    const conv = createConversation({});
    appendMessage({ conversationId: conv.id, role: 'user', content: 'q' });
    appendMessage({ conversationId: conv.id, role: 'assistant', content: 'same' });

    const provider = makeProvider([
      [
        { type: 'text_delta', delta: 'same' },
        { type: 'error', message: 'boom', retryable: false },
        { type: 'done', stopReason: 'error' },
      ],
    ]);

    const result = await replayConversation({
      request: {
        conversationId: conv.id,
        targetProviderId: 'p',
        targetModelId: 'm',
      },
      buildProvider: async () => provider,
    });

    expect(result.pairs[0]?.contentChanged).toBe(false);
    expect(result.errors[0]).toMatch(/boom/);
  });

  it('reports provider build failure as a top-level error', async () => {
    const conv = createConversation({});
    appendMessage({ conversationId: conv.id, role: 'user', content: 'q' });

    const result = await replayConversation({
      request: {
        conversationId: conv.id,
        targetProviderId: 'p',
        targetModelId: 'm',
      },
      buildProvider: async () => {
        throw new Error('no api key');
      },
    });

    expect(result.errors[0]).toMatch(/no api key/);
    expect(result.pairs).toHaveLength(0);
  });
});

describe('replayDiff', () => {
  it('returns an error when the diff is missing', async () => {
    const result = await replayDiff({
      request: { appliedDiffId: 'nope', targetProviderId: 'p', targetModelId: 'm' },
      buildProvider: vi.fn(),
    });
    expect(result.error).toMatch(/not found/);
  });

  it('replays the prompt snapshot when available', async () => {
    const conv = createConversation({});
    const msg = appendMessage({ conversationId: conv.id, role: 'assistant', content: '' });
    const id = recordAppliedDiff({
      conversationId: conv.id,
      messageId: msg.id,
      filePath: 'foo.ts',
      diff: 'd',
      promptSnapshot: 'do the thing',
    });

    let observedPrompt = '';
    const provider: LLMProvider = {
      id: 'fake',
      displayName: 'Fake',
      async *chat(req: ChatRequest): AsyncIterable<ChatEvent> {
        const first = req.messages[0];
        if (first && typeof first.content === 'string') observedPrompt = first.content;
        yield { type: 'text_delta', delta: 'replayed' };
        yield { type: 'usage', inputTokens: 1, outputTokens: 2 };
        yield { type: 'done', stopReason: 'end_turn' };
      },
      embed: vi.fn(),
      listModels: vi.fn(),
      capabilities: vi.fn(),
    } as unknown as LLMProvider;

    const result = await replayDiff({
      request: { appliedDiffId: id, targetProviderId: 'p', targetModelId: 'm' },
      buildProvider: async () => provider,
    });

    expect(observedPrompt).toBe('do the thing');
    expect(result.replayContent).toBe('replayed');
    expect(result.filePath).toBe('foo.ts');
    expect(result.tokensInput).toBe(1);
    expect(result.tokensOutput).toBe(2);
    expect(result.error).toBeNull();
  });
});
