# Handoff State

## Last Session Summary

- **Phase 11 (UX polish & robustness) shipped in full via a 6-lane parallel agent fan-out + orchestrator consolidation.** Lane ownership was strict and airtight — no two agents edited the same file. Each lane self-reported in <500 words; cross-lane handshakes were collected and wired in a final consolidation pass by the orchestrator.
  - **Lane A (Chat surface, 12 files):** ChatView Esc-cancels-stream + Up-arrow recalls last message + Cmd/Ctrl+K opens slash menu + auto-grow textarea capped at ~12 lines + contextual placeholder; Send→Stop→Retry on stream error preserving partial content; Markdown code-block Wrap/Unwrap toggle, Copy→"Copied" 1.2s revert, inline citation tokenization → clickable `chat-to-codebase` transfer; ToolCallCard auto-collapses read-tool successes via new `isReadOnlyTool()` (errors auto-expand); grep/glob result entries become clickable file-link buttons; SlashCommands skill description as right-aligned hint; StatusBar 64×6 segmented token meter against `selectedCapabilities.contextWindow` (helper `computeTokenMeterSegments` + 5 new tests) with 70%/90% color thresholds, workspace name → Reveal in OS, active-tool pulse during stream; starter chips on empty conversation (Explain repo / Find TODOs / Run tests). Updated tests: `status-bar-derive.test.ts` (+5), `tool-block-grouping.test.ts` (+1 block).

  - **Lane B (Agent + Automations, 12 files):** ActiveRunCard iteration progress bar against budget + reduced-motion-aware current-tool pulse + in-place "Confirm abort" → Cancel; AgentSpawnModal worktree preview block (branch + path, OS-separator), per-option runner install-status suffix + below-select Runners link, per-field validation, Cmd/Ctrl+Enter submits, Esc closes; AgentRunDrawer log-style with monospace timestamps, per-tool expand, sticky scroll-to-bottom + "Jump to latest ↓" pill when user scrolls up, j/k tool-block keyboard nav, sticky footer for merge-review + continue-in-chat CTAs; MergeReviewModal full split-view: file-list with per-file +/- counts + lazy MonacoDiffViewer per file (inline `parseUnifiedDiff`), Accept/Reject in-place confirm with danger "Confirm discard", "Open in Codebase view" per file via new `agent-to-codebase` transfer; AutomationsView 3 template cards (Daily standup / Weekly security audit / Hourly TODO sweep) prefill editor + trigger-type filter chips with counts; ScheduledTaskEditorModal live cron validation with red ring + reason, preset rows show next-3-fires inline, trigger-type radios → card buttons with badge + label + hint, Cmd/Ctrl+Enter saves; ScheduledTaskCard + AgentRunRow humane countdowns ("in 3m", "tomorrow at 9:00") via new pure `humaneCountdown()` helper; AgentRunRow "Resume in chat" relabel + failed-status danger tokens. `agent-runs-derive.ts` gained `runBudget`/`runProgressFraction`/`humaneCountdown`/`RUN_BUDGET_DEFAULT` covered by 12 new vitest cases.

  - **Lane C (Codebase surface, 11 files):** FileTree 150ms-debounced filter input + auto-expand matching ancestors + j/k/Up/Down/Right/Left/Enter/Space keyboard nav + inline windowing for >500 rows (24px row, ±10 buffer, no new dep) + clickable pending-edit pills with aggregated count; CodebaseSearchBox scope chips (Current dir / Repo / MCP resources, local MCP filtering), `N results · Xms` pill via `performance.now()`, Cmd/Ctrl+F refocus, `<mark>` snippet highlighting; CodebasePreviewPane header with language pill + click-to-copy path + Open in editor / Reveal in OS / Copy path, URL hash `#L42` jump on mount + on `hashchange`, line-number gutter; FileTreeContextMenu Open/Edit/Share section grouping with dividers + ArrowUp/Down/Enter/Esc + viewport-clamped position; MonacoDiffViewer sticky header with file path + +N -M, j/k next/prev hunk + a accept / r reject + active-hunk outline; `citations.ts` now accepts `file:line-line` ranges (3 new test cases); `language-from-extension.ts` adds dart/kts/m/mm/r/lua/vue/svelte; `codebase-pending-edits-derive.ts` aggregates multiple pending edits per path into `{status, count, runIds[]}` with runId dedupe (test updated); `monaco-diff-helpers.ts` adds `countLineDelta(hunks)` (4 new tests).

  - **Lane D (Settings + Onboarding, 21 files):** OnboardingWizard full rewrite with top progress bar, per-step "Why?" lines (keychain, sandbox, switchability), inline provider error block with Dismiss + "Try a different provider", Escape closes / Enter advances, SVG check draw + fade animation honoring `prefers-reduced-motion`, `providers.test` runs on key save with real provider message surfaced inline; OnboardingBanner derives `onboardingComplete` + workspace state, "N of 4 done" chip, persistent "Resume setup" button, hides when both providers and workspace are set; SettingsRail Escape-to-clear + × clear button + Cmd/Ctrl+F focus; SettingsView reads `?highlight=` / `#row=` and briefly pulses matching `[data-settings-anchor]`; ProvidersPanel test reports latency + model count, per-provider 401/403/429/404/5xx dictionary with one-line `suggestedFix` + inline Retry; ApprovalsPanel tier-default line + tool description tooltip + `data-settings-anchor`, skeleton shimmer load state + retry on error; AuditLogPanel Trigger filter (user/scheduled) + per-row scheduled pill + Copy buttons on expanded Input/Output (1.2s "Copied" swap) + in-place clear-log confirm; McpServersPanel inline spinner during Enable/Disable/Add + clickable resources/prompts counts expanding inline lists + in-place Remove confirm + Dismiss on error banner; PluginsPanel + WorkspacePanel + MemoryPanel + TelemetryPanel + CrashReportingPanel + UpdatesPanel + IndexingPanel + RunnersPanel + SkillsPanel polished with Saved flash + in-place confirms + Retry on load error; AccessibilityPanel reads live OS `prefers-reduced-motion` media query; ThemePanel adds preview swatches (split swatch for System).

  - **Lane E (Shell + design system, 15 files including styles.css):** New `Toasts.tsx` global primitive — `ToastProvider` + `useToast()` returning `{show, dismiss}`, `ToastOptions` `{kind, duration, action}`, bottom-right region stacking upward, Esc dismisses most recent, `prefers-reduced-motion` aware; `App.tsx` wraps tree with `ToastProvider`; AppShell Cmd/Ctrl+1..5 nav routes + Cmd/Ctrl+, opens /settings (existing \\ + B retained); HoverHint new `shortcut?: string` prop + `·` interpunct fallback promoting trailing substring to inline `<kbd>` using new `--kbd-*` tokens, 5-word cap excludes shortcut; ApprovalQueue 600px default width + per-tool colored letter chip tinted by permission tier (write/execute amber, network red, read accent) + keyboard 1-6 maps to action buttons + "Always allow this exact command" path for `run_shell` (in-renderer `Map<string,true>`); LeftColumnContextPane empty-state CTAs (Spawn task → `/agent?spawn=1`, recents reader from `localStorage['opencodex.codebase.recent-files']` polling every 2s + cross-tab `storage` listener); AutomationsContextPane drift-resistant tick via self-scheduling `setTimeout` aligned to `1000 - (Date.now() % 1000)` + `visibilitychange` listener; ModelPicker Recent group (top 3, localStorage-persisted) + provider section headers + capability badges (tools/vision/cache/stream) + cost-per-1M inline; PluginPanelHost audited (sandbox + origin checks intact); ThemeApplier left-untouched JS-wise but body color/bg transition added in styles.css; styles.css adds tokens `--kbd-bg/border/text`, `--toast-bg/border/text/shadow` with light overrides + reduced-motion media block zeroing transitions/animations on `*`.

  - **Lane F (Main-process robustness):** New `apps/desktop/src/main/util/friendly-error.ts` maps errno (ENOENT/EACCES/EPERM/EBUSY/EEXIST/EISDIR/ENOTDIR/ENOSPC/EMFILE/ETIMEDOUT/ECONNREFUSED/ECONNRESET/ENETUNREACH/EHOSTUNREACH/EAI_AGAIN/ENOTFOUND) and SQLite errors (SQLITE_BUSY/LOCKED/CORRUPT/READONLY) to user-facing strings; new `ui-error.ts` `emitUiError(payload)` broadcasts to all renderers; new `sqlite-retry.ts` `withSqliteBusyRetry(fn)` synchronous 50ms→250ms `Atomics.wait`-based retry; new `shared/ui-errors.ts` Zod schema. New IPC event `ui:error` with payload `{source: 'mcp'|'scheduler'|'provider'|'plugin'|'memory'|'updater', severity: 'info'|'warning'|'error', message, detailId?}` exposed at `window.opencodex.ui.onError(listener)`. `main/index.ts` added `process.on('unhandledRejection')` + `process.on('uncaughtException')` both routing to lazy `@opencodex/crash-reporting` `captureException` (guarded, no hard dep), plus idempotent `wal_checkpoint(TRUNCATE)` on `before-quit`. `chat/runner.ts` retry wrapper (exponential backoff with full jitter 1s/2s/4s, cap 3 attempts, only 429/5xx, never 400/401/403, only while no text or tool_call yet streamed). `scheduler.ts` `logSkipOnce` for concurrent-run / catch-up-busy / fire-by-id-busy. `mcp/manager.ts` `EARLY_EXIT_THRESHOLD_MS = 500` early-exit guard jumping to 30s backoff + single ui:error toast. `withSqliteBusyRetry` applied to `setTaskRunBookkeeping` and `recordToolCall`. `codebase/handlers.ts`, `plugins/handlers.ts`, `memory/handlers.ts`, `skills/handlers.ts`, `agent/handlers.ts` all adopt `toFriendlyError`.

  - **Orchestrator consolidation pass (this turn):** Extended `shared/transfer-context.ts` with `agent-to-codebase` and `codebase-to-agent` variants; extended `shared/agent-runs.ts` `AgentRun` with optional `budget?: number`; added `ShellOpenPathRequest/Response` to `shared/agent-spawn.ts` + `shell:open-path` channel to `ipc-types.ts` + handler in `main/codebase/handlers.ts` (calls `shell.openPath`) + preload bridge `window.opencodex.shell.openPath`; bridged Lane F's `ui:error` IPC into Lane E's `useToast()` via new `UiErrorBridge` component in `App.tsx`; wired `AgentView` to honor `?spawn=1` query (auto-opens spawn modal, strips param); wired `CodebaseView` to (a) push `pushRecentFile()` on `handleOpenFile` (`localStorage['opencodex.codebase.recent-files']`, max 10, dedup), (b) honor `?file=` query (sets selectedPath, strips param), (c) handleOpenPendingEdit now pushes `codebase-to-agent` transfer carrying `runIds[]` so the merge-review can deep-link. Added cross-lane CSS to `styles.css`: tokens `--meter-bg/-fill-ok/warn/danger`, `--chip-bg/border`, `--citation-bg/border`, `--diff-add-fg/del-fg`, `--bg-pill` (with light-theme overrides); rules for `.slash-commands*` (menu was previously unstyled), `.statusbar-token-meter*`, `.chat-empty-hook`, `.chat-starter-chip`, `.md-citation`, `.tool-result-file-link`, `.md-code-actions`, `.jump-to-latest`, `mark`, `.codebase-search-timing`, `.monaco-diff-viewer-sticky-header`, `.settings-anchor-highlight` keyframes, `.settings-skeleton` shimmer, `.mcp-inline-spinner`, full onboarding-wizard rules + `.onboarding-success-check` draw animation. Fixed two closure-mutated `let`-narrowing TS errors in `chat/runner.ts` (snapshot cast pattern for `pending` + `finalStop`).

