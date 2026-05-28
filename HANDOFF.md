# Handoff State

## Last Session Summary

- **Phase 13 (Runner onboarding & friction reduction) shipped in full via a researcher → 3-lane fan-out → consolidation → wrap-up team.** The user explicitly requested a multi-role agent team this session: a context-manager (orchestrator), a researcher, three implementation lanes, and a wrap-up. The orchestrator stayed lean by delegating every file read and never reading large source files directly — researcher's findings + each lane's tight report kept orchestrator context under budget.
  - **Researcher (1 read-only Explore agent)** — pre-flighted 8 architectural questions (IPC handler registration, streaming-event pattern, preload bridge structure, Providers panel Test-connection shape, `isGitRepo` reference, `tool_calls` schema audit, onboarding wizard step contract, `run_shell` approval routing). Two cross-lane findings surfaced and were bundled into the lane prompts: (1) `tool_calls` has no `runner_id` → Lane B adds migration v10; (2) no reusable `runApprovedShell()` helper exists → install-command consent surface is Lane C's UI picker, not main-process `ApprovalManager` routing.

  - **Lane A (Discovery, 2 files edited + 2 NEW components):** New `RunnersStep.tsx` (~150 LOC) — pure component, external-only runner cards with install pill + source badge + one-line "what is this" copy (claude-code → "Anthropic's Claude Code CLI", opencode → "The OpenCode harness", aider → "Aider AI pair programmer"); Install button navigates to `/settings/runners?install=<id>`; subscribes to `agent.onRunnersChanged` with cleanup. `OnboardingWizard.tsx` inserts `'runners'` into `VISIBLE_STEPS` between `'apikey'` and `'workspace'`; bidirectional Back/Skip wiring; progress bar reflects new count. New `RunnerDiscoveryCards.tsx` (~120 LOC) — pure presentational, always-present built-in card + external cards (installed → "Spawn with `<name>`", uninstalled → "Set up"). `AgentView.tsx` empty state replaced with two-line hook + discovery cards; `onSpawn(runnerId)` opens existing spawn modal with `spawnInitialRunnerId` set. CROSS-LANE flag: `AgentSpawnModal` needs `initialRunnerId` prop — handled in consolidation.

  - **Lane B (Main-process, 4 NEW files + 4 additive edits):** New `shared/runner-discovery.ts` Zod contract (8 schemas: install request / progress / result, probe result, git-init request / result, friendly-error kind / payload). New `runner-install.ts` — `getAvailablePackageManagers()` via `where.exe`/`which`, `installRunner(req, emitProgress, handles?)` spawns via `child_process.spawn` for stream chunks, returns `{ok, exitCode, durationMs, stderrTail}` with last-8-lines tail, abort via `treeKill` from `@opencodex/core`. Spawn direct — Lane C's picker is the consent surface (no `ApprovalManager` routing). New `runner-probe.ts` — per-runner probe table + 60s TTL cache + 8s `execFileAsync` timeout; populates `hint` via `classifyRunnerError().suggestedFix`; exports `clearRunnerProbeCache(runnerId?)` for test isolation. New `runner-friendly-errors.ts` — `classifyRunnerError(runnerId, errText)` with `COMMON_PATTERNS` × `PER_RUNNER_FIXES` (claude-code → `Run 'claude login'`, opencode → `Run 'opencode auth login' or check ~/.config/opencode/`, aider → `Set OPENAI_API_KEY or ANTHROPIC_API_KEY`). New `git-init.ts` — validates absolute path + existing dir + not-already-a-repo, runs `git init -b main` + optional initial commit. **Migration v10** appended to `MIGRATIONS` array — `ALTER TABLE tool_calls ADD COLUMN runner_id TEXT;`. Six new IPC channels in `shared/ipc-types.ts`. Four `registerInvoke` handlers in `handlers.ts` (the `runner:install` handler broadcasts `runner:install-progress` per chunk to all non-destroyed BrowserWindows). New `runner` preload namespace + `git.initRepo` sibling of `git.isRepo`. CROSS-LANE flag: `recordToolCall` writer + `ToolCallAuditRow` reader needed `runner_id` plumbing (handled in consolidation); `runner:friendly-error` broadcast site needed (handled in consolidation).

  - **Lane C (Renderer wiring, 3 files edited):** RunnersPanel — install picker per not-installed runner: inline radio rows of available package managers from `runner.getInstallablePackageManagers()`, **literal command preview** in boxed `<pre>` so user sees exactly what will run, danger-styled Install + Cancel buttons, streams `onInstallProgress` into inline log block, auto-re-runs `checkRunnerInstalled` on success, `stderrTail` in `<pre>` with "Show full log" disclosure on failure, deep-link `?install=<id>` auto-expand via `useSearchParams`. Test-connection button — mirrors Providers panel exactly: `.test-result test-result-ok`/`-err` pills, 60s "Cached" badge, inline Retry. AgentSpawnModal — three new behaviors: (1) safety-boundary callout when external runner picked, copy `<displayName> uses its own approval model. Changes land in a git worktree for your review — your OpenCodex approval policy does not gate the runner's internal tool calls.`, styled with `--bg-pill` + `--text-secondary`; (2) inline **Initialize git repo** button on the Phase-12 worktree guard, calls `git.initRepo({workspacePath, initialCommit: true})`, refreshes `isRepo` + fires success toast on success, friendly error + Retry on failure; (3) **Verify runner** secondary button next to Submit (external runners only), calls `runner.probeAuth(runnerId)`, renders status pill inline. AgentRunDrawer — subscribes to `runner.onFriendlyError` keyed by `run.runnerId`; when `run.stopReason === 'runner_error'` callout renders kind icon + message + suggestedFix + **Retry with `<runnerId>`** + **Re-spawn with internal runner** buttons; raw stderr behind "Show raw error" disclosure (collapsed by default). AuditLogPanel — deferred (`ToolCallAuditRow.runnerId` not yet on the shared type — handled in consolidation, then revisited).

  - **Consolidation (one cross-lane agent):** 4 cross-lane handshakes wired surgically:
    1. `AgentSpawnModal.initialRunnerId?: string` prop added + `useState` seed; `AgentView` already passes the prop conditionally.
    2. `runner:friendly-error` broadcast site in `spawn-from-ui.ts` — added `BrowserWindow` + `classifyRunnerError` imports; after worker/inline returns, when `runnerId !== 'internal'` AND `result.stopReason === 'runner_error'`, classifies stderr and `webContents.send`s to every non-destroyed window.
    3. `tool-audit.ts` writer + reader extended — `RecordToolCallInput.runnerId?: string | null`, `COLUMNS`/INSERT/RawRow/`rowToAudit` mapper, `ToolCallAuditRow.runnerId: string | null` in shared. Call sites in `chat/runner.ts` not threaded — all values default to null until a future follow-up.
    4. AuditLogPanel Runner column + filter wired — `runnerDisplayName` callback (maps null/internal → "OpenCodex"), Runner `<select>` chip inserted before Trigger chip, row filter treats null as OpenCodex, runner pill rendered in row head before scheduled trigger pill.
       `OpenCodexBridge` type was already correct (`= typeof api` with new `runner`/`git` already exposed) — Lane C's defensive helpers were defensive against a non-issue, left in place.

  - **Wrap-up (one agent, tests + docs):** Four new tests + three docs files.
    - `runner-probe.test.ts` — unknown-id short-circuit, clean success, auth-stderr classification, 60s cache hit (asserts spawn count), TTL re-spawn with fake timers, timeout hint, `clearRunnerProbeCache()` per-id + global.
    - `git-init.test.ts` — real tmpdir + `it.skipIf(!gitAvailable)` gate; rejects non-absolute / missing / already-in-repo, happy path (`.git` + branch=main), `initialCommit: true` produces exactly one log entry. Uses `GIT_AUTHOR_*` env + neutralized `commit.gpgsign` so it works on hosts with strict git config.
    - `runner-friendly-errors.test.ts` — `it.each` over all 4 kinds × 3 runners + per-runner `suggestedFix` assertions + unknown-stderr fallback + empty-stderr placeholder + generic-runner fallback.
    - `RunnersStep.test.tsx` — RTL + jsdom + MemoryRouter; mocks `useNavigate` via `vi.mock` with `await orig()`; covers external-only filtering, Install navigates to `/settings/runners?install=claude-code`, Skip/Continue callbacks, `onRunnersChanged` triggers `onRefreshStatuses`. Uses bare `Mock` from vitest (NOT `ReturnType<typeof vi.fn>` — that pattern broke in Phase 12).
    - `MANUAL.md` Runners section gained 5 subsections (Install from app / Test connection / Verify before spawn / Initialize git from spawn modal / Safety boundary callout) — quotes the actual inline note from `AgentSpawnModal.tsx`. `docs/runner-authoring.md` gained "Contributing friendly-error patterns" section mirroring the `PER_RUNNER_FIXES` shape. `QUICKSTART.md` gained a one-line nudge after step 4 mentioning the optional runner step.

