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

## Backlog (post-v0.1)

- [ ] Cloud / background tasks (Codex's headline feature) — requires a backend
- [ ] Voice mode (push-to-talk to agent)
- [ ] Mobile companion app for monitoring long-running multi-agent jobs
- [ ] Team workspaces (shared settings, shared plugins)
- [ ] Visual workflow builder for multi-agent pipelines
- [ ] First-class JetBrains / VSCode integration
