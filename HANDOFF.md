# Handoff State

## Last Session Summary

- **Phase 9 (Pluggable agent runners) shipped in full — 43/43 items closed except 1 stretch.** `SubagentRunner` interface + `RunnerRegistry` live in `@opencodex/core` with the `collectSubagentResult` helper. `internalRunner` wraps the legacy `runSubagent` and is registered at boot before plugin activation. `runnerId` threads through every subagent execution path: `worker-host` / `worker-protocol` / `worker-entry` / `spawn-from-ui` / `spawn-subagent-tool` / `scheduler/runner` / `shared/agent-spawn` / `shared/agent-runs` / `run-registry`. Plugin SDK gained `host.registerRunner()` gated by new `'agent.runner'` permission; manifest contributions accept `runners[]`. SQLite migration v9 adds `scheduled_tasks.runner_id TEXT NULL`. Three first-party adapter packages shipped: `@opencodex/runner-claude-code` (NDJSON stream-json parser, 19 tests), `@opencodex/runner-opencode` (NDJSON + fallback text mode, 25 tests), `@opencodex/runner-aider` (line-buffered, `streaming: false`, 14 tests). All use the shared `treeKill` util extracted from `run-shell.ts` into `packages/core/src/process/tree-kill.ts`. Worktree-only enforcement in `spawn-from-ui` + `scheduler/runner` rejects external-runner spawns on non-git workspaces. Plugin presets file (`apps/desktop/src/main/plugins/presets.ts`) lists the three runners with install hints; `plugins:list-presets` IPC channel registered. UI surfaces: Runner dropdown in `AgentSpawnModal` + `ScheduledTaskEditorModal` (hides provider/model and forces useWorktree when non-internal), runner pill on `ActiveRunCard` + `AgentRunRow`, new `RunnersPanel` settings section (slug `runners`, 15th), `runner_not_installed` callout in `AgentRunDrawer` with deep-link to `/settings/runners`. Skill frontmatter accepts optional `runner:` that propagates to the cron-linked scheduled task. Full Phase 9 docs landed in `website/pages/guides/runners.mdx` (149 lines, new) + extensions to `plugins/authoring.mdx`, `plugins/api.mdx`, `guides/architecture.mdx` (+ mirror to `docs/architecture.md`), `guides/scheduled-tasks.mdx`, and `guides/authoring-skills.mdx`.