- **Build + typecheck:** `pnpm -r typecheck` clean across all 17 packages (the new `examples/plugins/runner-stub` from Phase 12 + all new Phase 13 files compile). `pnpm build` green at **21.64s** — actually FASTER than Phase 12's 22.78s despite adding ~1500 LOC of new runtime + tests + docs (Phase 11 baseline was 21.55s). The pre-existing 92 better-sqlite3 ABI test failures remain locally but Phase 12's `@electron/rebuild` postinstall + CI step is the resolution path.

## Verify Before Continuing

- [ ] **Onboarding wizard runner step.** Reset onboarding (DevTools → `window.opencodex.onboarding.setComplete(false)` → reload). Wizard now shows 4 steps; the new step between API key and workspace lists external runners with install state, has Skip + Continue. Zero runners enabled is a valid completion path.

- [ ] **Agent empty-state runner discovery.** Open `/agent` with no runs (fresh install or wipe runs DB). Expected: two-line hook + horizontal scroll of runner cards. Built-in card → "Spawn task". External installed → "Spawn with `<name>`" pre-selects that runner in the modal. External not-installed → "Set up" deep-links to `/settings/runners?install=<id>`.

- [ ] **In-app install flow.** Settings → Runners → click Install on a not-installed runner → picker shows available package managers (npm if installed; brew if installed; pipx if installed) → click a manager → see the LITERAL command preview (e.g., `npm install -g @anthropic-ai/claude-code`) → click Install → live stdout/stderr stream → on success, status pill flips to installed. On failure, stderr tail visible + "Show full log" disclosure.

