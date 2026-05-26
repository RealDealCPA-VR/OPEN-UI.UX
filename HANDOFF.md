# Handoff State

## Last Session Summary

- **Massive Todo.md sweep — 30 items closed in one session via parallel subagent fan-out.** Every remaining engineering item in Phase 6 (polish & ship) and the entire Phase 7 (UX polish + long-term memory) backlog is now `[x]`. Four items remain `[ ]`, all credential- or human-action-bound — see the **Cannot Be Closed Here** section below.
- **Wave 1 (3 parallel agents):** (1) shipping infra — `release.yml`, `docs.yml`, electron-updater wiring with GitHub Releases, new `@opencodex/telemetry` (PostHog) + `@opencodex/crash-reporting` (Sentry Electron) packages, Nextra docs site under `website/`, `RELEASE_NOTES_TEMPLATE.md`, `docs/release-signing.md`, `cross-env` fix for `pnpm dev` (kills the `ELECTRON_RUN_AS_NODE` footgun for good). (2) memory providers — `@opencodex/memory-obsidian` (BM25, filesystem-backed) + `@opencodex/memory-notion` (fetch-only Notion API), `MemoryManager` wired into the shared `ToolRegistry` under `memory__<backend>__*` namespace. (3) AgentView + CodebaseView full rewrites — active-runs grid with abort, spawn-from-UI modal, per-run drawer, Monaco preview pane, ripgrep-backed search, pending-edit pills, right-click context menu, cross-view transfer (chat ↔ agent ↔ codebase).
- **Wave 2 (sequential, integrates wave-1 IPC):** two-pane Settings refresh with 12 sections, section search, deep-link routing (`/settings/<slug>`), sticky section headers with per-section action buttons, new `Memory` / `Updates` / `Telemetry` / `Crash reporting` panels that consume the wave-1 preload bridges. Collapsible chat sidebar + main nav rail with `prefers-reduced-motion`-aware width transitions.
- **No commits made — the user is committing manually.** Working tree is hot with all the wave changes.

## Verify Before Continuing

- [ ] **Walk every Settings section in the dev app.** The Settings two-pane refresh is the single largest UI delta. Open `/settings/theme`, then click through Workspace, Providers, Approvals, Plugins, MCP, Memory, Updates, Telemetry, Crash reporting, Audit log, Indexing. Confirm section search filters the rail, deep-link URLs work (paste `/settings/memory` directly), sticky headers stay pinned on scroll, and the `Reload` (Memory) + `Check now` (Updates) action buttons fire correctly.

- [ ] **Memory backends:** in Settings → Memory, point Obsidian at a `.md`-bearing folder, hit Test connection (expect `ok: true, noteCount: N`). For Notion, paste an integration token, Save, Test connection (expect `ok: true, user: { name }`). Then start a chat and ask the agent to `memory_search` or `notion_search` — the tools must surface in the registry under `memory__obsidian__*` / `memory__notion__*`.

- [ ] **AgentView spawn flow:** click "Spawn task" → pick a provider/model → enter a task → optionally toggle "Use git worktree" (only available if active workspace is a git repo). Confirm the run appears in the active-runs grid with live token meter, current tool name, and a working Abort button. After completion, the drawer at `/agent/:runId` should show transcript + file changes + Merge-review CTA.

- [ ] **CodebaseView:** select a file → Monaco preview renders. Type in the search bar → debounce-fires `codebase:search` after 300ms, results dropdown navigates to file+line on click. Right-click a file → context menu offers Open / Reveal in OS / Copy path / Ask agent about this file. Trigger a multi-file agent edit through a worktree subagent and confirm pending-edit pills appear in the file tree.

- [ ] **Cross-view transfer:** from a chat with citations, click "Send to Codebase" → CodebaseView opens with cited paths pre-filtered. Click "Send to Agent" → AgentView opens with spawn modal pre-filled with the last user message. From a completed AgentRunRow, click "Continue in chat" → new conversation seeded with the run summary.

- [ ] **`pnpm dev` no longer needs the manual env-var unset.** The dev script is now `cross-env ELECTRON_RUN_AS_NODE= electron-vite dev` — should launch cleanly without `Remove-Item Env:ELECTRON_RUN_AS_NODE` prep.

