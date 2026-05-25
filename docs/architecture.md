# OpenCodex Architecture

Source of truth for OpenCodex's design. Code can drift; update this file whenever a load-bearing decision changes.

## Goals

1. **Provider-agnostic.** Any LLM works. The provider layer is the most important abstraction in the codebase.
2. **Local-first.** No required backend. Your code, your keys, your machine.
3. **Extensible.** Third-party plugins and MCP servers extend the same registries that built-in code uses.
4. **Safe by default.** Every write or shell op goes through an explicit approval gate the user controls.

## Process model (Electron)

```
┌─────────────────────────────────────────────────────────────┐
│ Renderer (sandboxed browser context)                        │
│  React UI: chat, diff viewer, file tree, terminal, settings │
│        ↑                                                    │
│        │ contextBridge (window.opencodex.*)                 │
│        ↓                                                    │
├─────────────────────────────────────────────────────────────┤
│ Preload (typed IPC bridge)                                  │
├─────────────────────────────────────────────────────────────┤
│ Main process                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Agent loop   │←→│ Tool registry│←→│ Approval gateway  │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────────────┘  │
│         │                 │                                 │
│  ┌──────▼───────┐  ┌──────▼───────┐  ┌───────────────────┐  │
│  │ Provider     │  │ Built-in     │  │ MCP client        │  │
│  │ registry     │  │ tools        │  │ (stdio/SSE/HTTP)  │  │
│  └──────────────┘  └──────────────┘  └───────────────────┘  │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Plugin host  │  │ RAG indexer  │  │ SQLite + keytar   │  │
│  └──────────────┘  └──────────────┘  └───────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│ Utility processes (one per concurrent subagent)             │
│  Each has its own context, provider, tool subset, worktree  │
└─────────────────────────────────────────────────────────────┘
```

The renderer is created in `apps/desktop/src/main/index.ts:78` with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. Every privileged operation crosses the typed IPC bridge defined in `apps/desktop/src/preload/index.ts:208`.

## Monorepo structure

pnpm workspaces. Top-level layout:

```
apps/
  desktop/             Electron app (main / preload / renderer)
packages/
  core/                LLMProvider, Tool, ChatEvent — the contracts
  provider-openai/     Built-in adapters, one package per provider
  provider-anthropic/
  provider-google/
  provider-xai/
  provider-mistral/
  provider-ollama/
  provider-openrouter/
  tools/               Built-in tools (read_file, run_shell, glob, ...)
  plugin-sdk/          Public SDK for third-party plugin authors
  mcp-client/          Model Context Protocol client (stdio / SSE / HTTP)
examples/
  plugins/hello-world  Reference plugin
docs/
```

## Provider abstraction

Every LLM goes through one interface (`packages/core/src/provider.ts:29`):

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

Providers are constructed by a `ProviderFactory` (`packages/core/src/provider.ts:48`) that owns a Zod `configSchema`. The `ProviderRegistry` (`packages/core/src/registry.ts:18`) validates config at create-time and throws `ProviderConfigError` on schema failure.

A `ChatEvent` (`packages/core/src/events.ts:50`) is a discriminated union of `text_delta`, `tool_call`, `tool_result`, `usage`, `done`, `error`. Provider adapters translate their native streaming format (OpenAI SSE, Anthropic event stream, Gemini streamGenerateContent, Ollama NDJSON) into this common event series. See `docs/provider-authoring.md` for the contract.

Capabilities (`packages/core/src/capabilities.ts:9`) drive the UI: the renderer asks whether a model supports `toolUse`, `vision`, etc., and hides controls accordingly.

## Tool layer

A `Tool` (`packages/core/src/tool.ts:22`) extends a `ToolDefinition` with an `inputZod` schema and an `execute(input, ctx)` function. Each declares a `permissionTier`: `'read' | 'write' | 'execute' | 'network'` (`packages/core/src/tool.ts:4`).

Use `defineTool({...})` (`packages/core/src/tool.ts:35`) — it derives the JSON Schema from the Zod schema automatically.

The `ToolRegistry` (`packages/core/src/tool-registry.ts:10`) validates input with the tool's Zod schema on every `execute()` call (`tool-registry.ts:45`); invalid input throws `ToolInputError`.

Tools come from three sources, all flowing through the same registry:

1. **Built-in** (`@opencodex/tools`) — `read_file`, `write_file`, `edit_file`, `glob`, `grep`, `list_dir`, `run_shell`, `web_fetch`. Wired in `apps/desktop/src/main/tools/registry.ts:15`.
2. **MCP** (`@opencodex/mcp-client`) — every connected MCP server's tools. Status: planned for v0.1 (`packages/mcp-client/src/client.ts:27` throws `Not implemented — Phase 2.5 MCP task`).
3. **Plugins** (`@opencodex/plugin-sdk`) — third-party tools registered via the plugin host. Status: SDK shape landed, host wiring planned for v0.1.

## Agent loop