- [ ] **Test connection.** Settings → Runners → click Test connection on an installed runner. First call probes; second call within 60s shows "Cached" badge. Unauthenticated runner → red pill with friendly hint like `Run 'opencode auth login' or check ~/.config/opencode/`.

- [ ] **Verify runner before spawn.** Open AgentSpawnModal, pick an external runner. Verify-runner button appears next to Submit. Click → probe runs → status pill renders inline. Submit stays disabled until Verify is green (if you want — current spec allows submit either way).

- [ ] **Inline `git init` in spawn modal.** In a NON-git workspace, pick an external runner. The Phase-12 guard fires + new **Initialize git repo** button is present. Click → approval modal appears for the git commands → on success, guard clears, toast `Initialized git repo on branch main` fires, Submit enables.

- [ ] **Safety-boundary callout.** Pick any external runner → confirm the inline info note above Submit reads (verbatim) `<DisplayName> uses its own approval model. Changes land in a git worktree for your review — your OpenCodex approval policy does not gate the runner's internal tool calls.`

- [ ] **Friendly runner error in drawer.** Trigger an external-runner crash with a known stderr (e.g., temporarily invalidate the runner's auth + spawn a task). AgentRunDrawer shows the kind icon + classified message + `suggestedFix` callout + two buttons (Retry with `<runner>` / Re-spawn with internal). Raw stderr is behind "Show raw error" disclosure.

- [ ] **Audit-log runner column + filter.** Open Settings → Audit log. Each row now shows a Runner pill (`OpenCodex` for null/internal, runner displayName otherwise). New Runner `<select>` filter chip filters rows. Migration v10 ran on first launch; existing audit rows have `runner_id = NULL` → render as `OpenCodex`.

- [ ] **`pnpm build` stays ~21-23s.** Verified this session: 21.64s green.

## Next Task

**Phase 13 is closed.** Remaining work is Backlog (`Todo.md` lines 487–492) + the Phase 12 carry-over (`PLACEHOLDERS.md` for the maintainer). No new architectural work proposed.

- **Pre-tag maintainer work** (Phase 12 carry-over):
  - Fill `PLACEHOLDERS.md` — 24 `@TODO-` / `TODO-org` / `TODO-repo` / `TODO-set-domain` occurrences. The `pnpm check-placeholders` CI step blocks tagging until these are resolved.
  - Delete the stray `CUsersVRProjectsOPEN-UI-UX-handoff-fmt.tmp` file in repo root (caught by the placeholder gate; not part of the project).
- **Needs external credentials (4 items):** MCP OAuth (`Todo.md:116`), macOS code signing (`Todo.md:173`), Windows code signing (`Todo.md:174`), public v0.1 release announcement (`Todo.md:184`).
- **Needs user architecture sign-off (6 backlog items):** cloud tasks, voice mode, mobile companion, team workspaces, visual workflow builder, JetBrains/VSCode integration.
- **Explicit stretch (1 item):** `packages/runner-mcp-bridge` (`Todo.md:406`) — would let MCP-aware harnesses call OpenCodex tools with OpenCodex approvals enforced. Strong Phase 14 candidate.

- **Phase 13 deferred polish (optional, small):**
  - Thread `runnerId` into the `chat/runner.ts` `recordToolCall` call site so the audit log's Runner column shows the actual runner for new rows (today it always renders `OpenCodex` because the writer doesn't pass `runnerId`).
  - Replace Lane C's defensive `runnerBridge()` / `gitBridge()` helpers with direct `window.opencodex.runner.*` / `window.opencodex.git.*` calls — the bridge is properly typed now, the helpers are no-ops.
  - True per-hunk j/k/a/r in MergeReviewModal (Phase 12 deferred — still applies).

