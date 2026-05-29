import { describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from './events';
import type { ChatRequest, EmbedRequest, EmbedResult, LLMProvider } from './provider';
import type { ModelCapabilities } from './capabilities';
import { RoutingProvider } from './routing-provider';
import type { RoutingPolicy } from './routing';

interface CallLog {
  chat: Array<{ model: string; toolCount: number }>;
  embed: Array<{ model: string; count: number }>;
}

function makeProvider(id: string, log: CallLog): LLMProvider {
  return {
    id,
    displayName: id,
    async *chat(req: ChatRequest): AsyncIterable<ChatEvent> {
      log.chat.push({ model: req.model, toolCount: req.tools?.length ?? 0 });
      yield { type: 'text_delta', delta: id };
      yield { type: 'done', stopReason: 'end_turn' };
    },
    async embed(req: EmbedRequest): Promise<EmbedResult> {
      log.embed.push({ model: req.model, count: req.inputs.length });
      return { embeddings: req.inputs.map(() => [0, 1]), usage: { tokens: req.inputs.length } };
    },
    async listModels(): Promise<ModelCapabilities[]> {
      return [];
    },
    async capabilities(): Promise<ModelCapabilities | undefined> {
      return undefined;
    },
  };
}

async function collect(iter: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

const baseRequest: ChatRequest = {
  model: 'default-model',
  messages: [{ role: 'user', content: 'hi' }],
};

describe('RoutingProvider', () => {
  it('routes tool_call requests to the small/cheap rule', async () => {
    const log: CallLog = { chat: [], embed: [] };
    const small = makeProvider('small', log);
    const big = makeProvider('big', log);
    const policy: RoutingPolicy = {
      id: 'p1',
      name: 'Cheap and fast',
      rules: [
        { id: 'r1', when: 'tool_call', use: { providerId: 'small', modelId: 'tiny' } },
        { id: 'r2', when: 'reasoning', use: { providerId: 'big', modelId: 'frontier' } },
      ],
    };
    const router = new RoutingProvider({
      defaultRef: { providerId: 'big', modelId: 'frontier' },
      policy,
      providers: new Map([
        ['small', small],
        ['big', big],
      ]),
    });

    await collect(
      router.chat({
        ...baseRequest,
        tools: [
          {
            name: 'read_file',
            description: '',
            inputSchema: { type: 'object' },
            permissionTier: 'read',
          },
        ],
      }),
    );

    expect(log.chat).toEqual([{ model: 'tiny', toolCount: 1 }]);
  });

  it('routes reasoning requests to the frontier rule', async () => {
    const log: CallLog = { chat: [], embed: [] };
    const small = makeProvider('small', log);
    const big = makeProvider('big', log);
    const policy: RoutingPolicy = {
      id: 'p2',
      name: 'Hybrid',
      rules: [
        { id: 'r1', when: 'tool_call', use: { providerId: 'small', modelId: 'tiny' } },
        { id: 'r2', when: 'reasoning', use: { providerId: 'big', modelId: 'frontier' } },
      ],
    };
    const router = new RoutingProvider({
      defaultRef: { providerId: 'small', modelId: 'tiny' },
      policy,
      providers: new Map([
        ['small', small],
        ['big', big],
      ]),
    });

    await collect(
      router.chat({
        ...(baseRequest as ChatRequest & { reasoning: boolean }),
        ...({ reasoning: true } as { reasoning: boolean }),
      } as ChatRequest),
    );

    expect(log.chat).toEqual([{ model: 'frontier', toolCount: 0 }]);
  });

  it('routes embed() through the embedding rule', async () => {
    const log: CallLog = { chat: [], embed: [] };
    const local = makeProvider('local', log);
    const big = makeProvider('big', log);
    const policy: RoutingPolicy = {
      id: 'p3',
      name: 'Local embeddings',
      rules: [{ id: 'r1', when: 'embedding', use: { providerId: 'local', modelId: 'nomic' } }],
    };
    const router = new RoutingProvider({
      defaultRef: { providerId: 'big', modelId: 'frontier' },
      policy,
      providers: new Map([
        ['local', local],
        ['big', big],
      ]),
    });

    await router.embed({ model: 'whatever', inputs: ['a', 'b'] });

    expect(log.embed).toEqual([{ model: 'nomic', count: 2 }]);
  });

  it('falls back when primary provider is missing', async () => {
    const log: CallLog = { chat: [], embed: [] };
    const big = makeProvider('big', log);
    const policy: RoutingPolicy = {
      id: 'p4',
      name: 'Fallback',
      rules: [
        {
          id: 'r1',
          when: 'tool_call',
          use: { providerId: 'absent', modelId: 'gone' },
          fallback: { providerId: 'big', modelId: 'frontier' },
        },
      ],
    };
    const onDecision = vi.fn();
    const router = new RoutingProvider({
      defaultRef: { providerId: 'big', modelId: 'frontier' },
      policy,
      providers: new Map([['big', big]]),
      onDecision,
    });

    await collect(
      router.chat({
        ...baseRequest,
        tools: [
          {
            name: 'noop',
            description: '',
            inputSchema: { type: 'object' },
            permissionTier: 'read',
          },
        ],
      }),
    );

    expect(log.chat).toEqual([{ model: 'frontier', toolCount: 1 }]);
    expect(onDecision).toHaveBeenCalledOnce();
    expect(onDecision.mock.calls[0]?.[0]).toMatchObject({ usedFallback: true });
  });

  it('uses the default ref when no rule matches', async () => {
    const log: CallLog = { chat: [], embed: [] };
    const big = makeProvider('big', log);
    const policy: RoutingPolicy = {
      id: 'p5',
      name: 'Empty',
      rules: [],
    };
    const router = new RoutingProvider({
      defaultRef: { providerId: 'big', modelId: 'frontier' },
      policy,
      providers: new Map([['big', big]]),
    });

    await collect(router.chat(baseRequest));

    expect(log.chat).toEqual([{ model: 'frontier', toolCount: 0 }]);
  });

  it('honors a sensitive_path detector', async () => {
    const log: CallLog = { chat: [], embed: [] };
    const small = makeProvider('small', log);
    const big = makeProvider('big', log);
    const policy: RoutingPolicy = {
      id: 'p6',
      name: 'Sensitive',
      rules: [
        { id: 'r1', when: 'sensitive_path', use: { providerId: 'big', modelId: 'frontier' } },
      ],
    };
    const router = new RoutingProvider({
      defaultRef: { providerId: 'small', modelId: 'tiny' },
      policy,
      providers: new Map([
        ['small', small],
        ['big', big],
      ]),
      detectSensitivePath: () => true,
    });

    await collect(router.chat(baseRequest));
    expect(log.chat).toEqual([{ model: 'frontier', toolCount: 0 }]);
  });

  it('decideForChat exposes the resolution without dispatching', () => {
    const log: CallLog = { chat: [], embed: [] };
    const small = makeProvider('small', log);
    const big = makeProvider('big', log);
    const policy: RoutingPolicy = {
      id: 'p7',
      name: 'Inspect',
      rules: [{ id: 'r1', when: 'tool_call', use: { providerId: 'small', modelId: 'tiny' } }],
    };
    const router = new RoutingProvider({
      defaultRef: { providerId: 'big', modelId: 'frontier' },
      policy,
      providers: new Map([
        ['small', small],
        ['big', big],
      ]),
    });

    const decision = router.decideForChat({
      ...baseRequest,
      tools: [
        { name: 'x', description: '', inputSchema: { type: 'object' }, permissionTier: 'read' },
      ],
    });
    expect(decision).toEqual({
      matched: 'tool_call',
      ruleId: 'r1',
      providerId: 'small',
      modelId: 'tiny',
      usedFallback: false,
    });
    expect(log.chat).toEqual([]);
  });
});
