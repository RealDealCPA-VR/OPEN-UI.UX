# OpenCodex — Master Todo

Master backlog. Format: `- [ ]` pending, `- [x]` done. Check items off only when the feature actually works. Use `/handoff` at the end of every session to capture progress.

Phases are roughly sequential but can overlap. Phase 4 (plugins) gates Phase 5 because plugins need a stable host API.

---

## Phase 0 — Foundations

- [x] Initialize git repo (`git init`), set default branch to `main`
- [x] Configure pnpm workspaces (root `package.json` + `pnpm-workspace.yaml` exist; verify `pnpm install` succeeds)
- [x] Root `tsconfig.base.json` with strict mode (done — verify package configs extend it)
- [x] ESLint flat config (`eslint.config.js`) with TS + React rules
- [x] Prettier config (done — verify it runs)
- [x] Husky + lint-staged pre-commit (lint + typecheck staged files)
- [x] Vitest base config (workspace-aware, runs all packages)
- [ ] Playwright base config for `apps/desktop` E2E
- [ ] GitHub Actions: `ci.yml` running lint + typecheck + test + build on PR (lint + typecheck + test + format done; build deferred to Phase 0.5)
- [ ] GitHub Actions: `release.yml` for tagged builds (deferred to Phase 6)
- [x] CODEOWNERS, CODE_OF_CONDUCT.md, SECURITY.md, CONTRIBUTING.md
- [x] Issue + PR templates

## Phase 0.5 — Electron scaffold

- [x] `apps/desktop`: Electron 30+ + Vite + React 18 + TS scaffold
- [x] Configure `electron-vite` for separate main / preload / renderer builds
- [x] Main process entry with single-instance lock + deep-link handling
- [x] Preload bridge with `contextBridge` typed API (`window.opencodex.*`)
- [x] Renderer: React app shell with router (chat / agent / codebase / settings)
- [x] IPC channel registry with typed contracts in `apps/desktop/src/shared/ipc-types.ts`
- [x] IPC handler dispatch in main with Zod validation on every payload
- [x] Logger setup (`pino` in main, structured console in renderer)
- [x] SQLite via `better-sqlite3`, migration runner with versioned migrations
- [x] Settings store (`electron-store`) for non-secret prefs
- [x] Secure key storage via `keytar` (provider API keys)
- [x] `electron-updater` scaffold (no signing yet)
- [x] App icon + branding placeholders
- [x] Tray icon + minimal menu bar

## Phase 1 — Provider abstraction & adapters

### Core contracts

- [x] `packages/core`: `LLMProvider` interface (chat, embed, capabilities)
- [x] `packages/core`: `ChatEvent` union (`text_delta`, `tool_call`, `tool_result`, `usage`, `done`, `error`)
- [x] `packages/core`: `ModelCapabilities` (toolUse, vision, streaming, contextWindow, pricing, embeddings)
- [x] `packages/core`: `Message` / `ContentBlock` shared types (text, image, tool_use, tool_result)
- [x] Provider registry + factory with config validation

### Adapters

- [ ] `packages/providers/openai`: Chat Completions + Responses API, streaming, tool calls _(Chat Completions done with streaming + tool calls + embeddings; Responses API not implemented yet)_
- [x] `packages/providers/anthropic`: Messages API with prompt caching, tool use, vision _(streaming + tool use + vision + caching capability done; no embeddings — Anthropic has no embeddings endpoint)_
- [x] `packages/providers/google`: Gemini API, tool calls, vision _(streaming + tool calls + vision done; embed() throws — Gemini has embeddings but deferred to a future task)_
- [x] `packages/providers/xai`: Grok API (OpenAI-compatible) _(wraps `@opencodex/provider-openai` helpers; embed throws — xAI has no embeddings API)_
- [x] `packages/providers/mistral`: Mistral API, tool calls _(copy+adapt path with own sse/translate; embeddings via /v1/embeddings work)_
- [x] `packages/providers/ollama`: Local Ollama HTTP, streaming, tool-call JSON-mode fallback _(HTTP + NDJSON streaming + native tools for llama3.1+/qwen2.5+ + embeddings done; JSON-mode prompt-injection fallback for legacy non-tool-capable models deferred)_
- [x] `packages/providers/openrouter`: OpenRouter unified API (covers fallback "any model") _(wraps `@opencodex/provider-openai` helpers; HTTP-Referer + X-Title config headers; embed throws — no unified embeddings)_
- [ ] Per-adapter unit tests with recorded fixtures (no live API in CI)

### UI

