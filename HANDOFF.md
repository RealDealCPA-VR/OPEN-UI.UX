# Handoff State

## Last Session Summary

- **Massive Todo.md sweep complete via 15 subagents across 2 parallel waves + main-session work.** Baseline 423 tests → now **671 passing + 7 skipped across 70 files**. Lint, typecheck, build all green. Three commits land the work:
  - `26fee85` — main-session sweep across Phase 0–6 (Playwright/CI, OpenAI Responses, MCP transports + manager + UI, plugin loader + manager UI + examples, spawn_subagent + orchestrator prompt, onboarding wizard, docs, electron-builder.yml, search_codebase, ignore parser, read-only mode, citations, file tree)
  - `a1f4bcc` — Wave 1 (7 subagents in parallel): MCP slash commands, SQLite FTS5, chokidar watcher, git worktrees, utilityProcess subagent workers, agent inspector UI + run registry, plugin UI panel iframe sandbox
  - `5d91029` — Wave 2 (6 subagents in parallel): Monaco diff viewer (lazy-loaded 6.35MB chunk), xterm.js terminal (lazy 401KB chunk), tree-sitter chunker (new @opencodex/rag-chunker package), LanceDB vector store (SQLite-shim fallback), subagent merge-review flow, MCP resource → FTS5 indexing
- **Bundle code-splits cleanly**: renderer main `597 kB`, Monaco editor `6.35 MB` (lazy on first diff modal), xterm `401 kB` (lazy on first Terminal pill click).
- **Every remaining unchecked Todo item** is either external-account gated (code signing, OAuth, GitHub Releases, telemetry, Sentry, GitHub Pages docs site, public announcement) or explicitly post-v0.1 backlog. There are no more in-scope implementation items.

## Verify Before Continuing

- [ ] **Run from repo root:** `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build`. Expect 671 passing, 7 skipped, 70 files. If `pnpm format:check` complains run `pnpm format` to apply Prettier — many new files were authored Prettier-compatible but not run through it.
- [ ] **Smoke the heavy new UIs (none of these have visual tests):**
  - MCP servers panel — install Filesystem preset, see status pill go connecting → connected, see tools surface as `mcp__filesystem__*` in `tools:list`.
  - Plugin install flow — `pnpm --filter @opencodex-example/hello-world build`, install from folder, grant permissions, confirm `plugin__<id>__hello_world` appears in `tools:list`.
  - Onboarding wizard — clear `onboardingComplete` setting, launch app, walk through 4 steps.
  - Read-only chat mode toggle — Settings → Indexing. With it on, agent attempts to call `write_file` get `denied` from ApprovalManager.
  - Codebase tab file tree — pick a workspace, lazy-expand subdirs.
  - Slash commands in chat composer — connect an MCP server with prompts, type `/` in an empty line.
  - Agent inspector — call `spawn_subagent`, watch the AgentView table populate live with status, tokens, current tool, expandable timeline.
  - Monaco "View in Monaco" button — accept a write/edit approval, click View in Monaco, exercise per-hunk accept/reject. Confirms the 6.35MB chunk loads.
  - xterm Terminal pill — run a `run_shell` call, click Terminal pill on the ToolCallCard, confirm ANSI passthrough.
  - Merge review modal — manually `recordStart` a run with a worktreePath, see Review changes button on AgentRunRow, accept/reject.
- [ ] **Per-platform packaging:** `pnpm --filter @opencodex/desktop dist` on mac/win/linux produces the expected artifacts (signing creds still required for mac/win prod).

## Next Task

There are no in-scope implementation items left. Everything unchecked is one of:

- **External account / cert required** (lines 20, 116, 172, 173, 174, 176, 177, 178, 184):
  - GitHub Actions `release.yml` — needs a GitHub repo + Releases configured.
  - OAuth for MCP servers — needs the user to register OAuth apps per provider.
  - electron-updater + GitHub Releases wiring — needs a published release feed URL.
  - macOS code signing + notarization — needs an Apple Developer account ($99/yr).
  - Windows code signing — needs an Authenticode cert (DigiCert/Sectigo).
  - Telemetry (PostHog or self-hosted Plausible) — needs an account or self-hosted server.
  - Sentry crash reporting — needs a Sentry DSN.
  - Docs site (Docusaurus or Nextra on GitHub Pages) — needs the site set up + a custom-domain or `*.github.io` URL.
  - Public v0.1 release announcement — needs the user to actually write + post it.
- **Blocked on docs site** (line 152): Plugin docs site section with SDK API reference — depends on the docs site above.
- **Backlog post-v0.1** (lines 190–195): Cloud / background tasks (needs a backend), voice mode, mobile companion app, team workspaces, visual workflow builder, JetBrains / VSCode integration. All explicitly post-v0.1 per Todo.md's own header.

When the user is ready, the natural first sprint after that would be to wire the existing `LanceVectorStore` (currently SQLite-shim) to a real `@lancedb/lancedb` install, then plug the `chunkBySymbols` chunker into a real incremental indexer driven by the existing chokidar watcher.

## Context Notes

### Permission constraint observed in subagents