- [ ] **`pnpm build` is green end-to-end** — verified this session (22.5s, all 21 packages + apps/desktop compile, renderer bundle splits clean). If you re-run it, expect the same.

- [ ] **`pnpm test` baseline is at 668 passing / 86 failing — failures are pre-existing.** The 8 failing test files (better-sqlite3 ABI mismatch + electron-store needing Electron context) were present before this session; do not chase them unless you intend to fix that infrastructure separately. New tests added this session (memory, telemetry, crash-reporting, view derive helpers, transfer state) all pass.

- [ ] **`website/` is intentionally outside the pnpm workspace.** Don't `pnpm install` inside `website/` from the root — `cd website && pnpm install` is the correct flow. The site has its own `README.md` explaining this.

## Cannot Be Closed Here (4 items, all external)

These remained `[ ]` and are documented as such in `Todo.md`:

- **MCP OAuth handling** (Todo.md:116) — needs per-MCP-server OAuth app config; not a code task we can complete blind.
- **macOS code signing + notarization** (Todo.md:174) — needs Apple Developer Program enrollment + Developer ID cert + Apple ID + app-specific password. Full walkthrough in `docs/release-signing.md`; `release.yml` already reads the required `CSC_*` + `APPLE_*` secrets.
- **Windows code signing (Authenticode)** (Todo.md:175) — needs EV cert purchase (Sectigo/DigiCert) and hardware token. `release.yml` reads `WIN_CSC_*` secrets. Note in `docs/release-signing.md` that EV signing requires a manually-triggered build (hardware token can't live in CI).
- **Public v0.1 release announcement** (Todo.md:186) — `RELEASE_NOTES_TEMPLATE.md` at repo root is ready to copy into a GitHub Release; actual publishing is the user's call.

Phase 7 backlog (post-v0.1) items 232-237 (cloud tasks, voice mode, mobile companion, team workspaces, visual workflow builder, JetBrains/VSCode plugins) are out of scope for v0.1 — left untouched.

## Next Task

**There is no engineering work left to ship v0.1.** The natural next step is for the user to:

1. Review the working tree diff and stage commits as they prefer.
2. Buy/enroll the signing certs (per `docs/release-signing.md`).
3. Cut a `v0.1.0-rc.1` tag → `release.yml` produces draft GitHub Releases on all three platforms (signed where certs are present, unsigned where not).
4. Walk the verify-checks above in the built dev app, file any fit-and-finish issues.
5. Copy `RELEASE_NOTES_TEMPLATE.md` into the draft GitHub Release, publish.

If the user redirects to anything else, the natural follow-up backlog from the wave reports:

- **Polish:** keyboard navigation between Settings rail items (arrow keys, not just Tab). Updates panel could show download speed/ETA. Telemetry/Crash panels would benefit from a real "you're sending us X" sample-payload preview.
- **Memory v0.2:** wire an `embedFn` in `MemoryManager` (the Obsidian package already accepts one via constructor; main just doesn't pass one yet). Hybrid retrieval via RRF is already implemented in `packages/memory-obsidian/src/bm25.ts`.
- **Cleanup:** delete `PROVIDERS_SECTION_ID` from `OnboardingBanner.tsx` (dead since deep-link routing landed). Replace localStorage-based `useCollapseState` with real settings fields (`ui.chatSidebarCollapsed`, `ui.navRailCollapsed`) if cross-machine sync is wanted.
- **Real LanceDB:** the `LanceVectorStore` is still a SQLite-backed shim. Swap to `@lancedb/lancedb` is a one-class change — public interface was kept identical for exactly this purpose. See `apps/desktop/src/main/rag/vector-store.ts`.

## Context Notes

### Cross-agent IPC surface added this session

**Memory** (`window.opencodex.memory.*`): `getStatus`, `getConfig`, `setConfig`, `testConnection(backend)`, `setNotionToken(token)`, `clearNotionToken`, `reload`, `onChanged(listener)`. Event channel: `memory:config-changed`. Notion token lives in keychain under `memory.notion.token`; vault path is plain config in `settings.memory.backends.obsidian.vaultPath`.

**Telemetry** (`window.opencodex.telemetry.*`): `getConfig`, `setConfig`, `onConfigChanged`. Settings fields: `telemetryEnabled`, `telemetryApiKey`, `telemetryHost`. Event: `telemetry:config-changed`. Tracked events are PII-free: `app.launched`, `chat.message_sent` (provider+model hashed), `agent.subagent_spawned`, `mcp.server_connected`. `OPENCODEX_TELEMETRY_KEY` env var overrides the setting.

**Crash reporting** (`window.opencodex.crashReporting.*`): `getConfig`, `setConfig`, `onConfigChanged`. Settings: `crashReportingEnabled`, `crashReportingDsn`, `crashReportingEnvironment`. Sentry SDK is `await import()`-loaded so disabled mode is genuinely free. `OPENCODEX_SENTRY_DSN` env overrides. `beforeSend` scrubs file paths from `event.request.url` and clears `event.user`.

**Updates** (`window.opencodex.updates.*`): `check`, `download`, `quitAndInstall`, `getStatus`, `setAutoCheck`, `onStatusChanged`. Settings: `autoCheckForUpdates` (opt-in, default `false`). `startAutoCheckLoop()` runs check on `app.whenReady + 30s` then every 4h, gated by both the setting AND `app.isPackaged` (no update checks in dev).

**Agent spawn / abort** (`window.opencodex.agent.*`): `spawnFromUi({ task, providerId, modelId, workspaceRoot, useWorktree }) → { runId }`, `abortRun(runId) → { ok, error? }`. Separate from the `spawn_subagent` _tool_ (which is for agent-to-agent spawning); this is for direct UI spawning. Reuses the same `runSubagent` + `run-registry` infra.

**Codebase** (`window.opencodex.codebase.*`): `search({ workspaceRoot, query, mode, limit? })`, `readFile({ workspaceRoot, path, maxBytes? })`, `getPendingEdits()`. Plus `window.opencodex.git.isRepo(path)` and `window.opencodex.shell.showItemInFolder(workspaceRoot, path)`.

### Pending-edits N+1 mitigation (CodebaseView)

`useAgentPendingEdits` hook avoids an IPC storm during streaming runs three ways:

1. **Fingerprint debouncing** — `pendingEditsFingerprint(runs)` hashes only `id|mergeStatus|completedAt` of runs that have a worktree. Token-only updates (which fire `agent:runs-changed` constantly during a live run) produce an identical fingerprint, so no IPC is sent.
2. **In-flight guard** — `inFlight` ref prevents overlapping fetches.
3. **Single aggregated IPC** — `codebase:get-pending-edits` aggregates all worktree runs in one round-trip; `prepareMergeBundle` runs in a `for` loop on main and skips failures.

### `prefers-reduced-motion` is respected

The wave-2 styles append a `@media (prefers-reduced-motion: reduce)` block that zeroes out transition durations for the chat sidebar + nav rail + Settings rail. If you add new transitions to the renderer, mirror this convention.

### `website/` deploy

`docs.yml` workflow builds Nextra + deploys via `actions/deploy-pages@v4`. Requires GitHub Pages enabled on the repo with "GitHub Actions" as source. `pages: write` + `id-token: write` permissions already set in the workflow.

### Pre-existing carry-overs still relevant

- Node v20 pinned. `better-sqlite3` must be rebuilt against Electron's ABI (not Node's) — `@electron/rebuild` is the tool, NOT `pnpm install --force`. The 8 pre-existing test failures stem from this; they don't repro under `pnpm dev` (Electron rebuild) but fail under bare `vitest`.
- Path has space + period (`OPEN UI.UX`) — quote in shell.
- `packages/*` tsconfig is `noEmit: true` — switch to `tsup` before any `pnpm publish` of the standalone packages.
- Pre-public placeholders remain in CODEOWNERS / SECURITY.md / README.md: `@TODO-set-github-handle`, `security@TODO-set-domain`, `github.com/TODO-org/TODO-repo`. Fill these before the first public tag.
- `PROVIDERS_SECTION_ID` is still exported from `OnboardingBanner.tsx` for back-compat but is now dead code (deep-link routing replaced the scroll-to-anchor pattern). Safe to delete in a follow-up.