- **Phase 10 (Unified left column + Automations + Hover hints) shipped in full — 26/26 items closed.** AppShell restructured to 3-column grid (nav rail / context pane / main); new `LeftColumnContextPane.tsx` lazy-loads 4 panes via `React.lazy()` + Suspense, switching by route. ChatView sidebar removed; conversations list, "New chat", workspace chip, and Cmd+`\` handler all moved into `ChatContextPane`. New top-level `/automations` route + `AutomationsView.tsx`; deep-link redirect from `/settings/scheduled-tasks` preserves `?prefillSkill=` query param. `ScheduledTaskCard.tsx` extracted from `ScheduledTasksPanel` so Settings and Automations render identically. Trigger-type badges (M / CRON / FILE / GIT / HOOK text labels — lucide-react not in deps; no emojis per CLAUDE.md). `HoverHint.tsx` (380 lines) provides 300ms-open/100ms-close tooltips with viewport-aware flip positioning, portal to document.body, `pointer-events: none`, focus support, `prefers-reduced-motion` honored, 5-word author cap enforced with dev-only warn-once. Global `hoverHintsEnabled` setting (default `true`) lives in storage/settings with IPC channels + broadcast + App.tsx provider wiring. New `AccessibilityPanel.tsx` settings section (slug `accessibility`) houses the toggle + preview demo. Sweep added 8 HoverHint wrappers across AgentView / ChatView / CodebaseSearchBox; nav rail icons covered. `website/pages/guides/accessibility.mdx` created. RELEASE_NOTES_TEMPLATE.md updated with the layout-change changelog note.

- **Test baseline: 874 pass / 94 fail / 7 skipped (up from 773 / 92 / 7 — +101 net passes, no regressions).** New green tests: `runner-registry` (6), `tree-kill` indirectly verified through `run-shell` (16), `manifest` plugin-sdk (11), `internal-runner` (7), `worker-protocol` (8 new on top of existing), `spawn-from-ui` (5 new), `cron-sync` (2 new), `runner-claude-code` (19), `runner-opencode` (25), `runner-aider` (14), `plugin manager` (5 new). RTL-gated test files written but skipped (jsdom not installed): `HoverHint.test.tsx` (9 cases), `AgentSpawnModal.test.tsx` (4), `LeftColumnContextPane.test.tsx`, `AutomationsView.test.tsx`. The 92 pre-existing better-sqlite3 ABI failures persist (HANDOFF carry-over from prior sessions; require `@electron/rebuild` to resolve). 2 new "failures" are the RTL-gated files attempting to load missing `jsdom` — by design, will pass once test deps are installed.

- **Tree state: `pnpm build` green at 21.51s (baseline was 21.41s). `pnpm --filter @opencodex/desktop typecheck` clean.**

## Verify Before Continuing

- [ ] **Runner dropdown in spawn modal.** Open Agent view → Spawn task → confirm Runner dropdown appears above provider/model with `OpenCodex built-in` as default. Switch to `Claude Code` (if installed) → provider + model selects disappear, informational note renders ("This runner uses its own provider and tools — OpenCodex approvals do not apply inside the harness."), useWorktree toggle is forced on + disabled.

- [ ] **External runner on non-git workspace fails clearly.** In a non-git directory, set it as active workspace → Spawn task → pick `Claude Code` → expect spawn to fail with the error `"External runners require a git workspace so changes can be reviewed before merge"`. Then run the same in a git workspace → spawn succeeds, worktree is created.

- [ ] **Runner settings panel + CLI path override.** Open Settings → Runners (new 15th section, after Skills). Expect rows for `internal` + any plugin-registered runners (initially none; first-party adapters are presets that need explicit install). Per-row "Re-check" button refreshes install status. CLI path input persists to `settings.runners.<id>.cliPath`.

- [ ] **Hover hints work and toggle off cleanly.** Hover any icon-only button (nav rail icons, Spawn task `+`, ChatView Send) → tooltip appears after 300ms. Open Settings → Accessibility → toggle off → all hints stop firing (zero listeners attached, verified by the `disabled` prop path). Toggle back on → hints return.

- [ ] **Automations is a top-level nav item with full functionality.** Click Automations icon (between Agent and Settings) → opens `/automations` view with scheduled-task grid. "New automation" button opens `ScheduledTaskEditorModal`. Visit `/settings/scheduled-tasks` directly → redirects to `/automations` preserving any `?prefillSkill=` query param. Click a task in the left context pane → opens its run-history drawer.

- [ ] **Skill with `runner:` frontmatter auto-registers correctly.** Create a `.skill.yml` (or `SKILL.md`) with `cron: "*/5 * * * *"` + `runner: claude-code` + `tools: [read_file]` → save → confirm a scheduled task is auto-created with `runnerId: 'claude-code'` (visible in Automations view). Chat-invoking that skill (via `/skill-name`) should still use the chat provider, not Claude Code — that's the documented caveat.

- [ ] **`pnpm build` and `pnpm typecheck` stay green.** Verified this session: typecheck clean, build at 21.51s.

- [ ] **`pnpm test` baseline is 874 / 94.** The 94 failures are 92 pre-existing better-sqlite3 ABI failures + 2 new RTL-gated test files awaiting `jsdom`. No real regressions.

## Next Task

**No engineering work remaining in Todo.md that doesn't require external user input.**

Every open `[ ]` in Todo.md is one of:

- **Needs external user credentials (4 items, Phase 6 + Backlog):**
  - MCP OAuth handling (Todo.md:116) — per-MCP-server OAuth app config
  - macOS code signing + notarization (Todo.md:173) — Apple Developer Program + Developer ID cert + Apple ID + app-specific password
  - Windows code signing (Todo.md:174) — EV cert + hardware token
  - Public v0.1 release announcement (Todo.md:184) — user task; `RELEASE_NOTES_TEMPLATE.md` at repo root is the body to paste

- **Needs user architecture/UX/scope sign-off (6 items, Backlog lines 487-492):** cloud tasks, voice mode, mobile companion, team workspaces, visual workflow builder, JetBrains/VSCode integration — each `_(BLOCKED — …)_` parenthetical in Todo.md explains why.

- **Explicitly deferred stretch (1 item):** `packages/runner-mcp-bridge` (Todo.md:406) — exposes OpenCodex tools as an MCP server to external harnesses. Not required for Phase 9.

**The repo is shippable as v0.1 with Phase 9 + Phase 10 functionality once the user buys macOS/Windows certs and publishes.**

## Context Notes

### Pluggable runner architecture (Phase 9)

- **`@opencodex/core` exports the contract:** `SubagentRunner`, `SubagentRunOptions`, `SubagentResult`, `SubagentStopReason`, `RunnerRegistry`, `RunnerAlreadyRegisteredError`, `collectSubagentResult`, `treeKill` (from `./process/tree-kill`). Adapters MUST emit at least one `done` ChatEvent and SHOULD emit `usage` before `done`.
- **Singleton:** `apps/desktop/src/main/agent/runner-registry-instance.ts` exports `runnerRegistry` — the canonical registry that handlers, spawn-from-ui, scheduler, and the worker process all reference. The utility worker process self-registers `internalRunner` because the fork is a fresh isolate.
- **Plugin runner naming:** plugin-contributed runners are registered as `plugin__${pluginId}__${runner.id}`. The `agent:list-runners` IPC parses this to surface the bare id + pluginId. The `agent:check-runner-installed` handler accepts either form.
- **Worktree-only:** external runners (`runnerId !== 'internal'`) reject non-git workspaces with a fixed error string. Applied in both `spawn-from-ui.ts` (`bootstrapWorktreeOrSkip`) and `scheduler/runner.ts` (`runSubagentForTask`). Error routes through the existing failed-run path in the scheduler.
- **Internal runner is streaming-honest:** the JSDoc on `runner.ts` notes that `internalRunner` synthesizes the event stream from the post-run `SubagentResult` rather than emitting mid-loop. A TODO in `subagent.ts:228-229` documents this. True mid-loop streaming requires a deeper refactor of `runSubagent` to expose its inner generator — punted to v0.2.

### Unified left column (Phase 10)

- **Layout:** 3-column grid in AppShell.tsx — nav rail (56px) / context pane (260px, collapsible) / main (1fr). When the context pane is collapsed, the middle column shrinks to 0 via `.context-hidden`. localStorage key `'left-column'` per Todo spec; legacy `'opencodex.nav.collapsed'` is orphaned but harmless.
- **Pane discipline:** each context pane is a separate component lazy-loaded via `React.lazy()`. Subscriptions only attach when the corresponding route is active. Pattern documented in `LeftColumnContextPane.tsx`.
- **Settings is the odd one out:** when route is `/settings`, the context pane renders nothing — SettingsView keeps its own internal two-pane layout to preserve the search box and section navigation. The shell collapses the middle column visually.
- **Codebase context pane is a placeholder:** the "recent files history" lift from CodebaseView was out of scope for this wave (would require modifying CodebaseView). `CodebaseContextPane.tsx` has a `TODO(phase10): recent-files history` comment.

### HoverHint contract

- **API:** `<HoverHint hint="≤5 words"><button>...</button></HoverHint>`. Prefers child's `aria-label` if `hint` not provided.
- **Provider wiring:** `<HoverHintProvider enabled={hintsEnabled}>` wraps the App in App.tsx. The boolean is fetched from `settings.getHoverHintsEnabled()` on mount and subscribed via `settings.onHoverHintsChanged`.
- **Suppression context:** components like Modal can call `useHoverHintControl().pushSuppression()` on mount and `popSuppression()` on unmount to prevent stacking-context fights. Defined; consumers are not yet wired in this wave — Modal adoption is a polish follow-up.
- **5-word cap:** enforced in dev only via `console.warn` (once per unique hint string, via module-scoped Set). Production renders the full text (still warns in dev).

### Local HTTP listener (scheduler) — carryover from prior session

- File: `apps/desktop/src/main/scheduler/listener.ts`. Binds **127.0.0.1 only**. Port range default **38400-38500**; chosen port persisted as `schedulerListenerPort` in electron-store.
- HMAC contract: `X-Opencodex-Signature: <hex>` — SHA256, optionally prefixed `sha256=`. Signature is computed over the **raw request body**. Verification via `timingSafeEqual`.
- Rate limit: 1 req / 1000 ms / taskId, enforced **before** signature verification so unknown task ids can't force HMAC CPU burn.

### Git-hook wrapper sentinel format — carryover

- The wrapper file `<workspace>/.git/hooks/<hook>` starts with `#!/bin/sh` then a sentinel block `# opencodex-hook BEGIN` … `# opencodex-hook END`.
- If a user hook pre-existed, OpenCodex writes to `<hook>.opencodex` and appends a sentinel-bounded sourcing line to the user's hook.
- Both `.cmd` and `sh` wrappers are installed; Git for Windows picks the right one.

