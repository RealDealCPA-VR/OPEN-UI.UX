# Handoff State

## Last Session Summary

- **Theme system shipped end-to-end.** `settings.theme` (`light` | `dark` | `system`) drives effective theme; `settings:get-theme`/`settings:set-theme` IPC + `settings:theme-changed` event; main passes `--initial-theme=<pref>` via `additionalArguments` and preload applies `data-theme` on `<html>` **before any renderer JS runs** (zero-flash boot). [ThemeApplier](apps/desktop/src/renderer/components/ThemeApplier.tsx) at App root reconciles preference, listens for IPC changes, and listens to `prefers-color-scheme` media query when preference is `system`. [ThemePanel](apps/desktop/src/renderer/views/ThemePanel.tsx) is now the first Settings subsection.
- **CSS variables refactor.** [styles.css](apps/desktop/src/renderer/styles.css) now has ~75 semantic tokens on `:root` (verbatim original dark colors) and a GitHub-light–style override block on `:root[data-theme='light']`. Every hex literal in rule bodies migrated to `var(--…)`. Two ambiguous hexes (`#1f232a` was both border and btn-bg; `#6c727a` was both text-muted and tok-comment) were disambiguated with targeted edits before bulk replace.
- **9 new tests** in [shared/theme.test.ts](apps/desktop/src/shared/theme.test.ts) covering `resolveEffectiveTheme` matrix, `isThemePreference` guard, `parseInitialThemeArg` (present, absent, invalid, first-wins). Suite is now **409 passed + 7 skipped across 46 files**.

## Verify Before Continuing

- [ ] **Full CI green** — `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build`. Expect **409 passing + 7 skipped across 46 files**. Bundle sizes: main `68.26 kB` (+0.92 vs prior), preload `4.46 kB` (+1.48), renderer JS `409.76 kB` (+4.87), renderer CSS `45.84 kB` (+9.71), provider-builder `1.72 kB` (unchanged).
- [ ] **Theme actually applies at runtime.** From `pnpm dev`: open Settings → Theme. Switch Light → instant re-paint, no reload, no flash. Switch back to Dark → same. Switch to System → matches the OS theme. Quit, change OS to a different scheme, relaunch with `system` selected → app launches in the new scheme with no FOUC. With **System** selected and the app open, flip the OS color-scheme (Windows: Settings → Personalization → Colors → Choose your mode) → app should update live within ~100ms.
- [ ] **Light theme readability** — scan every view in light mode: chat (user + assistant bubbles, code blocks, syntax highlighting), audit log (rows, decision pills, tier pills, expanded body), approvals (queue rows, modal with `write_file` diff preview, `edit_file` side-by-side, `run_shell` command box, `web_fetch` method pill), providers (cards + test result rows), model picker dropdown, workspace (active + recent list), tool call cards (read/glob/grep/run_shell/web_fetch previews). Anything that looks washed out or low-contrast → tune the relevant `--…` token in the `:root[data-theme='light']` block at the top of [styles.css](apps/desktop/src/renderer/styles.css), not the rule body.

### Carry-over visual checks (still not done; not blocking)