- **Build + typecheck:** `pnpm --filter @opencodex/desktop typecheck` clean; `pnpm build` green at **21.55s** (baseline was 21.51s — no regression). The 92 pre-existing better-sqlite3 ABI test failures remain (HANDOFF carry-over from prior sessions; require `@electron/rebuild`).

## Verify Before Continuing

- [ ] **Toast primitive renders.** Open the app. From DevTools renderer console run `window.opencodex.ui` and confirm the bridge exists. Trigger an MCP failure (e.g., add an MCP server with a bogus command) and confirm a bottom-right toast appears with the friendly message — should NOT show raw `ENOENT` text.

- [ ] **Spawn task via empty-state CTA.** Open `/agent` when there are no runs → click "Spawn task" in left context pane → AgentSpawnModal opens with `?spawn=1` query stripped from URL (no flash, no double-open). Cmd/Ctrl+Enter submits.

- [ ] **Codebase recents + deep-link.** Open `/codebase`, open a file in preview → check `localStorage.getItem('opencodex.codebase.recent-files')` contains the path. Switch to another route, then click an entry under "Recent files" in the Codebase left pane → opens that file in preview via `?file=` query. Open a file with URL hash `#L42` → preview scrolls to line 42.

- [ ] **Codebase → Agent merge-review handshake.** With a worktree run that has pending edits, click a pending-edit pill in the file tree → routes to `/agent` (the `codebase-to-agent` transfer carries `runIds`; consumer wiring inside AgentView is a future polish — the transfer is dispatched).

