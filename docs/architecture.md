# OpenCodex Architecture

Source of truth for OpenCodex's design. Code can drift; update this file whenever a load-bearing decision changes.

## Goals

1. **Provider-agnostic.** Any LLM works. The provider layer is the most important abstraction in the codebase.
2. **Local-first.** No required backend. Your code, your keys, your machine.
3. **Extensible.** Third-party plugins and MCP servers extend the same registries that built-in code uses.
4. **Safe by default.** Every write or shell op goes through an explicit approval gate the user controls.

## Process model (Electron)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Renderer (sandboxed browser context)                                │
│  ┌──────────┬────────────────┬─────────────────────────────────┐    │
│  │ Nav rail │ Context pane   │ Main: chat / diff / files / ... │    │
│  └──────────┴────────────────┴─────────────────────────────────┘    │
│  Unified left column: nav rail + context pane share one surface.    │
│        ↑                                                            │
│        │ contextBridge (window.opencodex.*)                         │
│        ↓                                                            │
├─────────────────────────────────────────────────────────────────────┤
│ Preload (typed IPC bridge)                                          │
├─────────────────────────────────────────────────────────────────────┤
│ Main process                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐          │
│  │ Agent loop   │←→│ Tool registry│←→│ Approval gateway  │          │
│  └──────┬───────┘  └──────┬───────┘  └───────────────────┘          │
│         │                 │                                         │
│  ┌──────▼───────────────────────────┐                               │
│  │ SubagentRunner registry          │  Picks an in-process or       │
│  │  internal | claude-code | ...    │  out-of-process runner per    │
│  │  opencode | aider | plugin       │  task; emits ChatEvents.      │
│  └──────┬───────────────────────────┘                               │
│         │                                                           │
│  ┌──────▼───────┐  ┌──────────────┐  ┌───────────────────┐          │
│  │ Provider     │  │ Built-in     │  │ MCP client        │          │
│  │ registry     │  │ tools        │  │ (stdio/SSE/HTTP)  │          │
│  └──────────────┘  └──────────────┘  └───────────────────┘          │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐          │
│  │ Plugin host  │  │ RAG indexer  │  │ SQLite + keytar   │          │
│  └──────────────┘  └──────────────┘  └───────────────────┘          │
├─────────────────────────────────────────────────────────────────────┤
│ Utility processes / child CLIs (one per concurrent subagent)        │
│  internal runner → Electron utilityProcess; own provider+tools.     │
│  external runners → spawned CLI (claude / opencode / aider).        │
│  Both always run inside a per-task git worktree.                    │
└─────────────────────────────────────────────────────────────────────┘
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

## Code knowledge graph

A deterministic structural index that sits **alongside** RAG retrieval, not inside it. RAG answers "what code is semantically similar to this query"; the graph answers "what code is structurally related to this symbol" — callers, callees, neighbors, the path between two symbols, and the community (subsystem) a symbol belongs to.

- **Package**: `@opencodex/code-graph` (pure, Electron-free) — `graphology`-backed `DirectedGraph`, Zod `GraphNode`/`GraphEdge` schemas, unicode-aware ID normalization (the reconciliation key), Jaro-Winkler entity dedup, and Louvain community detection (`graphology-communities-louvain`, seeded for determinism).
- **Extraction**: `@opencodex/rag-chunker` reuses its existing tree-sitter walk to emit an `ExtractionResult` (symbols + `contains`/`method` edges + raw calls + imports) from the same parse it already does for AST chunking. No second parser, no extra grammars.
- **Resolution** (`code-graph`): deterministic, no LLM. Import-guided call resolution yields high-confidence `EXTRACTED` edges; a unique global label yields lower-confidence `INFERRED` edges. Member calls and ambiguous labels are skipped. Dangling edges to external/stdlib symbols and cross-language `INFERRED` `calls` are dropped.
- **Confidence split**: every edge carries `EXTRACTED | INFERRED | AMBIGUOUS`, so consumers can prefer deterministic relationships and treat heuristic ones as hints. (An optional LLM tie-break for the Jaro-Winkler 0.75–0.92 band is deferred behind a setting — the default path is fully deterministic.)
- **Persistence**: `code_graph_nodes` / `code_graph_edges` tables (migration 21), workspace-scoped, rebuilt best-effort off the same watcher batch that drives reindexing.
- **Agent access**: the `query_code_graph` tool (read tier) exposes neighbors/callers/callees/path/subsystem through an injectable resolver (the same pattern as `search_codebase`), so the agent can ask relationship questions in chat — complementing, not replacing, `search_codebase`.
- **Louvain vs. Leiden**: Leiden (`graspologic`) is Python-only; Louvain is the realistic native target. Community quality is slightly lower than Leiden but stable across runs via a seeded rng + a previous-run remap.

