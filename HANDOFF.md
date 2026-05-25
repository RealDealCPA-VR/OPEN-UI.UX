# Handoff State

## Last Session Summary

- **Massive Todo.md sweep across all phases.** Started from 423 tests / 47 files baseline. Now: **462 tests passing, 7 skipped, 55 files; lint, typecheck, build all green.** Bundle: main `68.56 kB`, preload (now larger with MCP/plugin/onboarding bridges), renderer JS `445.48 kB`, renderer CSS `49.87 kB`.
- **Phases shipped end-to-end:** Phase 0 polish (Playwright + ci.yml build step), Phase 1 (OpenAI Responses API + provider fixtures across all 7 adapters + Voyage embeddings adapter), Phase 2.5 MCP client (3 transports + manager + ToolRegistry surfacing + presets + auto-reconnect + Settings UI), Phase 4 plugin system (loader + permissions + 3 example plugins + manager UI + marketplace stub), Phase 5 multi-agent (`spawn_subagent` tool + budgets + orchestrator prompt + failure handling), Phase 6 onboarding wizard + 5 architecture/security/plugin/MCP/provider docs, Phase 3 ranked search_codebase tool + .gitignore/.opencodexignore parser + read-only chat mode + citation tokenizer, Phase 2 UI file tree.
- **Better-sqlite3 ABI blocker resolved** with `pnpm install --force`. No need for the deeper rebuild steps the prior handoff outlined.

## Verify Before Continuing

- [ ] **Run the smoke check from repo root:** `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build`. Expect 462 tests passing, 7 skipped across 55 files. If `pnpm format:check` complains, run `pnpm format` to apply Prettier (newly created docs + several new files were authored Prettier-compatible but not run through it in-session).
- [ ] **MCP server connection (Settings → MCP servers).** With `npx` on PATH: add the Filesystem preset → status goes connecting → connected; tool count increments; the agent's `tools:list` includes `mcp__filesystem__<tool>` entries. Disable → tools deregister; remove → preset reappears in the "Curated presets" list.
- [ ] **Plugin install flow.** Settings → Plugins → Install from folder. Pick `examples/plugins/hello-world` (after `pnpm --filter @opencodex-example/hello-world build`). Plugin lands as `pending-permissions` if any; grant → `loaded`. `tools:list` includes `plugin__<id>__hello_world`. Disable → unregisters.
- [ ] **`spawn_subagent` tool.** Ask the orchestrator to delegate something — `ORCHESTRATOR_SYSTEM_PROMPT` in `main/agent/orchestrator-prompt.ts` is the suggested system message. Verify subagent runs in-process (no utilityProcess yet), respects `maxToolIterations` / `maxTokens` / `maxWallTimeMs`, returns text + stopReason + iteration count.
- [ ] **Onboarding wizard.** Clear `onboardingComplete` setting → first launch → 4-step overlay (provider → API key → workspace → done). Skip closes wizard + sets the flag.
- [ ] **Read-only chat mode.** Toggle in Settings → Indexing. With it on, every non-read tool call returns `denied` from the approvals manager before reaching the user.
- [ ] **File tree.** Codebase tab → workspace tree, lazy-expand on click, respects `.gitignore` + `.opencodexignore`, switches when workspace changes.

## Next Task

Everything still unchecked in `Todo.md` falls into one of three buckets — pick from the second one if you want to keep adding features:

1. **External / signup required (skip until the user provides creds)** — `release.yml`, electron-updater with GitHub Releases, macOS notarization, Windows code signing, telemetry (PostHog/Plausible), Sentry crash reporting, GitHub Pages docs site, OAuth for MCP servers, public v0.1 announcement.
2. **Implementable but deferred for scope** — Monaco diff viewer (lazy-load chunk), xterm.js terminal, tree-sitter chunker, LanceDB vector store, SQLite FTS5, chokidar file watcher, MCP prompt → slash command composer wiring, MCP resource → RAG integration, plugin UI panel iframe sandbox + postMessage bridge, utilityProcess subagent workers, git worktree integration, agent inspector UI, subagent merge-review flow, plugin docs site section.
3. **Backlog post-v0.1** — cloud/background tasks, voice mode, mobile companion, team workspaces, visual workflow builder, JetBrains/VSCode integration.

Recommended next sprint: **utilityProcess subagent workers → git worktree integration → merge-review flow** (the Phase 5 trio that unblocks real parallel agent runs).

## Context Notes

### Permission constraint (new this session)

- **Subagents spawned via `Agent` tool can be denied Write/Bash by the user's permission sandbox.** Three subagents launched in parallel: Playwright was blocked entirely; the OpenAI Responses + fixtures agent worked through it; the docs agent worked but couldn't run `pnpm format:check`. Future automation should be aware that subagent file-writes may need explicit approval and plan accordingly (in-session main thread retains full Write/Bash).

### MCP architecture invariants

