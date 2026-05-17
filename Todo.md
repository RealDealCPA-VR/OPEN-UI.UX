# OpenCodex — Master Todo

Master backlog. Format: `- [ ]` pending, `- [x]` done. Check items off only when the feature actually works. Use `/handoff` at the end of every session to capture progress.

Phases are roughly sequential but can overlap. Phase 4 (plugins) gates Phase 5 because plugins need a stable host API.

---

## Phase 0 — Foundations

- [ ] Initialize git repo (`git init`), set default branch to `main`
- [ ] Configure pnpm workspaces (root `package.json` + `pnpm-workspace.yaml` exist; verify `pnpm install` succeeds)
- [ ] Root `tsconfig.base.json` with strict mode (done — verify package configs extend it)
- [ ] ESLint flat config (`eslint.config.js`) with TS + React rules
- [ ] Prettier config (done — verify it runs)
- [ ] Husky + lint-staged pre-commit (lint + typecheck staged files)
- [ ] Vitest base config (workspace-aware, runs all packages)
- [ ] Playwright base config for `apps/desktop` E2E
- [ ] GitHub Actions: `ci.yml` running lint + typecheck + test + build on PR
- [ ] GitHub Actions: `release.yml` for tagged builds (deferred to Phase 6)
- [ ] CODEOWNERS, CODE_OF_CONDUCT.md, SECURITY.md, CONTRIBUTING.md
- [ ] Issue + PR templates

## Phase 0.5 — Electron scaffold

- [ ] `apps/desktop`: Electron 30+ + Vite + React 18 + TS scaffold
- [ ] Configure `electron-vite` for separate main / preload / renderer builds
- [ ] Main process entry with single-instance lock + deep-link handling
- [ ] Preload bridge with `contextBridge` typed API (`window.opencodex.*`)
- [ ] Renderer: React app shell with router (chat / agent / codebase / settings)
- [ ] IPC channel registry with typed contracts in `apps/desktop/src/shared/ipc-types.ts`
- [ ] IPC handler dispatch in main with Zod validation on every payload
- [ ] Logger setup (`pino` in main, structured console in renderer)
- [ ] SQLite via `better-sqlite3`, migration runner with versioned migrations
- [ ] Settings store (`electron-store`) for non-secret prefs
- [ ] Secure key storage via `keytar` (provider API keys)
- [ ] `electron-updater` scaffold (no signing yet)
- [ ] App icon + branding placeholders
- [ ] Tray icon + minimal menu bar

## Phase 1 — Provider abstraction & adapters

### Core contracts
- [ ] `packages/core`: `LLMProvider` interface (chat, embed, capabilities)
- [ ] `packages/core`: `ChatEvent` union (`text_delta`, `tool_call`, `tool_result`, `usage`, `done`, `error`)
- [ ] `packages/core`: `ModelCapabilities` (toolUse, vision, streaming, contextWindow, pricing, embeddings)
- [ ] `packages/core`: `Message` / `ContentBlock` shared types (text, image, tool_use, tool_result)
- [ ] Provider registry + factory with config validation

### Adapters
- [ ] `packages/providers/openai`: Chat Completions + Responses API, streaming, tool calls
- [ ] `packages/providers/anthropic`: Messages API with prompt caching, tool use, vision
- [ ] `packages/providers/google`: Gemini API, tool calls, vision
- [ ] `packages/providers/xai`: Grok API (OpenAI-compatible)
- [ ] `packages/providers/mistral`: Mistral API, tool calls
- [ ] `packages/providers/ollama`: Local Ollama HTTP, streaming, tool-call JSON-mode fallback
- [ ] `packages/providers/openrouter`: OpenRouter unified API (covers fallback "any model")
- [ ] Per-adapter unit tests with recorded fixtures (no live API in CI)

### UI
- [ ] Provider config UI (add/remove keys, test connection)
- [ ] Model picker with cost + context window display + capabilities badges
- [ ] Capabilities-driven UI gating (hide tools toggle if `!toolUse`)
- [ ] Streaming chat view (markdown + syntax-highlighted code + copy buttons)
- [ ] Conversation persistence in SQLite
- [ ] Token usage + cost accounting per session
- [ ] Export conversation (markdown, JSON)

## Phase 2 — Local coding agent

### Tool layer
- [ ] `packages/core`: `Tool` interface (name, schema (Zod), permission tier, execute)
- [ ] Permission tiers: `read` / `write` / `execute` / `network`
- [ ] `packages/tools/read-file`
- [ ] `packages/tools/write-file`
- [ ] `packages/tools/edit-file` (unified-diff patch application with conflict detection)
- [ ] `packages/tools/glob`
- [ ] `packages/tools/grep` (ripgrep wrapper, falls back to JS impl if rg missing)
- [ ] `packages/tools/list-dir`
- [ ] `packages/tools/run-shell` (sandboxed)
- [ ] `packages/tools/web-fetch` (with allow-listed domains by default)
- [ ] Tool registry with permission-tier dispatch

### Agent runtime
- [ ] Agent loop (stream → collect tool calls → exec → feed results → repeat)
- [ ] Cancellation: abort mid-stream and kill in-flight shell processes
- [ ] Approval system (per-tool `auto` / `prompt` / `deny` policy)
- [ ] Per-session approval overrides ("trust this session")
- [ ] Approval UI: modal queue with diff preview for write ops, command preview for exec
- [ ] Shell sandbox: cwd lock, env scrub, timeout, output size cap, PATH allowlist
- [ ] Audit log of every tool call (input, output, decision, timestamp) in SQLite

### UI
- [ ] Diff viewer (Monaco diff editor) with hunk-level accept/reject
- [ ] File tree with agent edit annotations (pending / applied / rejected)
- [ ] Embedded terminal (`xterm.js`) tailing `run_shell` output
- [ ] Tool-call cards in chat with expand/collapse, copy, re-run
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
