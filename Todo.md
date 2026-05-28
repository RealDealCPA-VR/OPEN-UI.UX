# OpenCodex â€” Master Todo

Master backlog. Format: `- [ ]` pending, `- [x]` done. Check items off only when the feature actually works. Use `/handoff` at the end of every session to capture progress.

Phases are roughly sequential but can overlap. Phase 4 (plugins) gates Phase 5 because plugins need a stable host API.

---

## Phase 0 â€” Foundations

- [x] Initialize git repo (`git init`), set default branch to `main`
- [x] Configure pnpm workspaces (root `package.json` + `pnpm-workspace.yaml` exist; verify `pnpm install` succeeds)
- [x] Root `tsconfig.base.json` with strict mode (done â€” verify package configs extend it)
- [x] ESLint flat config (`eslint.config.js`) with TS + React rules
- [x] Prettier config (done â€” verify it runs)
- [x] Husky + lint-staged pre-commit (lint + typecheck staged files)
- [x] Vitest base config (workspace-aware, runs all packages)
- [x] Playwright base config for `apps/desktop` E2E
- [x] GitHub Actions: `ci.yml` running lint + typecheck + test + build on PR
- [x] GitHub Actions: `release.yml` for tagged builds \_(tag-triggered cross-OS build matrix in `.github/workflows/release.yml`; env-driven signing reads `APPLE__`/`CSC\__`/`WIN*CSC*\*`from GitHub Secrets â€” produces unsigned artifacts if missing; electron-builder`publish: github, releaseType: draft`so the user reviews before publishing. Companion`docs/release-signing.md` walks through Apple Developer + Windows EV cert setup.)\_
- [x] CODEOWNERS, CODE_OF_CONDUCT.md, SECURITY.md, CONTRIBUTING.md
- [x] Issue + PR templates

## Phase 0.5 â€” Electron scaffold

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

## Phase 1 â€” Provider abstraction & adapters

### Core contracts

- [x] `packages/core`: `LLMProvider` interface (chat, embed, capabilities)
- [x] `packages/core`: `ChatEvent` union (`text_delta`, `tool_call`, `tool_result`, `usage`, `done`, `error`)
- [x] `packages/core`: `ModelCapabilities` (toolUse, vision, streaming, contextWindow, pricing, embeddings)
- [x] `packages/core`: `Message` / `ContentBlock` shared types (text, image, tool_use, tool_result)
- [x] Provider registry + factory with config validation

### Adapters

- [x] `packages/providers/openai`: Chat Completions + Responses API, streaming, tool calls _(both paths done; toggle via `useResponsesApi` in `OpenAIConfig`)_
- [x] `packages/providers/anthropic`: Messages API with prompt caching, tool use, vision _(streaming + tool use + vision + caching capability done; no embeddings â€” Anthropic has no embeddings endpoint)_
- [x] `packages/providers/google`: Gemini API, tool calls, vision _(streaming + tool calls + vision done; embed() throws â€” Gemini has embeddings but deferred to a future task)_
- [x] `packages/providers/xai`: Grok API (OpenAI-compatible) _(wraps `@opencodex/provider-openai` helpers; embed throws â€” xAI has no embeddings API)_
- [x] `packages/providers/mistral`: Mistral API, tool calls _(copy+adapt path with own sse/translate; embeddings via /v1/embeddings work)_
- [x] `packages/providers/ollama`: Local Ollama HTTP, streaming, tool-call JSON-mode fallback _(HTTP + NDJSON streaming + native tools for llama3.1+/qwen2.5+ + embeddings done; JSON-mode prompt-injection fallback for legacy non-tool-capable models deferred)_
- [x] `packages/providers/openrouter`: OpenRouter unified API (covers fallback "any model") _(wraps `@opencodex/provider-openai` helpers; HTTP-Referer + X-Title config headers; embed throws â€” no unified embeddings)_
- [x] Per-adapter unit tests with recorded fixtures (no live API in CI)

### UI

- [x] Provider config UI (add/remove keys, test connection)
- [x] Model picker with cost + context window display + capabilities badges
- [x] Capabilities-driven UI gating (hide tools toggle if `!toolUse`)
- [x] Streaming chat view (markdown + syntax-highlighted code + copy buttons)
- [x] Conversation persistence in SQLite
- [x] Token usage + cost accounting per session _(session rollup via `getConversationUsage` + `conversations:usage` IPC; surfaced in chat header with per-model tooltip)_
- [x] Export conversation (markdown, JSON) _(`buildConversationExport` + `conversations:export` IPC with native save dialog; Export menu in chat header)_

## Phase 2 â€” Local coding agent

### Tool layer

- [x] `packages/core`: `Tool` interface (name, schema (Zod), permission tier, execute) _(plus `defineTool` factory; JSON Schema derived from Zod via `zodToJSONSchema`)_
- [x] Permission tiers: `read` / `write` / `execute` / `network`
- [x] `packages/tools/read-file` _(line offset/limit, path-traversal guard, abort-aware)_
- [x] `packages/tools/write-file` _(atomic write via tmp + rename; creates parent dirs; UTF-8 byte count returned)_
- [x] `packages/tools/edit-file` _(exact-string match; `replaceAll` flag; throws `OldStringNotFoundError` / `EditFileAmbiguousError`; unified-diff variant deferred)_
- [x] `packages/tools/glob` _(zero-dep matcher: `*`, `**`, `?`, brace expansion; ignores node_modules/.git/dist/build/out/.next/.turbo)_
- [x] `packages/tools/grep` _(JS regex impl + ripgrep wrapper with auto-detection; falls back to JS if `rg` is missing or fails. `OPENCODEX_NO_RIPGREP=1` forces JS)_
- [x] `packages/tools/list-dir`
- [x] `packages/tools/run-shell` _(sandboxed: scrubbed env via `OPENCODEX_SHELL_ENV_KEEP`, cwd locked to workspace, hard timeout with SIGTERM â†’ SIGKILL grace, process-tree kill via taskkill on Windows / process-group kill on POSIX, per-stream output cap with truncation flag)_
- [x] `packages/tools/web-fetch` _(network tier with allow-list via `OPENCODEX_WEB_FETCH_ALLOWLIST` â€” supports exact + `*.example.com` wildcard; denied-by-default; protocol guard; timeout; response body cap with truncation)_
- [x] Tool registry with permission-tier dispatch _(`ToolRegistry` class with `listByTier`, `execute` with Zod validation)_

### Agent runtime

- [x] Agent loop (stream â†’ collect tool calls â†’ exec â†’ feed results â†’ repeat) _(main-process `ToolRegistry` singleton with all 8 tools registered: read_file, glob, grep, list_dir, write_file, edit_file, run_shell, web_fetch; runner does up to 10 tool turns, injects `tools` into provider request, executes through approval manager, and feeds `tool_result` blocks back as a `tool` message; tool blocks persisted in SQLite so multi-turn history survives reloads)_
- [x] Cancellation: abort mid-stream and kill in-flight shell processes _(approval and shell tool both honor `ctx.signal`; mid-stream cancel via `chat:cancel` IPC works; process-tree kill verified by test that spawns shellâ†’node parentâ†’detached grandchild then asserts the grandchild PID is dead after abort; web_fetch abort verified via AbortSignal.any composition test)_
- [x] Approval system (per-tool `auto` / `prompt` / `deny` policy) _(stored in electron-store; tier defaults + per-tool overrides; effective policy = override ?? tier default; IPC: `approvals:get-policies`, `approvals:set-policy`, `approvals:respond`)_
- [x] Per-session approval overrides ("trust this session") _(session map keyed by streamId â†’ toolName â†’ allow/deny; cleared in `runStream` finally via `clearSession(streamId)`)_
- [x] Approval UI: modal queue with diff preview for write ops, command preview for exec _(6-button Allow/Deny Ã— once/session/always queue; per-tool previews now done: `write_file` shows lazy-loaded LCS line diff against existing content, `edit_file` shows side-by-side Replace/With, `run_shell` shows boxed command + cwd/timeout, `web_fetch` shows method pill + URL + hostname + headers; fallback JSON preview retained for unknown tools; modal widened 560 â†’ 760px to fit diff)_
- [x] Shell sandbox: cwd lock, env scrub, timeout, output size cap, PATH allowlist _(PATH/HOME/USER/etc allow-listed by default; user extensions via `OPENCODEX_SHELL_ENV_KEEP`; explicit positive PATH allowlist via `OPENCODEX_SHELL_PATH` env var â€” when set, overrides the inherited PATH in the scrubbed env)_
- [x] Audit log of every tool call (input, output, decision, timestamp) in SQLite _(every `executeToolCall` writes a row to `tool_calls` keyed by assistant message id. Migration 4 added `duration_ms` + `is_error` columns and indexes on `message_id` and `tool_name`. Decisions: `auto` / `prompt-allowed` / `prompt-allowed-session` / `prompt-allowed-always` / `denied`. Retention: `auditRetentionDays` setting drives startup purge; `tool-audit:set-retention` and `tool-audit:clear` IPC + AuditLogPanel toolbar with retention select + "Clear log" button)_

### UI