- [ ] **Approval queue keyboard.** Trigger any tool requiring approval → modal opens → press `1`–`6` to invoke each of the six Allow/Deny × once/session/always paths. For a `run_shell` approval, see the "Always allow this exact command" footer option.

- [ ] **Cron validation.** Open ScheduledTaskEditorModal → type an invalid cron expression → red ring + "Invalid: <reason>" appears below the input. Pick a preset → each preset row shows the next-3 fire times.

- [ ] **Onboarding error path.** On first run, enter a deliberately wrong API key → the actual provider error message renders inline in the wizard (not just "failed"); Dismiss + "Try a different provider" present.

- [ ] **Reduced motion.** Set OS to reduce motion → token meter `width` transitions, toast slide-in, body theme transition, onboarding check draw, automations countdown — all freeze to instant.

- [ ] **`pnpm build` stays at ~21.5s.** Verified this session: 21.55s green.

## Next Task

**Phase 11 is closed.** Remaining work in Todo.md is unchanged from prior session: all items are blocked on external user input or are explicit stretch / backlog items.

- **Needs external credentials (4 items, Phase 6 + Backlog):** MCP OAuth (Todo.md:116), macOS code signing (Todo.md:173), Windows code signing (Todo.md:174), public v0.1 release announcement (Todo.md:184).
- **Needs user architecture/UX sign-off (6 items, Backlog lines 487-492):** cloud tasks, voice mode, mobile companion, team workspaces, visual workflow builder, JetBrains/VSCode integration.
- **Explicit stretch (1 item):** `packages/runner-mcp-bridge` (Todo.md:406).
- **Phase 11 deferred polish (small, optional, can be picked up at any time):**
  - HoverHint richer hover-card primitive for citation previews (Lane A request; current `<HoverHint>` 5-word cap is too tight). Would unlock "hover citation → file+line snippet preview".
  - Cross-view hover-highlight: hovering a citation in chat highlights the file in the FileTree (Lane A → Lane C signal channel). Requires a shared "highlight intent" signal in `renderer/state/`; intentionally deferred.
  - `Cmd+/` to insert a code-comment placeholder when cursor is inside a fenced markdown block in the composer (Lane A deferred; composer has no fence-awareness — would need a small lexer pass over the textarea value).
  - ApprovalsPanel tool-description hover preview: today uses native `title=`; promoting to `<HoverHint>` requires the richer hover-card primitive above.
  - MCP tools-count click-to-expand (Lane D deferred): the existing `tools.list()` IPC doesn't carry origin/server-id; resources/prompts work because their IPC does. Would need a small main-process IPC schema extension.

