# Handoff State

## Last Session Summary

- **Workspace picker shipped.** Settings → Workspace: Browse… opens a native folder picker; active path shown with Clear; Recent list with Open/Remove per row. MRU dedupe + 10-item cap. Active path validated as an existing directory before save; setting a path that no longer exists auto-removes it from history (cleanup). Pure helpers (`applySetActive`, `applyRemove`) in [shared/workspace.ts](apps/desktop/src/shared/workspace.ts) keep the storage wrappers in [storage/settings.ts](apps/desktop/src/main/storage/settings.ts) trivial.
- **5 new IPC channels** — `workspace:get`, `workspace:set-active`, `workspace:browse`, `workspace:remove`, `workspace:clear-active`. Handlers in [main/workspace/handlers.ts](apps/desktop/src/main/workspace/handlers.ts); preload bridge `window.opencodex.workspace.*`; registered in [main/index.ts](apps/desktop/src/main/index.ts#L153).
- **7 new tests** in [shared/workspace.test.ts](apps/desktop/src/shared/workspace.test.ts) covering MRU prepend, no-duplicate-on-re-set, history cap, removal, and active-clearing-on-remove. Full suite **400 passed + 7 skipped across 45 files** (+1 file, +7 tests from prior session's 393).

## Verify Before Continuing

- [ ] **Full CI green** — `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build`. Expect **400 passing + 7 skipped across 45 files**. Bundle sizes: main `67.34 kB` (+2.88), preload `2.98 kB` (+0.34), renderer JS `404.89 kB` (+6.62), renderer CSS `36.13 kB` (+2.03), provider-builder `1.72 kB` (unchanged).
- [ ] **Workspace picker actually works at runtime.** From `pnpm dev`: open Settings, scroll to the new "Workspace" section. Click **Browse…**, pick any folder. Expected: active path updates immediately, the folder appears at the top of Recent on next picker round-trip. Click **Browse…** again, pick a second folder. Expected: first folder moves to Recent, second becomes active. In Recent, click **Open** on the first — it should swap back to active. Click **Remove** — it disappears from Recent. Click **Clear** on the active — active goes to "(none — using launch directory)" without dropping anything from Recent. Restart the app; active + recent persist.
- [ ] **Workspace actually drives tool sandbox.** With a non-cwd workspace active, ask the agent to `read_file` something inside it (relative path) and confirm it resolves correctly. The consumers are [main/chat/handlers.ts:124](apps/desktop/src/main/chat/handlers.ts#L124) (`runStream` workspaceRoot) and [main/chat/approval-handlers.ts:59](apps/desktop/src/main/chat/approval-handlers.ts#L59) (`readFilePreview` workspaceRoot).

### Carry-over visual checks (still not done; not blocking)

- [ ] **`OPENCODEX_SHELL_PATH` runtime check** (prior session) — set the env var, `pnpm dev`, trigger a `run_shell` with `node -e "console.log(process.env.PATH)"`. Output should equal the override, not the inherited PATH.
- [ ] **Audit row → conversation jump** — click conversation title cell in Audit log, expect jump + scroll + flash.
- [ ] **Audit row expand toggle** — clicking the row (not the title) still expands/collapses.
- [ ] **Approval modal cleanup on cancel** — visually confirm Cancel mid-approval removes the modal.
- [ ] **Tool result previews** (read_file, grep, run_shell, web_fetch, glob, list_dir, write_file, edit_file).
- [ ] **Approval previews** (write_file/edit_file/run_shell/web_fetch header tier pill, diff stats, side-by-side, command box, method pill).
- [ ] **`window.opencodex.approvals.readFilePreview`** in devtools.
- [ ] **Retention UI** — change retention to 7 days, custom value passthrough, startup purge log.
- [ ] **POSIX shell process-tree kill + ripgrep tests** on macOS/Linux CI.

## Next Task

Pick one (two carry-overs remaining, plus the new option):

1. **Settings UI parent line** _([Todo.md:172](Todo.md#L172))_ — four subsections exist (workspace, providers, approvals, audit log); **three remaining**: MCP servers, plugins, theme, indexing. (MCP and plugins are gated by Phase 2.5/4; theme + indexing are independently doable.)
2. **Status bar** _([Todo.md:104](Todo.md#L104))_ — agent state, current tool, tokens used. Status bar slot doesn't exist yet; would live below the chat composer or as a top-bar extension.
3. **Workspace switch event** — currently `activeWorkspace` change doesn't broadcast; a live chat keeps the workspace it captured at `chat:start`. Probably fine (mid-stream switching is weird), but worth deciding explicitly. If you want a fix, emit a `workspace:changed` IPC event on `set-active`/`clear-active`/`browse` and refresh whatever the renderer needs.

## Context Notes

### Workspace picker invariants (now load-bearing)

- **Pure logic lives in [shared/workspace.ts](apps/desktop/src/shared/workspace.ts).** `applySetActive` and `applyRemove` take/return `WorkspaceState`; storage wrappers in `settings.ts` just call them around `updateSettings`. Tests target the pure helpers (no electron-store mocking). If you add fields to `WorkspaceState`, update the schema in [settings.ts](apps/desktop/src/main/storage/settings.ts) too.
- **`workspace:set-active` validates dir-exists.** If the path no longer exists, the handler calls `removeWorkspaceFromHistory(resolved)` instead — so clicking **Open** on a deleted recent silently cleans it up. This is intentional cleanup behavior; if you ever want "fail loudly", branch in [main/workspace/handlers.ts](apps/desktop/src/main/workspace/handlers.ts).
- **History cap = `WORKSPACE_HISTORY_LIMIT` (10).** Defined in shared so the renderer can display the right ceiling if needed.
- **Recent list filters out the active path.** Done in the renderer ([WorkspacePanel.tsx](apps/desktop/src/renderer/views/WorkspacePanel.tsx)) — `state.history` still contains the active. If you ever surface history elsewhere, the active is always at index 0 (MRU).
- **`activeWorkspace` was already wired upstream** — [main/chat/handlers.ts:124](apps/desktop/src/main/chat/handlers.ts#L124) and [main/chat/approval-handlers.ts:59](apps/desktop/src/main/chat/approval-handlers.ts#L59) both read `getSettings().activeWorkspace ?? process.cwd()`. No cascade needed; switching workspaces affects subsequent chat starts only.

### `OPENCODEX_SHELL_PATH` invariants (still load-bearing — from prior session)

- **Override applies AFTER the keep-list copy** in [scrubEnv](packages/tools/src/run-shell.ts#L203-L219). Order matters: the loop copies parent `PATH` (because `PATH` ∈ `DEFAULT_ENV_KEEP`), then the override line replaces it. If you reorder, the override will be clobbered.
- **Empty/whitespace-only is treated as unset** (`.trim()` then truthiness). Intentional: `OPENCODEX_SHELL_PATH=` shouldn't zero `PATH`.
- **Override var itself is NOT in `DEFAULT_ENV_KEEP`** — never reaches the child. Test guards this; don't add it.
- **No UI exposure yet.** Operator-config-only.

### Audit → chat jump invariants (still load-bearing)

- **URL contract: `/chat?conversationId=<id>&messageId=<id>`.** Both required to scroll-to-message.
- **ChatPane uses refs, not state, to dedupe scroll triggers.** `consumedScrollRef` (Set), `skipBottomScrollRef` (boolean one-shot). Don't replace with `useState` — `react-hooks/set-state-in-effect` will fire.
- **Scroll-to-target useLayoutEffect must come BEFORE bottom-scroll useLayoutEffect** in source order. See [ChatView.tsx:170-202](apps/desktop/src/renderer/views/ChatView.tsx#L170-L202).
- **URL params cleared with `setSearchParams({}, { replace: true })`** after consume.
- **MessageBubble `id="chat-message-{id}"`** is the load-bearing DOM hook.

### CSS structure

- **`.audit-row-head` is a `<div>`, not a `<button>`.** 3-col grid: toggle | link | caret.
- **`.chat-bubble-highlight`** uses `box-shadow` + `background` animation, 2s ease-out, runs once.
- **`.workspace-*` styles mirror the `.approvals-*` idiom** — same row background `#14171c`, border `#1f232a`, primary button `#1a2c4a`/`#2a4778`, danger hover `#f08a8a`.

### Retention invariants

- **`purgeToolCallsOlderThan` is strict less-than the cutoff.** Equal-timestamp rows survive.
- **Invalid retention is silent no-op.** `days < 1`, `NaN`, non-finite → `{ deletedCount: 0 }`.
- **`auditRetentionDays` schema is `.min(1).max(36500).nullable().default(null)`.** Don't drop `.max`.

### Cancellation invariants

- **`taskkill /F /T` kills detached descendants on Windows.** Don't change `run-shell.ts`'s `detached: !isWindows` without updating the test.
- **`waitForProcessDeath` polls every 50ms with a 5s budget.**
- **`process.kill(pid, 0)` is a liveness probe on Windows** (Node ≥14).
- **Web-fetch abort tests mock `fetch` by hand** so the mock honors `init.signal`.

### Other carry-overs

- **`packages/tools` exports `resolveWithinWorkspace` + `PathEscapesWorkspaceError`** from the package root.
- **Audit-log denial cases lose source info.** `policy-deny` / `prompt-deny-*` all collapse to `decision: 'denied'`.
- **`requestApproval` returns `Promise<ApprovalOutcome>`** (`{decision, source}`), not `Promise<ApprovalDecision>`.
- **`durationMs: null` for denials** distinguishes "never ran" from "ran instantly".
- **Tool-tier pill classes**: `.tool-tier-{read,write,execute,network}` in [styles.css](apps/desktop/src/renderer/styles.css).
- **`packages/*` tsconfig is `noEmit: true`** — switch to `tsup` before any `pnpm publish`.
- **`.github/workflows/ci.yml`** doesn't run `pnpm build`.
- **Folder path has a space + period** (`OPEN UI.UX`) — quote in shell.
- **Pre-public placeholders**: `@TODO-set-github-handle`, `security@TODO-set-domain`, `github.com/TODO-org/TODO-repo`.

### Untracked files at handoff (still uncommitted across ~10 sessions)

```
Modified: HANDOFF.md, Todo.md,
          apps/desktop/src/main/chat/approval-handlers.ts,
          apps/desktop/src/main/index.ts,                       (this session — registerWorkspaceHandlers)
          apps/desktop/src/main/storage/tool-audit.{ts,test.ts},
          apps/desktop/src/main/storage/settings.ts,            (this session — workspace storage helpers)
          apps/desktop/src/preload/index.ts,                    (this session — workspace bridge)
          apps/desktop/src/renderer/components/{ApprovalQueue,ToolCallCard}.tsx,
          apps/desktop/src/renderer/styles.css,                 (this session — .workspace-* styles)
          apps/desktop/src/renderer/views/{ChatView,SettingsView}.tsx,
          apps/desktop/src/shared/{approvals,ipc-types}.ts,     (this session — workspace IPC contracts)
          apps/desktop/src/shared/tool-audit.ts,
          packages/tools/src/index.ts,
          packages/tools/src/run-shell.ts,
          packages/tools/src/run-shell.test.ts,
          packages/tools/src/web-fetch.test.ts
Untracked: apps/desktop/src/main/tool-audit/,
          apps/desktop/src/main/tools/handlers.ts,
          apps/desktop/src/main/workspace/handlers.ts,          (this session)
          apps/desktop/src/main/chat/file-preview.{ts,test.ts},
          apps/desktop/src/renderer/components/line-diff.{ts,test.ts},
          apps/desktop/src/renderer/components/tool-result-preview.{tsx,test.ts},
          apps/desktop/src/renderer/views/{ApprovalsPanel,AuditLogPanel,WorkspacePanel}.tsx,
          apps/desktop/src/renderer/views/audit-log-link.test.ts,
          apps/desktop/src/shared/{tool-audit,tools,workspace}.ts,
          apps/desktop/src/shared/workspace.test.ts             (this session — 7 tests)
```

User has chosen to defer commits until the multi-session feature stack lands.