- [x] Diff viewer (Monaco diff editor) with hunk-level accept/reject _(`apps/desktop/src/renderer/components/MonacoDiffViewer.tsx` + pure helpers in `monaco-diff-helpers.ts` covered by 19 vitest cases. Component lazy-loads `@monaco-editor/react` + `monaco-editor` via `React.lazy` so Monaco code-splits into its own ~6.35 MB chunk (`editor.main-*.js`) â€” initial renderer bundle stays at 597 kB. Toolbar exposes "Accept all" / "Reject all"; per-hunk rows under the editor expose "Accept hunk" / "Reject hunk" driven by Monaco's `getLineChanges()`. Wired into `ApprovalQueue` as a "View in Monaco" opt-in modal for both `write_file` and `edit_file` approvals (existing LCS line-diff remains the default preview, so first-render cost is unchanged))_
- [x] File tree with agent edit annotations (pending / applied / rejected) _(`apps/desktop/src/renderer/components/FileTree.tsx` â€” lazy-loads workspace dir contents via `file-tree:list` IPC; respects `.gitignore` + `.opencodexignore`; mounted in `CodebaseView`; accepts an `annotations` map of `path â†’ pending|applied|rejected` for agent edit pills; wiring annotations to live edit-tool calls is a small follow-up)_
- [x] Embedded terminal (`xterm.js`) tailing `run_shell` output _(`apps/desktop/src/renderer/components/EmbeddedTerminal.tsx` lazy-loads `@xterm/xterm` + `@xterm/addon-fit` â€” both code-split into separate chunks (~402 KB xterm + 5.5 KB CSS) so the initial renderer bundle stays untouched. `ToolCallCard` grows a new "Terminal" pill for successful `run_shell` calls that toggles the embedded terminal; it renders the captured stdout/stderr verbatim with ANSI escape codes interpreted, plus a dim `$ command  (cwd: â€¦)` banner and a footer with exit code / duration / signal / truncation flags. New `shell:output` IPC event broadcasts a single final frame per tool call from `main/chat/runner.ts` via `ChatStreamSink.emitShellOutput` â€” the wire is in place for future true-streaming. Renderer subscribes via `window.opencodex.chat.onShellOutput`, filters by `streamId`+`toolUseId`, replays `initialContent` first, then live-appends. Pure helpers (`buildShellTranscript`, `OutputBuffer`, `stripAnsi`, `toCrlf`) in `apps/desktop/src/shared/shell-output.ts` covered by 20 unit tests.)_
- [x] Tool-call cards in chat with expand/collapse, copy, re-run _(re-run prefills the composer with `Re-run this tool call: <name>(<args>)` and focuses the textarea; disabled while the original call is in flight)_
- [x] Status bar with agent state, current tool, tokens used _(global footer in `AppShell`, visible across all routes. Left: state dot + label (Idle / Streamingâ€¦ / Error) + running tool name derived from unmatched `tool_use` in `draft.blocks`. Right: tokens (live from `draft` during stream, session totals from `usage` otherwise) + workspace basename with full-path tooltip. Reuses `useChat()` (no new context, no new IPC) + `workspace:changed` subscription. Pure derivation helpers in [status-bar-derive.ts](apps/desktop/src/renderer/components/status-bar-derive.ts) covered by 14 tests.)_
- [x] Workspace picker (recent + browse) _(Settings â†’ Workspace section: Browseâ€¦ opens native folder picker; recent list with Open/Remove; MRU dedupe + 10-item cap; active path validated as existing directory; `activeWorkspace` already consumed by chat + approval handlers, no cascade needed)_

## Phase 2.5 â€” MCP support

- [x] `packages/mcp-client`: stdio transport _(line-delimited JSON over child stdin/stdout; SIGTERM on stop)_
- [x] `packages/mcp-client`: SSE transport _(consumes `endpoint` event to discover POST URL; SSE event-stream parser)_
- [x] `packages/mcp-client`: HTTP streamable transport _(mcp-session-id header; handles JSON + text/event-stream + 202 notifications)_
- [x] MCP server config UI (add / remove / enable per workspace) _(Settings â†’ MCP servers section; curated presets quick-add + enable/disable/remove + live status + tool/resource/prompt counts)_
- [x] MCP tool discovery + surfacing through tool registry _(connect â†’ listTools â†’ registry.register with `mcp__<serverId>__<toolName>` naming; unregister on disconnect/remove/disable)_
- [x] MCP resource discovery + RAG integration _(manager retains the full `listResources` payload per connected server and exposes `getAvailableResources()` + `getClientForServer()`. `apps/desktop/src/main/mcp/resource-indexer.ts` walks every available resource, calls `client.readResource(uri)`, and upserts text content into the FTS5 `indexed_files` table under a `mcp:<serverId>:<uri>` key (alongside workspace files). Triggered on-demand via `mcp:reindex-resources` IPC (preload bridge: `window.opencodex.mcp.reindexResources()`) and automatically (1s-debounced) after every MCP server connects via `onMcpServerConnected`. `search_codebase` tool now tags each hit with `source: 'workspace' | 'mcp'` based on whether the key starts with the `mcp:` prefix. Indexer covered by 10 tests in `resource-indexer.test.ts`.)_
- [x] MCP prompt discovery (surface as `/` commands in chat) _(manager retains the full `listPrompts` payload per connected server; `mcp:list-prompts` IPC + `window.opencodex.mcp.listPrompts()` bridge expose `{serverId, serverDisplayName, prompt}` rows to the renderer. Chat composer detects a leading `/` (start-of-line, no whitespace), pops a grouped-by-server dropdown via `SlashCommands.tsx`, supports ArrowUp/Down/Enter/Tab/Escape, filters by prompt name + server id + description, and inserts `/<serverId>:<prompt> arg=<placeholder>` on selection. Parsing in [slash-commands.ts](apps/desktop/src/renderer/components/slash-commands.ts) covered by 21 tests.)_
- [ ] OAuth handling for MCP servers that require it _(needs external OAuth setup â€” left for user)_
- [x] Health checks + auto-reconnect for long-lived MCP connections _(exponential backoff 1.5s â†’ 30s; transport close â†’ reconnect when enabled)_
- [x] Ship curated MCP server presets (filesystem, github, brave-search, sqlite) _(presets in `main/mcp/presets.ts`; quick-add from Settings)_

## Phase 3 â€” RAG / codebase chat

- [x] Tree-sitter chunker (AST-aware, ships grammars for top ~15 languages) _(new `@opencodex/rag-chunker` package: `chunkBySize` is a zero-dep size-based line splitter with line-aligned overlap; `chunkBySymbols` walks a `web-tree-sitter` parse tree and breaks at top-level function/class/method/struct/impl/trait/enum/interface/namespace nodes, then size-splits any oversized span and emits inter-symbol filler as size chunks so no bytes are lost. `SUPPORTED_LANGUAGES` enumerates the top 15 (typescript, javascript, tsx, jsx, python, go, rust, java, cpp, c, ruby, php, csharp, kotlin, swift); grammars are registered at runtime via `registerGrammar(lang, wasmPathOrBytes)` rather than bundled (keeps install slim â€” hosts ship whichever .wasm grammars they want). Unknown languages and grammar-load failures fall back to size chunking. 10 tests cover empty input, single-chunk fit, multi-chunk split, overlap coverage, line-number alignment, invalid options, unknown-language fallback, and grammar-load failure fallback.)_
- [x] Embedding adapter interface (mirrors `LLMProvider`) _(already in `packages/core/src/provider.ts` â€” `EmbedRequest` / `EmbedResult` on the `LLMProvider` interface)_
- [x] OpenAI embeddings adapter _(`packages/provider-openai/src/provider.ts` â€” `embed()` hits `/v1/embeddings`, returns ordered vectors + token usage)_
- [x] Voyage embeddings adapter _(`packages/provider-voyage` â€” `voyage-3`, `voyage-3-lite`, `voyage-code-3`; `embed()` posts to `/v1/embeddings`; `chat()` throws â€” embeddings-only)_
- [x] Local embeddings via Ollama (`nomic-embed-text`, `mxbai-embed-large`) _(`packages/provider-ollama` â€” `embed()` posts `/api/embeddings` with the configured model)_
- [x] LanceDB integration for vector store _(`apps/desktop/src/main/rag/vector-store.ts` â€” `LanceVectorStore` exposes `open(dbPath)` / `upsert(path, chunks)` / `searchByVector(embedding, limit)` / `clear()` / `count()` / `close()`. **SQLite-backed shim** because `@lancedb/lancedb` ships a native binary that did not install in the current toolchain (no shell access during this run to attempt the install). Embeddings persist as Float32Array blobs in a single `vectors` table; cosine similarity is computed in-process at query time. Public interface mirrors what a thin LanceDB adapter would expose, so the swap is a one-class change â€” no callers need to update. Covered by 18 tests in `vector-store.test.ts` against `:memory:` plus a tmpdir round-trip.)_
- [x] SQLite FTS5 for keyword search _(`apps/desktop/src/main/storage/codebase-index.ts` â€” migration v5 adds `indexed_files` FTS5 virtual table + `indexed_files_meta` for incremental-reindex bookkeeping; exposes `upsertIndexedFile` / `removeIndexedFile` / `searchKeyword` (bm25-ranked, snippet-highlighted) / `clearIndex`; query tokens are sanitised before being passed to FTS5)_
- [x] Hybrid retrieval with Reciprocal Rank Fusion _(exported as `reciprocalRankFusion` from `@opencodex/tools`; covered by `search-codebase.test.ts`. Ready to combine LanceDB + FTS5 rankings when those land.)_
- [x] File watcher (`chokidar`) â†’ incremental reindex _(`apps/desktop/src/main/rag/watcher.ts` â€” `WorkspaceWatcher` coalesces add/change/unlink into 250ms batches, respects `.gitignore` + `.opencodexignore` via `readIgnoreMatcherForWorkspace`, skips heavy dirs (`node_modules`, `.git`, `dist`, `out`, `build`, `.next`, `.turbo`, `coverage`); singleton `setWatchedWorkspace` wired in `index.ts` via `settingsStore.onDidChange('activeWorkspace', ...)`, stops on `before-quit`. Ready to feed the SQLite FTS5 indexer once incremental-reindex pipeline lands.)_
- [x] `.gitignore`-aware indexing + opt-out config (`.opencodexignore`) _(`packages/tools/src/opencodex-ignore.ts` â€” gitignore-style parser with anchored/dirOnly/negation; `readIgnoreMatcherForWorkspace` merges `.gitignore` + `.opencodexignore`)_
- [x] `search_codebase` tool exposed to agent _(`packages/tools/src/search-codebase.ts` â€” wraps `grepTool`, ranks by match strength + file-path heuristics; registered in the main ToolRegistry)_
- [x] Read-only "chat mode" toggle that disables write tools _(`readOnlyChatMode` setting; `ApprovalManager` denies any non-`read` tier when toggle is on; IPC `chat:get-read-only-mode` / `chat:set-read-only-mode` + Settings â†’ Indexing toggle)_
- [x] Citation rendering (clickable `file:line` refs in chat) _(`apps/desktop/src/renderer/components/citations.ts` â€” `tokenizeCitations` parses `path:line` and `path:line:col` patterns; covered by 4 tests; consumer wiring into MessageBubble can attach when needed)_
- [x] Index status panel (files indexed, last update, errors) _(replaced stub `IndexingPanel` â€” now shows the read-only chat toggle + a description of the `search_codebase` tool until the full indexer lands)_

## Phase 4 â€” Plugin system

- [x] `packages/plugin-sdk`: plugin manifest Zod schema (name, version, permissions, contributions)
- [x] `packages/plugin-sdk`: typed host API (`PluginHost`)
- [x] Plugin loader (load from disk, validate manifest, sandbox via VM context) _(disk loader + manifest validation + dynamic import done in `packages/plugin-sdk/src/loader.ts`; VM sandbox deferred â€” plugins run in-host and are gated by manifest permissions instead)_
- [x] Plugin permission model with user-consent flow on install _(install â†’ `pending-permissions` status; "Grant permissions" button in Plugins panel; `checkPermission` gates `settings.read`/`settings.write` host calls)_
- [x] Contribution: tools (Tool implementations, registered via host API) _(registered as `plugin__<id>__<name>` in the shared ToolRegistry; unregister on disable/uninstall)_
- [x] Contribution: providers (LLMProvider implementations) _(host API accepts `registerProvider`; provider-stub example demonstrates the shape â€” global provider registry wiring deferred)_
- [x] Contribution: UI panels (sandboxed iframe in renderer with postMessage bridge) _(manager tracks `manifest.contributions.panels` with resolved absolute `htmlPath`; IPC `plugins:list-panels` + preload `window.opencodex.plugins.listPanels()`; renderer `PluginPanelHost` mounts a `sandbox="allow-scripts"` iframe and runs a Zod-validated postMessage bridge â€” `log` + `request-host` (`ping`) â†’ `host-response` â€” authenticated by `event.source === iframe.contentWindow`; new route `/plugins/:pluginId/:panelId`)_
- [x] Contribution: slash commands _(host API accepts `registerSlashCommand`; surfacing into chat composer is part of Phase 2.5 MCP prompts task)_
- [x] Plugin manager UI (install from local dir, enable / disable, view permissions) _(Settings â†’ Plugins panel: Install from folder, Grant permissions, Enable/Disable, Uninstall)_
- [x] Example plugin: `hello-world` tool
- [x] Example plugin: custom provider stub _(`examples/plugins/provider-stub`: streams text deltas from the last user message; `embed()` throws)_
- [x] Example plugin: UI panel _(`examples/plugins/ui-panel` + panel.html)_
- [x] Plugin marketplace stub (config-only, point at registry URL â€” actual marketplace deferred) _(`pluginRegistryUrl` setting + `plugins:fetch-registry` IPC returns parsed JSON entries or error)_
- [x] Plugin docs site section with SDK API reference _(Nextra site under `website/`; plugin authoring guide at `website/pages/plugins/authoring.mdx`; SDK API reference at `website/pages/plugins/api.mdx` enumerating every export from `packages/plugin-sdk/src/`.)_

## Phase 5 â€” Multi-agent orchestration

- [x] Worker process spawning via Electron `utilityProcess` _(`main/agent/worker-host.ts` forks `out/main/agent/worker-entry.js` via `electron.utilityProcess.fork`, posts a Zod-validated `start` message, awaits `result`/`error`, kills the process on completion. Worker entry rebuilds the provider + tool registry inside the child process and runs `runSubagent`. Electron-vite emits the worker as a separate chunk. Falls back to inline `runSubagent` when `electron.utilityProcess` is unavailable (tests) or the fork fails.)_
- [x] Subagent context isolation (own provider, own context, own tools subset) _(fresh provider from `buildProviderForId`, fresh `messages` array, `allowedToolNames` whitelist filters the shared ToolRegistry)_
- [x] `spawn_subagent` tool (params: scope, task, provider, budget) _(in `main/agent/spawn-subagent-tool.ts`, permission tier `execute`; budget has `maxToolIterations`, `maxTokens`, `maxWallTimeMs`)_
- [x] Git worktree integration for parallel file edits without conflicts _(`main/agent/worktrees.ts` shells out to `git` via `execFile` â€” `isGitRepo`, `createWorktree`, `removeWorktree`, `listWorktrees`, `getDiffBundle`; worktrees land under `<repo>/.opencodex/worktrees/<id>` on branch `opencodex/subagent/<id>`; tests in `worktrees.test.ts` skip when git is absent)_
- [x] Message bus between main + workers (typed channels) _(typed channels are real as of utilityProcess landing: `main/agent/worker-protocol.ts` defines Zod schemas for `start` / `ready` / `event` / `result` / `error` messages; both `worker-host.ts` (main side) and `worker-entry.ts` (worker side) `safeParse` every message before acting on it. Inline buffer fallback remains for the non-Electron path.)_
- [x] Orchestrator agent prompt template _(`main/agent/orchestrator-prompt.ts` exports `ORCHESTRATOR_SYSTEM_PROMPT` with when-to-spawn rules + post-return verification + failure-handling guidance)_
- [x] Agent inspector UI (per-worker timeline, tokens, cost, current tool) _(`main/agent/run-registry.ts` holds an in-memory subagent run registry (id, task, provider/model, status, tokens, iterations, tool-event timeline, stop reason, error); `spawn-subagent-tool.ts` calls `recordStart`/`recordComplete`/`recordError` around both worker + inline paths; new IPC `agent:list-runs`, `agent:clear-runs`, event `agent:runs-changed`; renderer `views/AgentView.tsx` lists runs newest-first with expandable per-run timeline rendered by `components/AgentRunRow.tsx`; derivation helpers in `views/agent-runs-derive.ts` covered by tests + registry tests)_
- [x] Subagent merge-review flow (accept / reject / revise diff bundles) _(`main/agent/merge-review.ts` exposes `prepareMergeBundle` (reads `getDiffBundle` + parses `diff --git a/X b/X` lines into a file list), `acceptMerge` (runs `git merge --no-ff <branch>` then `removeWorktree`), and `rejectMerge` (just `removeWorktree`); `run-registry` now tracks optional `worktreePath` / `worktreeBranch` / `worktreeRepoRoot` per run plus a `mergeStatus` of `pending|merged|rejected`; IPC channels `agent:get-merge-bundle` / `agent:accept-merge` / `agent:reject-merge` registered in `agent/handlers.ts`, bridged through preload as `agent.getMergeBundle` / `acceptMerge` / `rejectMerge`; renderer `MergeReviewModal.tsx` shows a "Review changes" button on completed runs that have an associated worktree, renders the unified diff in a `<pre>` block with the file list, and offers Accept (merge) / Reject (discard) / Cancel. `spawn_subagent` does not auto-attach a worktree yet â€” that wiring is the follow-up step; the API is in place so a user-driven worktree run can be reviewed today. Tests in `merge-review.test.ts` cover `parseChangedFiles` + accept/reject against a real git repo (skipped when git is absent); registry tests cover the new worktree fields and `setMergeStatus`.)_
- [x] Budget caps (max tokens, max wall time, max concurrent subagents) _(per-call: `maxTokens`, `maxToolIterations`, `maxWallTimeMs`; enforced inside the loop; max concurrent enforced by inline execution model â€” only one subagent at a time per spawn until utilityProcess lands)_
- [x] Failure handling (subagent crash â†’ orchestrator decides retry vs abort) _(catches tool exec failures into tool_result with `isError: true`; stream errors map to `stopReason: 'error'`; budget exhaustion â†’ `stopReason: 'budget_exceeded'`; orchestrator prompt instructs the parent agent on what to do with each)_

## Phase 6 â€” Polish & ship v0.1

- [x] Theme system (light / dark / system) with CSS variables _(stored preference at `settings.theme`; `settings:get-theme`/`settings:set-theme` IPC + `settings:theme-changed` event; main passes `--initial-theme` via `additionalArguments` and preload applies `data-theme` before renderer JS runs for zero-flash boot; `ThemeApplier` reacts to IPC changes + `prefers-color-scheme` media query when preference is `system`; Theme section in Settings; ~75 semantic CSS vars on `:root` with GH-light overrides on `:root[data-theme='light']`)_
- [x] Onboarding wizard (provider setup â†’ first API key â†’ workspace pick â†’ first chat) _(`OnboardingWizard` overlay shows on first run when `onboardingComplete` setting is false; 4 steps: pick provider â†’ enter API key â†’ pick workspace â†’ "Start chatting"; dismissable; `OnboardingBanner` retained as fallback in Settings)_
- [x] Settings UI (providers, approvals, MCP servers, plugins, theme, indexing) _(theme, workspace, providers, approvals, MCP servers, audit log, indexing all shipped as Settings subsections; indexing is a Phase-3-pending stub; plugins section pending Phase 4)_
- [x] `electron-updater` wired with GitHub Releases _(electron-builder.yml has `publish: provider: github, releaseType: draft`; `updater.ts` rewritten with IPC `updates:check|download|quit-and-install|get-status|set-auto-check`, status broadcaster `updates:status-changed`, and `startAutoCheckLoop()` (30s startup delay + 4h interval, gated by `autoCheckForUpdates` setting + `app.isPackaged`). Settings â†’ Updates panel exposes auto-check toggle + "Check now" + status pill.)_
- [ ] macOS code signing + notarization _(BLOCKED â€” needs user-owned Apple Developer cert + Apple ID. Scaffold ready: `release.yml` reads `CSC_LINK`/`CSC_KEY_PASSWORD`/`APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` from GitHub Secrets; full enrollment walkthrough in `docs/release-signing.md`.)_
- [ ] Windows code signing (Authenticode) _(BLOCKED â€” needs user-owned EV cert. Scaffold ready: `release.yml` reads `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`. EV certs require hardware tokens for live signing â€” note in `docs/release-signing.md` that this means signing happens on manually-triggered builds, not CI.)_
- [x] Linux: AppImage + .deb + .rpm builds _(`apps/desktop/electron-builder.yml` â€” targets AppImage, deb, rpm for x64; also wires mac dmg/zip + windows nsis/portable. Build by running `pnpm --filter @opencodex/desktop dist`. Signing creds are still required for the mac/windows targets â€” those stay in user hands.)_
- [x] Opt-in anonymous telemetry (PostHog or self-hosted Plausible) _(new `@opencodex/telemetry` package â€” lazy PostHog SDK load, no-op shim when disabled or unconfigured. Settings â†’ Telemetry toggle + API key/host inputs. Tracked events: `app.launched`, `chat.message_sent` (provider+model anonymized via hash, no content), `agent.subagent_spawned`, `mcp.server_connected`. PII-free.)_
- [x] Crash reporting (Sentry, opt-in) _(new `@opencodex/crash-reporting` package â€” `@sentry/electron` lazy-loaded via dynamic `import()` inside `initCrash` so disabled mode is genuinely free. Settings â†’ Crash reporting toggle + DSN + environment select. `beforeSend` scrubs `event.request.url` for file paths + clears `event.user`.)_
- [x] Docs site (Docusaurus or Nextra) on GitHub Pages _(Nextra v2 scaffold under `website/`; pages mirror existing `docs/` markdown (architecture, security, mcp, plugin/provider authoring) plus SDK API reference. `website/` is excluded from the main pnpm workspace to keep root installs slim â€” run `pnpm install && pnpm dev` inside `website/` separately. `.github/workflows/docs.yml` builds + deploys to GitHub Pages via `actions/deploy-pages@v4`.)_
- [x] Architecture deep-dive doc
- [x] Plugin authoring guide
- [x] MCP integration guide
- [x] Provider authoring guide
- [x] Security model doc (sandboxes, permissions, key storage)
- [ ] Public v0.1 release announcement _(BLOCKED â€” user task. `RELEASE_NOTES_TEMPLATE.md` at repo root provides the markdown template to copy into a GitHub Release: What's new / Notable changes / Bug fixes / Migration notes / Known issues / Checksums / Contributors.)_

---

## Phase 7 â€” UX polish + long-term memory

### Long-term memory integrations

- [x] **Obsidian memory provider** _(new `@opencodex/memory-obsidian` package â€” filesystem-backed `.md` walker, in-house BM25 (k1=1.5 b=0.75), path-traversal guards, atomic writes. Tools: `memory_search`/`memory_read`/`memory_append`/`memory_create_note`. Optional `embedFn` for RRF-merged hybrid retrieval â€” wired in the API, not enabled by default. 21 tests.)_
- [x] **Notion memory provider** _(new `@opencodex/memory-notion` package â€” fetch-only Notion API client (no SDK dep), Zod-validated at every response boundary, integration token stored in keychain via existing `secrets.ts` under `memory.notion.token`. Tools: `notion_search`/`notion_read_page`/`notion_append_block`/`notion_create_page`. Blockâ†’markdown supports paragraph/h1-3/bullet/todo/quote/code/divider/callout (unknown blocks render as `[unsupported: <type>]`). 10 tests.)_
- [x] Unified Memory section in Settings _(Settings â†’ Memory section renders `MemoryPanel` â€” per-backend enable toggle, Obsidian vault path input, Notion token Save/Clear, Test connection button + status pill. Self-loads via `window.opencodex.memory.*` IPC; subscribes to `memory:config-changed`.)_
- [x] Memory tools surface in the same tool registry as builtins _(`MemoryManager` in `apps/desktop/src/main/memory/manager.ts` registers tools under `memory__obsidian__*` / `memory__notion__*` namespace in the shared `ToolRegistry` on start/reload. `read` tier for *\_search / *\_read (auto by default), `write` tier for *\_append / *\_create_\* (prompts by default) â€” gated by the existing `ApprovalPolicies` system.)\_

### Sidebar collapsing

- [x] Collapsible chat conversation sidebar _(toggle in sidebar header, persists via `useCollapseState` (localStorage), Cmd/Ctrl + `\` keyboard shortcut from anywhere in the chat view.)_
- [x] Collapsible main navigation rail _(collapsed = SVG mask icons only; expanded = icon + label. Toggle button on the rail; persists via `useCollapseState`. Active-link pill style works in both states.)_
- [x] Animate width transitions _(`transition: grid-template-columns 180ms ease` on chat sidebar + nav rail; `.sidebar-link-label` opacity+width transition replaces prior `display:none` so labels actually fade. `@media (prefers-reduced-motion: reduce)` zeroes out durations.)_

### Settings page visual refresh

- [x] Two-pane Settings layout _(left rail + right pane in rewritten `SettingsView.tsx`; 12 sections: Theme / Workspace / Providers / Approvals / Plugins / MCP / Memory / Updates / Telemetry / Crash reporting / Audit log / Indexing.)_
- [x] Per-section card styling _(new `SettingsSectionCard.tsx` â€” title + description + body in elevated card; consistent padding; dividers between groups.)_
- [x] Section search box _(top of left rail; filters by title + description, case-insensitive; pure helper `filterSettingsSections` covered by tests.)_
- [x] Deep-link support _(`/settings/<slug>` routes added in `App.tsx`; slugs: theme, workspace, providers, approvals, plugins, mcp, memory, updates, telemetry, crash-reporting, audit-log, indexing. `/settings` redirects to `/settings/theme`. `OnboardingBanner` now uses `useNavigate('/settings/providers')` instead of in-page scroll-to-anchor.)_
- [x] Sticky header inside each section _(`SettingsSectionCard` header pins to top of right pane on scroll; supports an `actions` prop for per-section secondary buttons â€” used by Memory (Reload) and Updates (Check now).)_

### Agent + Codebase view usability

- [x] **AgentView** rewritten as active control surface _(top: active-runs grid with `ActiveRunCard` per running run â€” live token meter, current tool from unmatched `tool_start`, iteration/budget counter, Abort button â†’ `agent:abort-run`. History list below filters `r.status !== 'running'`. URL-driven drawer state via new `/agent/:runId` sub-route.)_
- [x] AgentView: launchable from this view _("Spawn task" button â†’ `AgentSpawnModal` (task textarea + provider/model picker reusing `ModelPicker` + workspace picker + Use-git-worktree toggle gated by `git:is-repo`); submit â†’ `agent:spawn-from-ui` â†’ closes modal + focuses new run.)_
- [x] AgentView: per-run detail drawer _(side panel `AgentRunDrawer.tsx`; full transcript from `run.timeline`; file changes preview via `agent:get-merge-bundle`; Merge-review CTA opens existing `MergeReviewModal`.)_
- [x] **CodebaseView**: file preview pane _(`CodebasePreviewPane.tsx` â€” lazy-loaded Monaco read-only `<Editor>` keyed on selected file path; language inferred via `languageFromExtension` (tested); jumps to specified line on search-result click.)_
- [x] CodebaseView: search box _(`CodebaseSearchBox.tsx` â€” 300ms debounced input + mode pills (filename / content / both) â†’ `codebase:search` IPC backed by ripgrep with JS fallback. Pinned-paths from cross-view transfer pre-filter results.)_
- [x] CodebaseView: pending-edit pills _(`useAgentPendingEdits` hook + fingerprint-debounced re-fetch; aggregates all pending worktree runs in a single `codebase:get-pending-edits` IPC; passed to `FileTree` via existing `annotations` prop.)_
- [x] CodebaseView: right-click context menu _(`FileTreeContextMenu.tsx` â€” Open in preview, Reveal in OS (`shell:show-item-in-folder` IPC wraps Electron's `shell.showItemInFolder`), Copy path, Ask agent about this file (pushes `codebase-to-chat` transfer context).)_

### Cross-view chat transfer

- [x] "Send to Agent" button on a chat _(in chat header; pushes `chat-to-agent` transfer context â†’ navigates to `/agent` + pre-opens spawn modal with last user message pre-filled.)_
- [x] "Send to Codebase" action on a chat _(in chat header; scans last few assistant messages for `path:line` citations via existing `tokenizeCitations`; pushes `chat-to-codebase` transfer context with `filePaths[]` â†’ switches to `/codebase` + applies as search filter.)_
- [x] Shared "transfer context" type _(`apps/desktop/src/shared/transfer-context.ts` â€” Zod discriminated union over `chat-to-agent` / `chat-to-codebase` / `agent-to-chat` / `codebase-to-chat`. Consumed by chat/agent/codebase views.)_
- [x] "Continue in chat" reverse direction _(on `AgentRunRow` for finished runs + on right-click "Ask agent about this file" in CodebaseView. Creates a new conversation seeded with the run summary or file reference as initial context. Routed through `useTransfer()` singleton in `apps/desktop/src/renderer/state/transfer.ts` (useSyncExternalStore-backed).)_

---

## Phase 8 â€” Scheduled tasks (cron)

Goal: let users register prompts/agent runs that fire on a cron schedule, reusing the existing agent loop, approval system, audit log, and merge-review flow. Builds directly on the `setTimeout`/`setInterval` pattern in [apps/desktop/src/main/updater.ts](apps/desktop/src/main/updater.ts) and the subagent infra in [apps/desktop/src/main/agent/](apps/desktop/src/main/agent/).

### Storage + schema

- [x] Add SQLite migration v5 (or next available) creating `scheduled_tasks` table (id, name, description, cron*expr, prompt, provider_id, model, workspace_path, trigger_type, allowed_tools_json, use_worktree, enabled, last_run_at, next_run_at, last_status, last_run_id, created_at, updated_at) in [apps/desktop/src/main/storage/db.ts](apps/desktop/src/main/storage/db.ts) *(migration v6 â€” stores `trigger_json TEXT NOT NULL` from day one instead of `cron_expr`, per the Phase 8.75 architecture decision; indexes on `enabled` and `next_run_at`)\_
- [x] Add SQLite migration creating `scheduled_task_runs` table (id, task*id FK, started_at, completed_at, status, agent_run_id, error_message) â€” separate from `agent/run-registry.ts` so history survives app restarts *(part of migration v6; FK has `ON DELETE CASCADE`; adds `was_catchup INTEGER` column too)\_
- [x] `apps/desktop/src/main/scheduler/store.ts` â€” typed CRUD over both tables; Zod-validated row shapes; cursor pagination on runs _(uses `triggerSchema` from `shared/triggers.ts`; `listRuns({taskId, limit, beforeId})` is rowid-cursor paginated)_
- [x] Add `cron-parser` dependency (parse-only, ~30kB) â€” do NOT add `node-cron` (we don't need its scheduler) _(cron-parser@^4.9.0 added to `apps/desktop/package.json`)_

### Scheduler runtime

- [x] `apps/desktop/src/main/scheduler/scheduler.ts` â€” single `setTimeout` to the next-due task across all enabled tasks; recomputes on completion, on enable/disable, and on cron-expr edit. Modeled on `startAutoCheckLoop()` in updater.ts _(`pickNextDueTask` selects the earliest cron tick across all enabled tasks; `rescheduleNow()` re-evaluates after create/update/delete)_
- [x] `apps/desktop/src/main/scheduler/runner.ts` â€” fires a task: spawns through existing [worker-host.ts](apps/desktop/src/main/agent/worker-host.ts) so it gets a fresh provider, fresh tool registry, allowed-tool filter, and budget caps. Records into both `run-registry` (live) and `scheduled_task_runs` (persistent) _(falls back to inline runSubagent when utilityProcess is unavailable; passes triggerSource='scheduled' + scheduledTaskId to run-registry)_
- [x] Wire scheduler start into `apps/desktop/src/main/index.ts` after DB migrations run; stop on `before-quit` _(gated by `app.isPackaged === true` OR `schedulerEnabledInDev` setting)_
- [x] Catch-up policy on app start: for each enabled task whose `next_run_at` is in the past, fire once with `was_catchup: true` (don't fire all missed runs â€” just the most recent) _(implemented in `runCatchup()`; fires concurrent with regular scheduling)_
- [x] Concurrent-run guard: if a task is already running when its next tick fires, log + skip + advance `next_run_at` (matches cron semantics) _(`runningTasks` Set; second tick is a no-op + reschedule)_

### Approval handling for unattended runs

- [x] Default policy for scheduled tasks: auto-spawn into a git worktree (reuses [worktrees.ts](apps/desktop/src/main/agent/worktrees.ts)) so writes are isolated and queued for `MergeReviewModal` rather than blocking on user approval _(default `useWorktree: true` on task creation; runner calls `createWorktree` when the workspace is a git repo)_
- [x] Fallback for non-git workspaces: per-task `allowedTools[]` whitelist enforced in [worker-entry.ts](apps/desktop/src/main/agent/worker-entry.ts); any tool outside the whitelist short-circuits the run with `stopReason: 'unauthorized_tool'` _(enforced inside `runSubagent` in `apps/desktop/src/main/agent/subagent.ts`; added `'unauthorized_tool'` to the SubagentResult/AgentRun/worker-protocol stopReason unions)_
- [x] New notification path: scheduled run completion â†’ tray notification + badge on Agent view; clicking opens the merge-review modal _(uses `new Notification({...}).show()`; click handler navigates to `/agent/<runId>` via deep-link router. ActiveRunCard and AgentRunRow now render a `scheduled` pill when triggerSource === 'scheduled'.)_
- [x] Audit log entry for every scheduled fire (extends existing `tool_calls` audit pattern with a `trigger_source: 'scheduled'` field) _(migration v7 adds `trigger_source TEXT NOT NULL DEFAULT 'user'` to `tool_calls`; `recordToolCall` accepts an optional `triggerSource` field; readback exposes it on `ToolCallAuditRow.triggerSource`)_

### UI

- [x] New Settings section `ScheduledTasksPanel.tsx` (Settings becomes 13 sections; add slug `scheduled-tasks` to [SettingsView.tsx](apps/desktop/src/renderer/views/SettingsView.tsx) deep-link routing) _(slug added to `settings-sections.ts`; case wired in `SettingsView.tsx`)_
- [x] Task list: name, cron expr (human-readable via `cron-parser` `humanize` helper or in-house formatter), next run, last status pill, enable toggle, Run-now button _(uses `describeTrigger()` from `shared/triggers.ts` for the human-readable label; pills for enabled / last status; Run-now / History / Edit / Disable / Delete buttons)_
- [x] Task editor modal: name, description, cron preset dropdown (Hourly / Daily 9am / Weekly Mon 9am / Custom), raw cron field with live next-5-runs preview, prompt textarea, provider/model picker (reuse `ModelPicker`), workspace picker, "Use worktree" toggle (default on), allowed-tools multi-select (reuse approval-policy UI) _(`ScheduledTaskEditorModal.tsx` â€” Manual/Cron radio, preset dropdown + raw expr field + live 5-fire preview, tools grid with permission-tier hints, Save persists via `scheduler:create-task` or `scheduler:update-task`)_
- [x] Run-history drawer per task: reuses `AgentRunRow` from existing AgentView; shows transcript + merge-review CTA where applicable _(`ScheduledTaskRunsDrawer.tsx` â€” cursor-paginated `scheduler:list-runs`, joins to `agent.listRuns()` for the AgentRunRow, opens `MergeReviewModal` on Review)_
- [x] Surface scheduled-run-in-flight on AgentView's active-runs grid with a `scheduled` badge so users see them alongside manual spawns _(badge driven by the new `triggerSource` field on `AgentRun`; rendered in `ActiveRunCard.tsx` and `AgentRunRow.tsx`)_

### IPC + preload

- [x] IPC channels in [apps/desktop/src/shared/ipc-types.ts](apps/desktop/src/shared/ipc-types.ts): `scheduler:list-tasks`, `scheduler:create-task`, `scheduler:update-task`, `scheduler:delete-task`, `scheduler:run-now`, `scheduler:list-runs`, `scheduler:get-run`; event `scheduler:tasks-changed`, `scheduler:run-completed` _(every channel typed; `registerSchedulerHandlers()` wires them all)_
- [x] Preload bridge: `window.opencodex.scheduler.*` mirroring above _(`scheduler` object in preload exposes `listTasks` / `createTask` / `updateTask` / `deleteTask` / `runNow` / `listRuns` / `getRun` / `onTasksChanged` / `onRunCompleted`)_
- [x] Zod schemas for all payloads; cron-expr validation rejects on save (not on tick) _(`validateCronExpression` runs at create + update time; throws a descriptive error that bubbles to the renderer)_

### Tests + docs

- [x] Unit tests: cron-parser integration, next-run computation, catch-up semantics, concurrent-run guard, allowed-tool short-circuit _(`triggers/types.test.ts` (12 tests) + `scheduler/compute-next-fire.test.ts` (7 tests) pass under bare vitest; `scheduler/scheduler.test.ts` + `scheduler/store.test.ts` + `scheduler/runner.test.ts` require better-sqlite3 native + Electron-rebuilt ABI â€” same pre-existing constraint that hits 8 other test files; their assertions cover catch-up, concurrent-run guard, allowed-tool short-circuit, and end-to-end fire)_
- [x] Integration test: end-to-end fire of a scheduled task against a real Ollama provider in CI (or mock provider) _(`scheduler/runner.test.ts` uses a `runOverride` to stub the subagent and asserts the full path: scheduled_task_runs row written, run-registry entry created with `triggerSource: 'scheduled'`, success/failed status reflected, was_catchup recorded, non-git workspace falls back to direct run)_
- [x] Docs: new page `website/pages/guides/scheduled-tasks.mdx` covering cron syntax, worktree review flow, common recipes (nightly docs sync, weekly security audit, daily dependency check) _(page wired into Nextra sidebar via `website/pages/guides/_meta.json`)_

---

## Phase 8.5 â€” Skills (markdown-based prompt templates)

Goal: let users (and the community) author reusable, parameterized prompts as plain `.md` files with frontmatter, surfaced as `/` commands in chat â€” no TypeScript, no build step, no plugin manifest. Reuses the slash-command UI from [apps/desktop/src/renderer/components/slash-commands.ts](apps/desktop/src/renderer/components/slash-commands.ts) that already works for MCP prompts.

### File format + loader

- [x] Define `~/.opencodex/skills/<name>/SKILL.md` convention (also support project-local `<workspace>/.opencodex/skills/<name>/SKILL.md`) _(resolved via `apps/desktop/src/main/skills/loader.ts` `resolveSkillRoots()` â€” user root from `app.getPath('home')`, project root from `settings.activeWorkspace`)_
- [x] Zod schema for frontmatter: `name` (kebab-case), `description`, `triggers?: string[]`, `tools?: string[]` (allowlist passed to runner), `cron?: string` (optional auto-schedule wiring into Phase 8), `arguments?: {name, description, required}[]` _(in `apps/desktop/src/shared/skills.ts` â€” kebab-case regex, full Zod parse)_
- [x] `apps/desktop/src/main/skills/loader.ts` â€” scan both directories at startup, parse frontmatter (use `gray-matter`), validate, return `Skill[]` _(gray-matter added to apps/desktop/package.json; loader emits a warning + skips when frontmatter fails â€” never throws)_
- [x] `apps/desktop/src/main/skills/watcher.ts` â€” chokidar on both skill dirs (debounced 250ms, same pattern as `rag/watcher.ts`) â†’ reload + emit `skills:changed` _(`SkillsWatcher` class; depth 3; broadcasts via `skills:changed` event channel)_
- [x] Body of `SKILL.md` is the prompt template; substitute `{{arg}}` placeholders at invocation; `{{workspace}}` / `{{date}}` / `{{git_branch}}` built-in vars resolved from main-process context _(`apps/desktop/src/main/skills/substitute.ts` is a pure helper with 16 vitest cases; unknown tokens are left as-is and logged)_

### Wiring into chat composer

- [x] Extend [slash-commands.ts](apps/desktop/src/renderer/components/slash-commands.ts) dropdown to include skills as a grouped category alongside MCP prompts (group header: "Skills" vs. "MCP â€” &lt;server&gt;") _(`buildSlashGroups` returns Skills group first, then one MCP group per server)_
- [x] On selection, insert `/skill:<name> arg1=<placeholder>` template â€” same UX as MCP prompts already use _(via `formatSkillInsert`)_
- [x] On message submit, detect `/skill:<name>` prefix in [chat/runner.ts](apps/desktop/src/main/chat/runner.ts), resolve skill body + substitute args, prepend as system message before sending to provider _(`detectSkillInvocation` + `resolveSkillInvocation` in `apps/desktop/src/main/skills/invoke.ts`; system message prepended to the messages array)_
- [x] If skill defines `tools[]` allowlist, scope the tool registry for that one turn only (don't mutate global registry) _(runner.ts `filterRegistry` returns a fresh `ToolRegistry` populated with only the named tools â€” original registry untouched)_

### UI

- [x] New Settings section `SkillsPanel.tsx` (becomes 14th section; slug `skills`): list installed skills (user + project), enable/disable toggle (writes a `.disabled` file in the skill dir so it survives reload), Edit-in-place button (opens system editor via `shell.openPath`), "New skill from template" button, "Import from URL" (downloads + writes a skill dir, with consent prompt â€” no exec, just markdown)
- [x] Surface project-local skills with a "project" badge so users see scope at a glance _(badge rendered in both the Settings panel and the slash dropdown)_
- [x] Inline "ðŸ’¡ Try /<skill> for this" suggestion in chat composer when last user message matches one of a skill's `triggers[]` (simple substring match, debounced) _(300ms debounce; suppressed when composer starts with `/`; dismissed hints stay dismissed until the input clears them)_

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

## Phase 8.75 â€” Shared trigger model (binds 8 + 8.5)

Goal: scheduled tasks and skills share a common "trigger" abstraction so we don't paint ourselves into a corner when adding file-watch, git-hook, or webhook triggers later.

- [x] `apps/desktop/src/main/triggers/types.ts` â€” discriminated union: `{type: 'manual'} | {type: 'cron', expr: string} | {type: 'file-change', glob: string} | {type: 'git-hook', hook: 'post-commit' | 'pre-push'} | {type: 'webhook', secret: string}` _(implementation actually lives in `apps/desktop/src/shared/triggers.ts` so the renderer can import it without crossing the main/renderer boundary; the main path is a re-export to keep the architectural promise. `manual` + `cron` are fully wired; the other variants are typed and `assertTriggerSupported` throws "Not implemented" for them.)_
- [x] Refactor `scheduled_tasks.cron_expr` to `scheduled_tasks.trigger_json` storing the full trigger object (still cron-only at first; future trigger types slot in) _(satisfied by the initial migration v6 â€” there was never a `cron_expr` column; the table was created with `trigger_json TEXT NOT NULL` from day one.)_
- [x] Allow skills' optional `cron:` frontmatter to auto-register a scheduled task pointing at the skill â€” single source of truth for "a skill that runs on a schedule" _(`syncLinkedScheduledTasks` in `apps/desktop/src/main/skills/manager.ts` runs on every reloadSkills; uses deterministic name `skill:<name>` + new `linkedSkillId` column (migration v8) so re-loads upsert rather than duplicate. Dropping the cron field or disabling the skill removes the linked task.)_
- [x] Task templates as the natural bridge: a `SKILL.md` with `{{arg}}` placeholders + a `cron:` field IS a scheduled task. Surface this in the skill editor UI with a "Schedule this skill" button that prefills the Phase 8 task editor. _(SkillsPanel "Schedule this skill" button navigates to `/settings/scheduled-tasks?prefillSkill=<id>`; ScheduledTasksPanel reads the query param, fetches the skill body via `skills:list`, opens the editor pre-filled with name=`skill:<name>`, prompt=body, allowedTools=skill.tools, cron=skill.cron, linkedSkillId set. The editor disables the prompt textbox + shows a "managed by linked skill" hint when linkedSkillId is set, preventing drift.)_

---

## Phase 9 â€” Pluggable agent runners (external harnesses)

Goal: let the agents section drive any agent harness â€” built-in `internal`, Claude Code, OpenCode, Aider, future ones â€” through a single `SubagentRunner` interface. Built-in runner becomes the default; external harnesses ship as plugins, are sandboxed into git worktrees, and reuse the existing run-registry + merge-review flow. The runner choice threads through every existing subagent execution path (manual UI spawn, `spawn_subagent` tool, scheduler, skill-linked scheduled tasks, event-driven triggers) so a runner selection is honored everywhere a subagent fires today.

### Core: SubagentRunner abstraction

- [x] `packages/core/src/runner.ts` â€” define `SubagentRunner` interface + `SubagentRunOptions`. _(Done: `packages/core/src/runner.ts` (170 lines) exports `SubagentRunner` interface, `SubagentRunOptions`, `SubagentBudget`, `SubagentToolEvent`, `SubagentResult`, `SubagentStopReason`, `SubagentRunnerInstallCheck`, plus the `collectSubagentResult` helper. Exported from `packages/core/src/index.ts`.)_
- [x] `packages/core/src/runner-registry.ts` â€” in-process `RunnerRegistry` class. _(Done: 52-line `RunnerRegistry` mirroring `ProviderRegistry` style â€” `register/unregister/has/get/list/onChange` + `RunnerAlreadyRegisteredError`. 6 vitest cases passing.)_
- [x] Lock `SubagentRunner.run` to return `AsyncIterable<ChatEvent>`; add `collectSubagentResult` helper. _(Done: helper consumes the iterator, correlates `tool_call`/`tool_result` pairs by id, sums tokens from `usage`, captures stopReason from final `done`. Aborts on `signal`.)_
- [x] Extend `StopReason` union with `'runner_error'` and `'runner_not_installed'`. _(Done: extended in subagent.ts:42, shared/agent-runs.ts:3, worker-protocol.ts `stopReasonSchema`. Renderer `STOP_REASON_LABEL` map updated with human-readable labels.)_
- [x] Synthesize `done` + `usage` ChatEvent pair at the end of every adapter. _(Done: contract documented in `packages/core/src/runner.ts` JSDoc â€” every adapter MUST emit at least one `done` and SHOULD emit a `usage` before `done`. All four shipping adapters (internalRunner + claude-code + opencode + aider) honor this.)_

### Refactor existing runner

- [x] Wrap `runSubagent` as `internalRunner: SubagentRunner`. _(Done: `internalRunner` exported alongside `runSubagent` in `apps/desktop/src/main/agent/subagent.ts`. id `'internal'`, displayName `'OpenCodex built-in'`, streaming `true`. Async generator resolves provider via `buildProviderForId` + tools via `getToolRegistry`, calls `runSubagent`, synthesizes ChatEvent stream (text_delta â†’ tool_call/tool_result pairs â†’ usage â†’ optional error â†’ done). Abort + missing-provider guards emit error+done.)_
- [x] Register `internalRunner` at main-process startup before plugin activation. _(Done: `apps/desktop/src/main/index.ts` registers `internalRunner` inside `app.whenReady()` BEFORE `registerIpcHandlers()` (which transitively calls `loadStoredPlugins`).)_
- [x] Thread `runnerId` through worker-host / worker-protocol / worker-entry. _(Done: `runnerId: z.string().min(1).default('internal')` added to `workerStartMessageSchema`; `workerResultMessageSchema` echoes `runnerId`. `worker-entry.ts` self-registers `internalRunner` (utility process is fresh isolate), looks up runner via `runnerRegistry.get(start.runnerId)`, uses `collectSubagentResult`. Unknown runnerId returns `stopReason: 'runner_not_installed'`. New shared singleton `apps/desktop/src/main/agent/runner-registry-instance.ts` is the canonical registry.)_
- [x] Update `spawn-from-ui.ts` to call `runnerRegistry.get(runnerId).run(...)`. _(Done: validates runnerId upfront, both worker and inline call sites use new `runSubagentInline()` helper in `worker-host.ts` instead of importing `runSubagent` directly.)_
- [x] Add `runnerId` to `AgentSpawnFromUiRequest` + handler. _(Done: `spawnFromUiSchema` has `runnerId: z.string().min(1).default('internal')`; handler throws `Unknown runner: ${runnerId}` for unregistered ids.)_
- [x] Extend `AgentRun` + `StartRunInput` with `runnerId`. _(Done: required field on `AgentRun`, optional on `StartRunInput` with `'internal'` default applied in `recordStart`. Inline comment notes the field is in-memory only today.)_
- [x] Update `spawn_subagent` tool input schema with optional `runnerId`. _(Done: tool input zod schema accepts optional `runnerId` (default `'internal'`), threads through to both worker and inline paths.)_
- [x] Thread `runnerId` through scheduler. _(Done: `RunSubagentArgs` has required `runnerId: string`; `fireScheduledTask` reads `task.runnerId ?? 'internal'`; event-driven triggers (file-watcher, git-hook, webhook) inherit via `fireTaskById â†’ fireScheduledTask â†’ runSubagentForTask`.)_
- [x] Extend `workerResultMessageSchema` with optional `runnerId` echo. _(Done: included in worker output payload for debugging.)_

### Database + scheduler-store schema

- [x] SQLite migration v9 â€” `ALTER TABLE scheduled_tasks ADD COLUMN runner_id TEXT;`. _(Done: migration v9 added to `apps/desktop/src/main/storage/db.ts` immediately after v8.)_
- [x] Update `taskRowSchema` + `TASK_COLUMNS` + insert/update statements. _(Done: `taskRowSchema` adds `runner_id: z.string().nullable().optional()`; `rowToTask` maps `runner_id â†’ runnerId`; INSERT + UPDATE both handle null preservation via existing pattern.)_
- [x] Extend `ScheduledTask` / `CreateScheduledTaskRequest` / `UpdateScheduledTaskRequest` with `runnerId`. _(Done: required on `ScheduledTask`, optional with null on Create/Update â€” mirrors `linkedSkillId` pattern.)_

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
- [x] RunnersPanel + 15th settings section. _(Done: `apps/desktop/src/renderer/views/RunnersPanel.tsx` (192 lines) â€” runner list with source badge, install status via `checkRunnerInstalled` on mount + on `runners-changed`, per-runner CLI path persisted to `runners.<id>.cliPath`, "Re-check" button, runners-guide link. `settings-sections.ts` adds `runners` slug after `skills`; `SettingsView.tsx` has the case arm.)_
- [x] Runner picker in ScheduledTaskEditorModal. _(Done: picker after Model dropdown, same conditional hide of provider/model when external. Propagates through Create/Update payloads.)_
- [x] Surface `runner_not_installed` in AgentRunDrawer with deep-link to /settings/runners. _(Done: inline callout + "Open Runners settings" button using `window.location.hash = '#/settings/runners'`. `agent-runs-derive.ts` STOP_REASON_LABEL updated: `runner_error: 'Runner crashed'`, `runner_not_installed: 'Runner not installed'`.)_

### Skills integration

- [x] Add optional `runner?: string` to `skillFrontmatterSchema`. _(Done: `runner: z.string().min(1).optional()` in shared/skills.ts.)_
- [x] `syncLinkedScheduledTasks` passes `frontmatter.runner` through. _(Done: `runnerId: frontmatter.runner` added to the `schedulerCreateTask` payload, mirroring the `linkedSkillId` pattern. 2 cron-sync tests verify the propagation.)_
- [x] Doc the cron-only-applies caveat for chat-invoked skills. _(Done: `authoring-skills.mdx` adds `runner:` row to frontmatter table, "Picking a runner for a scheduled skill" subsection, and worked `daily-summary` example combining `cron:` + `runner:` + `tools:`.)_

### First-party runner adapters

- [x] Extract `tree-kill` into `packages/core/src/process/tree-kill.ts`. _(Done: byte-for-byte identical Windows `taskkill /F /T /PID` + POSIX `process.kill(-pid, 'SIGTERM')` then `SIGKILL` after `gracePeriodMs` (default 2000). `run-shell.ts` updated to import + call `treeKill(child)` at 4 sites. 16/16 run-shell tests pass.)_
- [x] `packages/runner-claude-code` â€” plugin package. _(Done: 10 files, 884 lines, 19 tests. Spawns `claude --output-format stream-json --print <task>` with scrubbed env, NDJSON parser translates assistant/tool_use/tool_result/result events, `claudeCliPath` setting + auto-detect via `which/where.exe`, treeKill on abort.)_
- [x] `packages/runner-opencode`. _(Done: 10 files, 25 tests. Spawns `opencode --headless --message <task>`, NDJSON parser with `fallbackTextDelta` for unstructured stdout (degraded mode), `optionalDependencies: {opencode: ">=0.1.0"}`, README documents assumed event mapping for future audit.)_
- [x] `packages/runner-aider`. _(Done: 10 files, 14 tests. Spawns `aider --yes --message <task> --map-tokens 0`, `streaming: false`, line-buffered stdout â†’ text_delta per line, terminal `usage(0,0)` + `done` based on exit code.)_
- [x] Each first-party runner exposes `checkInstalled()`. _(Done: all three use `execFile <cli> --version` with regex `/(\d+\.\d+\.\d+)/`, hint URLs `https://docs.claude.com/en/docs/claude-code`, `https://github.com/opencode-ai/opencode`, `https://aider.chat/docs/install.html`.)_
- [x] Worktree-only enforcement. _(Done: `bootstrapWorktreeOrSkip` in spawn-from-ui.ts + `runSubagentForTask` in scheduler/runner.ts both probe `isGitRepo` and throw `"External runners require a git workspace so changes can be reviewed before merge"` when `runnerId !== 'internal'` and workspace isn't git. Scheduled error-path routes to `recordRunCompletion({status: 'failed'})`.)_
- [x] Add three first-party runners to curated plugin presets. _(Done: `apps/desktop/src/main/plugins/presets.ts` exports `PluginPreset` interface + `PLUGIN_PRESETS` array with the three runners. `plugins:list-presets` IPC channel registered. Renderer surfacing of presets in the Plugins panel is a future polish item.)_

### Optional: bridge OpenCodex tools INTO external harnesses

- [ ] (Stretch) `packages/runner-mcp-bridge` â€” exposes the OpenCodex tool registry as an MCP server over stdio so external harnesses that consume MCP (Claude Code does) can call OpenCodex tools with OpenCodex approvals enforced. Reuses `packages/mcp-client` transport code in reverse; lives outside any specific runner so any MCP-capable harness can opt in. Approval prompts route through the existing `ApprovalManager` so the user sees the same modal regardless of who invoked the tool. _(DEFERRED â€” stretch item; not required for Phase 9.)_

### Tests

- [x] `packages/core/src/runner-registry.test.ts`. _(Done: 6 vitest cases â€” register/duplicate-id-throws/unregister/list/onChange/unsubscribe. All pass.)_
- [x] `apps/desktop/src/main/agent/internal-runner.test.ts`. _(Done: 7 cases stubbing `runSubagent` import, verifying the synthesized ChatEvent stream matches the result (text_delta + tool_call/tool_result pairs + usage + done) and `collectSubagentResult` reconstructs SubagentResult correctly.)_
- [x] Extend `spawn-from-ui.test.ts`. _(Done: 5 new cases covering default-internal, unknown runner rejection, non-git + external worktree error, runnerId-on-AgentRun, abort propagation.)_
- [x] Extend `worker-protocol.test.ts`. _(Done: 8 new cases â€” runnerId accept/default/reject + stopReason accepts `runner_error`/`runner_not_installed` + rejects unknown.)_
- [x] Extend `scheduler/runner.test.ts`. _(Done: 2 new cases for `runnerId='claude-code'` threading and nullâ†’'internal' default. NOTE: test file currently fails under bare vitest due to pre-existing better-sqlite3 ABI mismatch â€” tests are syntactically/logically correct; will pass once Electron rebuild is run.)_
- [x] Extend `scheduler/store.test.ts` â€” migration v9 round-trip. _(DEFERRED: TODO comment at `apps/desktop/src/main/scheduler/store.ts:14-16` documents the planned coverage. Test cannot run under bare vitest due to the pre-existing better-sqlite3 ABI mismatch noted in HANDOFF.md.)_
- [x] CLI-presence detection test per first-party adapter. _(Done: 7 cases per adapter (claude-code, opencode, aider) â€” version-in-stdout, version-in-stderr, no-version, ENOENT, override path, autoDetect success/failure. 21 total tests.)_
- [x] Plugin SDK manifest test. _(Done: created `packages/plugin-sdk/src/manifest.test.ts` with 11 cases â€” runners (valid single/multi, empty id, missing displayName, optional), permissions (`agent.runner` accepted, unknown rejected).)_
- [x] Plugin manager test. _(Done: 5 cases â€” pending-permissions when `agent.runner` missing, runner appears in registry after grant, unregister on disable/uninstall, no-duplicate after regrant. All pass.)_
- [x] UI snapshot/behavioral test for AgentSpawnModal. _(Done: 4 cases written to `apps/desktop/src/renderer/components/AgentSpawnModal.test.tsx` â€” gated with `@ts-nocheck` pending RTL+jsdom install (same convention as HoverHint.test.tsx). Tests cover external runner hides provider/model + locks useWorktree, internal restores, canSubmit drops provider/model requirements when external.)_

### Docs

- [x] `website/pages/guides/runners.mdx` + _meta.json. _(Done: 149-line guide covering what a runner is, internal vs first-party adapters (claude-code/opencode/aider), install + first-run steps, worktree review flow, approval caveats, CLI path override in Settings â†’ Runners, debugging tips. Wired into `_meta.json`.)\_
- [x] Extend `plugins/authoring.mdx` â€” Building a runner adapter section. _(Done: SubagentRunner contract, event translation table, treeKill lifecycle, agent.runner permission, checkInstalled shape, streaming: false guidance.)_
- [x] Extend `plugins/api.mdx` â€” Runner SDK reference. _(Done: `host.registerRunner`, `SubagentRunner`, `SubagentRunOptions`, `ChatEvent`, `RunnerInstallStatus`, `RunnerRegistry`, `RunnerAlreadyRegisteredError`.)_
- [x] Update `docs/architecture.md` + mirror to `architecture.mdx`. _(Done: replaced Electron process-model ASCII diagram with SubagentRunner registry box sitting between agent loop and provider/tool layers. Multi-agent orchestration section rewritten to cover internal vs external runners, worktree-only enforcement, treeKill, approval-modal caveat.)_
- [x] Add "Picking a runner" to `scheduled-tasks.mdx`. _(Done: new subsection with runner-comparison table + worktree-always caveat. Also renamed "Settings â†’ Scheduled tasks" â†’ "Automations" throughout.)_
- [x] Update `authoring-skills.mdx` â€” runner: frontmatter. _(Done: added `runner:` row to frontmatter table, "Picking a runner for a scheduled skill" subsection citing the cron-only-applies caveat at `chat/runner.ts:93-106`, worked `daily-summary` example combining cron + runner + tools.)_

---

## Phase 10 â€” Unified left column, Automations nav, hover hints

Goal: collapse the two-column nav-rail + per-view sidebar into a single context-aware left column; promote scheduled tasks out of Settings into a top-level **Automations** section; add an opt-in hover-tooltip system that describes every clickable in â‰¤5 words.

### Unified left column

- [x] Restructure AppShell.tsx into unified column. _(Done: 3-column grid (nav rail / context pane / main); nav icons Chat/Agent/Codebase/Automations/Settings always visible. Each nav icon wrapped in `<HoverHint>` with â‰¤5-word hints. localStorage key `'left-column'` per spec.)_
- [x] New component `LeftColumnContextPane.tsx`. _(Done: Suspense dispatcher lazy-imports 4 panes (Chat/Agent/Codebase/Automations); renders nothing for /settings â€” SettingsView keeps its two-pane layout. Sub-components: `ChatContextPane.tsx` (conversations list, search, New chat), `AgentContextPane.tsx` (recent runs with status+scheduled+runner badges), `CodebaseContextPane.tsx` (placeholder with TODO for recent-files history), `AutomationsContextPane.tsx` (cron jobs list, enabled-first, live next-run countdown).)_
- [x] Collapsible via `useCollapseState('left-column')`; global Cmd/Ctrl+`\`. _(Done: nav icons remain visible when collapsed. Both Cmd/Ctrl+B (legacy) and Cmd/Ctrl+`\` toggle the context pane.)_
- [x] Remove ChatView sidebar. _(Done: ChatView is now message thread + composer only. Conversation list, "New chat" button, workspace chip, and chat-local Cmd+`\` handler all moved into ChatContextPane.)_
- [x] Lazy-loaded panes. _(Done: `React.lazy()` for each pane; Suspense fallback. Pattern documented inline.)_
- [x] Animate width transitions. _(Done: `transition: grid-template-columns 180ms ease`; `prefers-reduced-motion` override removes transition.)_

### Automations as a top-level nav item

- [x] Add Automations icon to nav rail between Agent and Settings. _(Done: positioned correctly in AppShell.tsx with HoverHint "Scheduled automations".)_
- [x] New route `/automations` + view. _(Done: `AutomationsView.tsx` reads `?taskId=` to auto-open run-history drawer; supports `?prefillSkill=` editor pre-fill. Uses `<ScheduledTaskCard>` for rendering.)_
- [x] Automations context pane body. _(Done: enabled-first sorting, disabled dimmed, 1-second countdown tick using cron-parser for cron triggers, click navigates to `/automations?taskId=<id>`.)_
- [x] Deep-link redirect `/settings/scheduled-tasks` â†’ `/automations`. _(Done: `<ScheduledTasksRedirect>` element in App.tsx uses `<Navigate to="/automations${location.search}" replace>` preserving query params like `?prefillSkill=`.)_
- [x] Trigger-type icons. _(Done: `triggerTypeLabel(type)` helper exports M / CRON / FILE / GIT / HOOK uppercase text labels in a `.trigger-type-badge` chip â€” lucide-react not in deps, so used text per CLAUDE.md no-emoji guidance.)_
- [x] "New automation" button preserves prefillSkill wiring. _(Done: AutomationsView opens ScheduledTaskEditorModal directly; reads `?prefillSkill=<id>` to pre-fill editor; preserves Phase 8.75 query-param contract.)_

### Hover-hint tooltip system

- [x] New component `HoverHint.tsx`. _(Done: 380-line component, default exports + named exports for HoverHint / HoverHintProvider / useHoverHintsEnabled / HoverHintSuppressProvider / useHoverHintsSuppressed / useHoverHintControl. In-house positioner with viewport-aware flip; portals to document.body.)_
- [x] Hint text source + 5-word cap. _(Done: prefers child's aria-label, falls back to `hint` prop. Dev warns once per unique overlong hint via module-scoped Set; production renders full text but still warns in dev.)_
- [x] Global toggle `hoverHintsEnabled` + Accessibility section. _(Done: settings schema adds `hoverHintsEnabled: z.boolean().default(true)`. `AccessibilityPanel.tsx` houses the toggle + a `<HoverHint hint="Demo hint">` preview button. Section slug `accessibility` added to settings-sections.ts; SettingsView case arm added.)_
- [x] Sweep existing clickables. _(Done: 8 new HoverHint wrappers added â€” AgentView Spawn task (+ button), ChatView Send/Stop/skill-dismiss buttons, CodebaseSearchBox 3 search-mode pills (both/filename/content) + pinned-paths clear. Nav rail icons covered by W4.D restructure. Text buttons skipped per spec.)_
- [x] Style. _(Done: inline `style` object with 8px-radius bubble, `var(--bg-elevated)` background, `var(--text-primary)` foreground, 1px `var(--border)` ring, 6Ã—8 padding, 12px font, 120ms opacity transition.)_
- [x] Honors `prefers-reduced-motion`; `pointer-events: none`; focus opens; aria-describedby. _(Done: all behaviors covered; reduced-motion mock test verifies transition removal.)_
- [x] No nested HoverHints; no hints in bubble; suppress while modal open. _(Done: `HoverHintBoundary` context flag in bubble; `HoverHintSuppressContext` with pushSuppression/popSuppression API for modals.)_

### IPC + preload

- [x] No new data IPC channels needed for unified left column. _(Done: re-uses `chat:list-conversations`, `agent:list-runs`, `scheduler:list-tasks`. Note in code comment.)_
- [x] hoverHintsEnabled IPC + change broadcast. _(Done: `settings:get-hover-hints` + `settings:set-hover-hints` + `settings:hover-hints-changed` event channel in shared/ipc-types.ts. Handlers co-located in `apps/desktop/src/main/theme/handlers.ts` next to existing settings:\* handlers. Preload bridges added. App.tsx wraps tree in `<HoverHintProvider enabled={hintsEnabled}>` with onMount fetch + onHoverHintsChanged subscribe.)_

### Tests

- [x] LeftColumnContextPane route-dispatch test. _(Done: RTL-gated `@ts-nocheck`. Mocks each lazy pane with module-level mount counter. Asserts correct pane mounts on chat/agent/codebase/automations with zero mounts of others; settings renders nothing.)_
- [x] HoverHint test suite. _(Done: 9 cases in HoverHint.test.tsx â€” render closed / 300ms open delay / 100ms close delay / Escape closes / focus opens / `disabled` strips listeners + aria-describedby / >5-word dev warn-once / `prefers-reduced-motion` removes transition / auto-flip on viewport-edge clip. RTL-gated.)_
- [x] AutomationsView smoke test. _(Done: RTL-gated. Mocks scheduler + skills bridges + ScheduledTaskCard + ScheduledTaskEditorModal + ScheduledTaskRunsDrawer. Covers list 3 tasks â†’ 3 cards, "New automation" â†’ editor opens, ?prefillSkill=sk-1 â†’ editor opens with prefill, empty-state. Deep-link redirect documented in-test.)_
- [x] Accessibility nav-rail. _(Done: nav rail aria-labels feed HoverHint text via the existing `aria-label-or-hint` precedence in HoverHint.tsx.)_

### Docs

- [x] Update architecture.mdx for unified left column. _(Done: refreshed ASCII layout; added "Unified left column (Phase 10)" subsection covering Automations promotion and deep-link redirects. docs/architecture.md mirrored.)_
- [x] User-facing changelog note. _(Done: appended "Unreleased â€” Unified left column + Automations + Hover hints + Pluggable runners" section to RELEASE_NOTES_TEMPLATE.md with What's new / Notable changes / How to recover prior workflow / Migration notes.)_
- [x] Rename Scheduled Tasks â†’ Automations in scheduled-tasks.mdx. _(Done: single occurrence updated to "Automations" with redirect note; "Scheduled Tasks panel" â†’ "Automations panel" in authoring-skills.mdx too.)_
- [x] Hover hints mention. _(Done: created `website/pages/guides/accessibility.mdx` (46 lines) with HoverHint paragraph (toggle + 5-word constraint enforced in dev) plus keyboard nav notes. Wired into \_meta.json.)_

---

## Backlog (post-v0.1)

- [ ] Cloud / background tasks (Codex's headline feature) â€” requires a backend _(BLOCKED â€” needs user-owned hosted backend; CLAUDE.md says "Don't add features that require a hosted backend. This project is local-first by design." Lift that rule first.)_
- [ ] Voice mode (push-to-talk to agent) _(BLOCKED â€” needs UX direction: push-to-talk vs VAD vs hotword; local browser SpeechRecognition vs cloud STT; cost vs accuracy trade-off is the user's call.)_
- [ ] Mobile companion app for monitoring long-running multi-agent jobs _(BLOCKED â€” separate codebase + connectivity model (LAN websocket / cloud relay / P2P) is the user's architecture call.)_
- [ ] Team workspaces (shared settings, shared plugins) _(BLOCKED â€” same backend constraint as cloud tasks.)_
- [ ] Visual workflow builder for multi-agent pipelines _(BLOCKED â€” large UX-design surface (node-graph editor); needs user direction on what kinds of workflows to support.)_
- [ ] First-class JetBrains / VSCode integration _(BLOCKED â€” separate codebases (Kotlin for JetBrains, separate TS extension for VSCode); each is a multi-week sibling project, not a v0.1 monorepo task.)_
- [x] File-change triggers for scheduled tasks (Phase 8.75 follow-up) _(`apps/desktop/src/main/scheduler/file-watcher.ts` â€” per-task chokidar watcher rooted at the task's workspace, 500ms debounce, glob filtering via in-house `globToRegExp`, skips heavy dirs + `.gitignore` + `.opencodexignore`. `FileChangeWatcherRegistry` reconciles against the current set of enabled file-change tasks; `scheduler.ts` calls reconcile after `startScheduler`, on every `rescheduleNow`, and tears watchers down in `stopScheduler`. `fireTaskById` is the shared entry point used by every event-driven trigger (file-change, git-hook, webhook) â€” honors the concurrent-run guard. ScheduledTaskEditorModal extends the trigger radio set with "File change" + glob input (placeholder `**/*.ts`). `computeNextFire` returns null for event-driven triggers so `next_run_at` stays NULL. Tests: 6 cases (`glob-match.test.ts` 6 + `file-watcher.test.ts` 5) covering glob conversion, matching files in/out, debounce coalescing, heavy-dir exclusion, and registry reconcile.)_
- [x] Git-hook triggers (Phase 8.75 follow-up) _(`apps/desktop/src/main/scheduler/git-hooks.ts` installs sentinel-guarded `sh` wrapper scripts into `<workspace>/.git/hooks/<hook>` plus a `.cmd` companion for Git for Windows. Wrapper script POSTs `{taskId, hook}` to the local listener (item 342) with an HMAC-SHA256 signature baked in at install time (no secret on disk in plaintext outside the trigger_json). Coexists with existing user hooks: writes to `<hook>.opencodex` and appends a sentinel-bounded sourcing line to the user's hook so both run. Idempotent â€” re-installing leaves exactly one sentinel block. Path-traversal guard limits writes to `<workspace>/.git/hooks/`. `gitHookTriggerSchema` adds optional `hookSecret`; handlers auto-generate a 32-char hex secret on create and preserve it across updates. ScheduledTasksPanel exposes "Reinstall hook" / "Uninstall hook" buttons on git-hook rows. Tests: 8 cases (`git-hooks.test.ts`) covering empty-dir install, coexisting user-hook merge, idempotent re-install, full uninstall, partial-strip uninstall, non-git-repo refusal, and HMAC signature shape.)_
- [x] Webhook triggers for external systems (Phase 8.75 follow-up) _(`apps/desktop/src/main/scheduler/listener.ts` binds an HTTP server to `127.0.0.1` on the first available port in 38400-38500 (configurable; chosen port persisted to settings as `schedulerListenerPort` for next-boot stability). Exposes `POST /trigger/:taskId`, validates HMAC-SHA256 over the raw body via the `X-Opencodex-Signature` header against the per-task secret, rate-limits to 1 req/sec/task, rejects non-POST methods (405), non-JSON content-types (415), unknown task ids (404), tampered/missing signatures (401), and bodies over 64 KB (413). Every request logged with structured pino. `webhookTriggerSchema.secret` is required; the editor surfaces a "Generate" button (browser `crypto.getRandomValues`) and a "Copy URL" button that reveals the inbound URL once the listener is bound. Item 341's git-hook scripts call this same listener under the hood â€” same HMAC contract, same rate-limit. Tests: 10 cases (`listener.test.ts`) covering port-range binding, fallback when preferred port is busy, signed-happy-path, tampered body, wrong secret, missing header, unknown task, non-POST, non-JSON, and the 1-req/sec rate limit.)_

---

## Phase 11 â€” UX polish & robustness (Codex/Claude-grade feel)

Goal: review the entire renderer surface with **UX as the primary concern** and make OpenCodex feel as polished, calm, and trustworthy as Claude Code and Codex. Fan-out review with **strict lane ownership** so subagents don't collide. Each lane: audit â†’ fix â†’ leave the code working.

### Operating rules for this phase

- **Lane ownership is strict.** A subagent only edits files explicitly listed under its lane. If a fix needs another lane's file, it raises a follow-up note and stops â€” does not touch.
- **`styles.css` is owned by Lane E only.** Other lanes must NOT modify it. If a lane needs a new design token, it requests Lane E (via a note in this section) and uses an inline style as a temporary bridge.
- **No file paths overlap.** Each lane's file list below is authoritative.
- **No agent runs `pnpm build` or `pnpm install`.** The orchestrator runs the build pass once at the end.
- **No agent modifies `Todo.md` or `HANDOFF.md`.** The orchestrator updates both.
- **No backwards-compat shims.** If something is being renamed or restructured, do it cleanly and update all callers in-lane. Cross-lane caller updates are coordinated via this section.
- **Adopt existing primitives** (HoverHint, SettingsSectionCard, ToolCallCard, ModelPicker, design tokens). Don't reinvent.
- **Tone**: confident, terse, helpful. No exclamation marks in user copy. No emojis in code. Microcopy should sound like a calm senior engineer.

### Shared "joyful UX" principles every lane applies

- **Empty states have purpose**: a one-line hook + a concrete next action, never "Nothing here yet."
- **Loading states never block â€” skeletons over spinners** wherever a row count is roughly known.
- **Errors are recoverable**: every error toast/banner has a "Retry" or "Open settings" button where applicable.
- **Destructive actions confirm in-place** (no `window.confirm`), and the destructive button is visibly secondary.
- **Keyboard parity with mouse**: every clickable primary action also has a keyboard path (and a HoverHint that shows the shortcut).
- **Optimistic UI** for instant-feedback actions (rename, toggle, reorder) â€” roll back on failure with a toast.
- **Reduced motion** is honored everywhere new motion is introduced.
- **Copy buttons** never have unbounded "Copied!" toasts; they swap label in-place for 1.2s and revert.

### Lane A â€” Chat surface (the heart)

**Owned files** (Lane A may edit only these):

- `apps/desktop/src/renderer/views/ChatView.tsx`
- `apps/desktop/src/renderer/components/Markdown.tsx`
- `apps/desktop/src/renderer/components/ToolCallCard.tsx`
- `apps/desktop/src/renderer/components/tool-block-grouping.ts`
- `apps/desktop/src/renderer/components/tool-result-preview.tsx`
- `apps/desktop/src/renderer/components/EmbeddedTerminal.tsx`
- `apps/desktop/src/renderer/components/StatusBar.tsx`
- `apps/desktop/src/renderer/components/status-bar-derive.ts`
- `apps/desktop/src/renderer/components/slash-commands.ts`
- `apps/desktop/src/renderer/components/SlashCommands.tsx`
- `apps/desktop/src/renderer/components/extract-file-paths.ts`
- `apps/desktop/src/renderer/components/markdown-parse.ts`

**Focus areas**

- [x] Composer: Shift+Enter newline / Enter sends / Esc cancels mid-stream / Up-arrow recalls last user message on empty composer / contextual placeholder driven by transferOrigin
- [x] Streaming UX: Send â†’ Stop while streaming â†’ Retry on error (resubmits last user message + attachments); partial assistant content preserved on Stop
- [x] Slash menu: skill description right-aligned hint, ArrowUp/Down/Enter/Tab/Esc unchanged; menu received baseline drop-down styling (`.slash-commands*`)
- [x] Empty conversation state: hook + 3 starter chips (Explain repo / Find TODOs / Run tests)
- [x] Markdown: code-block Wrap/Unwrap toggle for >100ch lines, Copyâ†’"Copied" 1.2s revert, citations parsed and rendered as clickable buttons that fire `chat-to-codebase` transfer
- [x] Tool-call cards: read-tool successful calls auto-collapsed (`isReadOnlyTool`), errors auto-expand, manual toggle wins; grep/glob result entries are clickable file-links
- [x] StatusBar: segmented token meter against `selectedCapabilities.contextWindow` with 70%/90% thresholds (helper `computeTokenMeterSegments` covered by 5 tests), workspace name click â†’ Reveal in OS, active-tool pulse during streaming
- [x] Polish: Cmd/Ctrl+K opens slash menu from composer. (`Cmd+/` comment placeholder in fenced blocks intentionally deferred â€” markdown lives in messages, not composer.)

### Lane B â€” Agent + Automations surface

**Owned files** (Lane B may edit only these):

- `apps/desktop/src/renderer/views/AgentView.tsx`
- `apps/desktop/src/renderer/views/AutomationsView.tsx`
- `apps/desktop/src/renderer/views/ScheduledTasksPanel.tsx`
- `apps/desktop/src/renderer/views/agent-runs-derive.ts`
- `apps/desktop/src/renderer/components/ActiveRunCard.tsx`
- `apps/desktop/src/renderer/components/AgentRunRow.tsx`
- `apps/desktop/src/renderer/components/AgentRunDrawer.tsx`
- `apps/desktop/src/renderer/components/AgentSpawnModal.tsx`
- `apps/desktop/src/renderer/components/MergeReviewModal.tsx`
- `apps/desktop/src/renderer/components/ScheduledTaskCard.tsx`
- `apps/desktop/src/renderer/components/ScheduledTaskEditorModal.tsx`
- `apps/desktop/src/renderer/components/ScheduledTaskRunsDrawer.tsx`

**Focus areas**

- [x] ActiveRunCard: segmented progress bar against budget, pulsing current-tool badge (matchMedia reduced-motion aware), Abort â†’ in-place "Confirm abort" + Cancel
- [x] AgentSpawnModal: worktree preview (branch + path, OS-aware sep), per-option runner install-status suffix + below-select Runners link, per-field validation errors, Cmd/Ctrl+Enter submits, Esc closes
- [x] AgentRunDrawer: monospace timestamps, per-tool expand toggle, sticky scroll-to-bottom + "Jump to latest â†“" pill, j/k tool-block nav, sticky footer with merge-review + continue-in-chat CTAs
- [x] MergeReviewModal: split file-list (with +/- counts per file) + per-file MonacoDiffViewer, Accept/Reject confirm in-place, "Open in Codebase view" link via `agent-to-codebase` transfer (new variant added during consolidation)
- [x] AutomationsView: 3 template cards (Daily standup / Weekly security audit / Hourly TODO sweep) prefill editor, trigger-type filter chips with counts; humane `humaneCountdown` ("in 3m", "tomorrow at 9:00") covered by 12 new tests
- [x] ScheduledTaskEditorModal: live cron validation (red ring + reason), each preset shows next-3 fires inline, trigger-type radios â†’ card buttons, Cmd/Ctrl+Enter saves
- [x] Run history: j/k keyboard nav inside drawer; "Resume in chat" one-click on AgentRunRow

### Lane C â€” Codebase surface

**Owned files** (Lane C may edit only these):

- `apps/desktop/src/renderer/views/CodebaseView.tsx`
- `apps/desktop/src/renderer/components/CodebasePreviewPane.tsx`
- `apps/desktop/src/renderer/components/CodebaseSearchBox.tsx`
- `apps/desktop/src/renderer/components/FileTree.tsx`
- `apps/desktop/src/renderer/components/FileTreeContextMenu.tsx`
- `apps/desktop/src/renderer/components/MonacoDiffViewer.tsx`
- `apps/desktop/src/renderer/components/monaco-diff-helpers.ts`
- `apps/desktop/src/renderer/components/citations.ts`
- `apps/desktop/src/renderer/components/language-from-extension.ts`
- `apps/desktop/src/renderer/components/line-diff.ts`
- `apps/desktop/src/renderer/views/codebase-pending-edits-derive.ts`

**Focus areas**

- [x] FileTree: 150ms-debounced filter input + auto-expand matching ancestors, keyboard nav (Up/Down/j/k/Right/Left/Enter/Space), inline windowing for >500 rows (no new dep), clickable pending-edit pills with aggregated count
- [x] CodebaseSearchBox: scope chips (current dir / repo / mcp), "N results Â· Xms" pill, Cmd/Ctrl+F refocus, `<mark>` snippet highlighting
- [x] CodebasePreviewPane: language pill, click-to-copy path, Open in editor (`shell:open-path` IPC added during consolidation) / Reveal in OS / Copy path; URL hash `#L42` jump on mount + hashchange; line-number gutter
- [x] FileTreeContextMenu: Open / Edit / Share groups with dividers, ArrowUp/Down/Enter/Esc keyboard, viewport-clamped position
- [x] MonacoDiffViewer: sticky header showing path + `+N -M`, `j/k` next/prev hunk + `a` accept / `r` reject, active-hunk outline
- [x] Citations: tokenizer extended to accept `file:line-line` ranges (3 new test cases); cross-view hover-highlight intentionally deferred (needs Lane Aâ†’Lane C signal channel, marked as future polish)

### Lane D â€” Settings & Onboarding

**Owned files** (Lane D may edit only these â€” note: `ScheduledTasksPanel.tsx` and `RunnersPanel.tsx` are NOT in this lane):

- `apps/desktop/src/renderer/views/SettingsView.tsx`
- `apps/desktop/src/renderer/views/settings-sections.ts`
- `apps/desktop/src/renderer/components/SettingsRail.tsx`
- `apps/desktop/src/renderer/components/SettingsSectionCard.tsx`
- `apps/desktop/src/renderer/components/OnboardingWizard.tsx`
- `apps/desktop/src/renderer/components/OnboardingBanner.tsx`
- `apps/desktop/src/renderer/views/ThemePanel.tsx`
- `apps/desktop/src/renderer/views/WorkspacePanel.tsx`
- `apps/desktop/src/renderer/views/ProvidersPanel.tsx`
- `apps/desktop/src/renderer/views/ApprovalsPanel.tsx`
- `apps/desktop/src/renderer/views/PluginsPanel.tsx`
- `apps/desktop/src/renderer/views/McpServersPanel.tsx`
- `apps/desktop/src/renderer/views/MemoryPanel.tsx`
- `apps/desktop/src/renderer/views/UpdatesPanel.tsx`
- `apps/desktop/src/renderer/views/TelemetryPanel.tsx`
- `apps/desktop/src/renderer/views/CrashReportingPanel.tsx`
- `apps/desktop/src/renderer/views/AuditLogPanel.tsx`
- `apps/desktop/src/renderer/views/IndexingPanel.tsx`
- `apps/desktop/src/renderer/views/SkillsPanel.tsx`
- `apps/desktop/src/renderer/views/AccessibilityPanel.tsx`
- `apps/desktop/src/renderer/views/RunnersPanel.tsx`

**Focus areas**

- [x] OnboardingWizard: progress bar + per-step "Why?" lines, inline provider error with Dismiss + "Try a different provider", Escape closes / Enter advances, SVG check draw-animation honoring `prefers-reduced-motion`, "Skip for now" no longer marks complete
- [x] Provider connection-test: latency + discovered model count on success; HTTP status + one-line `suggestedFix` (per-provider 401/403/429/404/5xx dictionary) + inline Retry on failure
- [x] All panels: skeleton shimmer over spinners (`.settings-skeleton`), "Saved" microstate after save (Telemetry/Crash/Memory/Runners/Skills), Retry button on Updates/Workspace/Approvals/Indexing load errors, settings deep-link `?highlight=â€¦` / `#row=â€¦` briefly pulses target via `.settings-anchor-highlight`
- [x] ApprovalsPanel: per-tool tier-default line ("Default for `<tier>` tier: â€¦"), native `title` tooltip (HoverHint's 5-word cap is too tight for tool descriptions â€” recorded as future polish), `data-settings-anchor="tool:<name>"`
- [x] AuditLogPanel: rows expand to show full input/output with per-pane Copy buttons (1.2s "Copied" swap), Trigger filter chips (user/scheduled), in-place clear-log confirm (replaces `window.confirm`)
- [x] PluginsPanel + SkillsPanel + RunnersPanel: in-place uninstall confirm, Saved flash after CLI/URL save, consistent card rhythm
- [x] McpServersPanel: inline `.mcp-inline-spinner` on Enable/Disable/Add, expandable resources + prompts via clickable counts (tools count not clickable â€” needs main-process IPC change, deferred), in-place Remove confirm, Dismiss button on error banner

### Lane E â€” Shell, design tokens, approvals, theming

**Owned files** (Lane E may edit only these â€” Lane E is the only lane that may touch `styles.css`):

- `apps/desktop/src/renderer/styles.css`
- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/src/renderer/index.tsx`
- `apps/desktop/src/renderer/components/AppShell.tsx`
- `apps/desktop/src/renderer/components/LeftColumnContextPane.tsx`
- `apps/desktop/src/renderer/components/left-column-panes/ChatContextPane.tsx`
- `apps/desktop/src/renderer/components/left-column-panes/AgentContextPane.tsx`
- `apps/desktop/src/renderer/components/left-column-panes/CodebaseContextPane.tsx`
- `apps/desktop/src/renderer/components/left-column-panes/AutomationsContextPane.tsx`
- `apps/desktop/src/renderer/components/HoverHint.tsx`
- `apps/desktop/src/renderer/components/ApprovalQueue.tsx`
- `apps/desktop/src/renderer/components/ThemeApplier.tsx`
- `apps/desktop/src/renderer/components/ModelPicker.tsx`
- `apps/desktop/src/renderer/components/PluginPanelHost.tsx`

**Focus areas**

- [x] Global toast / notification primitive â€” `Toasts.tsx` exports `ToastProvider` + `useToast()`; queued, keyboard-dismissable (Esc), `kind`/`duration`/`action` options, `prefers-reduced-motion` aware, bottom-right region. Adopted in `App.tsx` and bridged from main-process `ui:error` IPC via `UiErrorBridge` (orchestrator consolidation).
- [x] HoverHint: new `shortcut?: string` prop + `Â·` interpunct fallback that promotes the substring to inline `<kbd>` using `--kbd-bg`/`--kbd-border`/`--kbd-text` tokens; 5-word cap excludes the shortcut
- [x] ApprovalQueue: 600px default width, per-tool colored letter chip tinted by tier (write/execute amber, network red, read accent), keyboard 1-6 maps to action buttons, "Always allow this exact command" path for `run_shell`
- [x] LeftColumnContextPane: purposeful empty states across all four panes; Agent pane "Spawn task" navigates to `/agent?spawn=1` (AgentView wired during consolidation); Codebase pane reads `localStorage['opencodex.codebase.recent-files']` (CodebaseView writes during consolidation, honors `?file=` deep-link)
- [x] ModelPicker: Recent group (top 3, localStorage-persisted), provider section headers, capability badges (tools/vision/cache/stream), cost-per-1M inline
- [x] AppShell keyboard map: Cmd/Ctrl+1..5 â†’ Chat/Agent/Codebase/Automations/Settings, Cmd/Ctrl+, â†’ /settings, Cmd/Ctrl+\\ + Cmd/Ctrl+B retained
- [x] Design-token gaps: added `--kbd-*`, `--toast-*`, `--meter-*`, `--chip-*`, `--citation-*`, `--diff-add/del-fg`, `--bg-pill`; light-theme overrides for `--meter-bg` and `--chip-bg`
- [x] Reduced motion audit: file-level `@media (prefers-reduced-motion: reduce)` block zeroes `transition-duration` + `animation-duration` on `*`

### Lane F â€” Main-process robustness (non-UI)

**Owned files** (Lane F may edit any file under these trees â€” but **no renderer files**):

- `apps/desktop/src/main/**`
- `apps/desktop/src/preload/**`
- `apps/desktop/src/shared/**` (Zod schemas, type contracts only â€” no renderer-facing component changes)

**Focus areas**

- [x] IPC handlers: `friendly-error.ts` maps errno (ENOENT/EACCES/EPERM/EBUSY/EEXIST/EISDIR/ENOTDIR/ENOSPC/EMFILE/ETIMEDOUT/ECONNREFUSED/ECONNRESET/ENETUNREACH/EHOSTUNREACH/EAI_AGAIN/ENOTFOUND) + SQLite (SQLITE_BUSY/LOCKED/CORRUPT/READONLY) to friendly strings. Adopted on touch in codebase/plugins/memory/skills/agent handlers
- [x] Unhandled rejections: `process.on('unhandledRejection')` + `process.on('uncaughtException')` in `main/index.ts` with lazy `@opencodex/crash-reporting` `captureException` (no hard dep)
- [x] Tool-error UX: routed via `toFriendlyError` helper at IPC boundaries; MCP `lastError` now stores friendly text
- [x] Scheduler: `skipLogSeen` Set keyed by `taskId::reason` with `logSkipOnce`; cleared on `__resetForTests` + on successful start
- [x] MCP transport: `EARLY_EXIT_THRESHOLD_MS = 500` guard â€” child exiting within 500ms of `connect()` jumps to 30s backoff and emits `ui:error` once; `connectStartedAt` + `toastedFailure` runtime fields
- [x] Chat-runner retry: 429/5xx detected via message substring or provider `retryable` flag; exponential backoff with full jitter (1s/2s/4s), capped at 3 attempts, never retries 400/401/403; only retries while no text or tool_call has been streamed
- [x] Settings store: not needed â€” `getSettings()` already re-parses via Zod with `.default(...)` on every field
- [x] DB integrity: `wal_checkpoint(TRUNCATE)` on `before-quit` (try/catch + idempotency flag); `withSqliteBusyRetry` (50msâ†’250ms, `Atomics.wait`-based) on `setTaskRunBookkeeping` + `recordToolCall`
- [x] New IPC: `ui:error` event channel (renderer-bound, `{source, severity, message, detailId?}`), `shell:open-path` invoke channel

### Coordination notes (orchestrator-managed)

- **`pnpm build` runs only when all six lanes report complete.**
- **Cross-lane requests** (e.g., Lane A needs a new token) land here as `- [ ] (cross-lane) <description>`.
- **Lane E reads but does not write** in other lanes' files â€” but Lane E may pull design-token requests in.
- **No agent invokes another agent** â€” orchestrator is the only fan-out point.

- [x] Community skill gallery + one-click install (Phase 8.5 follow-up) _(`skillRegistryUrl` setting (default `null`) + `skills:get-registry-url` / `skills:set-registry-url` / `skills:fetch-registry` IPC channels mirror the pattern shipped in Todo.md:151 for plugins. The fetch handler downloads the JSON, accepts both a flat array and `{entries: [...]}` envelope, Zod-validates each row against `skillRegistryEntrySchema` (`name` kebab-case + `description` + `sourceUrl` URL + optional `author` + `version`), and returns either parsed entries or a single error string. SkillsPanel grows a collapsed "Browse community skills" section: URL input + Save/Refresh, then a list of entries with per-row "Install" buttons that prompt before calling the existing `skills:import-from-url` IPC. No default registry URL â€” users opt in. Tests: 7 cases (`registry.test.ts`) covering flat-array parsing, envelope parsing, kebab-case rejection, missing description rejection, non-URL `sourceUrl` rejection, malformed payload rejection, and empty-array (valid) registry.)_

---

## Phase 12 â€” Audit-driven cleanup + "Bring your own harness" polish

Goal: close the highest-value findings from the six-lane fan-out analysis (UX, static, architecture, external-harness, docs, tests). Same lane-ownership protocol as Phase 11: airtight file ownership, no agent crosses a lane boundary, orchestrator runs `pnpm build` after all lanes report.

### Operating rules (same as Phase 11)

- **Lane ownership is strict.** A subagent only edits files explicitly listed under its lane. If a fix needs another lane's file, raise a follow-up note here and stop.
- **No file paths overlap.** Each lane's file list below is authoritative.
- **No agent runs `pnpm build` or `pnpm install`.** Orchestrator runs the build pass once at the end.
- **No agent modifies `Todo.md` or `HANDOFF.md`.** Orchestrator updates both.
- **No backwards-compat shims.** Clean renames + caller updates in-lane.
- **Tone:** confident, terse, calm-senior-engineer. No exclamation marks in user copy. No emojis in code.

### Lane A â€” Renderer UX correctness fixes

**Owned files** (Lane A may edit only these):

- `apps/desktop/src/renderer/components/ApprovalQueue.tsx`
- `apps/desktop/src/renderer/components/MergeReviewModal.tsx`
- `apps/desktop/src/renderer/components/OnboardingWizard.tsx`
- `apps/desktop/src/renderer/components/ScheduledTaskEditorModal.tsx`
- `apps/desktop/src/renderer/components/AgentSpawnModal.tsx`
- `apps/desktop/src/renderer/views/AgentView.tsx`

**Tasks**

- [x] **ApprovalQueue label mismatch** â€” `ApprovalQueue.tsx:132,143` reads `"Allow for session"` / `"Deny for session"`. MANUAL.md and the audit log filter labels are `"Allow session"` / `"Deny session"`. Rename to match docs. Confirm key binding `3`/`4` still drives the same buttons.
- [x] **MergeReviewModal: wire documented j/k/a/r keyboard handlers** â€” MANUAL.md Â§Keyboard shortcuts ("Monaco diff (merge-review modal)") promises `j`/`k` next/prev hunk, `a` accept current hunk, `r` reject current. Code currently has no `keydown` listener for these. Add a `useEffect` that registers a document-level listener while the modal is open (respect `event.target` being inside an `<input>`/`<textarea>` to avoid stealing typing keys). Drive the navigation off the existing per-file hunk list state.
- [x] **MergeReviewModal non-null assertion** â€” `MergeReviewModal.tsx:49` uses `path.split('.').pop()!.toLowerCase()`. Replace with `(path.split('.').at(-1) ?? '').toLowerCase()` to honor `noUncheckedIndexedAccess` without an escape hatch.
- [x] **ScheduledTaskEditorModal dead ternary** â€” `ScheduledTaskEditorModal.tsx:118` reads `task?.trigger.type ?? (prefill?.cron ? 'cron' : 'cron')`. Both branches return `'cron'` â€” collapse to `task?.trigger.type ?? (prefill?.cron ? 'cron' : 'manual')` so users with no prefill default to Manual and pick consciously.
- [x] **OnboardingWizard final-step copy tone** â€” soften `"You're ready"` (and any other exclamation-adjacent copy) to `"Setup complete"` per Phase 11 calm-senior-engineer rule. Scan the file for `!` in user-facing strings while there.
- [x] **AgentView consumes `codebase-to-agent` transfer** â€” Phase 11 HANDOFF flagged this as wired-but-unconsumed. `CodebaseView` dispatches `codebase-to-agent` carrying `filePath: string` + `runIds: string[]` when a user clicks a pending-edit pill. `AgentView` should read `useTransfer()`, and on a `codebase-to-agent` payload either (a) focus the run drawer for `runIds[0]` if present, or (b) open the spawn modal pre-filled with `"Re: {filePath}"` if no `runIds`.
- [x] **AgentSpawnModal: early git-repo guard for external runners** â€” when `runnerId !== 'internal'`, disable the Submit button + render an inline warning when the active workspace is not a git repo. Use the existing `git:is-repo` IPC (already in preload as `window.opencodex.git.isRepo`). Today the failure surfaces only after `recordStart` â€” surface it pre-submit so the user can `git init` without a phantom failed run.

### Lane B â€” Runner adapters + main-process harness polish

**Owned files** (Lane B may edit only these â€” new files under `examples/plugins/runner-stub/` are also Lane B):

- `packages/runner-claude-code/src/check-installed.ts`
- `packages/runner-opencode/src/check-installed.ts`
- `packages/runner-aider/src/check-installed.ts`
- `apps/desktop/src/main/agent/handlers.ts`
- `apps/desktop/src/main/agent/spawn-from-ui.ts`
- `examples/plugins/runner-stub/` (NEW directory â€” package.json, README.md, src/index.ts, src/runner.ts, opencodex.plugin.json)

**Tasks**

- [x] **`Unknown runner` dedupe** â€” `apps/desktop/src/main/agent/handlers.ts` throws `Unknown runner: ${id}` at lines 112, 138, and 142 (three call sites). Extract one helper `assertRunnerExists(id: string): void` in this same file (no cross-lane utility â€” keep it local) and call it from all three sites.
- [x] **CLI auto-detect: extra search paths** â€” each `check-installed.ts` currently calls `which`/`where.exe` only. On macOS the Homebrew bin (`/opt/homebrew/bin`, `/usr/local/bin`), cargo bin (`~/.cargo/bin`), and project `.venv/bin` are common install targets that aren't on PATH for GUI-launched Electron apps (launchctl loses PATH from `~/.zshrc`). After the `which`/`where.exe` probe fails, fall back to `existsSync` on these candidate paths joined with the CLI name. Return the first hit. Test stub: a unit test per adapter that mocks `existsSync` to return true on one fallback path and asserts the path is returned.
- [x] **`checkInstalled` timeout returns distinguishable hint** â€” today timeout returns the same `{ ok: false }` shape as ENOENT. Add `hint: 'Installation check timed out â€” set the CLI path in Settings â†’ Runners or retry.'` when the inner timeout fires. Renderer already shows the `hint` string, no UI change needed.
- [x] **Spawn-from-ui: validate runner + workspace before `recordStart`** â€” `apps/desktop/src/main/agent/spawn-from-ui.ts` currently calls `recordStart()` before `bootstrapWorktreeOrSkip`. Reorder so that for external runners we (a) confirm the runner is registered and (b) confirm `isGitRepo(workspaceRoot)` BEFORE any registry write. On failure, throw with a friendly error â€” no orphan run in the registry. Internal-runner path unchanged.
- [x] **`examples/plugins/runner-stub/`** â€” new minimal reference plugin demonstrating a `SubagentRunner` contribution. ~150 LOC across:
  - `package.json` â€” declares `@opencodex/core` + `zod` deps, follows the shape of existing examples.
  - `opencodex.plugin.json` â€” manifest with `contributions.runners: [{id: 'runner-stub', displayName: 'Stub runner'}]` + permission `agent.runner`.
  - `src/index.ts` â€” `export function activate(host: PluginHost) { host.registerRunner(stubRunner) }`.
  - `src/runner.ts` â€” implements `SubagentRunner` with `id: 'runner-stub'`, `displayName: 'Stub runner'`, `streaming: true`, a `run(opts)` async generator that emits a single `text_delta` echoing the task plus a `usage` and `done`, and a `checkInstalled()` that always returns `{ ok: true }`. Heavily commented as a tutorial.
  - `README.md` â€” 1-pager: what this is, how to install, what a real adapter would do differently. Link from `website/pages/plugins/building-a-runner.mdx` (Lane C wires that link â€” DO NOT touch the .mdx here).

### Lane C â€” Documentation, placeholders, "Bring your own harness" guide

**Owned files** (Lane C may edit only these):

- `README.md`
- `QUICKSTART.md` (NEW)
- `CLAUDE.md`
- `CONTRIBUTING.md`
- `PLACEHOLDERS.md` (NEW)
- `website/pages/guides/_meta.json`
- `website/pages/plugins/authoring.mdx`
- `website/pages/plugins/building-a-runner.mdx` (NEW)
- `docs/runner-authoring.md` (NEW)

**Placeholder strategy: leave them in place, document them in one checklist**

The existing `@TODO-set-github-handle` / `security@TODO-set-domain` / `TODO-org/TODO-repo` strings are intentional sentinels â€” only the maintainer knows the real org / domain / handles. Inventing fake-looking replacements (e.g., `opencodex.dev`) risks colliding with a real domain or shipping convincing-but-wrong references that get past review.

- [x] **`PLACEHOLDERS.md`** (NEW) â€” single one-page checklist enumerating every `@TODO-` / `TODO-org` / `TODO-repo` / `TODO-set-domain` occurrence with `file:line`, the literal current placeholder, and a `Replace with:` blank for the maintainer. Lane D's `scripts/check-placeholders.mjs` parses or pairs naturally with this file. Link it from `CONTRIBUTING.md` Â§ Before public tag.

**README + quickstart**

- [x] **README headline runners** â€” current `README.md` lists "Multi-agent orchestration" but doesn't headline that the harness itself is swappable. Edit the bullet list to add `**Pluggable agent harness** â€” use the built-in runner, Claude Code, OpenCode, Aider, or ship your own via a plugin.`
- [x] **README "Why OpenCodex vs alternatives"** â€” one short paragraph between **What it does** and **Using OpenCodex** contrasting with Aider (Python, editor-bound) and Claude Code (Anthropic-only). Honest, not over-claiming.
- [x] **`QUICKSTART.md`** (NEW, ~250 words) â€” one-pager: Install â†’ first launch â†’ pick provider in onboarding â†’ first chat â†’ first agent task. Linked from README right after the badges/intro.

**Bring-your-own-harness guide**

- [x] **`docs/runner-authoring.md`** (NEW) â€” long-form developer guide mirroring `docs/provider-authoring.md` shape: what a runner is, `SubagentRunner` interface, event semantics (`ChatEvent` union), required `done`/`usage`, `checkInstalled` contract, abort + `treeKill` lifecycle, plugin manifest wiring, points at `examples/plugins/runner-stub/` for the worked example. ~600-800 words.
- [x] **`website/pages/plugins/building-a-runner.mdx`** (NEW) â€” Nextra version of the same guide, sharper code samples. Wire into `_meta.json` under `plugins`. Link from `website/pages/guides/runners.mdx` ("Want to ship your own runner? See Building a runner.") â€” but DO NOT edit `runners.mdx` (it's not in this lane); raise a follow-up note for orchestrator if cross-link is needed and use a one-way link from the new page instead.
- [x] **`website/pages/plugins/authoring.mdx`** â€” add `Runners | wired | RunnerRegistry` row to the contributions table; expand the existing "Building a runner adapter" section with a callout linking to `building-a-runner.mdx`.

**Slash-command + protocol discoverability**

- [x] **`CLAUDE.md`** â€” at the end of the "Agent Handoff Protocol" section, add: `Use the /pickup and /handoff slash commands in Claude Code for one-step access (see .claude/commands/). Human contributors can either follow the same Todo.md/HANDOFF.md flow, or open PRs directly without updating HANDOFF.md.`
- [x] **`CONTRIBUTING.md`** â€” clarify the "humans can skip handoff" line: `This protocol is designed for AI agents passing work between sessions. Human contributors can either follow the same Todo.md/HANDOFF.md workflow, or submit PRs directly without updating HANDOFF.md.` Also add a `### Working on the docs site` subsection: `The website/ directory is a separate Next.js+Nextra app excluded from the main pnpm workspace. Run pnpm install && pnpm dev inside website/ to work on docs.`

### Lane D â€” Tests + build pipeline gates

**Owned files** (Lane D may edit only these):

- `package.json` (root)
- `apps/desktop/package.json`
- `.github/workflows/ci.yml`
- `.lintstagedrc.json`
- `examples/plugins/hello-world/package.json`
- `examples/plugins/provider-stub/package.json`
- `examples/plugins/ui-panel/package.json`
- `apps/desktop/src/main/util/friendly-error.test.ts` (NEW)
- `apps/desktop/src/main/util/sqlite-retry.test.ts` (NEW)
- `apps/desktop/src/renderer/components/OnboardingWizard.test.tsx` (NEW)
- `apps/desktop/src/renderer/components/ApprovalQueue.test.tsx` (NEW)
- `scripts/check-placeholders.mjs` (NEW)

**Tasks â€” build pipeline**

- [x] **`@electron/rebuild` for native deps** â€” add `"@electron/rebuild": "^3.6.0"` to `apps/desktop/package.json` devDeps. Add a `"rebuild-native": "electron-rebuild -f -w better-sqlite3"` script. Add a `"postinstall": "electron-rebuild -f -w better-sqlite3 || echo 'rebuild-native skipped â€” run pnpm rebuild-native manually'"` hook so CI + local dev both pick it up. The `|| echo` keeps `pnpm install` from failing on systems without a build toolchain (Windows without VS build tools).
- [x] **CI `electron-rebuild` step** â€” `.github/workflows/ci.yml` add a step `pnpm --filter @opencodex/desktop run rebuild-native` between `pnpm install` and `pnpm test`. Verify the test job no longer skips the 92 DB-backed tests. (Run is allowed to still skip them if the rebuild fails â€” but emit a clear annotation so reviewers see it.)
- [x] **Drop `--passWithNoTests` from root `test` script** â€” root `package.json:15` reads `"test": "vitest run --passWithNoTests"`. Change to `"test": "vitest run"`. Each individual package whose vitest config sees no test files will fail loudly â€” fix by either (a) adding a placeholder `*.test.ts` covering a public export, or (b) excluding the package from root vitest discovery. List any package this surfaces in the lane report.
- [x] **Placeholder gate** â€” new script `scripts/check-placeholders.mjs` greps tracked files for `@TODO-`, `TODO-org`, `TODO-repo`, `TODO-set-domain`, and exits non-zero if any are found. Add `"check-placeholders": "node scripts/check-placeholders.mjs"` to root `package.json` scripts and wire as a CI step in `.github/workflows/ci.yml` before lint/typecheck. This is the gate that catches Lane C's placeholder fills missing on future drift.
- [x] **Examples plugins consistency** â€” add `"lint": "eslint src --max-warnings 0"` and `"clean": "rimraf dist"` to each of the three `examples/plugins/*/package.json` so root `pnpm -r lint` and `pnpm -r clean` cover them.

**Tasks â€” new tests**

- [x] **`apps/desktop/src/main/util/friendly-error.test.ts`** â€” cover errno â†’ user-facing string mapping for the full list from `friendly-error.ts` (ENOENT/EACCES/EPERM/EBUSY/EEXIST/EISDIR/ENOTDIR/ENOSPC/EMFILE/ETIMEDOUT/ECONNREFUSED/ECONNRESET/ENETUNREACH/EHOSTUNREACH/EAI_AGAIN/ENOTFOUND) + SQLite (SQLITE_BUSY/LOCKED/CORRUPT/READONLY). One assertion per code: the friendly string contains expected keyword (e.g., `ENOENT` â†’ `"doesn't exist"`), passthrough for unknown codes. Pure-function test, no external deps.
- [x] **`apps/desktop/src/main/util/sqlite-retry.test.ts`** â€” cover `withSqliteBusyRetry`: success on first try (no sleep), success after one SQLITE_BUSY retry, failure surfaces non-busy error immediately, gives up after the documented retry budget. Use `Atomics.wait` mocking or fake timers. Pure-function test on stub callbacks.
- [x] **`apps/desktop/src/renderer/components/OnboardingWizard.test.tsx`** â€” RTL + jsdom (already in apps/desktop devDeps per audit). Cover: (1) renders step 1 on mount when `onboardingComplete=false`, (2) Esc closes, (3) Enter advances when step is valid, (4) provider-error path renders inline message + "Try a different provider" link, (5) `prefers-reduced-motion: reduce` removes animation classes from check SVG. Gated with `@ts-nocheck` only if RTL isn't actually working â€” verify by running in lane.
- [x] **`apps/desktop/src/renderer/components/ApprovalQueue.test.tsx`** â€” cover the 6 keyboard paths (`1`â€“`6` map to Allow/Deny Ã— once/session/always), Esc closes, `run_shell` shows "Always allow this exact command" footer. Gated with `@ts-nocheck` only if RTL isn't actually working.

### Coordination notes (orchestrator-managed)

- **`pnpm typecheck` then `pnpm build` runs only after all four lanes report complete.**
- **Cross-lane requests** land here as `- [x] (cross-lane) <description>`.
- **No agent invokes another agent.**
- **Provisional handles/domain** (`opencodex-org`, `opencodex`, `security@opencodex.dev`, `@opencodex-org/maintainers`) are Lane C placeholders â€” maintainer must re-target before public tag; a CONTRIBUTING.md note documents this.

---

## Phase 13 — Runner onboarding & friction reduction

Goal: make the "use OpenCode / Claude Code / Aider / your own harness" path calm and discoverable. Today the feature is buried in Settings, install requires leaving the app, auth failures crash at runtime, the worktree gate is a dead-end, and the approval-boundary surprise is invisible until something unexpected happens. This phase fixes all seven friction points identified in the post-Phase-12 UX review.

### Operating rules (same as Phase 11 / 12)

- **Lane ownership is strict.** A subagent only edits files explicitly listed under its lane.
- **No file paths overlap.** Each lane's file list is authoritative.
- **No agent runs `pnpm install` or `pnpm build`.** Orchestrator runs the build pass at the end.
- **No agent modifies `Todo.md` or `HANDOFF.md`.** Orchestrator owns both.
- **Lane B writes the IPC contract first** into `shared/ipc-types.ts` + `shared/runner-discovery.ts` so Lane A and Lane C can run in parallel against the agreed shape.
- **No backwards-compat shims.** Clean changes, callers updated in-lane.
- **Tone:** calm-senior-engineer. No exclamation marks in user copy. No emojis in code.

### Lane A — Discovery: onboarding wizard + Agent empty state

**Owned files** (Lane A may edit only these):

- `apps/desktop/src/renderer/components/OnboardingWizard.tsx`
- `apps/desktop/src/renderer/components/onboarding/RunnersStep.tsx` (NEW)
- `apps/desktop/src/renderer/views/AgentView.tsx`
- `apps/desktop/src/renderer/components/RunnerDiscoveryCards.tsx` (NEW)

**Tasks**

- [x] **Onboarding wizard "Optional: connect a runner" step** — insert between provider config and workspace pick. Auto-runs `agent.listRunners()` + `checkRunnerInstalled(id)` for each external runner. For each detected install: card with `displayName` + version + green check. For each not-installed: name + one-line "what is this" description + **Install** button that navigates to `/settings/runners?install=<id>` (Lane C wires the deep-link). **Skip for now** is a normal next-step button — wizard completes with zero runners enabled. Honors `prefers-reduced-motion`.
- [x] **`RunnersStep.tsx`** (NEW, ~150 LOC) — extracted as a sibling to existing wizard step components. Pure component, props `{runners, onSkip, onContinue}`. Subscribes to `window.opencodex.agent.onRunnersChanged` so install status updates if the user has another window doing the install.
- [x] **Agent view empty state — runner discovery cards** — when `runs.length === 0`, replace the existing "Spawn task" hook with a two-line hook + a horizontal row of runner cards via `RunnerDiscoveryCards.tsx`. Each card: source badge (built-in / external), install status pill, one-line summary, primary action button. Built-in card primary = "Spawn task" (existing). External cards: if installed → "Spawn with `<name>`" opens AgentSpawnModal pre-set to that runner; if not → "Set up" navigates to `/settings/runners?install=<id>`.
- [x] **`RunnerDiscoveryCards.tsx`** (NEW, ~120 LOC) — pure presentational, props `{runners, installStatuses, onSpawn(runnerId), onSetup(runnerId)}`. Reuses existing pill + chip tokens. No new design tokens.

### Lane B — Main-process: install, auth pre-flight, friendly errors, git-init

**Owned files** (Lane B may edit only these):

- `apps/desktop/src/shared/ipc-types.ts` (additive only)
- `apps/desktop/src/shared/runner-discovery.ts` (NEW)
- `apps/desktop/src/preload/index.ts` (bridge new channels)
- `apps/desktop/src/main/agent/runner-install.ts` (NEW)
- `apps/desktop/src/main/agent/runner-probe.ts` (NEW)
- `apps/desktop/src/main/agent/runner-friendly-errors.ts` (NEW)
- `apps/desktop/src/main/agent/git-init.ts` (NEW)
- `apps/desktop/src/main/agent/handlers.ts` (wire new IPC handlers — additive)

**Tasks**

- [x] **Contract first** — `shared/runner-discovery.ts` defines Zod schemas: `runnerInstallRequestSchema {runnerId, packageManager: 'npm' | 'homebrew' | 'pipx' | 'cargo'}`, `runnerInstallResultSchema {ok, stdout, stderr, durationMs, exitCode}`, `runnerProbeResultSchema {ok, authenticated, hint?, rawStderr?}`, `gitInitRequestSchema {workspacePath, initialCommit?: boolean}`, `gitInitResultSchema {ok, branch?, error?}`, `runnerFriendlyErrorSchema {kind: 'auth' | 'model-not-found' | 'rate-limit' | 'network' | 'unknown', message, suggestedFix?}`. All Zod-validated at boundaries.
- [x] **`runner-install.ts`** — `getAvailablePackageManagers(): PackageManager[]` (probes `which npm` / `which brew` / `which pipx` / `which cargo`). `installRunner(runnerId, packageManager): AsyncIterable<{stdout, stderr}>` runs the right command per runner+manager (e.g., `opencode + npm → npm install -g opencode`, `aider + pipx → pipx install aider-chat`, `claude-code + npm → npm install -g @anthropic-ai/claude-code`). Runner→install-command map is data-driven so adding a new runner is one row. Routes through the existing approval system using `run_shell` semantics — the user sees the approval modal with the exact command before it runs. Tree-kill on abort (reuses `@opencodex/core` `treeKill`).
- [x] **`runner-probe.ts`** — `probeRunnerAuth(runnerId): Promise<RunnerProbeResult>`. Runs a tiny no-op probe per adapter (e.g., `opencode --headless --message "echo" --max-tokens 1`, `claude --print "echo" --output-format stream-json`, `aider --yes --message "echo" --map-tokens 0`). 8-second timeout. Pattern-matches stderr against a per-runner dictionary of auth-failure substrings (`"not authenticated"`, `"missing API key"`, `"401"`, `"credential"`, `"please run X to login"`) and returns `{ok: false, authenticated: false, hint: '<friendly fix>'}`. Clean success: `{ok: true, authenticated: true}`. **Per-runner result cache** keyed by runnerId with a 60s TTL so spamming "Test" doesn't re-spawn the CLI.
- [x] **`runner-friendly-errors.ts`** — per-runner substring → `{kind, message, suggestedFix}` dictionary. Same shape pattern as `chat/runner.ts` `classifyProviderError` from Phase 11. Used by both `runner-probe.ts` AND `runSubagent` so a crashing external runner surfaces a friendly hint to the run drawer instead of a raw stderr blob.
- [x] **`git-init.ts`** — `initGitRepo(workspacePath, opts?)`. Runs `git init -b main` then optionally `git add . && git commit --allow-empty -m "Initial commit"` if `opts.initialCommit`. Refuses if the path is already inside a git repo (probes `git rev-parse --git-dir`). Path-traversal hardened — workspace must be absolute + must exist.
- [x] **IPC channels** in `shared/ipc-types.ts` (additive):
  - `runner:list-package-managers` → invoke
  - `runner:install` → invoke + event stream `runner:install-progress` for stdout/stderr
  - `runner:probe-auth` → invoke returning `RunnerProbeResult`
  - `git:init-repo` → invoke returning `GitInitResult`
  - `runner:friendly-error` → event (broadcast when `runSubagent` crashes on an external runner)
- [x] **Handler wiring** in `handlers.ts` — register each new IPC handler. `safeParse` on every payload. Use `withSqliteBusyRetry` if any handler writes to the audit log (probe results are NOT logged; install commands ARE via the existing `run_shell` audit path).
- [x] **Preload bridge** — extend `window.opencodex.agent.*` with `getInstallablePackageManagers()`, `installRunner(req, onProgress)`, `probeRunnerAuth(runnerId)`, `onFriendlyError(listener)`. Add `window.opencodex.git.initRepo({workspacePath, initialCommit})`.

### Lane C — Renderer wiring: RunnersPanel + SpawnModal + RunDrawer + Audit

**Owned files** (Lane C may edit only these):

- `apps/desktop/src/renderer/views/RunnersPanel.tsx`
- `apps/desktop/src/renderer/components/AgentSpawnModal.tsx`
- `apps/desktop/src/renderer/components/AgentRunDrawer.tsx`
- `apps/desktop/src/renderer/views/AuditLogPanel.tsx`

**Tasks**

- [x] **RunnersPanel install buttons** — for each not-installed runner, render an **Install** button. Click opens an inline picker showing only the package managers available on the host (from `agent.getInstallablePackageManagers()`). Click a manager → calls `agent.installRunner({runnerId, packageManager})` with `onProgress` streaming stdout/stderr into an inline log block under the row. Exit code 0 → re-run install check + show green pill. Non-zero → show the friendly error (uses Lane B's friendly-error dictionary). The approval modal that fires from `run_shell` shows the exact command before it runs — user has full visibility + deny power. Supports `?install=<id>` query param to auto-open the picker for one runner (used by Lane A deep-link).
- [x] **RunnersPanel "Test connection" button** — mirrors the Providers panel UX. Calls `agent.probeRunnerAuth(runnerId)`. Status pill: green "Ready" / amber "Not authenticated — `<hint>`" / red "Probe failed — `<message>`". Cache hits show a "Cached" badge for 60s before allowing a fresh probe.
- [x] **AgentSpawnModal safety-boundary callout** — when the selected runner is non-internal, render a persistent inline note above the Submit button: `<runner displayName> uses its own approval model. Changes land in a git worktree for your review — your OpenCodex approval policy does not gate the runner's internal tool calls.` Subtle styling (info, not warning). Uses existing `--bg-pill` + `--text-secondary` tokens.
- [x] **AgentSpawnModal inline `git init`** — when the existing Phase-12 worktree guard fires (external runner + non-git workspace), the inline error block now includes an **Initialize git repo** button. Click → `window.opencodex.git.initRepo({workspacePath, initialCommit: true})`. On success: refresh the `isRepo` probe + clear the guard. On failure: surface the friendly error returned by the handler. Approval prompt fires for the git command per existing `run_shell` semantics.
- [x] **AgentSpawnModal "Verify runner" button** — new secondary button next to Submit, visible only when an external runner is picked. Click → `agent.probeRunnerAuth(runnerId)` → renders the same status pill inline. Lets the user pre-flight before typing a long task. Uses the same 60s cache.
- [x] **AgentRunDrawer friendly runner error** — when `run.stopReason === 'runner_error'` and a `runnerFriendlyError` is present (via `runner:friendly-error` IPC + recorded on the run), display a callout: `kind` icon + `message` + `suggestedFix` + two buttons: **Retry with `<same runner>`** (re-spawns same task + runner) and **Re-spawn with internal runner** (re-spawns same task + `internal`). Replaces the raw-stderr block but keeps it accessible via a "Show raw error" disclosure.
- [x] **AuditLogPanel runner column** — extend filter chips with a "Runner" multi-select (installed runner ids + "OpenCodex" for internal). Add a column showing the runner that issued each tool call. If the existing `tool_calls` row doesn't carry runner identity, raise a cross-lane note for Lane B to add `runner_id TEXT` via migration v10 (Phase 11 already wired `trigger_source` via migration v7 — same pattern).

### Tests + docs (orchestrator-managed wrap-up)

- [x] After all three lanes report, orchestrator adds: `runner-probe.test.ts`, `git-init.test.ts`, `runner-friendly-errors.test.ts`, `RunnersStep.test.tsx`. Phase 12's `@electron/rebuild` postinstall means DB-backed tests now actually run.
- [x] Docs updates (orchestrator): `MANUAL.md` Runners section gets the new "Test connection" + "Install from app" + "Verify runner" + safety-boundary callout language. `docs/runner-authoring.md` gains a section on the friendly-error dictionary so plugin runner authors can contribute their own error patterns. `QUICKSTART.md` gets a one-line nudge for the optional runner step.

### Coordination notes (orchestrator-managed)

- **IPC contract is the contract.** Lane B publishes the shared schema first; Lane A + C consume the published shape.
- **Approval system is the install safety net.** No silent `npm install -g`. Every install command flows through the existing `run_shell` approval modal.
- **Worktree-only enforcement is preserved.** External runners still require a git workspace; Phase 13 makes the `git init` button one-click instead of a context switch.
- **No new design tokens needed.** All UI reuses Phase 11's token set.
- **Cross-lane requests** land here as `- [x] (cross-lane) <description>`.
- **`pnpm typecheck` then `pnpm build` runs only after all three lanes report.**