**The repo remains shippable as v0.1 plus Phase 9 + 10 + 11 once macOS/Windows certs are provided and a public release is published.**

## Context Notes

### Lane-ownership protocol (Phase 11)

- `Todo.md` Phase 11 section documents the strict lane→files mapping used during the fan-out. Any future similar pass should reuse the same airtight slicing pattern: orchestrator writes lane ownership to Todo.md, agents are spawned in parallel with explicit allowlists, each agent reports cross-lane requests, orchestrator consolidates in a final pass. This was load-bearing for collision-free parallel execution.

### Cross-lane handshakes wired by orchestrator (this session)

- **`ui:error` IPC → `useToast`.** New `UiErrorBridge` component in `App.tsx` subscribes to `window.opencodex.ui.onError` and maps to toast `kind` via severity: `error → 'error'`, `warning → 'warn'`, otherwise `'info'`. Message prefixed with `<source>: <message>`.
- **`?spawn=1` query support.** `AgentView` reads `useSearchParams`, opens spawn modal when present, removes the param via `setSearchParams(next, { replace: true })`.
- **Codebase recents + `?file=`.** Pure helper `pushRecentFile(path)` writes `localStorage['opencodex.codebase.recent-files']` (max 10, dedup, JSON-serialized). `handleOpenFile` calls it. `CodebaseView` reads `?file=` on mount and strips it. Left-column reader polls every 2s + listens to `storage` event.
- **`codebase-to-agent` transfer.** New variant on `TransferContextSchema` carrying `filePath: string` + `runIds: string[]`. `handleOpenPendingEdit` in `CodebaseView` now pushes this and navigates `/agent`. AgentView consumer for this kind is a future polish item — the transfer is dispatched but not yet consumed.
- **`agent-to-codebase` transfer.** New variant on `TransferContextSchema` carrying `filePaths: string[]` + optional `runId`. Used by MergeReviewModal's "Open in Codebase view" link.
- **`AgentRun.budget?: number`.** Optional field added to `shared/agent-runs.ts` to back the new budget-aware progress bar in `ActiveRunCard`. Currently always read via duck-typing from the run object; backend population is a small follow-up (none of the existing tests assert its absence).
- **`shell:open-path` IPC.** New invoke channel `{workspaceRoot, path} → {ok, error?}` in `ipc-types.ts`, handler in `main/codebase/handlers.ts` calls `shell.openPath(resolved)` (returning the error string if Electron reports one), exposed as `window.opencodex.shell.openPath(workspaceRoot, path)`. CodebasePreviewPane's "Open in editor" uses this.

