import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ChatEvent, ChatRequest, LLMProvider, Message } from '@opencodex/core';
import { ToolRegistry, defineTool } from '@opencodex/core';
import type { ChatStreamEvent } from '../../shared/chat';
import { createConversation } from '../storage/conversations';
import { applyMigrations, setDbForTesting } from '../storage/db';
import { listMessages } from '../storage/conversations';
import {
  activeStreamCount,
  cancelChatStream,
  expandStoredMessages,
  startChatStream,
} from './runner';
import { ApprovalManager } from './approvals';
import type { ApprovalRequest } from '../../shared/approvals';
import { DEFAULT_TIER_POLICIES } from '../../shared/approvals';
import type { StoredMessage } from '../../shared/conversation';

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

  it('runs a tool loop: tool_call → execute → tool_result → second turn', async () => {
    const conv = createConversation({});
    const { events, sink } = collectSink();

    const registry = new ToolRegistry();
    let toolInvocations = 0;
    registry.register(
      defineTool({
        name: 'fake_lookup',
        description: 'returns a canned answer',
        inputZod: z.object({ q: z.string() }),
        permissionTier: 'read',
        execute: async ({ q }) => {
          toolInvocations++;
          return { answer: `answer-for-${q}` };
        },
      }),
    );

    const turns: ChatRequest[] = [];
    let turn = 0;
    const provider: LLMProvider = {
      id: 'fake',
      displayName: 'Fake',
      async *chat(req: ChatRequest): AsyncIterable<ChatEvent> {
        turns.push(req);
        const t = turn++;
        if (t === 0) {
          yield { type: 'text_delta', delta: 'looking...' };
          yield { type: 'tool_call', id: 'call-1', name: 'fake_lookup', arguments: { q: 'hi' } };
          yield { type: 'done', stopReason: 'tool_use' };
        } else {
          yield { type: 'text_delta', delta: 'done!' };
          yield { type: 'usage', inputTokens: 9, outputTokens: 4 };
          yield { type: 'done', stopReason: 'end_turn' };
        }
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
      toolRegistry: registry,
      workspaceRoot: '/tmp',
    });
    await new Promise((r) => setTimeout(r, 30));

    expect(toolInvocations).toBe(1);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.tools?.map((t) => t.name)).toEqual(['fake_lookup']);

    // Second turn must contain the assistant tool_use + tool tool_result blocks
    const secondMsgs = turns[1]?.messages ?? [];
    expect(secondMsgs.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    const assistantBlocks = secondMsgs[1]?.content;
    expect(Array.isArray(assistantBlocks)).toBe(true);
    if (Array.isArray(assistantBlocks)) {
      const toolUse = assistantBlocks.find((b) => b.type === 'tool_use');
      expect(toolUse).toMatchObject({ id: 'call-1', name: 'fake_lookup' });
    }
    const toolMsgBlocks = secondMsgs[2]?.content;
    expect(Array.isArray(toolMsgBlocks)).toBe(true);
    if (Array.isArray(toolMsgBlocks)) {
      const result = toolMsgBlocks[0];
      expect(result?.type).toBe('tool_result');
      if (result?.type === 'tool_result') {
        expect(result.toolUseId).toBe('call-1');
        expect(result.output).toEqual({ answer: 'answer-for-hi' });
        expect(result.isError).toBeFalsy();
      }
    }

    // Sink events: text_delta, tool_call, tool_result, text_delta, usage, done
    const types = events.map((e) => e.event.type);
    expect(types).toEqual([
      'text_delta',
      'tool_call',
      'tool_result',
      'text_delta',
      'usage',
      'done',
    ]);

    // Persisted assistant content concatenates text across both iterations
    const stored = listMessages(conv.id);
    expect(stored[1]?.content).toBe('looking...done!');
    expect(stored[1]?.inputTokens).toBe(9);
    expect(stored[1]?.outputTokens).toBe(4);
  });

  it('blocks non-read-tier tools with a tool_result error and feeds it back', async () => {
    const conv = createConversation({});
    const { events, sink } = collectSink();

    const registry = new ToolRegistry();
    let writeCalls = 0;
    registry.register(
      defineTool({
        name: 'fake_write',
        description: 'write something',
        inputZod: z.object({ path: z.string() }),
        permissionTier: 'write',
        execute: async () => {
          writeCalls++;
          return { ok: true };
        },
      }),
    );

    let turn = 0;
    const provider: LLMProvider = {
      id: 'fake',
      displayName: 'Fake',
      async *chat(): AsyncIterable<ChatEvent> {
        const t = turn++;
        if (t === 0) {
          yield { type: 'tool_call', id: 'w1', name: 'fake_write', arguments: { path: 'x' } };
          yield { type: 'done', stopReason: 'tool_use' };
        } else {
          yield { type: 'text_delta', delta: 'gave up' };
          yield { type: 'done', stopReason: 'end_turn' };
        }
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
      toolRegistry: registry,
      workspaceRoot: '/tmp',
    });
    await new Promise((r) => setTimeout(r, 30));

    expect(writeCalls).toBe(0);
    const toolResult = events.find((e) => e.event.type === 'tool_result');
    expect(toolResult?.event.type).toBe('tool_result');
    if (toolResult?.event.type === 'tool_result') {
      expect(toolResult.event.isError).toBe(true);
      expect(String(toolResult.event.output)).toContain('write');
    }
    expect(listMessages(conv.id)[1]?.content).toBe('gave up');
  });

  it('uses an approval manager: allows write tool when user responds allow', async () => {
    const conv = createConversation({});
    const registry = new ToolRegistry();
    let writeCalls = 0;
    registry.register(
      defineTool({
        name: 'fake_write',
        description: 'write something',
        inputZod: z.object({ path: z.string() }),
        permissionTier: 'write',
        execute: async () => {
          writeCalls++;
          return { ok: true };
        },
      }),
    );

    const broadcasts: ApprovalRequest[] = [];
    const policies = {
      tierDefaults: { ...DEFAULT_TIER_POLICIES },
      toolOverrides: {},
    };
    const manager = new ApprovalManager(
      (req) => {
        broadcasts.push(req);
        // Simulate the user clicking "Allow once" on the next tick
        queueMicrotask(() =>
          manager.respond({ requestId: req.requestId, decision: 'allow', scope: 'once' }),
        );
      },
      () => policies,
      () => {},
    );

    let turn = 0;
    const provider: LLMProvider = {
      id: 'fake',
      displayName: 'Fake',
      async *chat(): AsyncIterable<ChatEvent> {
        const t = turn++;
        if (t === 0) {
          yield { type: 'tool_call', id: 'w1', name: 'fake_write', arguments: { path: 'x' } };
          yield { type: 'done', stopReason: 'tool_use' };
        } else {
          yield { type: 'text_delta', delta: 'done' };
          yield { type: 'done', stopReason: 'end_turn' };
        }
      },
      embed: vi.fn(),
      listModels: vi.fn(),
      capabilities: vi.fn(),
    } as unknown as LLMProvider;

    const { sink } = collectSink();
    await startChatStream({
      conversationId: conv.id,
      providerId: 'fake',
      modelId: 'fake-1',
      userMessage: 'hi',
      sink,
      buildProvider: async () => provider,
      toolRegistry: registry,
      approvalManager: manager,
      workspaceRoot: '/tmp',
    });
    await new Promise((r) => setTimeout(r, 30));

    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.toolName).toBe('fake_write');
    expect(writeCalls).toBe(1);
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

  it('persists tool blocks and replays them on the next turn', async () => {
    const conv = createConversation({});
    const registry = new ToolRegistry();
    registry.register(
      defineTool({
        name: 'fake_lookup',
        description: 'lookup',
        inputZod: z.object({ q: z.string() }),
        permissionTier: 'read',
        execute: async ({ q }) => ({ answer: `for-${q}` }),
      }),
    );

    // Turn 1: tool_use → tool_result → final text
    let turn1Iter = 0;
    const provider1: LLMProvider = {
      id: 'fake',
      displayName: 'Fake',
      async *chat(): AsyncIterable<ChatEvent> {
        const t = turn1Iter++;
        if (t === 0) {
          yield { type: 'text_delta', delta: 'checking' };
          yield { type: 'tool_call', id: 'c1', name: 'fake_lookup', arguments: { q: 'hi' } };
          yield { type: 'done', stopReason: 'tool_use' };
        } else {
          yield { type: 'text_delta', delta: 'done' };
          yield { type: 'done', stopReason: 'end_turn' };
        }
      },
      embed: vi.fn(),
      listModels: vi.fn(),
      capabilities: vi.fn(),
    } as unknown as LLMProvider;

    const { sink: sink1 } = collectSink();
    await startChatStream({
      conversationId: conv.id,
      providerId: 'fake',
      modelId: 'fake-1',
      userMessage: 'hi',
      sink: sink1,
      buildProvider: async () => provider1,
      toolRegistry: registry,
      workspaceRoot: '/tmp',
    });
    await new Promise((r) => setTimeout(r, 30));

    // Stored assistant row has the full block sequence
    const after1 = listMessages(conv.id);
    const assistant1 = after1[1];
    expect(assistant1?.contentBlocks).not.toBeNull();
    const blocks = assistant1?.contentBlocks ?? [];
    expect(blocks.map((b) => b.type)).toEqual(['text', 'tool_use', 'tool_result', 'text']);
    expect(assistant1?.content).toBe('checkingdone');

    // Turn 2: the LLM must see the expanded history (assistant w/ tool_use, tool w/ tool_result, assistant text, user)
    const seenTurn2: ChatRequest[] = [];
    const provider2 = fakeProvider(
      [
        { type: 'text_delta', delta: 'ok' },
        { type: 'done', stopReason: 'end_turn' },
      ],
      (req) => seenTurn2.push(req),
    );

    const { sink: sink2 } = collectSink();
    await startChatStream({
      conversationId: conv.id,
      providerId: 'fake',
      modelId: 'fake-1',
      userMessage: 'again',
      sink: sink2,
      buildProvider: async () => provider2,
      toolRegistry: registry,
      workspaceRoot: '/tmp',
    });
    await new Promise((r) => setTimeout(r, 30));

    const llmMessages = seenTurn2[0]?.messages ?? [];
    expect(llmMessages.map((m: Message) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'user',
    ]);
    const assistantWithToolUse = llmMessages[1]?.content;
    expect(Array.isArray(assistantWithToolUse)).toBe(true);
    if (Array.isArray(assistantWithToolUse)) {
      expect(assistantWithToolUse.find((b) => b.type === 'tool_use')).toMatchObject({
        id: 'c1',
        name: 'fake_lookup',
      });
    }
    const toolReplay = llmMessages[2]?.content;
    if (Array.isArray(toolReplay)) {
      expect(toolReplay[0]?.type).toBe('tool_result');
    }
    const finalAssistantText = llmMessages[3]?.content;
    if (Array.isArray(finalAssistantText)) {
      expect(finalAssistantText[0]).toMatchObject({ type: 'text', text: 'done' });
    }
  });
});

describe('expandStoredMessages', () => {
  const base = (overrides: Partial<StoredMessage>): StoredMessage => ({
    id: 'x',
    conversationId: 'c',
    role: 'user',
    content: '',
    contentBlocks: null,
    providerId: null,
    modelId: null,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  });

  it('falls back to plain text for legacy rows', () => {
    const stored = [base({ role: 'user', content: 'hi' })];
    expect(expandStoredMessages(stored)).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('drops rows with empty content and no blocks', () => {
    const stored = [base({ role: 'assistant', content: '' })];
    expect(expandStoredMessages(stored)).toEqual([]);
  });

  it('splits an assistant turn into alternating assistant / tool messages', () => {
    const stored = [
      base({
        role: 'assistant',
        content: 'text1text2',
        contentBlocks: [
          { type: 'text', text: 'text1' },
          { type: 'tool_use', id: 'a', name: 'foo', arguments: {} },
          { type: 'tool_result', toolUseId: 'a', output: 'r1' },
          { type: 'text', text: 'text2' },
        ],
      }),
    ];
    const expanded = expandStoredMessages(stored);
    expect(expanded.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
  });
});
