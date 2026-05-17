# OpenCodex Architecture

This document is the source of truth for OpenCodex's design. Code can drift; this file should be updated whenever a load-bearing decision changes.

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

## The `LLMProvider` interface

Every LLM goes through one interface (`packages/core/src/provider.ts`):

```ts
interface LLMProvider {
  chat(req: ChatRequest): AsyncIterable<ChatEvent>;
  embed(req: EmbedRequest): Promise<EmbedResult>;
  listModels(): Promise<ModelCapabilities[]>;
  capabilities(model: string): Promise<ModelCapabilities | undefined>;
}
```

A `ChatEvent` stream is the unified shape. Provider adapters translate their native streaming format (OpenAI SSE, Anthropic event stream, Gemini streamGenerateContent, Ollama NDJSON) into this common event series.

Capabilities-driven UI: the renderer asks the registry whether a model supports `toolUse`, `vision`, etc., and hides controls accordingly.

## Tool registry

Tools come from three sources, all flowing through the same registry:

1. **Built-in** (`@opencodex/tools`) — `read_file`, `write_file`, `edit_file`, `glob`, `grep`, `list_dir`, `run_shell`, `web_fetch`.
2. **MCP** (`@opencodex/mcp-client`) — every connected MCP server's tools.
3. **Plugins** (`@opencodex/plugin-sdk`) — third-party tools registered via the plugin host.

Each tool declares a `permissionTier` (`read` / `write` / `execute` / `network`). The approval gateway uses the tier to decide auto vs prompt vs deny.

## Approval system

Default policy (configurable):
- `read` → auto
- `network` → auto for built-in allow-listed domains, prompt otherwise
- `write` → prompt with diff preview
- `execute` → prompt with command preview

Per-session override: "trust this session" sets all tiers to auto until the session ends.

All decisions are audit-logged to SQLite.

## RAG / codebase chat

- **Chunker**: tree-sitter for AST-aware splits (function/class boundaries beat fixed-size windows for code).
- **Storage**: LanceDB for vectors + SQLite FTS5 for keyword.
- **Retrieval**: hybrid via Reciprocal Rank Fusion.
- **Embeddings**: provider-agnostic, same interface as `LLMProvider`. Can use OpenAI, Voyage, or local Ollama embeddings.
- **Updates**: chokidar file watcher → incremental reindex (respects `.gitignore` and `.opencodexignore`).

## Multi-agent orchestration

- **`spawn_subagent` tool** lets an orchestrator agent fan out work.
- Each subagent runs in an Electron `utilityProcess` with its own provider, context window, tool subset, and (optionally) git worktree.
- Subagent diffs come back as a bundle for the orchestrator to merge-review.
- Budget caps prevent runaway spawning.

## Plugin model

Plugin packages ship a `opencodex.plugin.json` manifest declaring:
- name, version, entry point, engines
- requested **permissions** (workspace.read, workspace.write, shell.execute, network.fetch, ui.panel, ...)
- **contributions** (tool names, provider IDs, UI panel entries, slash command entries)

On install, the user reviews permissions and confirms. The plugin loader runs the entry module in a sandboxed VM context, hands it a `PluginHost` API restricted to its declared permissions, and registers its contributions with the relevant registries.

UI panels run in sandboxed iframes with a `postMessage` bridge to the plugin host — they cannot reach Node APIs directly.

## MCP integration

MCP is treated as a peer of built-in tools. When you add an MCP server:
- its `tools/list` becomes part of the agent's tool registry
- its `resources/list` feeds the RAG retriever as an additional source
- its `prompts/list` shows up as `/` commands in the chat

Transports supported: stdio, SSE, HTTP streamable.

## Storage layout

- **Global** (OS user-data dir): app settings, provider config, plugin install state, telemetry opt-in.
- **Per-workspace** (`<repo>/.opencodex/`): conversation history, audit log, RAG index, workspace-scoped MCP config. Add `.opencodex/` to `.gitignore`.
- **Secrets**: provider API keys live in the OS keychain via `keytar`. Never in SQLite or settings JSON.

## Why Electron, not Tauri

Electron was chosen for iteration velocity. Pure Node/TS means the same SDKs (openai, @anthropic-ai/sdk, tree-sitter bindings, better-sqlite3, LanceDB Node bindings) work everywhere without a Rust↔TS boundary. The cost is bundle size (~150MB) and a slightly weaker sandbox model, both of which we mitigate by aggressively using `sandbox: true` + `contextIsolation: true` in the renderer and routing all privileged work through the IPC bridge.

If Tauri later proves a better fit, the monorepo structure isolates the swap: `@opencodex/core`, `@opencodex/providers`, `@opencodex/tools`, `@opencodex/mcp-client` are all framework-agnostic.

## Open architectural decisions

These are noted for future sessions, not blockers:

- **State store in renderer**: Zustand vs Jotai vs Redux Toolkit. Lean Zustand for simplicity.
- **CSS approach**: CSS Modules vs Tailwind vs styled. Lean Tailwind for speed.
- **Plugin sandbox**: VM context is the v1 choice. If we hit limitations we may move plugins into their own utility processes for stronger isolation.
- **Embeddings default**: should we ship with a local embedding model bundled, or require user setup? Lean toward "default to Ollama with auto-pull on first run if local mode selected."