### TS narrowing gotcha in `chat/runner.ts`

- TypeScript narrowed `let retryError: RetryableErrorInfo | null = null` and `let iterStop: StopReason = 'end_turn'` to their literal-null / literal-`'end_turn'` types AFTER an inner async closure mutated them (because TS does not refresh control-flow narrowing through closures). The fix in this session was a snapshot cast pattern: `const pending = retryError as RetryableErrorInfo | null` and `const finalStop = iterStop as StopReason` at use sites. Any future addition of similar closure-mutated locals in the retry wrapper should adopt the same pattern.

### New design tokens shipped (Phase 11)

| Token                 | Dark                        | Light                       |
| --------------------- | --------------------------- | --------------------------- |
| `--kbd-bg`            | `var(--bg-sunken)`          | `#f4f4f5`                   |
| `--kbd-border`        | `var(--border)`             | `var(--border)`             |
| `--kbd-text`          | `var(--text-secondary)`     | `var(--text-secondary)`     |
| `--toast-bg`          | `var(--bg-elevated)`        | `#ffffff`                   |
| `--toast-border`      | `var(--border-strong)`      | `var(--border-strong)`      |
| `--toast-text`        | `var(--text-primary)`       | `var(--text-primary)`       |
| `--toast-shadow`      | `var(--shadow-modal)`       | `var(--shadow-modal)`       |
| `--meter-bg`          | `rgba(255,255,255,0.05)`    | `rgba(0,0,0,0.06)`          |
| `--meter-fill-ok`     | `var(--accent)`             | `var(--accent)`             |
| `--meter-fill-warn`   | `var(--warn)`               | `var(--warn)`               |
| `--meter-fill-danger` | `var(--danger)`             | `var(--danger)`             |
| `--chip-bg`           | `var(--bg-elevated)`        | `#f4f4f5`                   |
| `--chip-border`       | `var(--border-strong)`      | `var(--border-strong)`      |
| `--citation-bg`       | `var(--accent-soft-bg)`     | `var(--accent-soft-bg)`     |
| `--citation-border`   | `var(--accent-soft-border)` | `var(--accent-soft-border)` |
| `--diff-add-fg`       | `var(--success)`            | `var(--success)`            |
| `--diff-del-fg`       | `var(--danger)`             | `var(--danger)`             |
| `--bg-pill`           | `var(--bg-elevated)`        | `var(--bg-elevated)`        |

### Pre-existing carry-overs still relevant

- Node v20 pinned. `better-sqlite3` must be rebuilt against Electron's ABI — `@electron/rebuild` is the tool. The 92 pre-existing DB-backed test failures persist for the same reason.
- Path has space + period (`OPEN UI.UX`) — quote in shell.
- `packages/*` tsconfig is `noEmit: true` — switch to `tsup` before any `pnpm publish` of standalone packages.
- Pre-public placeholders remain in CODEOWNERS / SECURITY.md / README.md / `.github/ISSUE_TEMPLATE/config.yml` / `website/theme.config.tsx`: `@TODO-set-github-handle`, `security@TODO-set-domain`, `github.com/TODO-org/TODO-repo`. Fill before first public tag.
- `website/` excluded from the main pnpm workspace; run `pnpm install && pnpm dev` inside `website/` separately.

### Files added this session (Phase 11 + consolidation)

**New renderer files (1):**

- `apps/desktop/src/renderer/components/Toasts.tsx` — global toast primitive

**New main-process files (3):**

- `apps/desktop/src/main/util/friendly-error.ts`
- `apps/desktop/src/main/util/ui-error.ts`
- `apps/desktop/src/main/util/sqlite-retry.ts`

**New shared files (1):**

- `apps/desktop/src/shared/ui-errors.ts`

**New IPC channels (2):**

- `ui:error` (event, renderer-bound)
- `shell:open-path` (invoke)

**New TransferContext variants (2):**

- `agent-to-codebase` (filePaths + optional runId)
- `codebase-to-agent` (filePath + runIds)
