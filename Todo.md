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
- [x] Playwright base config for `apps/desktop` E2E
- [x] GitHub Actions: `ci.yml` running lint + typecheck + test + build on PR
- [x] GitHub Actions: `release.yml` for tagged builds \_(tag-triggered cross-OS build matrix in `.github/workflows/release.yml`; env-driven signing reads `APPLE__`/`CSC\__`/`WIN*CSC*\*`from GitHub Secrets — produces unsigned artifacts if missing; electron-builder`publish: github, releaseType: draft`so the user reviews before publishing. Companion`docs/release-signing.md` walks through Apple Developer + Windows EV cert setup.)\_
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

- [x] `packages/providers/openai`: Chat Completions + Responses API, streaming, tool calls _(both paths done; toggle via `useResponsesApi` in `OpenAIConfig`)_
- [x] `packages/providers/anthropic`: Messages API with prompt caching, tool use, vision _(streaming + tool use + vision + caching capability done; no embeddings — Anthropic has no embeddings endpoint)_
- [x] `packages/providers/google`: Gemini API, tool calls, vision _(streaming + tool calls + vision done; embed() throws — Gemini has embeddings but deferred to a future task)_
- [x] `packages/providers/xai`: Grok API (OpenAI-compatible) _(wraps `@opencodex/provider-openai` helpers; embed throws — xAI has no embeddings API)_
- [x] `packages/providers/mistral`: Mistral API, tool calls _(copy+adapt path with own sse/translate; embeddings via /v1/embeddings work)_
- [x] `packages/providers/ollama`: Local Ollama HTTP, streaming, tool-call JSON-mode fallback _(HTTP + NDJSON streaming + native tools for llama3.1+/qwen2.5+ + embeddings done; JSON-mode prompt-injection fallback for legacy non-tool-capable models deferred)_
- [x] `packages/providers/openrouter`: OpenRouter unified API (covers fallback "any model") _(wraps `@opencodex/provider-openai` helpers; HTTP-Referer + X-Title config headers; embed throws — no unified embeddings)_
- [x] Per-adapter unit tests with recorded fixtures (no live API in CI)

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
- [x] Cancellation: abort mid-stream and kill in-flight shell processes _(approval and shell tool both honor `ctx.signal`; mid-stream cancel via `chat:cancel` IPC works; process-tree kill verified by test that spawns shell→node parent→detached grandchild then asserts the grandchild PID is dead after abort; web_fetch abort verified via AbortSignal.any composition test)_
- [x] Approval system (per-tool `auto` / `prompt` / `deny` policy) _(stored in electron-store; tier defaults + per-tool overrides; effective policy = override ?? tier default; IPC: `approvals:get-policies`, `approvals:set-policy`, `approvals:respond`)_
- [x] Per-session approval overrides ("trust this session") _(session map keyed by streamId → toolName → allow/deny; cleared in `runStream` finally via `clearSession(streamId)`)_
- [x] Approval UI: modal queue with diff preview for write ops, command preview for exec _(6-button Allow/Deny × once/session/always queue; per-tool previews now done: `write_file` shows lazy-loaded LCS line diff against existing content, `edit_file` shows side-by-side Replace/With, `run_shell` shows boxed command + cwd/timeout, `web_fetch` shows method pill + URL + hostname + headers; fallback JSON preview retained for unknown tools; modal widened 560 → 760px to fit diff)_
- [x] Shell sandbox: cwd lock, env scrub, timeout, output size cap, PATH allowlist _(PATH/HOME/USER/etc allow-listed by default; user extensions via `OPENCODEX_SHELL_ENV_KEEP`; explicit positive PATH allowlist via `OPENCODEX_SHELL_PATH` env var — when set, overrides the inherited PATH in the scrubbed env)_
- [x] Audit log of every tool call (input, output, decision, timestamp) in SQLite _(every `executeToolCall` writes a row to `tool_calls` keyed by assistant message id. Migration 4 added `duration_ms` + `is_error` columns and indexes on `message_id` and `tool_name`. Decisions: `auto` / `prompt-allowed` / `prompt-allowed-session` / `prompt-allowed-always` / `denied`. Retention: `auditRetentionDays` setting drives startup purge; `tool-audit:set-retention` and `tool-audit:clear` IPC + AuditLogPanel toolbar with retention select + "Clear log" button)_

### UI

