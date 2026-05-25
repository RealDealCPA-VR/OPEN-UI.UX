# Provider Authoring Guide

A "provider" in OpenCodex is anything that implements `LLMProvider`. Built-ins live one-per-package in `packages/provider-*`. Third parties contribute providers through the plugin SDK (see [plugin-authoring.md](./plugin-authoring.md)).

This guide is the contract. Match it and the agent loop, UI, and tool layer treat your provider as a first-class citizen.

## The `LLMProvider` interface

From `packages/core/src/provider.ts:29`:

```ts
interface LLMProvider {
  readonly id: string;
  readonly displayName: string;

  chat(req: ChatRequest): AsyncIterable<ChatEvent>;
  embed(req: EmbedRequest): Promise<EmbedResult>;

  listModels(): Promise<ModelCapabilities[]>;
  capabilities(model: string): Promise<ModelCapabilities | undefined>;
}
```

`ChatRequest` (`packages/core/src/provider.ts:7`):

```ts
interface ChatRequest {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  signal?: AbortSignal;
}
```

`EmbedRequest` / `EmbedResult` (`provider.ts:18`):

```ts
interface EmbedRequest {
  model: string;
  inputs: string[];
  signal?: AbortSignal;
}

interface EmbedResult {
  embeddings: number[][]; // one row per input, in input order
  usage: { tokens: number };
}
```

## `ProviderFactory` and registry

You never construct providers directly. You ship a `ProviderFactory` (`packages/core/src/provider.ts:48`):

```ts
interface ProviderFactory<TConfig extends ProviderConfig = ProviderConfig> {
  readonly id: string;
  readonly displayName: string;
  readonly configSchema: z.ZodType<TConfig>;
  create(config: TConfig): LLMProvider;
}
```

`ProviderConfig` (`provider.ts:40`) is the base shape `{ apiKey?, baseUrl?, headers? }` — extend it with your own Zod schema (see `packages/provider-openai/src/config.ts` for an example that adds `organization` and `project`).

The `ProviderRegistry` (`packages/core/src/registry.ts:18`) holds factories. On `create(id, config)` it:

1. Looks up the factory by `id` (`registry.ts:44`).
2. Runs `configSchema.safeParse(config)` (`registry.ts:49`).
3. Throws `ProviderConfigError` with the Zod issues if the parse fails.
4. Otherwise calls `factory.create(parsed.data)`.

So **all config validation is centralized**. Your `create()` receives a fully-typed, fully-validated config object.

## `ChatEvent` union

From `packages/core/src/events.ts:50`. Every event yielded from `chat()` must be one of these six:

| `type`        | Meaning                                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `text_delta`  | Incremental assistant text. `delta: string`. Emit as it arrives, do not buffer the whole turn.                                         |
| `tool_call`   | A complete tool call: `{ id, name, arguments }`. `arguments` is the parsed JSON object (or the raw string if parse failed). See below. |
| `tool_result` | Provider rarely emits this directly — the agent loop emits it after running the tool. Carries `{ id, output, isError? }`.              |
| `usage`       | Token accounting: `{ inputTokens, outputTokens, cachedInputTokens?, costUsd? }`. May appear mid-stream or at the end.                  |
| `done`        | Terminal event for a turn. `stopReason` is one of `end_turn`, `max_tokens`, `stop_sequence`, `tool_use`, `error`.                      |
| `error`       | In-stream error: `{ message, retryable, cause? }`. Emit this then `done` with `stopReason: 'error'`.                                   |

Full Zod schemas in `events.ts:3-48`.

## `ModelCapabilities`

From `packages/core/src/capabilities.ts:9`:

```ts
{
  id: string;
  providerId: string;
  displayName: string;
  contextWindow: number;       // tokens
  maxOutputTokens?: number;
  toolUse: boolean;            // model supports function/tool calling
  vision: boolean;             // model accepts image content blocks
  streaming: boolean;          // chat() yields incrementally
  embeddings: boolean;         // model is an embedding model (use with embed())
  promptCaching?: boolean;     // supports server-side prompt caching
  pricing?: { inputPerMillion, outputPerMillion, cachedInputPerMillion? };
}
```

The renderer reads capabilities to gate UI: vision toggle off if `vision === false`, tool list hidden if `toolUse === false`, etc.

## Streaming contract

Providers **must** yield events incrementally — do not buffer the whole turn then emit. The agent loop pipes `text_delta` events straight to the UI as they arrive.

Tool calls are special. Most provider APIs deliver tool calls in fragments (`tool_calls[i].function.arguments` chunked across SSE events). **Accumulate internally** and emit a single complete `tool_call` event per call once you've seen `finish_reason: 'tool_calls'`. See `packages/provider-openai/src/translate-stream.ts:24` for the canonical pattern:

```ts
// Accumulate fragments into a pending map keyed by tool_call index
const pending = new Map<number, PendingToolCall>();
// ...
for (const tc of delta.tool_calls) {
  const cur = pending.get(tc.index) ?? { id: '', name: '', arguments: '' };
  if (tc.id) cur.id = tc.id;
  if (tc.function?.name) cur.name = tc.function.name;
  if (tc.function?.arguments) cur.arguments += tc.function.arguments;
  pending.set(tc.index, cur);
}
// ...at end of stream, emit one tool_call per accumulator
```