- [ ] **Workspace picker actually works at runtime** (prior session). From `pnpm dev`: Settings → Workspace → Browse… picks a folder, becomes active; second Browse moves first to Recent; Open from Recent swaps; Remove deletes; Clear unsets without dropping Recent; restart persists active + recent.
- [ ] **Workspace drives tool sandbox.** Non-cwd workspace active → ask agent to `read_file` a relative path inside it; consumers are [main/chat/handlers.ts:124](apps/desktop/src/main/chat/handlers.ts#L124) and [main/chat/approval-handlers.ts:59](apps/desktop/src/main/chat/approval-handlers.ts#L59).
- [ ] **`OPENCODEX_SHELL_PATH` runtime check** — set the env var, `pnpm dev`, trigger `run_shell` with `node -e "console.log(process.env.PATH)"`. Output should equal the override.
- [ ] **Audit row → conversation jump** — click conversation title cell in Audit log, expect jump + scroll + flash.
- [ ] **Audit row expand toggle** — clicking the row (not the title) still expands/collapses.
- [ ] **Approval modal cleanup on cancel** — visually confirm Cancel mid-approval removes the modal.
- [ ] **Tool result previews** (read_file, grep, run_shell, web_fetch, glob, list_dir, write_file, edit_file).
- [ ] **Approval previews** (write_file/edit_file/run_shell/web_fetch header tier pill, diff stats, side-by-side, command box, method pill).
- [ ] **`window.opencodex.approvals.readFilePreview`** in devtools.
- [ ] **Retention UI** — change retention to 7 days, custom value passthrough, startup purge log.
- [ ] **POSIX shell process-tree kill + ripgrep tests** on macOS/Linux CI.

## Next Task

Pick one (carry-overs plus the new options):

1. **Settings UI parent line** _([Todo.md:172](Todo.md#L172))_ — four subsections done (theme, workspace, providers, approvals, audit log); **two remaining** that are independently doable: indexing (UI-only stub until Phase 3 ships) and possibly an onboarding affordance for "no providers configured". MCP and plugins gated by Phase 2.5/4.
2. **Status bar** _([Todo.md:104](Todo.md#L104))_ — agent state, current tool, tokens used. Status-bar slot doesn't exist yet; would live below the chat composer or as a top-bar extension.
3. **Workspace switch event** — currently `activeWorkspace` change doesn't broadcast; a live chat keeps the workspace it captured at `chat:start`. Now mirrorable: emit `workspace:changed` IPC event on `set-active`/`clear-active`/`browse` (exactly the pattern just established for `settings:theme-changed`).
4. **Onboarding wizard** _([Todo.md:170](Todo.md#L170))_ — first-run flow: pick provider → enter key → pick workspace → first chat. Has a clear scope (single component + first-run detection in settings).

## Context Notes

### Theme system invariants (now load-bearing)

- **Boot path is `additionalArguments` → preload → renderer**, not async IPC. `main/index.ts` reads `getTheme()` synchronously when building `BrowserWindow.webPreferences` and appends `--initial-theme=<pref>` to `additionalArguments`. Preload calls `parseInitialThemeArg(process.argv)` and `document.documentElement.setAttribute('data-theme', effective)` **at module top-level**, before any contextBridge work. This is the zero-flash mechanism — don't move it into an async function.
- **`ThemeApplier` is mounted INSIDE the providers tree** in [App.tsx](apps/desktop/src/renderer/App.tsx) but renders `null` and never affects providers. It exists purely to: (a) refresh `data-theme` from the IPC source-of-truth on mount (in case preload's value got out of sync), (b) listen for `settings:theme-changed` broadcast, (c) listen for `prefers-color-scheme` flips when preference is `system`. The `current` ref pattern (closure variable inside `useEffect`) is what makes the media listener correctly skip non-system preferences. Don't replace with `useState` — re-renders would tear down listeners.
- **System-mode reactivity uses both `addEventListener('change')` and `addListener`** as fallback. Some older Electron Chromium builds quietly drop the older addListener API; using both is defensive but harmless.
- **`THEME_OPTIONS` is the single source for the radio list.** If you add a 4th preference (e.g. `high-contrast`), you'd update `ThemePreference` union, `isThemePreference` guard, `THEME_PREFERENCES` array, `THEME_OPTIONS`, the Zod enum in [settings.ts:44](apps/desktop/src/main/storage/settings.ts#L44), the Zod enum in [theme/handlers.ts](apps/desktop/src/main/theme/handlers.ts), and a new branch in `resolveEffectiveTheme`. The tests at [shared/theme.test.ts](apps/desktop/src/shared/theme.test.ts) cover the matrix and will need extension.

### CSS variable conventions (now load-bearing)

- **`:root` defines all dark-theme tokens with literal hex/rgba.** `:root[data-theme='light']` overrides every one of them with the light counterpart. **Never put hex literals in rule bodies** — always reference a `var(--…)` token. If you find yourself wanting a one-off color, define a new token in BOTH `:root` blocks first.
- **Two ambiguity-resolved tokens.** `--bg-btn` and `--border` had the same dark-theme value (`#1f232a`); they're separate tokens because the light theme needs them distinct (`--bg-btn: #f6f8fa` vs `--border: #d1d5da`). Similarly `--tok-comment` is its own token even though it shares the dark value with `--text-muted`. If you reintroduce a `background: #1f232a` literal it'll work in dark but break in light.
- **`.chip`, `.btn`, `.tok-comment` got targeted disambiguation edits** before the bulk hex→var replace. If you reorder the refactor (don't), redo those three first.
- **Bundle size impact: renderer CSS +9.7 kB.** Most of that is the second palette block. If size matters, consider tokenizing only top-level surfaces and letting accent colors stay literal — but the current setup is the more maintainable shape.

### Workspace picker invariants (prior session, still load-bearing)

- **Pure logic lives in [shared/workspace.ts](apps/desktop/src/shared/workspace.ts).** `applySetActive`/`applyRemove` take/return `WorkspaceState`; storage wrappers in `settings.ts` just call them around `updateSettings`. Tests target the pure helpers (no electron-store mocking).
- **`workspace:set-active` validates dir-exists.** Dead paths silently auto-cleanup via `removeWorkspaceFromHistory`. Intentional; if you want "fail loudly" branch in [main/workspace/handlers.ts](apps/desktop/src/main/workspace/handlers.ts).
- **History cap = `WORKSPACE_HISTORY_LIMIT` (10).** Renderer filters active out of `state.history` in [WorkspacePanel.tsx](apps/desktop/src/renderer/views/WorkspacePanel.tsx) — active is always at index 0 (MRU).
- **`activeWorkspace` wired upstream** at [main/chat/handlers.ts:124](apps/desktop/src/main/chat/handlers.ts#L124) and [main/chat/approval-handlers.ts:59](apps/desktop/src/main/chat/approval-handlers.ts#L59). Switching workspaces affects subsequent chat starts only — no live cascade.

### `OPENCODEX_SHELL_PATH` invariants (still load-bearing)

- **Override applies AFTER the keep-list copy** in [scrubEnv](packages/tools/src/run-shell.ts#L203-L219). Order matters.
- **Empty/whitespace-only is treated as unset** (`.trim()` then truthiness).
- **Override var itself is NOT in `DEFAULT_ENV_KEEP`** — never reaches the child.
- **No UI exposure yet.** Operator-config-only.

### Audit → chat jump invariants (still load-bearing)

- **URL contract: `/chat?conversationId=<id>&messageId=<id>`.** Both required.
- **ChatPane uses refs, not state, to dedupe scroll triggers.** `consumedScrollRef` (Set), `skipBottomScrollRef` (boolean one-shot).
- **Scroll-to-target useLayoutEffect must come BEFORE bottom-scroll useLayoutEffect.** [ChatView.tsx:170-202](apps/desktop/src/renderer/views/ChatView.tsx#L170-L202).
- **MessageBubble `id="chat-message-{id}"`** is the load-bearing DOM hook.

### Retention invariants

- **`purgeToolCallsOlderThan` is strict less-than the cutoff.** Equal-timestamp rows survive.
- **Invalid retention is silent no-op.** `days < 1`, `NaN`, non-finite → `{ deletedCount: 0 }`.
- **`auditRetentionDays` schema is `.min(1).max(36500).nullable().default(null)`.**

### Cancellation invariants

- **`taskkill /F /T` kills detached descendants on Windows.** Don't change `run-shell.ts`'s `detached: !isWindows` without updating the test.
- **`waitForProcessDeath` polls every 50ms with a 5s budget.**
- **`process.kill(pid, 0)` is a liveness probe on Windows** (Node ≥14).
- **Web-fetch abort tests mock `fetch` by hand** so the mock honors `init.signal`.

### Other carry-overs

- **`packages/tools` exports `resolveWithinWorkspace` + `PathEscapesWorkspaceError`** from the package root.
- **Audit-log denial cases lose source info.** `policy-deny` / `prompt-deny-*` all collapse to `decision: 'denied'`.
- **`requestApproval` returns `Promise<ApprovalOutcome>`** (`{decision, source}`).
- **`durationMs: null` for denials** distinguishes "never ran" from "ran instantly".
- **Tool-tier pill classes**: `.tool-tier-{read,write,execute,network}` in [styles.css](apps/desktop/src/renderer/styles.css).
- **`packages/*` tsconfig is `noEmit: true`** — switch to `tsup` before any `pnpm publish`.
- **`.github/workflows/ci.yml`** doesn't run `pnpm build`.
- **Folder path has a space + period** (`OPEN UI.UX`) — quote in shell.
- **Pre-public placeholders**: `@TODO-set-github-handle`, `security@TODO-set-domain`, `github.com/TODO-org/TODO-repo`.

### Untracked files at handoff (still uncommitted across ~11 sessions)

```
Modified: HANDOFF.md, Todo.md,
          apps/desktop/src/main/chat/approval-handlers.ts,
          apps/desktop/src/main/index.ts,                       (this session — registerThemeHandlers + additionalArguments)
          apps/desktop/src/main/storage/tool-audit.{ts,test.ts},
          apps/desktop/src/main/storage/settings.ts,            (this session — getTheme/setTheme)
          apps/desktop/src/preload/index.ts,                    (this session — theme bridge + zero-flash apply)
          apps/desktop/src/renderer/App.tsx,                    (this session — ThemeApplier mount)
          apps/desktop/src/renderer/components/{ApprovalQueue,ToolCallCard}.tsx,
          apps/desktop/src/renderer/styles.css,                 (this session — CSS var refactor + .theme-* rules)
          apps/desktop/src/renderer/views/{ChatView,SettingsView}.tsx,  (this session — Theme section in Settings)
          apps/desktop/src/shared/{approvals,ipc-types}.ts,     (this session — settings:get-theme/set-theme/theme-changed)
          apps/desktop/src/shared/tool-audit.ts,
          packages/tools/src/index.ts,
          packages/tools/src/run-shell.ts,
          packages/tools/src/run-shell.test.ts,
          packages/tools/src/web-fetch.test.ts
Untracked: apps/desktop/src/main/tool-audit/,
          apps/desktop/src/main/tools/handlers.ts,
          apps/desktop/src/main/theme/handlers.ts,              (this session)
          apps/desktop/src/main/workspace/handlers.ts,
          apps/desktop/src/main/chat/file-preview.{ts,test.ts},
          apps/desktop/src/renderer/components/{ThemeApplier.tsx,line-diff.{ts,test.ts},tool-result-preview.{tsx,test.ts}},  (this session — ThemeApplier)
          apps/desktop/src/renderer/views/{ApprovalsPanel,AuditLogPanel,ThemePanel,WorkspacePanel}.tsx,  (this session — ThemePanel)
          apps/desktop/src/renderer/views/audit-log-link.test.ts,
          apps/desktop/src/shared/{theme.ts,theme.test.ts,tool-audit,tools,workspace}.ts  (this session — theme + theme.test)
```

User has chosen to defer commits until the multi-session feature stack lands.