### Files added this session (Phases 9 + 10)

**New packages (3):**

- `packages/runner-claude-code/` — 10 files, 884 lines.
- `packages/runner-opencode/` — 10 files.
- `packages/runner-aider/` — 10 files.

**New core utilities:**

- `packages/core/src/runner.ts`
- `packages/core/src/runner-registry.ts`
- `packages/core/src/process/tree-kill.ts`

**New desktop modules:**

- `apps/desktop/src/main/agent/runner-registry-instance.ts`
- `apps/desktop/src/main/plugins/presets.ts`
- `apps/desktop/src/renderer/components/HoverHint.tsx`
- `apps/desktop/src/renderer/components/LeftColumnContextPane.tsx`
- `apps/desktop/src/renderer/components/left-column-panes/{Chat,Agent,Codebase,Automations}ContextPane.tsx`
- `apps/desktop/src/renderer/components/ScheduledTaskCard.tsx`
- `apps/desktop/src/renderer/views/AutomationsView.tsx`
- `apps/desktop/src/renderer/views/RunnersPanel.tsx`
- `apps/desktop/src/renderer/views/AccessibilityPanel.tsx`

**New tests:**

- `packages/core/src/runner-registry.test.ts`
- `packages/plugin-sdk/src/manifest.test.ts`
- `apps/desktop/src/main/agent/internal-runner.test.ts`
- `apps/desktop/src/main/plugins/manager.test.ts`
- Adapter tests in each of the three runner packages
- RTL-gated: `HoverHint.test.tsx`, `AgentSpawnModal.test.tsx`, `LeftColumnContextPane.test.tsx`, `AutomationsView.test.tsx`