Required ordering for a normal turn:

1. Zero or more `text_delta`s.
2. Zero or more `tool_call`s (each emitted only when fully assembled).
3. Exactly one `usage` (if the provider reports tokens).
4. Exactly one `done` with the appropriate `stopReason`.

`done` with `stopReason: 'tool_use'` signals the agent loop to execute the just-emitted tool calls and run another iteration.

## Pulling an SSE stream

Reference: `packages/provider-openai/src/sse.ts:1`.

```ts
export async function* sseEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data: string[] = [];
        for (const line of raw.split('\n')) {
          if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        }
        if (data.length > 0) yield data.join('\n');
        idx = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

Then in `chat()` (see `packages/provider-openai/src/provider.ts:70`):

```ts
private async *chunksFromBody(body: ReadableStream<Uint8Array>) {
  for await (const data of sseEvents(body)) {
    if (data === '[DONE]') return;
    let parsed: unknown;
    try { parsed = JSON.parse(data); } catch { continue; }
    const result = chatChunkSchema.safeParse(parsed);  // ALWAYS validate
    if (result.success) yield result.data;
  }
}
```

For NDJSON streams (Ollama) the loop is the same minus the SSE framing — split on `\n`, parse each line, validate with Zod, yield.

## Error contract

There are two failure modes and they go through different paths.

### Config errors → throw early

Bad `apiKey`, missing required field, malformed `baseUrl` — let the Zod `configSchema` reject in the factory. The registry throws `ProviderConfigError` before your `LLMProvider` is ever constructed.

### Pre-stream HTTP errors → throw or emit-then-done

A non-2xx response before the stream starts. The OpenAI adapter's choice (`packages/provider-openai/src/provider.ts:28`) is to **emit** an error event so the UI sees a structured message, then emit `done`:

```ts
if (!response.ok || !response.body) {
  const detail = await this.safeReadText(response);
  yield {
    type: 'error',
    message: `OpenAI chat HTTP ${response.status}: ${detail}`,
    retryable: response.status >= 500 || response.status === 429,
  };
  yield { type: 'done', stopReason: 'error' };
  return;
}
```

Mark `retryable: true` for `5xx` and `429`; `false` for `4xx` auth/config failures.

### In-stream errors → emit error, emit done

Same shape. If the provider closes the stream mid-turn or sends an error frame, translate it into a `ChatEvent` error then terminate with `done`. **Never throw from inside the generator** — the agent loop catches it but the UI loses the streamed events you already produced.

## Embed contract

`embed()` returns `EmbedResult` (`provider.ts:24`):

- `embeddings[i]` aligns with `inputs[i]` (preserve order — see `packages/provider-openai/src/provider.ts:54` which sorts by `data[i].index` because OpenAI may reorder).
- `usage.tokens` is total input tokens consumed (most provider APIs report only an aggregate).

Throw a plain `Error` for embedding failures — the embed path is not streaming, so there's no error-event channel. Callers handle the rejection.

## Capability detection patterns

Two strategies, both legitimate:

1. **Static catalog** (used by every built-in adapter, e.g. `packages/provider-openai/src/models.ts`): hardcode a `ModelCapabilities[]` for the models you know about. `listModels()` returns the catalog; `capabilities(model)` does an `Array.find`. Cheap, deterministic, no network round-trip.

2. **Dynamic discovery**: fetch the provider's `GET /models` endpoint and translate into `ModelCapabilities[]`. Good for providers that gate models per-account (Ollama, OpenRouter). The downside is `listModels()` becomes async-blocking on every UI render that needs the list — cache aggressively.

Hybrid is fine: hardcode known flagships' capability flags (`toolUse`, `vision`, `pricing`) and merge with dynamic IDs.

## Putting it together

Skeleton of a new provider (factory + class):

```ts
import type {
  ChatEvent,
  ChatRequest,
  EmbedRequest,
  EmbedResult,
  LLMProvider,
  ModelCapabilities,
  ProviderFactory,
} from '@opencodex/core';
import { z } from 'zod';

const myConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
});
type MyConfig = z.infer<typeof myConfigSchema>;

class MyProvider implements LLMProvider {
  readonly id = 'my-provider';
  readonly displayName = 'My Provider';
  constructor(private readonly config: MyConfig) {}

  async *chat(req: ChatRequest): AsyncIterable<ChatEvent> {
    // 1. POST to your endpoint, get a ReadableStream
    // 2. for await over framed chunks (SSE / NDJSON / your protocol)
    // 3. Zod-validate each chunk before yielding
    // 4. yield text_delta as text arrives
    // 5. accumulate tool calls; yield tool_call once each is complete
    // 6. yield usage (if available), then done
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    // POST /embeddings, parse, return { embeddings, usage }
    throw new Error('not implemented');
  }

  async listModels(): Promise<ModelCapabilities[]> {
    return knownModels;
  }
  async capabilities(m: string) {
    return knownModels.find((x) => x.id === m);
  }
}

export const myProvider: ProviderFactory<MyConfig> = {
  id: 'my-provider',
  displayName: 'My Provider',
  configSchema: myConfigSchema,
  create(config) {
    return new MyProvider(config);
  },
};
```

Register it through the plugin SDK's `host.registerProvider(myProvider)` and OpenCodex picks it up like any built-in.