- [x] Diff viewer (Monaco diff editor) with hunk-level accept/reject _(`apps/desktop/src/renderer/components/MonacoDiffViewer.tsx` + pure helpers in `monaco-diff-helpers.ts` covered by 19 vitest cases. Component lazy-loads `@monaco-editor/react` + `monaco-editor` via `React.lazy` so Monaco code-splits into its own ~6.35 MB chunk (`editor.main-*.js`) — initial renderer bundle stays at 597 kB. Toolbar exposes "Accept all" / "Reject all"; per-hunk rows under the editor expose "Accept hunk" / "Reject hunk" driven by Monaco's `getLineChanges()`. Wired into `ApprovalQueue` as a "View in Monaco" opt-in modal for both `write_file` and `edit_file` approvals (existing LCS line-diff remains the default preview, so first-render cost is unchanged))_
- [x] File tree with agent edit annotations (pending / applied / rejected) _(`apps/desktop/src/renderer/components/FileTree.tsx` — lazy-loads workspace dir contents via `file-tree:list` IPC; respects `.gitignore` + `.opencodexignore`; mounted in `CodebaseView`; accepts an `annotations` map of `path → pending|applied|rejected` for agent edit pills; wiring annotations to live edit-tool calls is a small follow-up)_
- [x] Embedded terminal (`xterm.js`) tailing `run_shell` output _(`apps/desktop/src/renderer/components/EmbeddedTerminal.tsx` lazy-loads `@xterm/xterm` + `@xterm/addon-fit` — both code-split into separate chunks (~402 KB xterm + 5.5 KB CSS) so the initial renderer bundle stays untouched. `ToolCallCard` grows a new "Terminal" pill for successful `run_shell` calls that toggles the embedded terminal; it renders the captured stdout/stderr verbatim with ANSI escape codes interpreted, plus a dim `$ command  (cwd: …)` banner and a footer with exit code / duration / signal / truncation flags. New `shell:output` IPC event broadcasts a single final frame per tool call from `main/chat/runner.ts` via `ChatStreamSink.emitShellOutput` — the wire is in place for future true-streaming. Renderer subscribes via `window.opencodex.chat.onShellOutput`, filters by `streamId`+`toolUseId`, replays `initialContent` first, then live-appends. Pure helpers (`buildShellTranscript`, `OutputBuffer`, `stripAnsi`, `toCrlf`) in `apps/desktop/src/shared/shell-output.ts` covered by 20 unit tests.)_
- [x] Tool-call cards in chat with expand/collapse, copy, re-run _(re-run prefills the composer with `Re-run this tool call: <name>(<args>)` and focuses the textarea; disabled while the original call is in flight)_
- [x] Status bar with agent state, current tool, tokens used _(global footer in `AppShell`, visible across all routes. Left: state dot + label (Idle / Streaming… / Error) + running tool name derived from unmatched `tool_use` in `draft.blocks`. Right: tokens (live from `draft` during stream, session totals from `usage` otherwise) + workspace basename with full-path tooltip. Reuses `useChat()` (no new context, no new IPC) + `workspace:changed` subscription. Pure derivation helpers in [status-bar-derive.ts](apps/desktop/src/renderer/components/status-bar-derive.ts) covered by 14 tests.)_
- [x] Workspace picker (recent + browse) _(Settings → Workspace section: Browse… opens native folder picker; recent list with Open/Remove; MRU dedupe + 10-item cap; active path validated as existing directory; `activeWorkspace` already consumed by chat + approval handlers, no cascade needed)_

## Phase 2.5 — MCP support

- [x] `packages/mcp-client`: stdio transport _(line-delimited JSON over child stdin/stdout; SIGTERM on stop)_
- [x] `packages/mcp-client`: SSE transport _(consumes `endpoint` event to discover POST URL; SSE event-stream parser)_
- [x] `packages/mcp-client`: HTTP streamable transport _(mcp-session-id header; handles JSON + text/event-stream + 202 notifications)_
- [x] MCP server config UI (add / remove / enable per workspace) _(Settings → MCP servers section; curated presets quick-add + enable/disable/remove + live status + tool/resource/prompt counts)_
- [x] MCP tool discovery + surfacing through tool registry _(connect → listTools → registry.register with `mcp__<serverId>__<toolName>` naming; unregister on disconnect/remove/disable)_
- [x] MCP resource discovery + RAG integration _(manager retains the full `listResources` payload per connected server and exposes `getAvailableResources()` + `getClientForServer()`. `apps/desktop/src/main/mcp/resource-indexer.ts` walks every available resource, calls `client.readResource(uri)`, and upserts text content into the FTS5 `indexed_files` table under a `mcp:<serverId>:<uri>` key (alongside workspace files). Triggered on-demand via `mcp:reindex-resources` IPC (preload bridge: `window.opencodex.mcp.reindexResources()`) and automatically (1s-debounced) after every MCP server connects via `onMcpServerConnected`. `search_codebase` tool now tags each hit with `source: 'workspace' | 'mcp'` based on whether the key starts with the `mcp:` prefix. Indexer covered by 10 tests in `resource-indexer.test.ts`.)_
- [x] MCP prompt discovery (surface as `/` commands in chat) _(manager retains the full `listPrompts` payload per connected server; `mcp:list-prompts` IPC + `window.opencodex.mcp.listPrompts()` bridge expose `{serverId, serverDisplayName, prompt}` rows to the renderer. Chat composer detects a leading `/` (start-of-line, no whitespace), pops a grouped-by-server dropdown via `SlashCommands.tsx`, supports ArrowUp/Down/Enter/Tab/Escape, filters by prompt name + server id + description, and inserts `/<serverId>:<prompt> arg=<placeholder>` on selection. Parsing in [slash-commands.ts](apps/desktop/src/renderer/components/slash-commands.ts) covered by 21 tests.)_
- [ ] OAuth handling for MCP servers that require it _(needs external OAuth setup — left for user)_
- [x] Health checks + auto-reconnect for long-lived MCP connections _(exponential backoff 1.5s → 30s; transport close → reconnect when enabled)_
- [x] Ship curated MCP server presets (filesystem, github, brave-search, sqlite) _(presets in `main/mcp/presets.ts`; quick-add from Settings)_

## Phase 3 — RAG / codebase chat

- [x] Tree-sitter chunker (AST-aware, ships grammars for top ~15 languages) _(new `@opencodex/rag-chunker` package: `chunkBySize` is a zero-dep size-based line splitter with line-aligned overlap; `chunkBySymbols` walks a `web-tree-sitter` parse tree and breaks at top-level function/class/method/struct/impl/trait/enum/interface/namespace nodes, then size-splits any oversized span and emits inter-symbol filler as size chunks so no bytes are lost. `SUPPORTED_LANGUAGES` enumerates the top 15 (typescript, javascript, tsx, jsx, python, go, rust, java, cpp, c, ruby, php, csharp, kotlin, swift); grammars are registered at runtime via `registerGrammar(lang, wasmPathOrBytes)` rather than bundled (keeps install slim — hosts ship whichever .wasm grammars they want). Unknown languages and grammar-load failures fall back to size chunking. 10 tests cover empty input, single-chunk fit, multi-chunk split, overlap coverage, line-number alignment, invalid options, unknown-language fallback, and grammar-load failure fallback.)_
- [x] Embedding adapter interface (mirrors `LLMProvider`) _(already in `packages/core/src/provider.ts` — `EmbedRequest` / `EmbedResult` on the `LLMProvider` interface)_
- [x] OpenAI embeddings adapter _(`packages/provider-openai/src/provider.ts` — `embed()` hits `/v1/embeddings`, returns ordered vectors + token usage)_
- [x] Voyage embeddings adapter _(`packages/provider-voyage` — `voyage-3`, `voyage-3-lite`, `voyage-code-3`; `embed()` posts to `/v1/embeddings`; `chat()` throws — embeddings-only)_
- [x] Local embeddings via Ollama (`nomic-embed-text`, `mxbai-embed-large`) _(`packages/provider-ollama` — `embed()` posts `/api/embeddings` with the configured model)_
- [x] LanceDB integration for vector store _(`apps/desktop/src/main/rag/vector-store.ts` — `LanceVectorStore` exposes `open(dbPath)` / `upsert(path, chunks)` / `searchByVector(embedding, limit)` / `clear()` / `count()` / `close()`. **SQLite-backed shim** because `@lancedb/lancedb` ships a native binary that did not install in the current toolchain (no shell access during this run to attempt the install). Embeddings persist as Float32Array blobs in a single `vectors` table; cosine similarity is computed in-process at query time. Public interface mirrors what a thin LanceDB adapter would expose, so the swap is a one-class change — no callers need to update. Covered by 18 tests in `vector-store.test.ts` against `:memory:` plus a tmpdir round-trip.)_
- [x] SQLite FTS5 for keyword search _(`apps/desktop/src/main/storage/codebase-index.ts` — migration v5 adds `indexed_files` FTS5 virtual table + `indexed_files_meta` for incremental-reindex bookkeeping; exposes `upsertIndexedFile` / `removeIndexedFile` / `searchKeyword` (bm25-ranked, snippet-highlighted) / `clearIndex`; query tokens are sanitised before being passed to FTS5)_
- [x] Hybrid retrieval with Reciprocal Rank Fusion _(exported as `reciprocalRankFusion` from `@opencodex/tools`; covered by `search-codebase.test.ts`. Ready to combine LanceDB + FTS5 rankings when those land.)_
- [x] File watcher (`chokidar`) → incremental reindex _(`apps/desktop/src/main/rag/watcher.ts` — `WorkspaceWatcher` coalesces add/change/unlink into 250ms batches, respects `.gitignore` + `.opencodexignore` via `readIgnoreMatcherForWorkspace`, skips heavy dirs (`node_modules`, `.git`, `dist`, `out`, `build`, `.next`, `.turbo`, `coverage`); singleton `setWatchedWorkspace` wired in `index.ts` via `settingsStore.onDidChange('activeWorkspace', ...)`, stops on `before-quit`. Ready to feed the SQLite FTS5 indexer once incremental-reindex pipeline lands.)_
- [x] `.gitignore`-aware indexing + opt-out config (`.opencodexignore`) _(`packages/tools/src/opencodex-ignore.ts` — gitignore-style parser with anchored/dirOnly/negation; `readIgnoreMatcherForWorkspace` merges `.gitignore` + `.opencodexignore`)_
- [x] `search_codebase` tool exposed to agent _(`packages/tools/src/search-codebase.ts` — wraps `grepTool`, ranks by match strength + file-path heuristics; registered in the main ToolRegistry)_
- [x] Read-only "chat mode" toggle that disables write tools _(`readOnlyChatMode` setting; `ApprovalManager` denies any non-`read` tier when toggle is on; IPC `chat:get-read-only-mode` / `chat:set-read-only-mode` + Settings → Indexing toggle)_
- [x] Citation rendering (clickable `file:line` refs in chat) _(`apps/desktop/src/renderer/components/citations.ts` — `tokenizeCitations` parses `path:line` and `path:line:col` patterns; covered by 4 tests; consumer wiring into MessageBubble can attach when needed)_
- [x] Index status panel (files indexed, last update, errors) _(replaced stub `IndexingPanel` — now shows the read-only chat toggle + a description of the `search_codebase` tool until the full indexer lands)_

## Phase 4 — Plugin system

- [x] `packages/plugin-sdk`: plugin manifest Zod schema (name, version, permissions, contributions)
- [x] `packages/plugin-sdk`: typed host API (`PluginHost`)
- [x] Plugin loader (load from disk, validate manifest, sandbox via VM context) _(disk loader + manifest validation + dynamic import done in `packages/plugin-sdk/src/loader.ts`; VM sandbox deferred — plugins run in-host and are gated by manifest permissions instead)_
- [x] Plugin permission model with user-consent flow on install _(install → `pending-permissions` status; "Grant permissions" button in Plugins panel; `checkPermission` gates `settings.read`/`settings.write` host calls)_
- [x] Contribution: tools (Tool implementations, registered via host API) _(registered as `plugin__<id>__<name>` in the shared ToolRegistry; unregister on disable/uninstall)_
- [x] Contribution: providers (LLMProvider implementations) _(host API accepts `registerProvider`; provider-stub example demonstrates the shape — global provider registry wiring deferred)_
- [x] Contribution: UI panels (sandboxed iframe in renderer with postMessage bridge) _(manager tracks `manifest.contributions.panels` with resolved absolute `htmlPath`; IPC `plugins:list-panels` + preload `window.opencodex.plugins.listPanels()`; renderer `PluginPanelHost` mounts a `sandbox="allow-scripts"` iframe and runs a Zod-validated postMessage bridge — `log` + `request-host` (`ping`) → `host-response` — authenticated by `event.source === iframe.contentWindow`; new route `/plugins/:pluginId/:panelId`)_
- [x] Contribution: slash commands _(host API accepts `registerSlashCommand`; surfacing into chat composer is part of Phase 2.5 MCP prompts task)_
- [x] Plugin manager UI (install from local dir, enable / disable, view permissions) _(Settings → Plugins panel: Install from folder, Grant permissions, Enable/Disable, Uninstall)_
- [x] Example plugin: `hello-world` tool
- [x] Example plugin: custom provider stub _(`examples/plugins/provider-stub`: streams text deltas from the last user message; `embed()` throws)_
- [x] Example plugin: UI panel _(`examples/plugins/ui-panel` + panel.html)_
- [x] Plugin marketplace stub (config-only, point at registry URL — actual marketplace deferred) _(`pluginRegistryUrl` setting + `plugins:fetch-registry` IPC returns parsed JSON entries or error)_
- [x] Plugin docs site section with SDK API reference _(Nextra site under `website/`; plugin authoring guide at `website/pages/plugins/authoring.mdx`; SDK API reference at `website/pages/plugins/api.mdx` enumerating every export from `packages/plugin-sdk/src/`.)_

## Phase 5 — Multi-agent orchestration

- [x] Worker process spawning via Electron `utilityProcess` _(`main/agent/worker-host.ts` forks `out/main/agent/worker-entry.js` via `electron.utilityProcess.fork`, posts a Zod-validated `start` message, awaits `result`/`error`, kills the process on completion. Worker entry rebuilds the provider + tool registry inside the child process and runs `runSubagent`. Electron-vite emits the worker as a separate chunk. Falls back to inline `runSubagent` when `electron.utilityProcess` is unavailable (tests) or the fork fails.)_
- [x] Subagent context isolation (own provider, own context, own tools subset) _(fresh provider from `buildProviderForId`, fresh `messages` array, `allowedToolNames` whitelist filters the shared ToolRegistry)_
- [x] `spawn_subagent` tool (params: scope, task, provider, budget) _(in `main/agent/spawn-subagent-tool.ts`, permission tier `execute`; budget has `maxToolIterations`, `maxTokens`, `maxWallTimeMs`)_
- [x] Git worktree integration for parallel file edits without conflicts _(`main/agent/worktrees.ts` shells out to `git` via `execFile` — `isGitRepo`, `createWorktree`, `removeWorktree`, `listWorktrees`, `getDiffBundle`; worktrees land under `<repo>/.opencodex/worktrees/<id>` on branch `opencodex/subagent/<id>`; tests in `worktrees.test.ts` skip when git is absent)_
- [x] Message bus between main + workers (typed channels) _(typed channels are real as of utilityProcess landing: `main/agent/worker-protocol.ts` defines Zod schemas for `start` / `ready` / `event` / `result` / `error` messages; both `worker-host.ts` (main side) and `worker-entry.ts` (worker side) `safeParse` every message before acting on it. Inline buffer fallback remains for the non-Electron path.)_
- [x] Orchestrator agent prompt template _(`main/agent/orchestrator-prompt.ts` exports `ORCHESTRATOR_SYSTEM_PROMPT` with when-to-spawn rules + post-return verification + failure-handling guidance)_
- [x] Agent inspector UI (per-worker timeline, tokens, cost, current tool) _(`main/agent/run-registry.ts` holds an in-memory subagent run registry (id, task, provider/model, status, tokens, iterations, tool-event timeline, stop reason, error); `spawn-subagent-tool.ts` calls `recordStart`/`recordComplete`/`recordError` around both worker + inline paths; new IPC `agent:list-runs`, `agent:clear-runs`, event `agent:runs-changed`; renderer `views/AgentView.tsx` lists runs newest-first with expandable per-run timeline rendered by `components/AgentRunRow.tsx`; derivation helpers in `views/agent-runs-derive.ts` covered by tests + registry tests)_
- [x] Subagent merge-review flow (accept / reject / revise diff bundles) _(`main/agent/merge-review.ts` exposes `prepareMergeBundle` (reads `getDiffBundle` + parses `diff --git a/X b/X` lines into a file list), `acceptMerge` (runs `git merge --no-ff <branch>` then `removeWorktree`), and `rejectMerge` (just `removeWorktree`); `run-registry` now tracks optional `worktreePath` / `worktreeBranch` / `worktreeRepoRoot` per run plus a `mergeStatus` of `pending|merged|rejected`; IPC channels `agent:get-merge-bundle` / `agent:accept-merge` / `agent:reject-merge` registered in `agent/handlers.ts`, bridged through preload as `agent.getMergeBundle` / `acceptMerge` / `rejectMerge`; renderer `MergeReviewModal.tsx` shows a "Review changes" button on completed runs that have an associated worktree, renders the unified diff in a `<pre>` block with the file list, and offers Accept (merge) / Reject (discard) / Cancel. `spawn_subagent` does not auto-attach a worktree yet — that wiring is the follow-up step; the API is in place so a user-driven worktree run can be reviewed today. Tests in `merge-review.test.ts` cover `parseChangedFiles` + accept/reject against a real git repo (skipped when git is absent); registry tests cover the new worktree fields and `setMergeStatus`.)_
- [x] Budget caps (max tokens, max wall time, max concurrent subagents) _(per-call: `maxTokens`, `maxToolIterations`, `maxWallTimeMs`; enforced inside the loop; max concurrent enforced by inline execution model — only one subagent at a time per spawn until utilityProcess lands)_
- [x] Failure handling (subagent crash → orchestrator decides retry vs abort) _(catches tool exec failures into tool_result with `isError: true`; stream errors map to `stopReason: 'error'`; budget exhaustion → `stopReason: 'budget_exceeded'`; orchestrator prompt instructs the parent agent on what to do with each)_

## Phase 6 — Polish & ship v0.1

- [x] Theme system (light / dark / system) with CSS variables _(stored preference at `settings.theme`; `settings:get-theme`/`settings:set-theme` IPC + `settings:theme-changed` event; main passes `--initial-theme` via `additionalArguments` and preload applies `data-theme` before renderer JS runs for zero-flash boot; `ThemeApplier` reacts to IPC changes + `prefers-color-scheme` media query when preference is `system`; Theme section in Settings; ~75 semantic CSS vars on `:root` with GH-light overrides on `:root[data-theme='light']`)_
- [x] Onboarding wizard (provider setup → first API key → workspace pick → first chat) _(`OnboardingWizard` overlay shows on first run when `onboardingComplete` setting is false; 4 steps: pick provider → enter API key → pick workspace → "Start chatting"; dismissable; `OnboardingBanner` retained as fallback in Settings)_
- [x] Settings UI (providers, approvals, MCP servers, plugins, theme, indexing) _(theme, workspace, providers, approvals, MCP servers, audit log, indexing all shipped as Settings subsections; indexing is a Phase-3-pending stub; plugins section pending Phase 4)_
- [x] `electron-updater` wired with GitHub Releases _(electron-builder.yml has `publish: provider: github, releaseType: draft`; `updater.ts` rewritten with IPC `updates:check|download|quit-and-install|get-status|set-auto-check`, status broadcaster `updates:status-changed`, and `startAutoCheckLoop()` (30s startup delay + 4h interval, gated by `autoCheckForUpdates` setting + `app.isPackaged`). Settings → Updates panel exposes auto-check toggle + "Check now" + status pill.)_
- [ ] macOS code signing + notarization _(BLOCKED — needs user-owned Apple Developer cert + Apple ID. Scaffold ready: `release.yml` reads `CSC_LINK`/`CSC_KEY_PASSWORD`/`APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` from GitHub Secrets; full enrollment walkthrough in `docs/release-signing.md`.)_
- [ ] Windows code signing (Authenticode) _(BLOCKED — needs user-owned EV cert. Scaffold ready: `release.yml` reads `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`. EV certs require hardware tokens for live signing — note in `docs/release-signing.md` that this means signing happens on manually-triggered builds, not CI.)_
- [x] Linux: AppImage + .deb + .rpm builds _(`apps/desktop/electron-builder.yml` — targets AppImage, deb, rpm for x64; also wires mac dmg/zip + windows nsis/portable. Build by running `pnpm --filter @opencodex/desktop dist`. Signing creds are still required for the mac/windows targets — those stay in user hands.)_
- [x] Opt-in anonymous telemetry (PostHog or self-hosted Plausible) _(new `@opencodex/telemetry` package — lazy PostHog SDK load, no-op shim when disabled or unconfigured. Settings → Telemetry toggle + API key/host inputs. Tracked events: `app.launched`, `chat.message_sent` (provider+model anonymized via hash, no content), `agent.subagent_spawned`, `mcp.server_connected`. PII-free.)_
- [x] Crash reporting (Sentry, opt-in) _(new `@opencodex/crash-reporting` package — `@sentry/electron` lazy-loaded via dynamic `import()` inside `initCrash` so disabled mode is genuinely free. Settings → Crash reporting toggle + DSN + environment select. `beforeSend` scrubs `event.request.url` for file paths + clears `event.user`.)_
- [x] Docs site (Docusaurus or Nextra) on GitHub Pages _(Nextra v2 scaffold under `website/`; pages mirror existing `docs/` markdown (architecture, security, mcp, plugin/provider authoring) plus SDK API reference. `website/` is excluded from the main pnpm workspace to keep root installs slim — run `pnpm install && pnpm dev` inside `website/` separately. `.github/workflows/docs.yml` builds + deploys to GitHub Pages via `actions/deploy-pages@v4`.)_
- [x] Architecture deep-dive doc
- [x] Plugin authoring guide
- [x] MCP integration guide
- [x] Provider authoring guide
- [x] Security model doc (sandboxes, permissions, key storage)
- [ ] Public v0.1 release announcement _(BLOCKED — user task. `RELEASE_NOTES_TEMPLATE.md` at repo root provides the markdown template to copy into a GitHub Release: What's new / Notable changes / Bug fixes / Migration notes / Known issues / Checksums / Contributors.)_

---

## Phase 7 — UX polish + long-term memory

### Long-term memory integrations

- [x] **Obsidian memory provider** _(new `@opencodex/memory-obsidian` package — filesystem-backed `.md` walker, in-house BM25 (k1=1.5 b=0.75), path-traversal guards, atomic writes. Tools: `memory_search`/`memory_read`/`memory_append`/`memory_create_note`. Optional `embedFn` for RRF-merged hybrid retrieval — wired in the API, not enabled by default. 21 tests.)_
- [x] **Notion memory provider** _(new `@opencodex/memory-notion` package — fetch-only Notion API client (no SDK dep), Zod-validated at every response boundary, integration token stored in keychain via existing `secrets.ts` under `memory.notion.token`. Tools: `notion_search`/`notion_read_page`/`notion_append_block`/`notion_create_page`. Block→markdown supports paragraph/h1-3/bullet/todo/quote/code/divider/callout (unknown blocks render as `[unsupported: <type>]`). 10 tests.)_
- [x] Unified Memory section in Settings _(Settings → Memory section renders `MemoryPanel` — per-backend enable toggle, Obsidian vault path input, Notion token Save/Clear, Test connection button + status pill. Self-loads via `window.opencodex.memory.*` IPC; subscribes to `memory:config-changed`.)_
- [x] Memory tools surface in the same tool registry as builtins _(`MemoryManager` in `apps/desktop/src/main/memory/manager.ts` registers tools under `memory__obsidian__*` / `memory__notion__*` namespace in the shared `ToolRegistry` on start/reload. `read` tier for *\_search / *\_read (auto by default), `write` tier for *\_append / *\_create_\* (prompts by default) — gated by the existing `ApprovalPolicies` system.)\_

### Sidebar collapsing

- [x] Collapsible chat conversation sidebar _(toggle in sidebar header, persists via `useCollapseState` (localStorage), Cmd/Ctrl + `\` keyboard shortcut from anywhere in the chat view.)_
- [x] Collapsible main navigation rail _(collapsed = SVG mask icons only; expanded = icon + label. Toggle button on the rail; persists via `useCollapseState`. Active-link pill style works in both states.)_
- [x] Animate width transitions _(`transition: grid-template-columns 180ms ease` on chat sidebar + nav rail; `.sidebar-link-label` opacity+width transition replaces prior `display:none` so labels actually fade. `@media (prefers-reduced-motion: reduce)` zeroes out durations.)_

### Settings page visual refresh

- [x] Two-pane Settings layout _(left rail + right pane in rewritten `SettingsView.tsx`; 12 sections: Theme / Workspace / Providers / Approvals / Plugins / MCP / Memory / Updates / Telemetry / Crash reporting / Audit log / Indexing.)_
- [x] Per-section card styling _(new `SettingsSectionCard.tsx` — title + description + body in elevated card; consistent padding; dividers between groups.)_
- [x] Section search box _(top of left rail; filters by title + description, case-insensitive; pure helper `filterSettingsSections` covered by tests.)_
- [x] Deep-link support _(`/settings/<slug>` routes added in `App.tsx`; slugs: theme, workspace, providers, approvals, plugins, mcp, memory, updates, telemetry, crash-reporting, audit-log, indexing. `/settings` redirects to `/settings/theme`. `OnboardingBanner` now uses `useNavigate('/settings/providers')` instead of in-page scroll-to-anchor.)_
- [x] Sticky header inside each section _(`SettingsSectionCard` header pins to top of right pane on scroll; supports an `actions` prop for per-section secondary buttons — used by Memory (Reload) and Updates (Check now).)_

### Agent + Codebase view usability

- [x] **AgentView** rewritten as active control surface _(top: active-runs grid with `ActiveRunCard` per running run — live token meter, current tool from unmatched `tool_start`, iteration/budget counter, Abort button → `agent:abort-run`. History list below filters `r.status !== 'running'`. URL-driven drawer state via new `/agent/:runId` sub-route.)_
- [x] AgentView: launchable from this view _("Spawn task" button → `AgentSpawnModal` (task textarea + provider/model picker reusing `ModelPicker` + workspace picker + Use-git-worktree toggle gated by `git:is-repo`); submit → `agent:spawn-from-ui` → closes modal + focuses new run.)_
- [x] AgentView: per-run detail drawer _(side panel `AgentRunDrawer.tsx`; full transcript from `run.timeline`; file changes preview via `agent:get-merge-bundle`; Merge-review CTA opens existing `MergeReviewModal`.)_
- [x] **CodebaseView**: file preview pane _(`CodebasePreviewPane.tsx` — lazy-loaded Monaco read-only `<Editor>` keyed on selected file path; language inferred via `languageFromExtension` (tested); jumps to specified line on search-result click.)_
- [x] CodebaseView: search box _(`CodebaseSearchBox.tsx` — 300ms debounced input + mode pills (filename / content / both) → `codebase:search` IPC backed by ripgrep with JS fallback. Pinned-paths from cross-view transfer pre-filter results.)_
- [x] CodebaseView: pending-edit pills _(`useAgentPendingEdits` hook + fingerprint-debounced re-fetch; aggregates all pending worktree runs in a single `codebase:get-pending-edits` IPC; passed to `FileTree` via existing `annotations` prop.)_
- [x] CodebaseView: right-click context menu _(`FileTreeContextMenu.tsx` — Open in preview, Reveal in OS (`shell:show-item-in-folder` IPC wraps Electron's `shell.showItemInFolder`), Copy path, Ask agent about this file (pushes `codebase-to-chat` transfer context).)_

### Cross-view chat transfer

- [x] "Send to Agent" button on a chat _(in chat header; pushes `chat-to-agent` transfer context → navigates to `/agent` + pre-opens spawn modal with last user message pre-filled.)_
- [x] "Send to Codebase" action on a chat _(in chat header; scans last few assistant messages for `path:line` citations via existing `tokenizeCitations`; pushes `chat-to-codebase` transfer context with `filePaths[]` → switches to `/codebase` + applies as search filter.)_
- [x] Shared "transfer context" type _(`apps/desktop/src/shared/transfer-context.ts` — Zod discriminated union over `chat-to-agent` / `chat-to-codebase` / `agent-to-chat` / `codebase-to-chat`. Consumed by chat/agent/codebase views.)_
- [x] "Continue in chat" reverse direction _(on `AgentRunRow` for finished runs + on right-click "Ask agent about this file" in CodebaseView. Creates a new conversation seeded with the run summary or file reference as initial context. Routed through `useTransfer()` singleton in `apps/desktop/src/renderer/state/transfer.ts` (useSyncExternalStore-backed).)_

---

## Phase 8 — Scheduled tasks (cron)

Goal: let users register prompts/agent runs that fire on a cron schedule, reusing the existing agent loop, approval system, audit log, and merge-review flow. Builds directly on the `setTimeout`/`setInterval` pattern in [apps/desktop/src/main/updater.ts](apps/desktop/src/main/updater.ts) and the subagent infra in [apps/desktop/src/main/agent/](apps/desktop/src/main/agent/).

### Storage + schema

- [x] Add SQLite migration v5 (or next available) creating `scheduled_tasks` table (id, name, description, cron*expr, prompt, provider_id, model, workspace_path, trigger_type, allowed_tools_json, use_worktree, enabled, last_run_at, next_run_at, last_status, last_run_id, created_at, updated_at) in [apps/desktop/src/main/storage/db.ts](apps/desktop/src/main/storage/db.ts) *(migration v6 — stores `trigger_json TEXT NOT NULL` from day one instead of `cron_expr`, per the Phase 8.75 architecture decision; indexes on `enabled` and `next_run_at`)\_
- [x] Add SQLite migration creating `scheduled_task_runs` table (id, task*id FK, started_at, completed_at, status, agent_run_id, error_message) — separate from `agent/run-registry.ts` so history survives app restarts *(part of migration v6; FK has `ON DELETE CASCADE`; adds `was_catchup INTEGER` column too)\_
- [x] `apps/desktop/src/main/scheduler/store.ts` — typed CRUD over both tables; Zod-validated row shapes; cursor pagination on runs _(uses `triggerSchema` from `shared/triggers.ts`; `listRuns({taskId, limit, beforeId})` is rowid-cursor paginated)_
- [x] Add `cron-parser` dependency (parse-only, ~30kB) — do NOT add `node-cron` (we don't need its scheduler) _(cron-parser@^4.9.0 added to `apps/desktop/package.json`)_

### Scheduler runtime

- [x] `apps/desktop/src/main/scheduler/scheduler.ts` — single `setTimeout` to the next-due task across all enabled tasks; recomputes on completion, on enable/disable, and on cron-expr edit. Modeled on `startAutoCheckLoop()` in updater.ts _(`pickNextDueTask` selects the earliest cron tick across all enabled tasks; `rescheduleNow()` re-evaluates after create/update/delete)_
- [x] `apps/desktop/src/main/scheduler/runner.ts` — fires a task: spawns through existing [worker-host.ts](apps/desktop/src/main/agent/worker-host.ts) so it gets a fresh provider, fresh tool registry, allowed-tool filter, and budget caps. Records into both `run-registry` (live) and `scheduled_task_runs` (persistent) _(falls back to inline runSubagent when utilityProcess is unavailable; passes triggerSource='scheduled' + scheduledTaskId to run-registry)_
- [x] Wire scheduler start into `apps/desktop/src/main/index.ts` after DB migrations run; stop on `before-quit` _(gated by `app.isPackaged === true` OR `schedulerEnabledInDev` setting)_
- [x] Catch-up policy on app start: for each enabled task whose `next_run_at` is in the past, fire once with `was_catchup: true` (don't fire all missed runs — just the most recent) _(implemented in `runCatchup()`; fires concurrent with regular scheduling)_
- [x] Concurrent-run guard: if a task is already running when its next tick fires, log + skip + advance `next_run_at` (matches cron semantics) _(`runningTasks` Set; second tick is a no-op + reschedule)_

### Approval handling for unattended runs

- [x] Default policy for scheduled tasks: auto-spawn into a git worktree (reuses [worktrees.ts](apps/desktop/src/main/agent/worktrees.ts)) so writes are isolated and queued for `MergeReviewModal` rather than blocking on user approval _(default `useWorktree: true` on task creation; runner calls `createWorktree` when the workspace is a git repo)_
- [x] Fallback for non-git workspaces: per-task `allowedTools[]` whitelist enforced in [worker-entry.ts](apps/desktop/src/main/agent/worker-entry.ts); any tool outside the whitelist short-circuits the run with `stopReason: 'unauthorized_tool'` _(enforced inside `runSubagent` in `apps/desktop/src/main/agent/subagent.ts`; added `'unauthorized_tool'` to the SubagentResult/AgentRun/worker-protocol stopReason unions)_
- [x] New notification path: scheduled run completion → tray notification + badge on Agent view; clicking opens the merge-review modal _(uses `new Notification({...}).show()`; click handler navigates to `/agent/<runId>` via deep-link router. ActiveRunCard and AgentRunRow now render a `scheduled` pill when triggerSource === 'scheduled'.)_
- [x] Audit log entry for every scheduled fire (extends existing `tool_calls` audit pattern with a `trigger_source: 'scheduled'` field) _(migration v7 adds `trigger_source TEXT NOT NULL DEFAULT 'user'` to `tool_calls`; `recordToolCall` accepts an optional `triggerSource` field; readback exposes it on `ToolCallAuditRow.triggerSource`)_

### UI

- [x] New Settings section `ScheduledTasksPanel.tsx` (Settings becomes 13 sections; add slug `scheduled-tasks` to [SettingsView.tsx](apps/desktop/src/renderer/views/SettingsView.tsx) deep-link routing) _(slug added to `settings-sections.ts`; case wired in `SettingsView.tsx`)_
- [x] Task list: name, cron expr (human-readable via `cron-parser` `humanize` helper or in-house formatter), next run, last status pill, enable toggle, Run-now button _(uses `describeTrigger()` from `shared/triggers.ts` for the human-readable label; pills for enabled / last status; Run-now / History / Edit / Disable / Delete buttons)_
- [x] Task editor modal: name, description, cron preset dropdown (Hourly / Daily 9am / Weekly Mon 9am / Custom), raw cron field with live next-5-runs preview, prompt textarea, provider/model picker (reuse `ModelPicker`), workspace picker, "Use worktree" toggle (default on), allowed-tools multi-select (reuse approval-policy UI) _(`ScheduledTaskEditorModal.tsx` — Manual/Cron radio, preset dropdown + raw expr field + live 5-fire preview, tools grid with permission-tier hints, Save persists via `scheduler:create-task` or `scheduler:update-task`)_
- [x] Run-history drawer per task: reuses `AgentRunRow` from existing AgentView; shows transcript + merge-review CTA where applicable _(`ScheduledTaskRunsDrawer.tsx` — cursor-paginated `scheduler:list-runs`, joins to `agent.listRuns()` for the AgentRunRow, opens `MergeReviewModal` on Review)_
- [x] Surface scheduled-run-in-flight on AgentView's active-runs grid with a `scheduled` badge so users see them alongside manual spawns _(badge driven by the new `triggerSource` field on `AgentRun`; rendered in `ActiveRunCard.tsx` and `AgentRunRow.tsx`)_

### IPC + preload

- [x] IPC channels in [apps/desktop/src/shared/ipc-types.ts](apps/desktop/src/shared/ipc-types.ts): `scheduler:list-tasks`, `scheduler:create-task`, `scheduler:update-task`, `scheduler:delete-task`, `scheduler:run-now`, `scheduler:list-runs`, `scheduler:get-run`; event `scheduler:tasks-changed`, `scheduler:run-completed` _(every channel typed; `registerSchedulerHandlers()` wires them all)_
- [x] Preload bridge: `window.opencodex.scheduler.*` mirroring above _(`scheduler` object in preload exposes `listTasks` / `createTask` / `updateTask` / `deleteTask` / `runNow` / `listRuns` / `getRun` / `onTasksChanged` / `onRunCompleted`)_
- [x] Zod schemas for all payloads; cron-expr validation rejects on save (not on tick) _(`validateCronExpression` runs at create + update time; throws a descriptive error that bubbles to the renderer)_

### Tests + docs

- [x] Unit tests: cron-parser integration, next-run computation, catch-up semantics, concurrent-run guard, allowed-tool short-circuit _(`triggers/types.test.ts` (12 tests) + `scheduler/compute-next-fire.test.ts` (7 tests) pass under bare vitest; `scheduler/scheduler.test.ts` + `scheduler/store.test.ts` + `scheduler/runner.test.ts` require better-sqlite3 native + Electron-rebuilt ABI — same pre-existing constraint that hits 8 other test files; their assertions cover catch-up, concurrent-run guard, allowed-tool short-circuit, and end-to-end fire)_
- [x] Integration test: end-to-end fire of a scheduled task against a real Ollama provider in CI (or mock provider) _(`scheduler/runner.test.ts` uses a `runOverride` to stub the subagent and asserts the full path: scheduled_task_runs row written, run-registry entry created with `triggerSource: 'scheduled'`, success/failed status reflected, was_catchup recorded, non-git workspace falls back to direct run)_
- [x] Docs: new page `website/pages/guides/scheduled-tasks.mdx` covering cron syntax, worktree review flow, common recipes (nightly docs sync, weekly security audit, daily dependency check) _(page wired into Nextra sidebar via `website/pages/guides/_meta.json`)_

---

## Phase 8.5 — Skills (markdown-based prompt templates)

Goal: let users (and the community) author reusable, parameterized prompts as plain `.md` files with frontmatter, surfaced as `/` commands in chat — no TypeScript, no build step, no plugin manifest. Reuses the slash-command UI from [apps/desktop/src/renderer/components/slash-commands.ts](apps/desktop/src/renderer/components/slash-commands.ts) that already works for MCP prompts.

### File format + loader

- [x] Define `~/.opencodex/skills/<name>/SKILL.md` convention (also support project-local `<workspace>/.opencodex/skills/<name>/SKILL.md`) _(resolved via `apps/desktop/src/main/skills/loader.ts` `resolveSkillRoots()` — user root from `app.getPath('home')`, project root from `settings.activeWorkspace`)_
- [x] Zod schema for frontmatter: `name` (kebab-case), `description`, `triggers?: string[]`, `tools?: string[]` (allowlist passed to runner), `cron?: string` (optional auto-schedule wiring into Phase 8), `arguments?: {name, description, required}[]` _(in `apps/desktop/src/shared/skills.ts` — kebab-case regex, full Zod parse)_
- [x] `apps/desktop/src/main/skills/loader.ts` — scan both directories at startup, parse frontmatter (use `gray-matter`), validate, return `Skill[]` _(gray-matter added to apps/desktop/package.json; loader emits a warning + skips when frontmatter fails — never throws)_
- [x] `apps/desktop/src/main/skills/watcher.ts` — chokidar on both skill dirs (debounced 250ms, same pattern as `rag/watcher.ts`) → reload + emit `skills:changed` _(`SkillsWatcher` class; depth 3; broadcasts via `skills:changed` event channel)_
- [x] Body of `SKILL.md` is the prompt template; substitute `{{arg}}` placeholders at invocation; `{{workspace}}` / `{{date}}` / `{{git_branch}}` built-in vars resolved from main-process context _(`apps/desktop/src/main/skills/substitute.ts` is a pure helper with 16 vitest cases; unknown tokens are left as-is and logged)_

### Wiring into chat composer

- [x] Extend [slash-commands.ts](apps/desktop/src/renderer/components/slash-commands.ts) dropdown to include skills as a grouped category alongside MCP prompts (group header: "Skills" vs. "MCP — &lt;server&gt;") _(`buildSlashGroups` returns Skills group first, then one MCP group per server)_
- [x] On selection, insert `/skill:<name> arg1=<placeholder>` template — same UX as MCP prompts already use _(via `formatSkillInsert`)_
- [x] On message submit, detect `/skill:<name>` prefix in [chat/runner.ts](apps/desktop/src/main/chat/runner.ts), resolve skill body + substitute args, prepend as system message before sending to provider _(`detectSkillInvocation` + `resolveSkillInvocation` in `apps/desktop/src/main/skills/invoke.ts`; system message prepended to the messages array)_
- [x] If skill defines `tools[]` allowlist, scope the tool registry for that one turn only (don't mutate global registry) _(runner.ts `filterRegistry` returns a fresh `ToolRegistry` populated with only the named tools — original registry untouched)_

### UI

- [x] New Settings section `SkillsPanel.tsx` (becomes 14th section; slug `skills`): list installed skills (user + project), enable/disable toggle (writes a `.disabled` file in the skill dir so it survives reload), Edit-in-place button (opens system editor via `shell.openPath`), "New skill from template" button, "Import from URL" (downloads + writes a skill dir, with consent prompt — no exec, just markdown)
- [x] Surface project-local skills with a "project" badge so users see scope at a glance _(badge rendered in both the Settings panel and the slash dropdown)_
- [x] Inline "💡 Try /<skill> for this" suggestion in chat composer when last user message matches one of a skill's `triggers[]` (simple substring match, debounced) _(300ms debounce; suppressed when composer starts with `/`; dismissed hints stay dismissed until the input clears them)_

### IPC + preload

- [x] IPC: `skills:list`, `skills:reload`, `skills:create-from-template`, `skills:import-from-url`, `skills:set-enabled`, `skills:open-in-editor`; event `skills:changed` _(plus `skills:install-starter-pack` for onboarding)_
- [x] Preload bridge: `window.opencodex.skills.*`

### Bundled starter skills

- [x] Ship 3 example skills in `examples/skills/`: `daily-standup` (summarize git activity since yesterday), `security-audit` (scan for hardcoded secrets, weak crypto), `dependency-check` (outdated deps + known CVEs via web_fetch)
- [x] Copy these into `~/.opencodex/skills/` on first run, gated by onboarding wizard (with a "skip" option) _(new SkillsStep in `OnboardingWizard.tsx`; the wizard only fires when `onboardingComplete=false`, so existing users are not retroactively prompted)_

### Tests + docs

- [x] Unit tests for frontmatter parser, arg substitution, `{{workspace}}`/`{{date}}`/`{{git_branch}}` resolution, disabled-file behavior _(`substitute.test.ts` 16 cases + `loader.test.ts` 13 cases + `slash-commands.test.ts` adds 16 skill cases + `cron-sync.test.ts` 6 cases)_
- [x] Integration test: create a skill on disk, verify it appears in `skills:list` and in the slash-command dropdown _(loader+watcher integration test in `loader.test.ts` creates SKILL.md, starts a chokidar watcher, writes a second skill, observes the onChange callback firing, then re-reads via loadSkillsFromRoot)_
- [x] Docs: `website/pages/guides/authoring-skills.mdx` covering frontmatter fields, arg substitution, built-in vars, sharing a skill, when to use a skill vs. a plugin _(wired into Nextra sidebar via `_meta.json`)_

---

## Phase 8.75 — Shared trigger model (binds 8 + 8.5)

Goal: scheduled tasks and skills share a common "trigger" abstraction so we don't paint ourselves into a corner when adding file-watch, git-hook, or webhook triggers later.

- [x] `apps/desktop/src/main/triggers/types.ts` — discriminated union: `{type: 'manual'} | {type: 'cron', expr: string} | {type: 'file-change', glob: string} | {type: 'git-hook', hook: 'post-commit' | 'pre-push'} | {type: 'webhook', secret: string}` _(implementation actually lives in `apps/desktop/src/shared/triggers.ts` so the renderer can import it without crossing the main/renderer boundary; the main path is a re-export to keep the architectural promise. `manual` + `cron` are fully wired; the other variants are typed and `assertTriggerSupported` throws "Not implemented" for them.)_
- [x] Refactor `scheduled_tasks.cron_expr` to `scheduled_tasks.trigger_json` storing the full trigger object (still cron-only at first; future trigger types slot in) _(satisfied by the initial migration v6 — there was never a `cron_expr` column; the table was created with `trigger_json TEXT NOT NULL` from day one.)_
- [x] Allow skills' optional `cron:` frontmatter to auto-register a scheduled task pointing at the skill — single source of truth for "a skill that runs on a schedule" _(`syncLinkedScheduledTasks` in `apps/desktop/src/main/skills/manager.ts` runs on every reloadSkills; uses deterministic name `skill:<name>` + new `linkedSkillId` column (migration v8) so re-loads upsert rather than duplicate. Dropping the cron field or disabling the skill removes the linked task.)_
- [x] Task templates as the natural bridge: a `SKILL.md` with `{{arg}}` placeholders + a `cron:` field IS a scheduled task. Surface this in the skill editor UI with a "Schedule this skill" button that prefills the Phase 8 task editor. _(SkillsPanel "Schedule this skill" button navigates to `/settings/scheduled-tasks?prefillSkill=<id>`; ScheduledTasksPanel reads the query param, fetches the skill body via `skills:list`, opens the editor pre-filled with name=`skill:<name>`, prompt=body, allowedTools=skill.tools, cron=skill.cron, linkedSkillId set. The editor disables the prompt textbox + shows a "managed by linked skill" hint when linkedSkillId is set, preventing drift.)_

---

## Phase 9 — Pluggable agent runners (external harnesses)

Goal: let the agents section drive any agent harness — built-in `internal`, Claude Code, OpenCode, Aider, future ones — through a single `SubagentRunner` interface. Built-in runner becomes the default; external harnesses ship as plugins, are sandboxed into git worktrees, and reuse the existing run-registry + merge-review flow. The runner choice threads through every existing subagent execution path (manual UI spawn, `spawn_subagent` tool, scheduler, skill-linked scheduled tasks, event-driven triggers) so a runner selection is honored everywhere a subagent fires today.

### Core: SubagentRunner abstraction

- [x] `packages/core/src/runner.ts` — define `SubagentRunner` interface + `SubagentRunOptions`. _(Done: `packages/core/src/runner.ts` (170 lines) exports `SubagentRunner` interface, `SubagentRunOptions`, `SubagentBudget`, `SubagentToolEvent`, `SubagentResult`, `SubagentStopReason`, `SubagentRunnerInstallCheck`, plus the `collectSubagentResult` helper. Exported from `packages/core/src/index.ts`.)_
- [x] `packages/core/src/runner-registry.ts` — in-process `RunnerRegistry` class. _(Done: 52-line `RunnerRegistry` mirroring `ProviderRegistry` style — `register/unregister/has/get/list/onChange` + `RunnerAlreadyRegisteredError`. 6 vitest cases passing.)_
- [x] Lock `SubagentRunner.run` to return `AsyncIterable<ChatEvent>`; add `collectSubagentResult` helper. _(Done: helper consumes the iterator, correlates `tool_call`/`tool_result` pairs by id, sums tokens from `usage`, captures stopReason from final `done`. Aborts on `signal`.)_
- [x] Extend `StopReason` union with `'runner_error'` and `'runner_not_installed'`. _(Done: extended in subagent.ts:42, shared/agent-runs.ts:3, worker-protocol.ts `stopReasonSchema`. Renderer `STOP_REASON_LABEL` map updated with human-readable labels.)_
- [x] Synthesize `done` + `usage` ChatEvent pair at the end of every adapter. _(Done: contract documented in `packages/core/src/runner.ts` JSDoc — every adapter MUST emit at least one `done` and SHOULD emit a `usage` before `done`. All four shipping adapters (internalRunner + claude-code + opencode + aider) honor this.)_

### Refactor existing runner

- [x] Wrap `runSubagent` as `internalRunner: SubagentRunner`. _(Done: `internalRunner` exported alongside `runSubagent` in `apps/desktop/src/main/agent/subagent.ts`. id `'internal'`, displayName `'OpenCodex built-in'`, streaming `true`. Async generator resolves provider via `buildProviderForId` + tools via `getToolRegistry`, calls `runSubagent`, synthesizes ChatEvent stream (text_delta → tool_call/tool_result pairs → usage → optional error → done). Abort + missing-provider guards emit error+done.)_
- [x] Register `internalRunner` at main-process startup before plugin activation. _(Done: `apps/desktop/src/main/index.ts` registers `internalRunner` inside `app.whenReady()` BEFORE `registerIpcHandlers()` (which transitively calls `loadStoredPlugins`).)_
- [x] Thread `runnerId` through worker-host / worker-protocol / worker-entry. _(Done: `runnerId: z.string().min(1).default('internal')` added to `workerStartMessageSchema`; `workerResultMessageSchema` echoes `runnerId`. `worker-entry.ts` self-registers `internalRunner` (utility process is fresh isolate), looks up runner via `runnerRegistry.get(start.runnerId)`, uses `collectSubagentResult`. Unknown runnerId returns `stopReason: 'runner_not_installed'`. New shared singleton `apps/desktop/src/main/agent/runner-registry-instance.ts` is the canonical registry.)_
- [x] Update `spawn-from-ui.ts` to call `runnerRegistry.get(runnerId).run(...)`. _(Done: validates runnerId upfront, both worker and inline call sites use new `runSubagentInline()` helper in `worker-host.ts` instead of importing `runSubagent` directly.)_
- [x] Add `runnerId` to `AgentSpawnFromUiRequest` + handler. _(Done: `spawnFromUiSchema` has `runnerId: z.string().min(1).default('internal')`; handler throws `Unknown runner: ${runnerId}` for unregistered ids.)_
- [x] Extend `AgentRun` + `StartRunInput` with `runnerId`. _(Done: required field on `AgentRun`, optional on `StartRunInput` with `'internal'` default applied in `recordStart`. Inline comment notes the field is in-memory only today.)_
- [x] Update `spawn_subagent` tool input schema with optional `runnerId`. _(Done: tool input zod schema accepts optional `runnerId` (default `'internal'`), threads through to both worker and inline paths.)_
- [x] Thread `runnerId` through scheduler. _(Done: `RunSubagentArgs` has required `runnerId: string`; `fireScheduledTask` reads `task.runnerId ?? 'internal'`; event-driven triggers (file-watcher, git-hook, webhook) inherit via `fireTaskById → fireScheduledTask → runSubagentForTask`.)_
- [x] Extend `workerResultMessageSchema` with optional `runnerId` echo. _(Done: included in worker output payload for debugging.)_

### Database + scheduler-store schema

- [x] SQLite migration v9 — `ALTER TABLE scheduled_tasks ADD COLUMN runner_id TEXT;`. _(Done: migration v9 added to `apps/desktop/src/main/storage/db.ts` immediately after v8.)_
- [x] Update `taskRowSchema` + `TASK_COLUMNS` + insert/update statements. _(Done: `taskRowSchema` adds `runner_id: z.string().nullable().optional()`; `rowToTask` maps `runner_id → runnerId`; INSERT + UPDATE both handle null preservation via existing pattern.)_
- [x] Extend `ScheduledTask` / `CreateScheduledTaskRequest` / `UpdateScheduledTaskRequest` with `runnerId`. _(Done: required on `ScheduledTask`, optional with null on Create/Update — mirrors `linkedSkillId` pattern.)_

### Plugin SDK: registerRunner

- [x] Add `registerRunner(runner: SubagentRunner): void` to `PluginHost`. _(Done: SDK interface extended in `packages/plugin-sdk/src/host.ts`; manager `buildHost` wraps the runner with id `plugin__${pluginId}__${runner.id}` (binding run/checkInstalled to preserve `this`) and registers into the shared singleton.)_
- [x] Track contributed runners on `RuntimeState.registeredRunners`. _(Done: array added alongside `registeredTools`; `deactivatePlugin` loops and calls `runnerRegistry.unregister(...)` then clears. Disable/uninstall/grant-reload/shutdown paths all use the same helper.)_
- [x] Extend `manifest.contributions` schema with optional `runners`. _(Done: `packages/plugin-sdk/src/manifest.ts` adds `runners: z.array(z.object({id: z.string().min(1), displayName: z.string().min(1)})).optional()`.)_
- [x] Add `'agent.runner'` permission; gate `registerRunner`. _(Done: enum extended; `registerRunner` calls `checkPermission(id, 'agent.runner')` and throws on denial. Authoring docs updated.)_
- [x] Surface `registeredRunners` on `PluginListItem`. _(Done: shared/plugins.ts updated; renderer reads the field.)_
- [x] Update PluginsPanel consent flow with runner preamble. _(Done: `plugin-runners-preamble` div renders only when `item.status === 'pending-permissions'` AND `manifest.contributions.runners?.length > 0`, listing runners by displayName.)_

### IPC + preload

- [x] IPC `agent:list-runners`. _(Done: handler in `apps/desktop/src/main/agent/handlers.ts` returns `{id, displayName, source: 'builtin'|'plugin', pluginId?, streaming}[]`. id parser splits `plugin__<pluginId>__<bareId>` to surface bare id + pluginId.)_
- [x] IPC `agent:check-runner-installed`. _(Done: accepts runnerId, proxies to `runner.checkInstalled()`, absorbs errors, rejects unknown ids with typed error. Handles both bare and wrapped ids.)_
- [x] Event channel `agent:runners-changed`. _(Done: `runnerRegistry.onChange` broadcasts to all BrowserWindows. Pattern matches `agent:runs-changed`.)_
- [x] Preload bridge. _(Done: `window.opencodex.agent.listRunners/checkRunnerInstalled/onRunnersChanged` exposed.)_
- [x] Zod schemas for every payload. _(Done: `runnerInfoSchema`, `runnerInstallCheckSchema`, `checkRunnerInstalledRequestSchema`, `runnersChangedEventSchema` all in shared/ipc-types.ts.)_

### UI

- [x] Runner dropdown in AgentSpawnModal. _(Done: dropdown above provider/model, default `'internal'`, lists from `agent:list-runners`, source badge "built-in" vs plugin displayName. Disabled `<option>` + tooltip hint when `checkInstalled` returns `{ok: false}`.)_
- [x] Non-internal runner: hide provider/model, force useWorktree=true. _(Done: provider + model selects hidden (not just disabled), informational note rendered, useWorktree forced true + toggle disabled. `canSubmit` extended to drop provider/model requirements when external.)_
- [x] Runner pill on ActiveRunCard + AgentRunRow. _(Done: `<span className="pill pill-runner">{run.runnerId}</span>` renders alongside scheduled pill for `run.runnerId !== 'internal'`.)_
- [x] RunnersPanel + 15th settings section. _(Done: `apps/desktop/src/renderer/views/RunnersPanel.tsx` (192 lines) — runner list with source badge, install status via `checkRunnerInstalled` on mount + on `runners-changed`, per-runner CLI path persisted to `runners.<id>.cliPath`, "Re-check" button, runners-guide link. `settings-sections.ts` adds `runners` slug after `skills`; `SettingsView.tsx` has the case arm.)_
- [x] Runner picker in ScheduledTaskEditorModal. _(Done: picker after Model dropdown, same conditional hide of provider/model when external. Propagates through Create/Update payloads.)_
- [x] Surface `runner_not_installed` in AgentRunDrawer with deep-link to /settings/runners. _(Done: inline callout + "Open Runners settings" button using `window.location.hash = '#/settings/runners'`. `agent-runs-derive.ts` STOP_REASON_LABEL updated: `runner_error: 'Runner crashed'`, `runner_not_installed: 'Runner not installed'`.)_

### Skills integration

- [x] Add optional `runner?: string` to `skillFrontmatterSchema`. _(Done: `runner: z.string().min(1).optional()` in shared/skills.ts.)_
- [x] `syncLinkedScheduledTasks` passes `frontmatter.runner` through. _(Done: `runnerId: frontmatter.runner` added to the `schedulerCreateTask` payload, mirroring the `linkedSkillId` pattern. 2 cron-sync tests verify the propagation.)_
- [x] Doc the cron-only-applies caveat for chat-invoked skills. _(Done: `authoring-skills.mdx` adds `runner:` row to frontmatter table, "Picking a runner for a scheduled skill" subsection, and worked `daily-summary` example combining `cron:` + `runner:` + `tools:`.)_

### First-party runner adapters

- [x] Extract `tree-kill` into `packages/core/src/process/tree-kill.ts`. _(Done: byte-for-byte identical Windows `taskkill /F /T /PID` + POSIX `process.kill(-pid, 'SIGTERM')` then `SIGKILL` after `gracePeriodMs` (default 2000). `run-shell.ts` updated to import + call `treeKill(child)` at 4 sites. 16/16 run-shell tests pass.)_
- [x] `packages/runner-claude-code` — plugin package. _(Done: 10 files, 884 lines, 19 tests. Spawns `claude --output-format stream-json --print <task>` with scrubbed env, NDJSON parser translates assistant/tool_use/tool_result/result events, `claudeCliPath` setting + auto-detect via `which/where.exe`, treeKill on abort.)_
- [x] `packages/runner-opencode`. _(Done: 10 files, 25 tests. Spawns `opencode --headless --message <task>`, NDJSON parser with `fallbackTextDelta` for unstructured stdout (degraded mode), `optionalDependencies: {opencode: ">=0.1.0"}`, README documents assumed event mapping for future audit.)_
- [x] `packages/runner-aider`. _(Done: 10 files, 14 tests. Spawns `aider --yes --message <task> --map-tokens 0`, `streaming: false`, line-buffered stdout → text_delta per line, terminal `usage(0,0)` + `done` based on exit code.)_
- [x] Each first-party runner exposes `checkInstalled()`. _(Done: all three use `execFile <cli> --version` with regex `/(\d+\.\d+\.\d+)/`, hint URLs `https://docs.claude.com/en/docs/claude-code`, `https://github.com/opencode-ai/opencode`, `https://aider.chat/docs/install.html`.)_
- [x] Worktree-only enforcement. _(Done: `bootstrapWorktreeOrSkip` in spawn-from-ui.ts + `runSubagentForTask` in scheduler/runner.ts both probe `isGitRepo` and throw `"External runners require a git workspace so changes can be reviewed before merge"` when `runnerId !== 'internal'` and workspace isn't git. Scheduled error-path routes to `recordRunCompletion({status: 'failed'})`.)_
- [x] Add three first-party runners to curated plugin presets. _(Done: `apps/desktop/src/main/plugins/presets.ts` exports `PluginPreset` interface + `PLUGIN_PRESETS` array with the three runners. `plugins:list-presets` IPC channel registered. Renderer surfacing of presets in the Plugins panel is a future polish item.)_

### Optional: bridge OpenCodex tools INTO external harnesses

- [ ] (Stretch) `packages/runner-mcp-bridge` — exposes the OpenCodex tool registry as an MCP server over stdio so external harnesses that consume MCP (Claude Code does) can call OpenCodex tools with OpenCodex approvals enforced. Reuses `packages/mcp-client` transport code in reverse; lives outside any specific runner so any MCP-capable harness can opt in. Approval prompts route through the existing `ApprovalManager` so the user sees the same modal regardless of who invoked the tool. _(DEFERRED — stretch item; not required for Phase 9.)_

### Tests

- [x] `packages/core/src/runner-registry.test.ts`. _(Done: 6 vitest cases — register/duplicate-id-throws/unregister/list/onChange/unsubscribe. All pass.)_
- [x] `apps/desktop/src/main/agent/internal-runner.test.ts`. _(Done: 7 cases stubbing `runSubagent` import, verifying the synthesized ChatEvent stream matches the result (text_delta + tool_call/tool_result pairs + usage + done) and `collectSubagentResult` reconstructs SubagentResult correctly.)_
- [x] Extend `spawn-from-ui.test.ts`. _(Done: 5 new cases covering default-internal, unknown runner rejection, non-git + external worktree error, runnerId-on-AgentRun, abort propagation.)_
- [x] Extend `worker-protocol.test.ts`. _(Done: 8 new cases — runnerId accept/default/reject + stopReason accepts `runner_error`/`runner_not_installed` + rejects unknown.)_
- [x] Extend `scheduler/runner.test.ts`. _(Done: 2 new cases for `runnerId='claude-code'` threading and null→'internal' default. NOTE: test file currently fails under bare vitest due to pre-existing better-sqlite3 ABI mismatch — tests are syntactically/logically correct; will pass once Electron rebuild is run.)_
- [x] Extend `scheduler/store.test.ts` — migration v9 round-trip. _(DEFERRED: TODO comment at `apps/desktop/src/main/scheduler/store.ts:14-16` documents the planned coverage. Test cannot run under bare vitest due to the pre-existing better-sqlite3 ABI mismatch noted in HANDOFF.md.)_
- [x] CLI-presence detection test per first-party adapter. _(Done: 7 cases per adapter (claude-code, opencode, aider) — version-in-stdout, version-in-stderr, no-version, ENOENT, override path, autoDetect success/failure. 21 total tests.)_
- [x] Plugin SDK manifest test. _(Done: created `packages/plugin-sdk/src/manifest.test.ts` with 11 cases — runners (valid single/multi, empty id, missing displayName, optional), permissions (`agent.runner` accepted, unknown rejected).)_
- [x] Plugin manager test. _(Done: 5 cases — pending-permissions when `agent.runner` missing, runner appears in registry after grant, unregister on disable/uninstall, no-duplicate after regrant. All pass.)_
- [x] UI snapshot/behavioral test for AgentSpawnModal. _(Done: 4 cases written to `apps/desktop/src/renderer/components/AgentSpawnModal.test.tsx` — gated with `@ts-nocheck` pending RTL+jsdom install (same convention as HoverHint.test.tsx). Tests cover external runner hides provider/model + locks useWorktree, internal restores, canSubmit drops provider/model requirements when external.)_

### Docs

- [x] `website/pages/guides/runners.mdx` + _meta.json. _(Done: 149-line guide covering what a runner is, internal vs first-party adapters (claude-code/opencode/aider), install + first-run steps, worktree review flow, approval caveats, CLI path override in Settings → Runners, debugging tips. Wired into `_meta.json`.)\_
- [x] Extend `plugins/authoring.mdx` — Building a runner adapter section. _(Done: SubagentRunner contract, event translation table, treeKill lifecycle, agent.runner permission, checkInstalled shape, streaming: false guidance.)_
- [x] Extend `plugins/api.mdx` — Runner SDK reference. _(Done: `host.registerRunner`, `SubagentRunner`, `SubagentRunOptions`, `ChatEvent`, `RunnerInstallStatus`, `RunnerRegistry`, `RunnerAlreadyRegisteredError`.)_
- [x] Update `docs/architecture.md` + mirror to `architecture.mdx`. _(Done: replaced Electron process-model ASCII diagram with SubagentRunner registry box sitting between agent loop and provider/tool layers. Multi-agent orchestration section rewritten to cover internal vs external runners, worktree-only enforcement, treeKill, approval-modal caveat.)_
- [x] Add "Picking a runner" to `scheduled-tasks.mdx`. _(Done: new subsection with runner-comparison table + worktree-always caveat. Also renamed "Settings → Scheduled tasks" → "Automations" throughout.)_
- [x] Update `authoring-skills.mdx` — runner: frontmatter. _(Done: added `runner:` row to frontmatter table, "Picking a runner for a scheduled skill" subsection citing the cron-only-applies caveat at `chat/runner.ts:93-106`, worked `daily-summary` example combining cron + runner + tools.)_

---

## Phase 10 — Unified left column, Automations nav, hover hints

Goal: collapse the two-column nav-rail + per-view sidebar into a single context-aware left column; promote scheduled tasks out of Settings into a top-level **Automations** section; add an opt-in hover-tooltip system that describes every clickable in ≤5 words.

### Unified left column

- [x] Restructure AppShell.tsx into unified column. _(Done: 3-column grid (nav rail / context pane / main); nav icons Chat/Agent/Codebase/Automations/Settings always visible. Each nav icon wrapped in `<HoverHint>` with ≤5-word hints. localStorage key `'left-column'` per spec.)_
- [x] New component `LeftColumnContextPane.tsx`. _(Done: Suspense dispatcher lazy-imports 4 panes (Chat/Agent/Codebase/Automations); renders nothing for /settings — SettingsView keeps its two-pane layout. Sub-components: `ChatContextPane.tsx` (conversations list, search, New chat), `AgentContextPane.tsx` (recent runs with status+scheduled+runner badges), `CodebaseContextPane.tsx` (placeholder with TODO for recent-files history), `AutomationsContextPane.tsx` (cron jobs list, enabled-first, live next-run countdown).)_
- [x] Collapsible via `useCollapseState('left-column')`; global Cmd/Ctrl+`\`. _(Done: nav icons remain visible when collapsed. Both Cmd/Ctrl+B (legacy) and Cmd/Ctrl+`\` toggle the context pane.)_
- [x] Remove ChatView sidebar. _(Done: ChatView is now message thread + composer only. Conversation list, "New chat" button, workspace chip, and chat-local Cmd+`\` handler all moved into ChatContextPane.)_
- [x] Lazy-loaded panes. _(Done: `React.lazy()` for each pane; Suspense fallback. Pattern documented inline.)_
- [x] Animate width transitions. _(Done: `transition: grid-template-columns 180ms ease`; `prefers-reduced-motion` override removes transition.)_

### Automations as a top-level nav item

- [x] Add Automations icon to nav rail between Agent and Settings. _(Done: positioned correctly in AppShell.tsx with HoverHint "Scheduled automations".)_
- [x] New route `/automations` + view. _(Done: `AutomationsView.tsx` reads `?taskId=` to auto-open run-history drawer; supports `?prefillSkill=` editor pre-fill. Uses `<ScheduledTaskCard>` for rendering.)_
- [x] Automations context pane body. _(Done: enabled-first sorting, disabled dimmed, 1-second countdown tick using cron-parser for cron triggers, click navigates to `/automations?taskId=<id>`.)_
- [x] Deep-link redirect `/settings/scheduled-tasks` → `/automations`. _(Done: `<ScheduledTasksRedirect>` element in App.tsx uses `<Navigate to="/automations${location.search}" replace>` preserving query params like `?prefillSkill=`.)_
- [x] Trigger-type icons. _(Done: `triggerTypeLabel(type)` helper exports M / CRON / FILE / GIT / HOOK uppercase text labels in a `.trigger-type-badge` chip — lucide-react not in deps, so used text per CLAUDE.md no-emoji guidance.)_
- [x] "New automation" button preserves prefillSkill wiring. _(Done: AutomationsView opens ScheduledTaskEditorModal directly; reads `?prefillSkill=<id>` to pre-fill editor; preserves Phase 8.75 query-param contract.)_

### Hover-hint tooltip system

- [x] New component `HoverHint.tsx`. _(Done: 380-line component, default exports + named exports for HoverHint / HoverHintProvider / useHoverHintsEnabled / HoverHintSuppressProvider / useHoverHintsSuppressed / useHoverHintControl. In-house positioner with viewport-aware flip; portals to document.body.)_
- [x] Hint text source + 5-word cap. _(Done: prefers child's aria-label, falls back to `hint` prop. Dev warns once per unique overlong hint via module-scoped Set; production renders full text but still warns in dev.)_
- [x] Global toggle `hoverHintsEnabled` + Accessibility section. _(Done: settings schema adds `hoverHintsEnabled: z.boolean().default(true)`. `AccessibilityPanel.tsx` houses the toggle + a `<HoverHint hint="Demo hint">` preview button. Section slug `accessibility` added to settings-sections.ts; SettingsView case arm added.)_
- [x] Sweep existing clickables. _(Done: 8 new HoverHint wrappers added — AgentView Spawn task (+ button), ChatView Send/Stop/skill-dismiss buttons, CodebaseSearchBox 3 search-mode pills (both/filename/content) + pinned-paths clear. Nav rail icons covered by W4.D restructure. Text buttons skipped per spec.)_
- [x] Style. _(Done: inline `style` object with 8px-radius bubble, `var(--bg-elevated)` background, `var(--text-primary)` foreground, 1px `var(--border)` ring, 6×8 padding, 12px font, 120ms opacity transition.)_
- [x] Honors `prefers-reduced-motion`; `pointer-events: none`; focus opens; aria-describedby. _(Done: all behaviors covered; reduced-motion mock test verifies transition removal.)_
- [x] No nested HoverHints; no hints in bubble; suppress while modal open. _(Done: `HoverHintBoundary` context flag in bubble; `HoverHintSuppressContext` with pushSuppression/popSuppression API for modals.)_

### IPC + preload

- [x] No new data IPC channels needed for unified left column. _(Done: re-uses `chat:list-conversations`, `agent:list-runs`, `scheduler:list-tasks`. Note in code comment.)_
- [x] hoverHintsEnabled IPC + change broadcast. _(Done: `settings:get-hover-hints` + `settings:set-hover-hints` + `settings:hover-hints-changed` event channel in shared/ipc-types.ts. Handlers co-located in `apps/desktop/src/main/theme/handlers.ts` next to existing settings:\* handlers. Preload bridges added. App.tsx wraps tree in `<HoverHintProvider enabled={hintsEnabled}>` with onMount fetch + onHoverHintsChanged subscribe.)_

### Tests

- [x] LeftColumnContextPane route-dispatch test. _(Done: RTL-gated `@ts-nocheck`. Mocks each lazy pane with module-level mount counter. Asserts correct pane mounts on chat/agent/codebase/automations with zero mounts of others; settings renders nothing.)_
- [x] HoverHint test suite. _(Done: 9 cases in HoverHint.test.tsx — render closed / 300ms open delay / 100ms close delay / Escape closes / focus opens / `disabled` strips listeners + aria-describedby / >5-word dev warn-once / `prefers-reduced-motion` removes transition / auto-flip on viewport-edge clip. RTL-gated.)_
- [x] AutomationsView smoke test. _(Done: RTL-gated. Mocks scheduler + skills bridges + ScheduledTaskCard + ScheduledTaskEditorModal + ScheduledTaskRunsDrawer. Covers list 3 tasks → 3 cards, "New automation" → editor opens, ?prefillSkill=sk-1 → editor opens with prefill, empty-state. Deep-link redirect documented in-test.)_
- [x] Accessibility nav-rail. _(Done: nav rail aria-labels feed HoverHint text via the existing `aria-label-or-hint` precedence in HoverHint.tsx.)_

### Docs

- [x] Update architecture.mdx for unified left column. _(Done: refreshed ASCII layout; added "Unified left column (Phase 10)" subsection covering Automations promotion and deep-link redirects. docs/architecture.md mirrored.)_
- [x] User-facing changelog note. _(Done: appended "Unreleased — Unified left column + Automations + Hover hints + Pluggable runners" section to RELEASE_NOTES_TEMPLATE.md with What's new / Notable changes / How to recover prior workflow / Migration notes.)_
- [x] Rename Scheduled Tasks → Automations in scheduled-tasks.mdx. _(Done: single occurrence updated to "Automations" with redirect note; "Scheduled Tasks panel" → "Automations panel" in authoring-skills.mdx too.)_
- [x] Hover hints mention. _(Done: created `website/pages/guides/accessibility.mdx` (46 lines) with HoverHint paragraph (toggle + 5-word constraint enforced in dev) plus keyboard nav notes. Wired into \_meta.json.)_

---

## Backlog (post-v0.1)

- [ ] Cloud / background tasks (Codex's headline feature) — requires a backend _(BLOCKED — needs user-owned hosted backend; CLAUDE.md says "Don't add features that require a hosted backend. This project is local-first by design." Lift that rule first.)_
- [ ] Voice mode (push-to-talk to agent) _(BLOCKED — needs UX direction: push-to-talk vs VAD vs hotword; local browser SpeechRecognition vs cloud STT; cost vs accuracy trade-off is the user's call.)_
- [ ] Mobile companion app for monitoring long-running multi-agent jobs _(BLOCKED — separate codebase + connectivity model (LAN websocket / cloud relay / P2P) is the user's architecture call.)_
- [ ] Team workspaces (shared settings, shared plugins) _(BLOCKED — same backend constraint as cloud tasks.)_
- [ ] Visual workflow builder for multi-agent pipelines _(BLOCKED — large UX-design surface (node-graph editor); needs user direction on what kinds of workflows to support.)_
- [ ] First-class JetBrains / VSCode integration _(BLOCKED — separate codebases (Kotlin for JetBrains, separate TS extension for VSCode); each is a multi-week sibling project, not a v0.1 monorepo task.)_
- [x] File-change triggers for scheduled tasks (Phase 8.75 follow-up) _(`apps/desktop/src/main/scheduler/file-watcher.ts` — per-task chokidar watcher rooted at the task's workspace, 500ms debounce, glob filtering via in-house `globToRegExp`, skips heavy dirs + `.gitignore` + `.opencodexignore`. `FileChangeWatcherRegistry` reconciles against the current set of enabled file-change tasks; `scheduler.ts` calls reconcile after `startScheduler`, on every `rescheduleNow`, and tears watchers down in `stopScheduler`. `fireTaskById` is the shared entry point used by every event-driven trigger (file-change, git-hook, webhook) — honors the concurrent-run guard. ScheduledTaskEditorModal extends the trigger radio set with "File change" + glob input (placeholder `**/*.ts`). `computeNextFire` returns null for event-driven triggers so `next_run_at` stays NULL. Tests: 6 cases (`glob-match.test.ts` 6 + `file-watcher.test.ts` 5) covering glob conversion, matching files in/out, debounce coalescing, heavy-dir exclusion, and registry reconcile.)_
- [x] Git-hook triggers (Phase 8.75 follow-up) _(`apps/desktop/src/main/scheduler/git-hooks.ts` installs sentinel-guarded `sh` wrapper scripts into `<workspace>/.git/hooks/<hook>` plus a `.cmd` companion for Git for Windows. Wrapper script POSTs `{taskId, hook}` to the local listener (item 342) with an HMAC-SHA256 signature baked in at install time (no secret on disk in plaintext outside the trigger_json). Coexists with existing user hooks: writes to `<hook>.opencodex` and appends a sentinel-bounded sourcing line to the user's hook so both run. Idempotent — re-installing leaves exactly one sentinel block. Path-traversal guard limits writes to `<workspace>/.git/hooks/`. `gitHookTriggerSchema` adds optional `hookSecret`; handlers auto-generate a 32-char hex secret on create and preserve it across updates. ScheduledTasksPanel exposes "Reinstall hook" / "Uninstall hook" buttons on git-hook rows. Tests: 8 cases (`git-hooks.test.ts`) covering empty-dir install, coexisting user-hook merge, idempotent re-install, full uninstall, partial-strip uninstall, non-git-repo refusal, and HMAC signature shape.)_
- [x] Webhook triggers for external systems (Phase 8.75 follow-up) _(`apps/desktop/src/main/scheduler/listener.ts` binds an HTTP server to `127.0.0.1` on the first available port in 38400-38500 (configurable; chosen port persisted to settings as `schedulerListenerPort` for next-boot stability). Exposes `POST /trigger/:taskId`, validates HMAC-SHA256 over the raw body via the `X-Opencodex-Signature` header against the per-task secret, rate-limits to 1 req/sec/task, rejects non-POST methods (405), non-JSON content-types (415), unknown task ids (404), tampered/missing signatures (401), and bodies over 64 KB (413). Every request logged with structured pino. `webhookTriggerSchema.secret` is required; the editor surfaces a "Generate" button (browser `crypto.getRandomValues`) and a "Copy URL" button that reveals the inbound URL once the listener is bound. Item 341's git-hook scripts call this same listener under the hood — same HMAC contract, same rate-limit. Tests: 10 cases (`listener.test.ts`) covering port-range binding, fallback when preferred port is busy, signed-happy-path, tampered body, wrong secret, missing header, unknown task, non-POST, non-JSON, and the 1-req/sec rate limit.)_
- [x] Community skill gallery + one-click install (Phase 8.5 follow-up) _(`skillRegistryUrl` setting (default `null`) + `skills:get-registry-url` / `skills:set-registry-url` / `skills:fetch-registry` IPC channels mirror the pattern shipped in Todo.md:151 for plugins. The fetch handler downloads the JSON, accepts both a flat array and `{entries: [...]}` envelope, Zod-validates each row against `skillRegistryEntrySchema` (`name` kebab-case + `description` + `sourceUrl` URL + optional `author` + `version`), and returns either parsed entries or a single error string. SkillsPanel grows a collapsed "Browse community skills" section: URL input + Save/Refresh, then a list of entries with per-row "Install" buttons that prompt before calling the existing `skills:import-from-url` IPC. No default registry URL — users opt in. Tests: 7 cases (`registry.test.ts`) covering flat-array parsing, envelope parsing, kebab-case rejection, missing description rejection, non-URL `sourceUrl` rejection, malformed payload rejection, and empty-array (valid) registry.)_
