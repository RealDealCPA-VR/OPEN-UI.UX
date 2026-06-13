import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ChatEvent, ChatRequest, LLMProvider, Message } from '@opencodex/core';
import { ToolRegistry, defineTool } from '@opencodex/core';
import type { ChatStreamEvent } from '../../shared/chat';
import { createConversation } from '../storage/conversations';
import { applyMigrations, setDbForTesting } from '../storage/db';
import { listMessages } from '../storage/conversations';
import { listToolCallsForMessage } from '../storage/tool-audit';
import {
  activeStreamCount,
  cancelChatStream,
  classifyProviderError,
  expandStoredMessages,
  getActivePartial,
  listActiveStreams,
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
      workspaceRoot: '/tmp/locked',
      buildProvider: async () => provider,
    });

    expect(result.streamId).toBeTruthy();
    expect(result.userMessageId).toBeTruthy();
    expect(result.assistantMessageId).toBeTruthy();
    expect(result.workspaceRoot).toBe('/tmp/locked');

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

  it('records an audit row per tool call with decision=auto for read-tier tools', async () => {
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

    let turn = 0;
    const provider: LLMProvider = {
      id: 'fake',
      displayName: 'Fake',
      async *chat(): AsyncIterable<ChatEvent> {
        const t = turn++;
        if (t === 0) {
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

    const { sink } = collectSink();
    const { assistantMessageId } = await startChatStream({
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

    const audit = listToolCallsForMessage(assistantMessageId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      toolName: 'fake_lookup',
      input: { q: 'hi' },
      output: { answer: 'for-hi' },
      decision: 'auto',
      isError: false,
    });
    expect(audit[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records prompt-allowed-session for write tools approved with session scope', async () => {
    const conv = createConversation({});
    const registry = new ToolRegistry();
    registry.register(
      defineTool({
        name: 'fake_write',
        description: 'write',
        inputZod: z.object({ path: z.string() }),
        permissionTier: 'write',
        execute: async () => ({ ok: true }),
      }),
    );

    const policies = {
      tierDefaults: { ...DEFAULT_TIER_POLICIES },
      toolOverrides: {},
    };
    const manager = new ApprovalManager(
      (req) => {
        queueMicrotask(() =>
          manager.respond({ requestId: req.requestId, decision: 'allow', scope: 'session' }),
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
          yield { type: 'done', stopReason: 'end_turn' };
        }
      },
      embed: vi.fn(),
      listModels: vi.fn(),
      capabilities: vi.fn(),
    } as unknown as LLMProvider;

    const { sink } = collectSink();
    const { assistantMessageId } = await startChatStream({
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

    const audit = listToolCallsForMessage(assistantMessageId);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.decision).toBe('prompt-allowed-session');
    expect(audit[0]?.isError).toBe(false);
  });

  it('partial override: executes write_file(override.args) instead of edit_file, audits prompt-allowed-partial', async () => {
    const conv = createConversation({});
    const registry = new ToolRegistry();
    let editCalls = 0;
    let writeArgs: { path: string; content: string } | null = null;
    registry.register(
      defineTool({
        name: 'edit_file',
        description: 'edit',
        inputZod: z.object({ path: z.string(), oldString: z.string(), newString: z.string() }),
        permissionTier: 'write',
        execute: async () => {
          editCalls++;
          return { ok: true };
        },
      }),
    );
    registry.register(
      defineTool({
        name: 'write_file',
        description: 'write',
        inputZod: z.object({ path: z.string().min(1), content: z.string() }),
        permissionTier: 'write',
        execute: async ({ path, content }) => {
          writeArgs = { path, content };
          return { ok: true };
        },
      }),
    );

    const policies = { tierDefaults: { ...DEFAULT_TIER_POLICIES }, toolOverrides: {} };
    const manager = new ApprovalManager(
      (req) => {
        queueMicrotask(() =>
          manager.respond({
            requestId: req.requestId,
            decision: 'allow',
            scope: 'once',
            override: {
              toolName: 'write_file',
              arguments: { path: 'src/a.ts', content: 'KEPT\nORIGINAL\n' },
            },
          }),
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
          yield {
            type: 'tool_call',
            id: 'e1',
            name: 'edit_file',
            arguments: { path: 'src/a.ts', oldString: 'a', newString: 'b' },
          };
          yield { type: 'done', stopReason: 'tool_use' };
        } else {
          yield { type: 'done', stopReason: 'end_turn' };
        }
      },
      embed: vi.fn(),
      listModels: vi.fn(),
      capabilities: vi.fn(),
    } as unknown as LLMProvider;

    const { sink } = collectSink();
    const { assistantMessageId } = await startChatStream({
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

    expect(editCalls).toBe(0);
    expect(writeArgs).toEqual({ path: 'src/a.ts', content: 'KEPT\nORIGINAL\n' });

    const audit = listToolCallsForMessage(assistantMessageId);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.decision).toBe('prompt-allowed-partial');
    expect(audit[0]?.isError).toBe(false);
    // Audit input reflects the executed override (correct path + content).
    expect(audit[0]?.input).toEqual({ path: 'src/a.ts', content: 'KEPT\nORIGINAL\n' });
  });

  it('partial override is re-validated at the tool sink (registry zod rejects bad args → tool error)', async () => {
    const conv = createConversation({});
    const registry = new ToolRegistry();
    registry.register(
      defineTool({
        name: 'edit_file',
        description: 'edit',
        inputZod: z.object({ path: z.string(), oldString: z.string(), newString: z.string() }),
        permissionTier: 'write',
        execute: async () => ({ ok: true }),
      }),
    );
    registry.register(
      defineTool({
        name: 'write_file',
        description: 'write',
        // Sink requires a non-empty path; an escaping/empty path is rejected here.
        inputZod: z.object({ path: z.string().min(1), content: z.string() }),
        permissionTier: 'write',
        execute: async () => ({ ok: true }),
      }),
    );

    const policies = { tierDefaults: { ...DEFAULT_TIER_POLICIES }, toolOverrides: {} };
    const manager = new ApprovalManager(
      (req) => {
        queueMicrotask(() =>
          manager.respond({
            requestId: req.requestId,
            decision: 'allow',
            scope: 'once',
            // Empty path: passes the IPC boundary mock here but the registry's
            // own zod (.min(1)) must reject it at the sink.
            override: { toolName: 'write_file', arguments: { path: '', content: 'x' } },
          }),
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
          yield {
            type: 'tool_call',
            id: 'e1',
            name: 'edit_file',
            arguments: { path: 'src/a.ts', oldString: 'a', newString: 'b' },
          };
          yield { type: 'done', stopReason: 'tool_use' };
        } else {
          yield { type: 'done', stopReason: 'end_turn' };
        }
      },
      embed: vi.fn(),
      listModels: vi.fn(),
      capabilities: vi.fn(),
    } as unknown as LLMProvider;

    const { events, sink } = collectSink();
    const { assistantMessageId } = await startChatStream({
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

    const toolResult = events.find((e) => e.event.type === 'tool_result');
    expect(toolResult?.event.type).toBe('tool_result');
    if (toolResult?.event.type === 'tool_result') {
      expect(toolResult.event.isError).toBe(true);
    }
    const audit = listToolCallsForMessage(assistantMessageId);
    expect(audit).toHaveLength(1);
    // Still attributed to the partial path; the error came from sink re-validation.
    expect(audit[0]?.decision).toBe('prompt-allowed-partial');
    expect(audit[0]?.isError).toBe(true);
  });

  it('records denied for tools blocked because no approval manager is configured', async () => {
    const conv = createConversation({});
    const registry = new ToolRegistry();
    registry.register(
      defineTool({
        name: 'fake_write',
        description: 'write',
        inputZod: z.object({ path: z.string() }),
        permissionTier: 'write',
        execute: async () => ({ ok: true }),
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
          yield { type: 'done', stopReason: 'end_turn' };
        }
      },
      embed: vi.fn(),
      listModels: vi.fn(),
      capabilities: vi.fn(),
    } as unknown as LLMProvider;

    const { sink } = collectSink();
    const { assistantMessageId } = await startChatStream({
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

    const audit = listToolCallsForMessage(assistantMessageId);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.decision).toBe('denied');
    expect(audit[0]?.isError).toBe(true);
    expect(audit[0]?.durationMs).toBeNull();
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
    // User cancellation must be distinguishable from a natural completion.
    const last = events[events.length - 1];
    expect(last?.event).toEqual({ type: 'done', stopReason: 'cancelled' });
  });

  it('treats a mid-stream provider error as terminal: error then done(error), no tool execution', async () => {
    const conv = createConversation({});
    const { events, sink } = collectSink();

    const registry = new ToolRegistry();
    let toolInvocations = 0;
    registry.register(
      defineTool({
        name: 'fake_lookup',
        description: 'lookup',
        inputZod: z.object({ q: z.string() }),
        permissionTier: 'read',
        execute: async () => {
          toolInvocations++;
          return { ok: true };
        },
      }),
    );

    let turns = 0;
    const provider: LLMProvider = {
      id: 'fake',
      displayName: 'Fake',
      async *chat(): AsyncIterable<ChatEvent> {
        turns++;
        yield { type: 'text_delta', delta: 'partial' };
        yield { type: 'error', message: 'mid-stream failure', retryable: false };
        // The runner must stop consuming after the terminal error, so the
        // tool_call below never reaches the loop.
        yield { type: 'tool_call', id: 'c1', name: 'fake_lookup', arguments: { q: 'x' } };
        yield { type: 'done', stopReason: 'tool_use' };
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

    expect(turns).toBe(1);
    expect(toolInvocations).toBe(0);
    expect(events.map((e) => e.event.type)).toEqual(['text_delta', 'error', 'done']);
    const last = events[events.length - 1];
    expect(last?.event).toEqual({ type: 'done', stopReason: 'error' });
  });

  it('retries when the provider marks an error retryable even if the message contains 4xx-looking digits', async () => {
    // Pin jitter to 0 so the retry delay is exactly RETRY_BASE_MS.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const conv = createConversation({});
      const { events, sink } = collectSink();
      let attempts = 0;
      const provider: LLMProvider = {
        id: 'fake',
        displayName: 'Fake',
        async *chat(): AsyncIterable<ChatEvent> {
          attempts++;
          if (attempts === 1) {
            yield { type: 'error', message: 'request timed out after 4000ms', retryable: true };
            return;
          }
          yield { type: 'text_delta', delta: 'recovered' };
          yield { type: 'done', stopReason: 'end_turn' };
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
      // Wait out the 1s backoff plus stream completion.
      await new Promise((r) => setTimeout(r, 1500));

      expect(attempts).toBe(2);
      expect(events.some((e) => e.event.type === 'error')).toBe(false);
      const msgs = listMessages(conv.id);
      expect(msgs[1]?.content).toBe('recovered');
    } finally {
      randomSpy.mockRestore();
    }
  }, 10000);

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

describe('classifyProviderError', () => {
  it('honors an explicit retryable hint when the message contains incidental digits like 4000ms', () => {
    const r = classifyProviderError('request timed out after 4000ms', true);
    expect(r.isRetryable).toBe(true);
  });

  it('treats code rate_limit as retryable regardless of message or hint', () => {
    const r = classifyProviderError('opaque provider message', undefined, 'rate_limit');
    expect(r.isRetryable).toBe(true);
    expect(r.friendly).toContain('rate-limited');
  });

  it('treats code server/timeout/network as retryable', () => {
    expect(classifyProviderError('x', undefined, 'server').isRetryable).toBe(true);
    expect(classifyProviderError('x', undefined, 'timeout').isRetryable).toBe(true);
    expect(classifyProviderError('x', undefined, 'network').isRetryable).toBe(true);
  });

  it('treats code auth/invalid_request/context_length as fatal even with retryable hint true', () => {
    expect(classifyProviderError('x', true, 'auth').isRetryable).toBe(false);
    expect(classifyProviderError('x', true, 'invalid_request').isRetryable).toBe(false);
    expect(classifyProviderError('x', true, 'context_length').isRetryable).toBe(false);
  });

  it('honors an explicit retryable:false hint over a retryable-looking message', () => {
    expect(classifyProviderError('503 service unavailable', false).isRetryable).toBe(false);
  });

  it('falls back to word-boundary sniffing: bare 400 status is fatal, 4000ms is not auth/bad-request', () => {
    expect(classifyProviderError('HTTP 400: bad request').isRetryable).toBe(false);
    expect(classifyProviderError('HTTP 503: service unavailable').isRetryable).toBe(true);
    // No code, no hint, no recognizable status — fatal by default, but not
    // because '4000' was misread as a 400.
    expect(classifyProviderError('timed out after 4000ms').isRetryable).toBe(false);
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
    cachedInputTokens: null,
    costUsd: null,
    createdAt: '2026-01-01T00:00:00Z',
    turnStatus: 'final',
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

function ftsRowCount(database: Database.Database, messageId: string): number {
  const row = database
    .prepare('SELECT COUNT(*) AS n FROM messages_fts WHERE message_id = ?')
    .get(messageId) as { n: number };
  return row.n;
}

describe('crash-restore checkpoint', () => {
  it('keeps turn_status streaming while in-flight then flips to final, without thrashing FTS', async () => {
    const conv = createConversation({});
    const { sink } = collectSink();

    // A gate the provider awaits between its delta and its done event, so we can
    // observe the persisted partial mid-stream.
    const gateControl: { release: () => void } = { release: () => {} };
    const gate = new Promise<void>((resolve) => {
      gateControl.release = resolve;
    });

    const provider: LLMProvider = {
      id: 'fake',
      displayName: 'Fake',
      async *chat(): AsyncIterable<ChatEvent> {
        yield { type: 'text_delta', delta: 'partial answer' };
        await gate;
        yield { type: 'done', stopReason: 'end_turn' };
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

    // Give the leading-edge checkpoint time to land the partial.
    await new Promise((r) => setTimeout(r, 20));

    const midRows = listMessages(conv.id);
    const midAssistant = midRows.find((m) => m.id === result.assistantMessageId);
    expect(midAssistant?.turnStatus).toBe('streaming');
    expect(midAssistant?.content).toBe('partial answer');
    // Checkpoint must NOT index FTS.
    expect(ftsRowCount(db, result.assistantMessageId)).toBe(0);

    gateControl.release();
    await new Promise((r) => setTimeout(r, 20));

    const finalRows = listMessages(conv.id);
    const finalAssistant = finalRows.find((m) => m.id === result.assistantMessageId);
    expect(finalAssistant?.turnStatus).toBe('final');
    expect(finalAssistant?.content).toBe('partial answer');
    // Terminal write re-indexes FTS exactly once.
    expect(ftsRowCount(db, result.assistantMessageId)).toBe(1);
  });

  it('reflects tool_result blocks in the checkpointed partial', async () => {
    const conv = createConversation({});
    const { sink } = collectSink();
    const registry = new ToolRegistry();
    registry.register(
      defineTool({
        name: 'fake_lookup',
        description: 'canned',
        inputZod: z.object({ q: z.string() }),
        permissionTier: 'read',
        execute: async ({ q }) => ({ answer: `a-${q}` }),
      }),
    );

    let turn = 0;
    const provider: LLMProvider = {
      id: 'fake',
      displayName: 'Fake',
      async *chat(): AsyncIterable<ChatEvent> {
        const t = turn++;
        if (t === 0) {
          yield { type: 'tool_call', id: 'c1', name: 'fake_lookup', arguments: { q: 'x' } };
          yield { type: 'done', stopReason: 'tool_use' };
        } else {
          yield { type: 'text_delta', delta: 'final text' };
          yield { type: 'done', stopReason: 'end_turn' };
        }
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
      toolRegistry: registry,
      workspaceRoot: '/tmp',
    });
    await new Promise((r) => setTimeout(r, 30));

    const rows = listMessages(conv.id);
    const assistant = rows.find((m) => m.id === result.assistantMessageId);
    expect(assistant?.turnStatus).toBe('final');
    const blocks = assistant?.contentBlocks ?? [];
    expect(blocks.some((b) => b.type === 'tool_use')).toBe(true);
    expect(blocks.some((b) => b.type === 'tool_result')).toBe(true);
  });
});

describe('reattach liveness', () => {
  it('lists an active stream during the turn and removes it after', async () => {
    const conv = createConversation({});
    const { sink } = collectSink();

    const gateControl: { release: () => void } = { release: () => {} };
    const gate = new Promise<void>((resolve) => {
      gateControl.release = resolve;
    });

    const provider: LLMProvider = {
      id: 'fake',
      displayName: 'Fake',
      async *chat(): AsyncIterable<ChatEvent> {
        yield { type: 'text_delta', delta: 'hi' };
        await gate;
        yield { type: 'done', stopReason: 'end_turn' };
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
    await new Promise((r) => setTimeout(r, 20));

    const duringActive = listActiveStreams();
    expect(duringActive.some((s) => s.conversationId === conv.id)).toBe(true);
    const partial = getActivePartial(conv.id);
    expect(partial?.id).toBe(result.assistantMessageId);
    expect(partial?.turnStatus).toBe('streaming');

    gateControl.release();
    await new Promise((r) => setTimeout(r, 20));

    expect(listActiveStreams().some((s) => s.conversationId === conv.id)).toBe(false);
    expect(getActivePartial(conv.id)).toBeNull();
  });
});