`apps/desktop/src/main/chat/runner.ts`. `startChatStream()` (line 49) appends the user message, creates an empty assistant message, expands stored history into provider-shaped `Message[]`, then dispatches `runStream()`.

`runStream()` (line 137) iterates over `provider.chat({ model, messages, tools, signal })`, accumulating `text_delta` into a buffer and collecting `tool_call` events. After each provider turn:

- If `stopReason === 'tool_use'` and tools were called, it runs each tool through `executeToolCall()` (line 313) — which checks the approval policy, executes via the `ToolRegistry`, audits the call, and pushes a `tool_result` block back into history for the next iteration.
- Otherwise the loop emits `done` and exits.

Hard cap at `MAX_TOOL_ITERATIONS = 10` (line 20) prevents runaway tool loops. The whole stream is cancellable via `cancelChatStream(streamId)` (line 106) which aborts the `AbortController`.

## IPC contract

The wire format is typed in `apps/desktop/src/shared/ipc-types.ts`: `IpcInvokeChannels` (line 52) maps each channel to a `{request, response}` pair; `IpcEventChannels` (line 187) covers fire-and-forget pushes.

Every invoke handler is registered through `registerInvoke()` in `apps/desktop/src/main/ipc/registry.ts:15`, which:

1. Takes a Zod `requestSchema` for the channel.
2. `safeParse()`s the raw payload on every call (`registry.ts:21`).
3. Throws `invalid request for <channel>` if the schema fails — the renderer never gets to run handler logic with malformed input.

Events are sent via `emit(webContents, channel, payload)` (`registry.ts:30`). The preload bridge (`apps/desktop/src/preload/index.ts`) exposes one thin wrapper per channel under `window.opencodex.*`.

## Storage

- **SQLite** via `better-sqlite3` in the OS user-data dir. Opened in `apps/desktop/src/main/storage/db.ts:76` with WAL mode and `foreign_keys = ON`. Schema is versioned through the `MIGRATIONS` array (`db.ts:11`) — every change appends a new entry; on boot, pending migrations are applied inside a transaction (`db.ts:125`). Current version: 4.
- **`electron-store`** for non-secret preferences in `apps/desktop/src/main/storage/settings.ts:61`, schema validated by Zod (`settings.ts:44`).
- **`keytar`** for secrets — provider API keys live in the OS keychain under service `opencodex` (`apps/desktop/src/main/storage/secrets.ts:3`). Never logged, never in SQLite or settings JSON.

Tables (version 4): `conversations`, `messages`, `tool_calls`, `schema_migrations`. `tool_calls` carries the full audit log (input/output JSON, decision, duration, error flag).

## RAG / codebase chat

Status: planned for v0.1.

- **Chunker**: tree-sitter for AST-aware splits.
- **Storage**: LanceDB for vectors + SQLite FTS5 for keyword.
- **Retrieval**: hybrid via Reciprocal Rank Fusion.
- **Embeddings**: provider-agnostic (same `LLMProvider.embed` interface).
- **Updates**: chokidar file watcher → incremental reindex (respects `.gitignore` and `.opencodexignore`).

## Multi-agent orchestration

Status: planned for v0.1.

- `spawn_subagent` tool lets an orchestrator agent fan out work.
- Each subagent runs in an Electron `utilityProcess` with its own provider, context, tool subset, and (optionally) git worktree.
- Subagent diffs come back as a bundle for the orchestrator to merge-review.
- Budget caps prevent runaway spawning.

## MCP integration

Status: client scaffolding shipped, transports + tool surfacing planned for v0.1. The transport interface (`packages/mcp-client/src/transport.ts:3`) supports `'stdio' | 'sse' | 'http'`. See `docs/mcp-integration.md`.

When a server connects, its `tools/list` is registered through the same `ToolRegistry`, its `resources/list` feeds the RAG retriever, and its `prompts/list` shows up as `/` commands in the chat.

## Plugin model

Status: SDK manifest shape shipped (`packages/plugin-sdk/src/manifest.ts:22`); plugin loader + VM sandbox planned for v0.1. See `docs/plugin-authoring.md`.

Plugin packages ship a `opencodex.plugin.json` manifest declaring `permissions[]` and `contributions{}`. On install the user reviews permissions and confirms. The loader runs the entry module in a sandboxed VM context, hands it a `PluginHost` restricted to declared permissions, and registers contributions with the relevant registries.

## Why Electron, not Tauri

Electron chosen for iteration velocity. Pure Node/TS means the same SDKs (openai, @anthropic-ai/sdk, tree-sitter bindings, better-sqlite3, LanceDB Node bindings) work everywhere without a Rust↔TS boundary. Cost: bundle size (~150MB) and a slightly weaker sandbox model — both mitigated by aggressively using `sandbox: true` + `contextIsolation: true` and routing all privileged work through the IPC bridge.

If Tauri later proves a better fit, the monorepo isolates the swap: `@opencodex/core`, `@opencodex/provider-*`, `@opencodex/tools`, `@opencodex/mcp-client` are all framework-agnostic.