**Repo remains shippable as v0.1 plus Phases 9 / 10 / 11 / 12 / 13 once macOS+Windows certs land, `PLACEHOLDERS.md` is filled, and a public release is published.**

## Context Notes

### The agent team Phase 13 used

Per the user's `/goal` request: a multi-role team with explicit roles. This session validated the pattern:

- **Orchestrator (me) = context manager.** Stayed lean by never reading large source files directly. Delegated all file reads to the researcher and the lane agents. Total orchestrator context burn was a fraction of Phase 12's because the researcher's pre-bundle removed redundant cross-lane reads.
- **Researcher (1 read-only agent) = the assistant that feeds items needing searching.** 8 specific architectural questions, returned in <1000 words with file:line citations and short code excerpts. Findings bundled verbatim into the 3 lane prompts so the implementers didn't re-discover the same patterns.
- **Lane A / B / C (3 implementation agents) = the implementers.** Strict file ownership, no overlap, parallel execution. Each reported in <500 words with explicit cross-lane flags for handoffs they couldn't reach.
- **Consolidation agent (1) = the cross-lane stitcher.** Single focused pass on the 4 cross-lane items the lanes flagged. Surgical edits, no scope creep.
- **Wrap-up agent (1) = tests + docs.** Read the source first (per prompt), then wrote tests matching the existing project style, plus 3 targeted docs edits.

The pattern of _researcher → lanes-in-parallel → consolidation → wrap-up_ fits inside one orchestrator context window even for substantive features. Recommended reuse for Phase 14+ if architecture-heavy.

### New "runner" namespace on the bridge

Phase 13 added `window.opencodex.runner.*` as a new top-level namespace, distinct from the existing `window.opencodex.agent.*`. Authoring rule: anything about an **individual runner adapter's lifecycle** (install, probe, friendly-errors) lives under `runner.*`; anything about the **agent-run registry or model layer** (listRuns, listRunners, spawnFromUi) stays under `agent.*`. Lane C deferred to this distinction; future lanes should preserve it.

### Phase 12 → Phase 13 follow-up still open

Phase 12 deferred polish noted "delete the now-redundant `isGitRepo` check inside `bootstrapWorktreeOrSkip`" — still applies. Lane B did NOT touch it in this session; the redundant check is defensive-by-design and harmless.

### TS Mock-type recurring lesson

For RTL + jsdom test files, **use `import { type Mock } from 'vitest'` + bare `Mock` annotations**, NEVER `ReturnType<typeof vi.fn>`. The latter gives `Mock<any[], unknown>` from the bare overload, but `vi.fn(async () => undefined)` returns the narrower `Mock<[], Promise<undefined>>` — assignment fails because `Mock` is invariant. This bit Phase 12 once; Phase 13's `RunnersStep.test.tsx` correctly used the bare-`Mock` pattern from the start.

### Pre-existing carry-overs

- Node v20 pinned. `@electron/rebuild` postinstall (Phase 12) resolves the 92 better-sqlite3 ABI test failures on fresh installs.
- Path has space + period (`OPEN UI.UX`) — quote in shell.
- `packages/*` tsconfig is `noEmit: true` — switch to `tsup` before any `pnpm publish` of standalone packages.
- Stray `.tmp` file in repo root — should be deleted before tag (placeholder gate catches it).

### Files added this session (Phase 13)

**New main-process source (4):**

- `apps/desktop/src/main/agent/runner-install.ts`
- `apps/desktop/src/main/agent/runner-probe.ts`
- `apps/desktop/src/main/agent/runner-friendly-errors.ts`
- `apps/desktop/src/main/agent/git-init.ts`

**New shared (1):**

- `apps/desktop/src/shared/runner-discovery.ts`

**New renderer (2):**

- `apps/desktop/src/renderer/components/onboarding/RunnersStep.tsx`
- `apps/desktop/src/renderer/components/RunnerDiscoveryCards.tsx`

**New tests (4):**

- `apps/desktop/src/main/agent/runner-probe.test.ts`
- `apps/desktop/src/main/agent/git-init.test.ts`
- `apps/desktop/src/main/agent/runner-friendly-errors.test.ts`
- `apps/desktop/src/renderer/components/onboarding/RunnersStep.test.tsx`

**New IPC channels (6):**

- `runner:list-package-managers` (invoke)
- `runner:install` (invoke)
- `runner:install-progress` (event)
- `runner:probe-auth` (invoke)
- `git:init-repo` (invoke)
- `runner:friendly-error` (event)

**DB migrations (1):**

- v10: `ALTER TABLE tool_calls ADD COLUMN runner_id TEXT;`

**Docs edits (3):**

- `MANUAL.md` Runners section — 5 new subsections.
- `docs/runner-authoring.md` — "Contributing friendly-error patterns" section.
- `QUICKSTART.md` — one-line runner-step nudge after step 4.
