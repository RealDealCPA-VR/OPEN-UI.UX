# Handoff State

## Last Session Summary

- **Workspace-mismatch banner shipped in chat composer.** Completes the workspace-change story for live chats (Next Task #1 from prior handoff). `chat:start` now returns `workspaceRoot` in [shared/chat.ts:14](apps/desktop/src/shared/chat.ts#L14); [runner.ts:81-103](apps/desktop/src/main/chat/runner.ts#L81-L103) captures the resolved root once and echoes it in the response; `chat-context` exposes `streamWorkspaceRoot: string | null`; `ChatPane` subscribes to `workspace:changed` locally and renders a warn-tinted banner just above the composer when active workspace differs from the stream's locked root. Banner clears on `done` / `error` / cancel.
- **Approach (c) of the three options** — chose UI affordance over main-side rewiring. No main-side internal bus, no chat-runner reactivity; the chat stays locked to its workspace at `chat:start` and the banner just surfaces the divergence to the user. Next chat re-reads `getSettings().activeWorkspace`, so no further cascade is needed.
- **CI green.** 409 passing + 7 skipped across 46 files. Bundle deltas: main `68.51 → 68.56 kB` (+0.05), preload `4.67 kB` unchanged, renderer JS `413.58 → 415.39 kB` (+1.81), renderer CSS `47.37 → 47.95 kB` (+0.58), provider-builder `1.72 kB` unchanged.

## Verify Before Continuing

- [ ] **Full CI green** — `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build`. Expect **409 passing + 7 skipped across 46 files**. Bundle sizes: main `68.56 kB`, preload `4.67 kB`, renderer JS `415.39 kB`, renderer CSS `47.95 kB`, provider-builder `1.72 kB`.
- [ ] **Banner appears mid-stream.** From `pnpm dev`: pick a workspace, start a chat with a slow-ish response, then in Settings → Workspace pick a different folder. Banner should appear above the composer reading "Workspace changed mid-chat. This response is still running against <old>. The next message will use <new>." (warn-tinted, monospace path pills.) When the stream finishes, banner disappears.
- [ ] **Banner stays hidden in non-streaming cases.** (a) Reading a historical conversation with no stream → no banner. (b) Streaming with workspace unchanged → no banner. (c) `activeWorkspace` is `null` (cleared) → no banner (we don't compare against null to avoid showing a banner when user sees "(none — using launch directory)").
- [ ] **Banner clears on cancel + error.** Start a stream, hit Stop → banner gone. Start a stream that errors → banner gone.

### Carry-over visual checks (still not done; not blocking)

- [ ] **Onboarding banner visibility logic.** From `pnpm dev`: with at least one provider key configured, Settings should NOT show the welcome banner. Clear all provider keys → banner appears at top. Click "Configure a provider" → smooth-scrolls to Providers section + focuses its `<h2>`. Add a key back → banner disappears.
- [ ] **Indexing stub readability in both themes.** Settings → Indexing should show the `Coming in Phase 3` pill + bulleted list + closing paragraph. Verify in light + dark.
- [ ] **Theme actually applies at runtime.** Light/Dark/System switching, OS-scheme flip live update, zero-flash boot.
- [ ] **Light theme readability** — scan every view for low-contrast tokens; tune in `:root[data-theme='light']` block.
- [ ] **Workspace picker runtime** — Browse picks folder, second Browse moves first to Recent, Open from Recent swaps, Remove deletes, Clear unsets without dropping Recent, restart persists.
- [ ] **Workspace drives tool sandbox.** Non-cwd workspace active → `read_file` a relative path inside it. Consumers: [main/chat/handlers.ts:124](apps/desktop/src/main/chat/handlers.ts#L124), [main/chat/approval-handlers.ts:59](apps/desktop/src/main/chat/approval-handlers.ts#L59).
- [ ] **`OPENCODEX_SHELL_PATH` runtime** — set env var, `pnpm dev`, `run_shell` with `node -e "console.log(process.env.PATH)"` → equals override.
- [ ] **Audit row → conversation jump** — click conversation title cell → jump + scroll + flash.
- [ ] **Audit row expand toggle** — clicking the row (not the title) still expands/collapses.
- [ ] **Approval modal cleanup on cancel** — Cancel mid-approval removes the modal.
- [ ] **Tool result previews** (read_file, grep, run_shell, web_fetch, glob, list_dir, write_file, edit_file).
- [ ] **Approval previews** (write_file/edit_file/run_shell/web_fetch header tier pill, diff stats, side-by-side, command box, method pill).
- [ ] **`window.opencodex.approvals.readFilePreview`** in devtools.
- [ ] **Retention UI** — change retention to 7 days, custom value passthrough, startup purge log.
- [ ] **POSIX shell process-tree kill + ripgrep tests** on macOS/Linux CI.

## Next Task

Pick one:

1. **Status bar** _([Todo.md:104](Todo.md#L104))_ — agent state, current tool, tokens used. New surface below composer or top-bar extension. Now naturally complemented by the workspace banner above the composer — the status bar would sit at the very bottom showing live agent state. Could use the same `workspace:changed` subscription pattern for the active-workspace label.
2. **Onboarding wizard** _([Todo.md:170](Todo.md#L170))_ — first-run flow: pick provider → enter key → pick workspace → first chat. Replaces the OnboardingBanner stopgap. Workspace step can prime the `workspace:set-active` IPC; the rest of the flow can compose existing handlers.
3. **Long-path handling in the workspace banner** — currently long folder paths wrap (no truncation). Lower priority polish — only worth doing if you hit it during dev. Would add CSS `max-width` + `text-overflow: ellipsis` on `.chat-workspace-banner-path` + tooltip on hover.

## Context Notes

### Workspace-mismatch banner invariants (load-bearing for what just shipped)

- **`chat:start` response is the contract.** The `workspaceRoot` field in [ChatStartResponse](apps/desktop/src/shared/chat.ts) is what the renderer compares against. Don't strip it in IPC handlers or runner shortcuts — the renderer's `setStreamWorkspaceRoot(result.workspaceRoot)` depends on it being present.
- **`runner.ts` computes `workspaceRoot` once** at [runner.ts:81](apps/desktop/src/main/chat/runner.ts#L81) (`opts.workspaceRoot ?? process.cwd()`) and reuses for both `runStream({workspaceRoot})` and the response. Single source of truth — don't recompute downstream.
- **Banner visibility predicate** at [ChatView.tsx](apps/desktop/src/renderer/views/ChatView.tsx) is intentionally conservative:
  ```ts
  chat.streaming &&
    streamWorkspaceRoot !== null &&
    activeWorkspace !== null &&
    activeWorkspace !== streamWorkspaceRoot;
  ```
  Both `null`-checks are deliberate. `activeWorkspace === null` means the user cleared the workspace (UI shows "none — using launch directory") — showing a banner there would be confusing. If you ever want to broaden this, also update the banner copy.
- **`streamWorkspaceRoot` is cleared in two places** in [chat-context.tsx](apps/desktop/src/renderer/state/chat-context.tsx): `finalizeStream` (done / error / cancel-from-server paths) and the catch arm of `send` (start failed before stream began). Don't forget either when adding new stream lifecycle paths.
- **`ChatPane` owns the workspace subscription locally**, not via a shared context. This is deliberate — only chat cares right now. If status bar (Next Task #1) also needs active workspace, lift to a `WorkspaceProvider` then; YAGNI for one consumer.
- **CSS uses `--warn-*` tokens** (`--warn-bg`, `--warn-border`, `--warn`) — already theme-aware in both `:root` blocks. The `.chat-workspace-banner-path` bg uses raw `rgba(0,0,0,0.18)` / `0.06` (dark / light) for the inline pill — tweak there if you adjust theme readability.

### `workspace:changed` invariants (still load-bearing)

- **`broadcastChange(state)` is the only emission point.** Lives in [main/workspace/handlers.ts](apps/desktop/src/main/workspace/handlers.ts). It's called inline at every mutation exit. If you add a new workspace mutation handler, route the returned state through it — don't emit by hand.
- **Spurious-emit policy:** canceled `browse` and invalid-pick paths do NOT emit (state genuinely unchanged). All other mutations emit unconditionally — even `set-active` to current active. This matches the theme handler's "emit on every set" policy. Subscribers should be idempotent.
- **Event payload is `{ state: WorkspaceState }`.** Includes both `active` and full `history`. Subscribers should `setState(payload.state)` rather than diffing.
- **Two renderer subscribers now:** `WorkspacePanel` (source + subscriber) and `ChatPane` (subscriber only, reads `state.active`). Don't worry about ordering — Electron delivers events to all webContents listeners in registration order.
- **No main-side listener exists.** The chat runner is still in-process and captures workspace at `chat:start`; later workspace changes do NOT cascade into in-flight chats. The banner is the answer to that — UI tells the user, not a reactive runtime.

### Settings subsection invariants (from prior session)

- **`OnboardingBanner` reads from `useSelectedModel()`, not a new IPC.** Renders `null` during load/error/when a configured provider exists. Will react for free if a future `providers:changed` event is wired.
- **Scroll target: `id="settings-providers"` on the `<section>`, `tabIndex={-1}` on the `<h2>`.** Constant `PROVIDERS_SECTION_ID` exported from [OnboardingBanner.tsx](apps/desktop/src/renderer/components/OnboardingBanner.tsx) — if you rename, change both.
- **`IndexingPanel` is intentionally interactive-free.** When Phase 3 starts, replace wholesale rather than slowly enabling controls.
- **`.pill-soon` is the shared "not yet shipped" pill class.** Reuse — don't invent a new one.
- **Settings order: Onboarding banner → Theme → Workspace → Providers → Approvals → Audit log → Indexing.**

### Theme system invariants (still load-bearing)

- **Boot path is `additionalArguments` → preload → renderer**, not async IPC. Preload calls `parseInitialThemeArg(process.argv)` and `document.documentElement.setAttribute('data-theme', effective)` at module top-level. Zero-flash mechanism — don't move into async.
- **`ThemeApplier` is mounted INSIDE the providers tree** in [App.tsx](apps/desktop/src/renderer/App.tsx) but renders `null`. The `current` ref pattern in `useEffect` lets the media listener correctly skip non-system preferences. Don't replace with `useState`.
- **`THEME_OPTIONS` is the single source for the radio list.** Adding a 4th preference means updating `ThemePreference` union, `isThemePreference` guard, `THEME_PREFERENCES`, `THEME_OPTIONS`, both Zod enums (settings + theme handlers), and `resolveEffectiveTheme`.

### CSS variable conventions (still load-bearing)

- **`:root` defines all dark-theme tokens; `:root[data-theme='light']` overrides every one.** Never put hex literals in rule bodies — always reference a `var(--…)` token. Define new tokens in BOTH `:root` blocks first.
- **Exception: inline rgba alpha overlays** like `.chat-workspace-banner-path` use raw `rgba(0,0,0,0.18)` / `0.06` rather than tokens — fine for low-alpha overlays where the color is "transparent black" not a semantic token.
- **Two ambiguity-resolved tokens.** `--bg-btn` vs `--border`; `--tok-comment` vs `--text-muted`.

### Workspace picker invariants (still load-bearing)

- **Pure logic in [shared/workspace.ts](apps/desktop/src/shared/workspace.ts).** `applySetActive`/`applyRemove` take/return `WorkspaceState`; storage wrappers call them around `updateSettings`. Tests target the pure helpers.
- **`workspace:set-active` validates dir-exists.** Dead paths silently auto-cleanup via `removeWorkspaceFromHistory`. Intentional. The event still fires in this case (state mutated).
- **History cap = `WORKSPACE_HISTORY_LIMIT` (10).** Renderer filters active out of `state.history` — active is always at index 0 (MRU).
- **`activeWorkspace` wired upstream** at [main/chat/handlers.ts:124](apps/desktop/src/main/chat/handlers.ts#L124) and [main/chat/approval-handlers.ts:59](apps/desktop/src/main/chat/approval-handlers.ts#L59). Captured at chat start — chat banner surfaces divergence, no live re-read.

### `OPENCODEX_SHELL_PATH` invariants (still load-bearing)

- **Override applies AFTER the keep-list copy** in [scrubEnv](packages/tools/src/run-shell.ts#L203-L219). Order matters.
- **Empty/whitespace-only treated as unset** (`.trim()` then truthiness).
- **Override var itself NOT in `DEFAULT_ENV_KEEP`** — never reaches the child.
- **No UI exposure yet.** Operator-config-only.

### Audit → chat jump invariants

- **URL contract: `/chat?conversationId=<id>&messageId=<id>`.** Both required.
- **ChatPane uses refs for dedupe.** `consumedScrollRef` (Set), `skipBottomScrollRef` (boolean one-shot).
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

### Untracked files at handoff (still uncommitted across ~14 sessions)

```
Modified: HANDOFF.md, Todo.md,
          apps/desktop/src/main/chat/approval-handlers.ts,
          apps/desktop/src/main/chat/runner.ts,                 (this session — +workspaceRoot in response)
          apps/desktop/src/main/chat/runner.test.ts,            (this session — asserts result.workspaceRoot)
          apps/desktop/src/main/index.ts,
          apps/desktop/src/main/storage/tool-audit.{ts,test.ts},
          apps/desktop/src/main/storage/settings.ts,
          apps/desktop/src/main/workspace/handlers.ts,
          apps/desktop/src/preload/index.ts,
          apps/desktop/src/renderer/App.tsx,
          apps/desktop/src/renderer/components/{ApprovalQueue,ToolCallCard}.tsx,
          apps/desktop/src/renderer/state/chat-context.tsx,     (this session — +streamWorkspaceRoot)
          apps/desktop/src/renderer/styles.css,                 (this session — +.chat-workspace-banner styles)
          apps/desktop/src/renderer/views/{ChatView,SettingsView,WorkspacePanel}.tsx,  (this session — ChatView banner)
          apps/desktop/src/shared/{approvals,ipc-types}.ts,
          apps/desktop/src/shared/chat.ts,                      (this session — +workspaceRoot on ChatStartResponse)
          apps/desktop/src/shared/tool-audit.ts,
          apps/desktop/src/shared/workspace.ts,
          packages/tools/src/index.ts,
          packages/tools/src/run-shell.ts,
          packages/tools/src/run-shell.test.ts,
          packages/tools/src/web-fetch.test.ts
Untracked: apps/desktop/src/main/tool-audit/,
          apps/desktop/src/main/tools/handlers.ts,
          apps/desktop/src/main/theme/handlers.ts,
          apps/desktop/src/main/workspace/handlers.ts,
          apps/desktop/src/main/chat/file-preview.{ts,test.ts},
          apps/desktop/src/renderer/components/{ThemeApplier.tsx,OnboardingBanner.tsx,line-diff.{ts,test.ts},tool-result-preview.{tsx,test.ts}},
          apps/desktop/src/renderer/views/{ApprovalsPanel,AuditLogPanel,IndexingPanel,ThemePanel,WorkspacePanel}.tsx,
          apps/desktop/src/renderer/views/audit-log-link.test.ts,
          apps/desktop/src/shared/{theme.ts,theme.test.ts,tool-audit,tools,workspace}.ts
```

User has chosen to defer commits until the multi-session feature stack lands.