- [x] Provider config UI (add/remove keys, test connection)
- [x] Model picker with cost + context window display + capabilities badges
- [x] Capabilities-driven UI gating (hide tools toggle if `!toolUse`)
- [x] Streaming chat view (markdown + syntax-highlighted code + copy buttons)
- [x] Conversation persistence in SQLite
- [x] Token usage + cost accounting per session _(session rollup via `getConversationUsage` + `conversations:usage` IPC; surfaced in chat header with per-model tooltip)_
- [x] Export conversation (markdown, JSON) _(`buildConversationExport` + `conversations:export` IPC with native save dialog; Export menu in chat header)_

## Phase 2 — Local coding agent

### Tool layer

- [x] `packages/core`: `Tool` interface (name, schema (Zod), permission tier, execute) _(plus `defineTool` factory; JSON Schema derived from Zod via `zodToJSONSchema`)_
- [x] Permission tiers: `read` / `write` / `execute` / `network`
- [x] `packages/tools/read-file` _(line offset/limit, path-traversal guard, abort-aware)_
- [x] `packages/tools/write-file` _(atomic write via tmp + rename; creates parent dirs; UTF-8 byte count returned)_
- [x] `packages/tools/edit-file` _(exact-string match; `replaceAll` flag; throws `OldStringNotFoundError` / `EditFileAmbiguousError`; unified-diff variant deferred)_
- [x] `packages/tools/glob` _(zero-dep matcher: `*`, `**`, `?`, brace expansion; ignores node_modules/.git/dist/build/out/.next/.turbo)_
- [x] `packages/tools/grep` _(JS regex impl + ripgrep wrapper with auto-detection; falls back to JS if `rg` is missing or fails. `OPENCODEX_NO_RIPGREP=1` forces JS)_
- [x] `packages/tools/list-dir`
- [x] `packages/tools/run-shell` _(sandboxed: scrubbed env via `OPENCODEX_SHELL_ENV_KEEP`, cwd locked to workspace, hard timeout with SIGTERM → SIGKILL grace, process-tree kill via taskkill on Windows / process-group kill on POSIX, per-stream output cap with truncation flag)_
- [x] `packages/tools/web-fetch` _(network tier with allow-list via `OPENCODEX_WEB_FETCH_ALLOWLIST` — supports exact + `*.example.com` wildcard; denied-by-default; protocol guard; timeout; response body cap with truncation)_
- [x] Tool registry with permission-tier dispatch _(`ToolRegistry` class with `listByTier`, `execute` with Zod validation)_

### Agent runtime

- [x] Agent loop (stream → collect tool calls → exec → feed results → repeat) _(main-process `ToolRegistry` singleton with all 8 tools registered: read_file, glob, grep, list_dir, write_file, edit_file, run_shell, web_fetch; runner does up to 10 tool turns, injects `tools` into provider request, executes through approval manager, and feeds `tool_result` blocks back as a `tool` message; tool blocks persisted in SQLite so multi-turn history survives reloads)_
- [ ] Cancellation: abort mid-stream and kill in-flight shell processes _(approval and shell tool both honor `ctx.signal`; mid-stream cancel via `chat:cancel` IPC works; verifying it actually kills an in-flight shell process is left untested)_
- [x] Approval system (per-tool `auto` / `prompt` / `deny` policy) _(stored in electron-store; tier defaults + per-tool overrides; effective policy = override ?? tier default; IPC: `approvals:get-policies`, `approvals:set-policy`, `approvals:respond`)_
- [x] Per-session approval overrides ("trust this session") _(session map keyed by streamId → toolName → allow/deny; cleared in `runStream` finally via `clearSession(streamId)`)_
- [x] Approval UI: modal queue with diff preview for write ops, command preview for exec _(basic queue UI with 6 buttons — Allow/Deny × once/session/always — and JSON args preview; per-tool diff/command previews still future)_
- [x] Shell sandbox: cwd lock, env scrub, timeout, output size cap, PATH allowlist _(PATH/HOME/USER/etc allow-listed by default; user extensions via `OPENCODEX_SHELL_ENV_KEEP`; explicit positive PATH allowlist still future)_
- [x] Audit log of every tool call (input, output, decision, timestamp) in SQLite _(every `executeToolCall` writes a row to `tool_calls` keyed by assistant message id. Migration 4 added `duration_ms` + `is_error` columns and indexes on `message_id` and `tool_name`. Decisions: `auto` / `prompt-allowed` / `prompt-allowed-session` / `prompt-allowed-always` / `denied`)_

### UI

- [ ] Diff viewer (Monaco diff editor) with hunk-level accept/reject
- [ ] File tree with agent edit annotations (pending / applied / rejected)
- [ ] Embedded terminal (`xterm.js`) tailing `run_shell` output
- [x] Tool-call cards in chat with expand/collapse, copy, re-run _(re-run prefills the composer with `Re-run this tool call: <name>(<args>)` and focuses the textarea; disabled while the original call is in flight)_
- [ ] Status bar with agent state, current tool, tokens used
- [ ] Workspace picker (recent + browse)