## Multi-agent orchestration

- `spawn_subagent` tool lets an orchestrator agent fan out work. Each spawn picks a `runnerId` from the `SubagentRunner` registry (`packages/core/src/runner.ts`).
- The **internal** runner runs in an Electron `utilityProcess` with its own provider, context, and tool subset — `ChatEvent`s stream back through the IPC bridge in real time, and the host's approval gateway fires for every write/execute tool call.
- **External runners** (`@opencodex/runner-claude-code`, `@opencodex/runner-opencode`, `@opencodex/runner-aider`, plus any plugin-registered runner gated by the `agent.runner` permission) spawn the corresponding CLI as a child process. Their tool calls are out-of-process; OpenCodex's per-call approval modals do not fire — the CLI's own approval system is authoritative.
- Every external run is **worktree-only**: OpenCodex creates a fresh worktree under `<workspace>/.opencodex/worktrees/<id>` on branch `opencodex/subagent/<id>`, sets it as the CLI's cwd, and queues the resulting diff for merge-review. There is no fallback to writing directly into the workspace — non-git workspaces refuse to start an external run.
- Cancellation goes through the shared `treeKill` helper so spawned grandchildren (e.g. a `git` invocation an external runner started) get cleaned up too.
- Budget caps prevent runaway spawning.

## MCP integration

Status: client scaffolding shipped, transports + tool surfacing planned for v0.1. The transport interface (`packages/mcp-client/src/transport.ts:3`) supports `'stdio' | 'sse' | 'http'`. See `docs/mcp-integration.md`.

When a server connects, its `tools/list` is registered through the same `ToolRegistry`, its `resources/list` feeds the RAG retriever, and its `prompts/list` shows up as `/` commands in the chat.

## Plugin model

Status: SDK manifest shape shipped (`packages/plugin-sdk/src/manifest.ts:22`); plugin loader shipped but **runs unsandboxed in the main process** — hardening to `utilityProcess.fork()` + Node `--permission` flags is planned for v0.1. See `docs/security-model.md#plugin-sandbox` for the current trust model and `docs/plugin-authoring.md` for the SDK shape.

Plugin packages ship a `opencodex.plugin.json` manifest declaring `permissions[]` and `contributions{}`. On install the user reviews permissions and confirms. Today the loader dynamically imports the entry module into the Electron main process and hands it a `PluginHost`; the manifest `permissions[]` array currently gates `PluginHost` helper calls only, not raw Node syscalls. Hardened isolation is in flight.

## Why Electron, not Tauri

Electron chosen for iteration velocity. Pure Node/TS means the same SDKs (openai, @anthropic-ai/sdk, tree-sitter bindings, better-sqlite3, LanceDB Node bindings) work everywhere without a Rust↔TS boundary. Cost: bundle size (~150MB) and a slightly weaker sandbox model — both mitigated by aggressively using `sandbox: true` + `contextIsolation: true` and routing all privileged work through the IPC bridge.

If Tauri later proves a better fit, the monorepo isolates the swap: `@opencodex/core`, `@opencodex/provider-*`, `@opencodex/tools`, `@opencodex/mcp-client` are all framework-agnostic.
