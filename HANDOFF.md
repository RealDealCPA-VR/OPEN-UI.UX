# Handoff State

## Last Session Summary

- **Tool-call audit log shipped — completes [Todo.md:96](Todo.md#L96).** Every `executeToolCall` in [`runner.ts`](apps/desktop/src/main/chat/runner.ts) now writes one row to the `tool_calls` table, attached to `args.assistantMessageId`. New helper [`recordToolCall`](apps/desktop/src/main/storage/tool-audit.ts) handles the insert; [`listToolCallsForMessage`](apps/desktop/src/main/storage/tool-audit.ts) reads rows back for audit queries. Decision column uses the 5-value enum from last session's plan: `auto` / `prompt-allowed` / `prompt-allowed-session` / `prompt-allowed-always` / `denied`. Latency captured around the `registry.execute()` call; denials get `durationMs: null`. Audit-write failures are logged but do not break the stream.
- **Migration 4** in [`db.ts`](apps/desktop/src/main/storage/db.ts) adds `duration_ms INTEGER` + `is_error INTEGER NOT NULL DEFAULT 0` to `tool_calls`, plus `idx_tool_calls_message` and `idx_tool_calls_tool_name` indexes for future audit queries.
- **`ApprovalManager.requestApproval` return type widened** from `Promise<ApprovalDecision>` to `Promise<ApprovalOutcome>` (`{decision, source}`). `source` ∈ `'policy' | 'prompt-once' | 'prompt-session' | 'prompt-always'`. Session-cache hits preserve `source: 'prompt-session'` — re-uses after Allow-for-Session still log under the user's original intent rather than collapsing to `auto`. Only caller (runner) updated; [`approvals.test.ts`](apps/desktop/src/main/chat/approvals.test.ts) updated with new `toEqual` shape + a new `prompt-always` test.
- **New tests.** [`tool-audit.test.ts`](apps/desktop/src/main/storage/tool-audit.test.ts) (4 tests: round-trip, error+denial+null-duration, insertion order, `ON DELETE CASCADE` from `conversations`). Three new tests in [`runner.test.ts`](apps/desktop/src/main/chat/runner.test.ts) cover read-tier `auto` audit row, write-tier `prompt-allowed-session` (queueMicrotask-respond pattern), and the "no approval manager configured" denial path.

## Verify Before Continuing

- [ ] **Full CI green** — `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build`. Expect **333 passing + 7 skipped tests across 40 files** (was 325/7/39; added 4 tool-audit tests + 3 runner audit tests + 1 approvals `prompt-always` test = 8 new tests, 1 new file). Bundle sizes: main `56.52 kB` (was 53.45, **+3.07 kB** for `tool-audit.ts` + audit wiring in runner), preload `2.18 kB` (unchanged), renderer JS `333.46 kB` (unchanged — audit is main-process only), renderer CSS `18.21 kB` (unchanged), provider-builder chunk `1.70 kB` (unchanged).
- [ ] **Visual check audit rows actually land in real SQLite** — harness uses `:memory:`. Run `pnpm dev`, trigger a chat with at least one tool call, quit, then open `%APPDATA%/opencodex/opencodex.db` (or sqlite3 it) and `SELECT id, tool_name, decision, is_error, duration_ms FROM tool_calls ORDER BY created_at DESC LIMIT 5;` — confirm rows match what just ran. Trigger a write tool, deny it, confirm `decision='denied'` and `is_error=1` with `duration_ms` NULL. Important: pre-existing dev DBs have schema_migrations version=3; migration 4 should apply on next open and `ALTER TABLE` won't fail because `tool_calls` is currently empty.
- [ ] **Carry-over from prior session — Re-run button visual check** — still not visually verified. Run `pnpm dev`, trigger any tool call, confirm: (a) **Re-run** appears in card head; (b) disabled while pill says `Running`; (c) clicking fills composer with `Re-run this tool call: <name>({...})` and focuses textarea with caret at end; (d) head toggle still expands/collapses body when clicking chevron/name (not Re-run). Confirm Re-run still works for errored calls.
- [ ] **Carry-over — tool cards & modal UI visual check** — still not visually verified. Confirm `ToolCallCard` expand/collapse, status pill flips, Copy works, modal Allow-for-session suppresses subsequent prompts for that tool, Allow-always writes `toolOverrides[<tool>] = "auto"` into `%APPDATA%/opencodex/settings.json`.
- [ ] **Carry-over — run-shell process-tree kill on POSIX** — [`run-shell.test.ts`](packages/tools/src/run-shell.test.ts) "times out a hanging command" still only tested on Windows; needs macOS/Linux CI run.
- [ ] **Carry-over — ripgrep tests** — 7 tests in [`ripgrep.test.ts`](packages/tools/src/ripgrep.test.ts) skipped locally because `rg` isn't installed on the dev box; verify they run + pass on a CI machine with `rg`.

## Next Task

Pick one (default suggestion: **Settings UI for approval policies**, the next-largest unchecked Phase 2 line that has clear UI scope):

1. **Settings UI for approval policies** _([Todo.md:171](Todo.md#L171))_ — policies only editable via IPC. Add a panel to [`SettingsView.tsx`](apps/desktop/src/renderer/views/SettingsView.tsx) showing tier defaults + per-tool overrides with dropdowns. IPC channels `approvals:get-policies` / `approvals:set-policy` are already wired and listed in [`shared/ipc-types.ts`](apps/desktop/src/shared/ipc-types.ts).
2. **Per-tool approval previews** _(refinement of [`ApprovalQueue.tsx`](apps/desktop/src/renderer/components/ApprovalQueue.tsx))_ — currently shows raw JSON args. For `write_file` show a diff preview, for `edit_file` show old/new strings, for `run_shell` show command + cwd prominently, for `web_fetch` show URL + method + hostname. Branch on `permissionTier` and `toolName`.
3. **Per-tool body previews in ToolCallCard** _(refinement of cards themselves)_ — same idea as #2 but for the result panel: render `read_file` output as syntax-highlighted code, `grep` matches as a list, `run_shell` stdout/stderr in a terminal-styled block, `web_fetch` as headers table + body. Currently every result is generic JSON-stringified through [`formatToolOutput`](apps/desktop/src/renderer/components/tool-block-grouping.ts).
4. **Real cancellation kills in-flight shell processes** _([Todo.md:91](Todo.md#L91))_ — runner's `chat:cancel` aborts `ctx.signal`; `run_shell` listens via `addEventListener('abort', ...)` and calls `tryKill(child)`. Verify end-to-end (test it!) and also that `web_fetch` + approval-modal-wait both cancel cleanly.
5. **Explicit positive PATH allowlist** for `run_shell` _([Todo.md:95](Todo.md#L95))_ — current sandbox passes through parent `PATH`. Add `OPENCODEX_SHELL_PATH` env var; if set, override `PATH` in the scrubbed env.
6. **Audit-log retention / viewing UI** _(natural follow-up to what shipped this session)_ — `tool_calls` rows accumulate forever. Decide whether to add a TTL/retention policy and/or a Settings panel that surfaces the audit log (filter by tool, decision, error status, time range). Could pair nicely with #1.
7. **Richer Re-run** _(refinement of earlier session)_ — instead of prefilling the composer, call the tool registry directly with the same args through the approval system and emit synthetic `tool_call` / `tool_result` events. Open question: where does the synthetic call attach in message history.

## Context Notes

### Audit-log data flow

- **Insertion point.** All five exit branches of `executeToolCall` in [`runner.ts`](apps/desktop/src/main/chat/runner.ts) call `auditToolCall()` (the local wrapper) before returning. Branches: (a) registry missing → `denied`, (b) tool not registered → `denied`, (c) no approval manager for non-read tool → `denied`, (d) approval thrown/denied → `denied`, (e) execute success / execute throws → mapped from `outcome.source` via `outcomeToAuditDecision`. Latency is only captured in branch (e); the other branches log `durationMs: null`.
- **`auditToolCall` is wrapped in try/catch** — audit-write failures log via `pino` but don't break the stream. If you ever want audit to be hard-required, remove the catch (but be careful: `recordToolCall` uses `getDb()` which throws if the DB isn't open, which would crash the runner).
- **Output column** stores the **stringified JSON of the tool's output for success cases and the error message string for failure cases**. `safeStringify` falls back to `JSON.stringify(String(value))` if the value can't be cycled (shouldn't happen for tool outputs, but defensive).
- **`is_error` column** is `0` / `1` INTEGER in SQLite; `rowToAudit` converts to boolean. Truthy `output` doesn't imply success — always check `isError`.

### Decision-string mapping (the one source of truth)

In [`runner.ts`](apps/desktop/src/main/chat/runner.ts) `outcomeToAuditDecision()`:

| `outcome.decision` | `outcome.source`   | Audit `decision`           |
| ------------------ | ------------------ | -------------------------- |
| `'allow'`          | `'policy'`         | `'auto'`                   |
| `'allow'`          | `'prompt-once'`    | `'prompt-allowed'`         |
| `'allow'`          | `'prompt-session'` | `'prompt-allowed-session'` |
| `'allow'`          | `'prompt-always'`  | `'prompt-allowed-always'`  |
| `'deny'`           | _any_              | `'denied'`                 |

**Caveat:** denial cases lose source info (policy-deny, prompt-deny-once, prompt-deny-session, prompt-deny-always all collapse to `denied`). If you ever want to distinguish "policy denied" from "user denied this once", extend `ToolCallAuditDecision` and `outcomeToAuditDecision`; the source info is still on the `ApprovalOutcome` returned by `requestApproval`.

### ApprovalManager API breakage

- **`requestApproval` return type changed** from `Promise<ApprovalDecision>` to `Promise<ApprovalOutcome>` (where `ApprovalOutcome = {decision: 'allow' | 'deny'; source: ApprovalSource}`). Only caller in the repo today is [`runner.ts`](apps/desktop/src/main/chat/runner.ts) `executeToolCall`. If you add a new caller, you must destructure `.decision` — don't compare the outcome to the string `'allow'` directly.
- **Session-cache hits preserve `source: 'prompt-session'`**. The session map (`sessionOverrides`) still only stores the `ApprovalDecision`; the source is hardcoded on read because the only way an entry gets into the cache is `respond({scope: 'session'})`. If you ever add another path that writes to the cache, revisit `requestApproval` line 52.
- **`respond()` resolves with `{decision, source}` via `scopeToSource()`** — `once`→`prompt-once`, `session`→`prompt-session`, `always`→`prompt-always`. Adding a new `ApprovalScope` requires updating this switch.

### Why a column for `is_error` instead of inferring from `output_json`?

Output strings can legitimately contain words like "error" without being errors (e.g. `read_file` returns "error_log.ts"). Inferring would be brittle. The dedicated INTEGER column is one byte and lets us do `SELECT * FROM tool_calls WHERE is_error = 1` for audit queries.

### Why `durationMs: null` for denials rather than 0?

A denial isn't a 0ms execution — it's a non-execution. NULL distinguishes "we never ran the tool" from "we ran it and it returned instantly". The is_error column tells you it failed; NULL duration tells you it never ran.

### Carry-overs still relevant (from prior sessions)

- **`packages/*` tsconfig is `noEmit: true`** — before any `pnpm publish`, swap to `tsup` per package.
- **`.github/workflows/ci.yml`** still doesn't run `pnpm build`.
- **Block ordering is canonical.** Persisted: runner's `allBlocks` writes `[text1, tool_use1, tool_result1, text2, tool_use2, tool_result2, ..., final_text]` to `content_blocks_json`. Live: chat-context reducer mirrors this. Audit rows are written in the same order as `tool_use` blocks but in a separate table — they are not duplicated in `content_blocks_json`.
- **Re-run head is sibling buttons, not nested.** From last session: `<div class="tool-card-head">` contains `<button class="tool-card-head-toggle">`, the pill `<span>`, and `<button class="tool-card-rerun">`. New head controls must stay siblings, not nest.
- **Pending state is fuzzy.** `result === null` ⇒ pill says `Running`. Covers both "approval modal open" and "tool executing".
- **Pre-existing dev DB version is 3** until first open after this change; migration 4 will apply automatically.
- **`zodToJSONSchema` supported subset**: see prior handoff. `z.union()` / `z.date()` still require extending the converter.
- **`resolveWithinWorkspace`** ([`path-guard.ts`](packages/tools/src/path-guard.ts)) is the single path-escape chokepoint.
- **Folder path has a space + period** (`OPEN UI.UX`) — quote in shell.
- **OpenAI Responses API** still deferred — Chat Completions is enough.
- **React lint canon**: `@typescript-eslint/consistent-type-imports` is strict — use `import { type Foo, bar }` when a name is both a type and a value (e.g., `ApprovalManager` is both a class and a type; `ApprovalOutcome` is type-only).
- **Pre-public placeholders**: `@TODO-set-github-handle` (CODEOWNERS), `security@TODO-set-domain` (SECURITY.md), `github.com/TODO-org/TODO-repo` (issue template config).