- **Subagents run under a stricter sandbox than the main session.** Three subagents this run had Bash / PowerShell denied for pnpm calls (Playwright agent, LanceDB agent — couldn't run install, and the Tree-sitter agent had limited shell). Their results were still merged into the working tree; the main session verifies CI after each wave. **Plan accordingly:** when a subagent needs to add a new npm dep or run install, factor in the risk it can't actually run pnpm — its file output may still be correct, but unverified.

### Wave 1 architecture (committed in `a1f4bcc`)

- **MCP prompts as slash commands** — `getAvailablePrompts()` in `apps/desktop/src/main/mcp/manager.ts` returns only prompts from enabled+connected servers. Composer detects `/` at start of a line via `getSlashTrigger` in `slash-commands.ts`; arrow/enter/tab/escape keyboard nav; selection inserts `/<serverId>:<prompt> arg=<placeholder>`.
- **SQLite FTS5** — migration version `5` adds `indexed_files USING fts5(path, content, tokenize='unicode61')` + `indexed_files_meta`. `searchKeyword` uses `bm25()` + `snippet()` with safe token sanitization. New `apps/desktop/src/main/storage/codebase-index.ts`.
- **chokidar watcher** — `WorkspaceWatcher` in `apps/desktop/src/main/rag/watcher.ts` with 250ms-debounced batches; respects `.gitignore` + `.opencodexignore`; subscribed via `settingsStore.onDidChange('activeWorkspace', …)` in `main/index.ts`.
- **Git worktrees** — `apps/desktop/src/main/agent/worktrees.ts` uses `execFile` (no shell injection); worktrees land at `<repoRoot>/.opencodex/worktrees/<random-id>` on branch `opencodex/subagent/<id>`. `it.skipIf(!gitAvailable)` for the integration tests; `isGitRepo` returns false on non-existent paths.
- **utilityProcess workers** — `apps/desktop/src/main/agent/worker-host.ts` softly imports `electron` so `isUtilityProcessAvailable()` returns false in vitest; `spawn_subagent` dispatches to worker when in Electron, falls back to inline `runSubagent`. `worker-protocol.ts` is Zod-validated on both sides. `electron.vite.config.ts` emits `out/main/agent/worker-entry.js`.
- **Agent inspector** — `run-registry.ts` is 100-entry capped, newest-first, listener-based change notifications. `AgentView` ticks every 1s only while runs are running. `AgentRunRow` expands to show the per-tool-event timeline.
- **Plugin UI panel iframe sandbox** — `sandbox="allow-scripts"` only (no `allow-same-origin`); inbound messages authenticated via reference identity (`event.source === iframe.contentWindow`) since `file://` origin is `"null"`. `handlePanelMessage` is the pure handler for tests.

### Wave 2 architecture (committed in `5d91029`)

- **Monaco diff viewer** — `MonacoDiffViewer.tsx` lazy-loads via React.lazy; pure helpers in `monaco-diff-helpers.ts` are vitest-tested independently (Vite can't resolve `monaco-editor` package in test graph). Wired into `ApprovalQueue` write_file / edit_file flows with "View in Monaco" button + lazy modal. Bundle: 6.35MB editor chunk only on first open.
- **xterm.js terminal** — `EmbeddedTerminal.tsx` lazy-loads xterm + fit addon on mount; subscribes to `shell:output` IPC events filtered by `streamId + toolUseId`; queues frames that arrive before xterm initializes. v1 emits a single final event per run_shell call (NOT mid-stream); IPC schema already supports `final: boolean` for the future streaming bump. Pre-seeds the terminal locally from cached result so it populates immediately on open.
- **Tree-sitter chunker** — `packages/rag-chunker` is a NEW workspace package; `web-tree-sitter@^0.22.6` is the only new dep (did NOT bundle `tree-sitter-wasms`). Hosts use `registerGrammar(lang, wasmPathOrBytes)` to opt into grammars they ship. `chunkBySymbols` falls back to `chunkBySize` when no grammar is registered.
- **LanceVectorStore (SQLite shim)** — `apps/desktop/src/main/rag/vector-store.ts`. NOT LanceDB — the subagent couldn't run `pnpm add @lancedb/lancedb`. Same public API a real LanceDB adapter would expose: `open`, `upsert`, `searchByVector`, `clear`, `count`. Cosine similarity computed in JS over Float32Array BLOBs. Float32Array decode pre-aligns via a Uint8Array copy (Node Buffer can start at non-aligned offsets).
- **Merge review** — `prepareMergeBundle` parses `diff --git a/X b/X` lines for the file list; `acceptMerge` is `git merge --no-ff <branch>` then `removeWorktree`. `recordStart` accepts optional worktree fields; `mergeStatus` defaults to `'pending'` only when a worktreePath is present, else `null`. `spawn_subagent` does NOT auto-attach a worktree yet — wiring is in place so a manually-created worktree run can be reviewed.
- **MCP resource indexing** — `resource-indexer.ts` upserts `mcp:<serverId>:<uri>` keys into the FTS5 `indexed_files` table; debounced 1s on `onMcpServerConnected`. `search_codebase` now tags each hit with `source: 'workspace' | 'mcp'`. Stale-entry pruning when a server unpublishes a resource is a future cleanup.

### Carry-overs still relevant from earlier sessions

- Node v20 pinned. Don't suggest a Node upgrade. `better-sqlite3` must be rebuilt against Node 20 — `pnpm install --force` was the fix this run.
- Path has space + period (`OPEN UI.UX`) — quote in shell.
- `packages/*` tsconfig is `noEmit: true` — switch to `tsup` before any `pnpm publish`.
- Pre-public placeholders remain in CODEOWNERS / SECURITY.md / README.md: `@TODO-set-github-handle`, `security@TODO-set-domain`, `github.com/TODO-org/TODO-repo`.

### Uncommitted state

Working tree is clean. Three commits added this session.
