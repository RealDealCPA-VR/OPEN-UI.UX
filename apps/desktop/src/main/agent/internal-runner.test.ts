import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectSubagentResult, type ChatEvent } from '@opencodex/core';

type ChatStream = AsyncIterable<ChatEvent>;

interface FakeProvider {
  chat: (args: unknown) => ChatStream;
}

const fakeChat: ReturnType<typeof vi.fn> = vi.fn();

vi.mock('../chat/provider-builder', () => ({
  buildProviderForId: vi.fn(
    async (): Promise<FakeProvider> => ({
      chat: (args) => fakeChat(args) as ChatStream,
    }),
  ),
}));

vi.mock('../tools/registry', () => ({
  getToolRegistry: vi.fn(() => ({ tools: new Map(), execute: vi.fn() })),
}));

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

async function* stream(events: ChatEvent[]): ChatStream {
  for (const e of events) yield e;
}

async function collectEvents(iter: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

describe('internalRunner.run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('synthesizes text_delta + usage + done in order for a result with no tool events', async () => {
    fakeChat.mockReturnValueOnce(
      stream([
        { type: 'text_delta', delta: 'all done' },
        { type: 'usage', inputTokens: 42, outputTokens: 19 },
        { type: 'done', stopReason: 'end_turn' },
      ]),
    );
    const { internalRunner } = await import('./subagent');

    const events = await collectEvents(
      internalRunner.run({
        task: 't',
        workspaceRoot: '/tmp/ws',
        providerId: 'openai',
        modelId: 'gpt-4o-mini',
      }),
    );

    expect(events.map((e) => e.type)).toEqual(['text_delta', 'usage', 'done']);
    expect(events[0]).toMatchObject({ type: 'text_delta', delta: 'all done' });
    expect(events[1]).toMatchObject({ type: 'usage', inputTokens: 42, outputTokens: 19 });
    expect(events[2]).toMatchObject({ type: 'done', stopReason: 'end_turn' });
  });

  it('collectSubagentResult reconstructs text + tokens + iterations + stopReason from the stream', async () => {
    fakeChat.mockReturnValueOnce(
      stream([
        { type: 'text_delta', delta: 'finished' },
        { type: 'usage', inputTokens: 100, outputTokens: 50 },
        { type: 'done', stopReason: 'end_turn' },
      ]),
    );
    const { internalRunner } = await import('./subagent');

    const result = await collectSubagentResult(
      internalRunner.run({
        task: 't',
        workspaceRoot: '/tmp/ws',
        providerId: 'openai',
        modelId: 'gpt-4o-mini',
      }),
    );

    expect(result.text).toBe('finished');
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
    expect(result.stopReason).toBe('end_turn');
    expect(result.iterations).toBe(0);
  });

  it('equivalence: streaming through internalRunner.run yields the same SubagentResult shape as running runSubagent directly', async () => {
    const events: ChatEvent[] = [
      { type: 'text_delta', delta: 'hello world' },
      { type: 'usage', inputTokens: 7, outputTokens: 3 },
      { type: 'done', stopReason: 'end_turn' },
    ];
    fakeChat.mockReturnValueOnce(stream(events));
    const { internalRunner, runSubagent } = await import('./subagent');

    const viaRunner = await collectSubagentResult(
      internalRunner.run({
        task: 'compare',
        workspaceRoot: '/tmp/ws',
        providerId: 'openai',
        modelId: 'gpt-4o-mini',
      }),
    );

    fakeChat.mockReturnValueOnce(stream(events));
    const { buildProviderForId } = await import('../chat/provider-builder');
    const { getToolRegistry } = await import('../tools/registry');
    const provider = await buildProviderForId('openai');
    const toolRegistry = getToolRegistry();
    const direct = await runSubagent({
      task: 'compare',
      provider,
      modelId: 'gpt-4o-mini',
      toolRegistry,
      workspaceRoot: '/tmp/ws',
    });

    expect(viaRunner.text).toBe(direct.text);
    expect(viaRunner.inputTokens).toBe(direct.inputTokens);
    expect(viaRunner.outputTokens).toBe(direct.outputTokens);
    expect(viaRunner.stopReason).toBe(direct.stopReason);
    expect(viaRunner.toolEvents.length).toBe(direct.toolEvents.length);
  });

  it('emits error + done(error) when the provider stream raises an error event', async () => {
    fakeChat.mockReturnValueOnce(
      stream([{ type: 'error', message: 'something broke', retryable: false }]),
    );
    const { internalRunner } = await import('./subagent');

    const events = await collectEvents(
      internalRunner.run({
        task: 'do x',
        workspaceRoot: '/tmp/ws',
        providerId: 'openai',
        modelId: 'gpt-4o',
      }),
    );

    const types = events.map((e) => e.type);
    expect(types).toContain('error');
    expect(types[types.length - 1]).toBe('done');
    const done = events[events.length - 1];
    expect(done).toMatchObject({ type: 'done', stopReason: 'error' });
  });

  it('yields error + done(error) when providerId is missing', async () => {
    const { internalRunner } = await import('./subagent');

    const events = await collectEvents(
      internalRunner.run({
        task: 't',
        workspaceRoot: '/tmp/ws',
        modelId: 'gpt-4o',
      }),
    );

    expect(events.map((e) => e.type)).toEqual(['error', 'done']);
    expect(events[0]).toMatchObject({
      type: 'error',
      message: 'internalRunner requires providerId and modelId',
    });
    expect(events[1]).toMatchObject({ type: 'done', stopReason: 'error' });
  });

  it('aborts before invoking the provider when signal is already aborted', async () => {
    const { internalRunner } = await import('./subagent');
    const controller = new AbortController();
    controller.abort();

    const events = await collectEvents(
      internalRunner.run({
        task: 't',
        workspaceRoot: '/tmp/ws',
        providerId: 'openai',
        modelId: 'gpt-4o',
        signal: controller.signal,
      }),
    );

    const types = events.map((e) => e.type);
    expect(types[types.length - 1]).toBe('done');
    expect(types).toContain('error');
  });

  it('exposes runner identity', async () => {
    const { internalRunner } = await import('./subagent');
    expect(internalRunner.id).toBe('internal');
    expect(internalRunner.streaming).toBe(true);
    expect(internalRunner.displayName).toMatch(/built-in/i);
  });
});