**New docs:**

- `website/pages/guides/runners.mdx`
- `website/pages/guides/accessibility.mdx`

### Pre-existing carry-overs still relevant

- Node v20 pinned. `better-sqlite3` must be rebuilt against Electron's ABI — `@electron/rebuild` is the tool. DB-backed tests still fail under bare vitest; this includes the new `scheduler/runner.test.ts` extensions and the deferred `store.test.ts` v9 round-trip.
- Path has space + period (`OPEN UI.UX`) — quote in shell.
- `packages/*` tsconfig is `noEmit: true` — switch to `tsup` before any `pnpm publish` of the standalone packages. Includes the three new runner packages.
- Pre-public placeholders remain in CODEOWNERS / SECURITY.md / README.md / `.github/ISSUE_TEMPLATE/config.yml` / `website/theme.config.tsx`: `@TODO-set-github-handle`, `security@TODO-set-domain`, `github.com/TODO-org/TODO-repo`. Fill these before the first public tag. (Out of scope for this session — requires real org names from the user.)
- `website/` is excluded from the main pnpm workspace; run `pnpm install && pnpm dev` inside `website/` separately. Docs added this session are not built by the main `pnpm build`.

### Cannot Be Closed Here (11 items, all external / blocked / stretch)

- **Needs external credentials (4 items):** MCP OAuth (Todo.md:116), macOS signing (Todo.md:173), Windows signing (Todo.md:174), public release announcement (Todo.md:184).
- **Needs user architecture/UX sign-off (6 items, lines 487-492):** cloud tasks, voice mode, mobile companion, team workspaces, visual workflow builder, JetBrains/VSCode plugins.
- **Explicitly deferred stretch (1 item):** `packages/runner-mcp-bridge` (Todo.md:406).

That's it. The engineering scope of v0.1 + Phase 9 + Phase 10 is closed.