- **Three transports live in `packages/mcp-client/src/`**: `stdio-transport.ts` (line-delimited JSON over child stdin/stdout), `sse-transport.ts` (server-sent events for inbound, POST for outbound via `endpoint` event), `http-transport.ts` (streamable HTTP with `mcp-session-id` header). All share the same `Transport` interface in `transport.ts`.
- **`McpClient` in `client.ts` is the JSON-RPC layer** — tracks pending requests by id, handles `initialize` + `initialized` notification, exposes `listTools`/`listResources`/`listPrompts`/`callTool`/`readResource`/`ping`.
- **`apps/desktop/src/main/mcp/manager.ts` owns lifecycle**: connect on enable, exponential-backoff reconnect (1.5s → 30s, capped at 6 doublings) on `onClose`, register MCP tools as `mcp__<serverId>__<remoteName>` in the global `ToolRegistry` via `tool-adapter.ts`, unregister on disconnect/disable/remove.
- **Server config persists in `electron-store` settings** under `mcpServers` (key was added to `SettingsSchema`). Live state (`status`, `serverInfo`, counts, `lastError`) is in-memory only.

### Plugin architecture invariants

- **Plugins run in-host, not in a VM sandbox.** Gating is via manifest-declared permissions; `PluginHost.getSetting`/`setSetting` check `settings.read`/`settings.write` grants. Tools registered through `host.registerTool` get namespaced as `plugin__<id>__<toolName>` in the shared registry.
- **`loadPluginModule` in `packages/plugin-sdk/src/loader.ts`** reads `opencodex.plugin.json`, dynamic-imports `manifest.entry`, expects either `default` or `plugin` export with an `activate` function.
- **Three reference plugins**: `examples/plugins/hello-world` (tool contribution), `examples/plugins/provider-stub` (echoes input as an LLMProvider), `examples/plugins/ui-panel` (manifest + panel.html — iframe runtime not yet wired in the renderer).

### Multi-agent invariants

- **`spawn_subagent` runs inline**, not via utilityProcess. It reads from the same `ToolRegistry` (filtered by `allowedToolNames`), builds a fresh `Provider`, and pipes events into a buffer that becomes the return value.
- **Budget enforcement is per-loop**: `maxToolIterations` is hard-checked at the top of each turn; `maxTokens` and `maxWallTimeMs` are checked at the start of every turn after the first event.
- **The orchestrator prompt** in `orchestrator-prompt.ts` tells the parent agent when to spawn vs. not; embed it in your system message if you want a long-running parent agent to actually use `spawn_subagent`.

### RAG / search invariants

- **`search_codebase` wraps `grep_tool`**, then re-ranks by match strength + filename heuristics (downweights `__fixtures__`, `test`, `.md`, `.txt`). Cap at `maxResults` (default 100, max 500).
- **`reciprocalRankFusion`** is exported from `@opencodex/tools` and tested. Slot it in front of search_codebase once LanceDB + FTS5 rankings exist.
- **`.opencodexignore` parser** in `packages/tools/src/opencodex-ignore.ts` supports gitignore syntax: `#` comments, `!` negation, leading `/` anchoring, trailing `/` directory-only, `*` / `**` / `?` globs. Tests cover all five.
- **Read-only chat mode** lives in settings (`readOnlyChatMode`) and short-circuits at the top of `ApprovalManager.requestApproval` — any non-`read` tier is denied immediately when on.

### Onboarding wizard invariants

- **Mounts inside `<ChatProvider>` in `App.tsx`** because it uses `useSelectedModel()`. If providers move outside the wizard renders nothing (loading state).
- **Stored flag is `onboardingComplete: boolean` in settings.** Skip + Start chatting both set it; "complete" never resets except by manual setting edit.
- **Wizard does NOT replace `OnboardingBanner`** — banner stays as a Settings-page reminder if the user dismisses the wizard without configuring a provider.

### electron-builder config (new this session)

- **`apps/desktop/electron-builder.yml`** now exists with mac (dmg + zip, x64 + arm64), windows (nsis + portable, x64), linux (AppImage + deb + rpm, x64) targets. `publish: null` — switch to GitHub Releases when ready. Signing creds remain user-side.

### Carry-overs still relevant (unchanged from prior handoff)

- Node v20 pinned. **Do NOT** suggest a Node upgrade. better-sqlite3 must be rebuilt against Node 20 (this session's fix used `pnpm install --force`).
- Path has space + period (`OPEN UI.UX`) — quote in shell.
- `packages/*` tsconfig is `noEmit: true` — switch to `tsup` before any `pnpm publish`.
- Pre-public placeholders still exist in CODEOWNERS / SECURITY.md / README.md: `@TODO-set-github-handle`, `security@TODO-set-domain`, `github.com/TODO-org/TODO-repo`.

### Uncommitted state

Massive multi-phase commit pending. No git operations were performed in this session — user defers commits until they review the full set.