## Phase 2.5 — MCP support

- [ ] `packages/mcp-client`: stdio transport
- [ ] `packages/mcp-client`: SSE transport
- [ ] `packages/mcp-client`: HTTP streamable transport
- [ ] MCP server config UI (add / remove / enable per workspace)
- [ ] MCP tool discovery + surfacing through tool registry
- [ ] MCP resource discovery + RAG integration
- [ ] MCP prompt discovery (surface as `/` commands in chat)
- [ ] OAuth handling for MCP servers that require it
- [ ] Health checks + auto-reconnect for long-lived MCP connections
- [ ] Ship curated MCP server presets (filesystem, github, brave-search, sqlite)

## Phase 3 — RAG / codebase chat

- [ ] Tree-sitter chunker (AST-aware, ships grammars for top ~15 languages)
- [ ] Embedding adapter interface (mirrors `LLMProvider`)
- [ ] OpenAI embeddings adapter
- [ ] Voyage embeddings adapter
- [ ] Local embeddings via Ollama (`nomic-embed-text`, `mxbai-embed-large`)
- [ ] LanceDB integration for vector store
- [ ] SQLite FTS5 for keyword search
- [ ] Hybrid retrieval with Reciprocal Rank Fusion
- [ ] File watcher (`chokidar`) → incremental reindex
- [ ] `.gitignore`-aware indexing + opt-out config (`.opencodexignore`)
- [ ] `search_codebase` tool exposed to agent
- [ ] Read-only "chat mode" toggle that disables write tools
- [ ] Citation rendering (clickable `file:line` refs in chat)
- [ ] Index status panel (files indexed, last update, errors)

## Phase 4 — Plugin system

- [ ] `packages/plugin-sdk`: plugin manifest Zod schema (name, version, permissions, contributions)
- [ ] `packages/plugin-sdk`: typed host API (`PluginHost`)
- [ ] Plugin loader (load from disk, validate manifest, sandbox via VM context)
- [ ] Plugin permission model with user-consent flow on install
- [ ] Contribution: tools (Tool implementations, registered via host API)
- [ ] Contribution: providers (LLMProvider implementations)
- [ ] Contribution: UI panels (sandboxed iframe in renderer with postMessage bridge)
- [ ] Contribution: slash commands
- [ ] Plugin manager UI (install from local dir, enable / disable, view permissions)
- [ ] Example plugin: `hello-world` tool
- [ ] Example plugin: custom provider stub
- [ ] Example plugin: UI panel
- [ ] Plugin marketplace stub (config-only, point at registry URL — actual marketplace deferred)
- [ ] Plugin docs site section with SDK API reference

## Phase 5 — Multi-agent orchestration

- [ ] Worker process spawning via Electron `utilityProcess`
- [ ] Subagent context isolation (own provider, own context, own tools subset)
- [ ] `spawn_subagent` tool (params: scope, task, provider, budget)
- [ ] Git worktree integration for parallel file edits without conflicts
- [ ] Message bus between main + workers (typed channels)
- [ ] Orchestrator agent prompt template
- [ ] Agent inspector UI (per-worker timeline, tokens, cost, current tool)
- [ ] Subagent merge-review flow (accept / reject / revise diff bundles)
- [ ] Budget caps (max tokens, max wall time, max concurrent subagents)
- [ ] Failure handling (subagent crash → orchestrator decides retry vs abort)

## Phase 6 — Polish & ship v0.1

- [ ] Theme system (light / dark / system) with CSS variables
- [ ] Onboarding wizard (provider setup → first API key → workspace pick → first chat)
- [ ] Settings UI (providers, approvals, MCP servers, plugins, theme, indexing)
- [ ] `electron-updater` wired with GitHub Releases
- [ ] macOS code signing + notarization
- [ ] Windows code signing (Authenticode)
- [ ] Linux: AppImage + .deb + .rpm builds
- [ ] Opt-in anonymous telemetry (PostHog or self-hosted Plausible)
- [ ] Crash reporting (Sentry, opt-in)
- [ ] Docs site (Docusaurus or Nextra) on GitHub Pages
- [ ] Architecture deep-dive doc
- [ ] Plugin authoring guide
- [ ] MCP integration guide
- [ ] Provider authoring guide
- [ ] Security model doc (sandboxes, permissions, key storage)
- [ ] Public v0.1 release announcement

---

## Backlog (post-v0.1)

- [ ] Cloud / background tasks (Codex's headline feature) — requires a backend
- [ ] Voice mode (push-to-talk to agent)
- [ ] Mobile companion app for monitoring long-running multi-agent jobs
- [ ] Team workspaces (shared settings, shared plugins)
- [ ] Visual workflow builder for multi-agent pipelines
- [ ] First-class JetBrains / VSCode integration
