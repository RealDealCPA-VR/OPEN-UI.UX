# Handoff State

## Last Session Summary

- **Phase 15.20 (debuggability infrastructure + final cleanup) shipped in full** via a 3-lane parallel fan-out: agent debugging guide + diagnose script (the new primary deliverable), final code items, Todo.md round-2 sweep.
  - **Lane A (Debuggability infrastructure — the new artifact):**
    - **`docs/agent-debugging-guide.md`** (NEW, 285 lines, 8 top-level sections). Written for AI agents (and humans) who land in this repo with no prior context and need to diagnose "why isn't X working?" Sections: When something doesn't work (5-step decision flow), Subsystem map (21 subsystems with entry-point file:line, IPC channels, settings, related tests), Failure-mode catalog (19 symptom→cause→file:line rows), Key paths, Structured logging (existing correlation IDs: `streamId` at runner.ts:177, `conversationId`, `runId`, `taskId`, plus a documented `withTraceContext` AsyncLocalStorage follow-up recommendation), Common gotchas (better-sqlite3 ABI dialog, path with space+period, Node v20 pin, vi.useFakeTimers scoping rule, keydown-listeners-now-scoped-to-modal-refs rule, `getBridge()` mandatory pattern, plugin sandbox NOT a true sandbox, anti-sycophancy clause on by default), Running diagnostics, Pointers. All file:line citations verified against the live tree.
    - **`apps/desktop/scripts/diagnose.mjs`** (NEW, 711 lines, 15 probes). Pure Node script (no Electron import) you run with `pnpm diagnose` from repo root. Probes: node+pnpm versions, better-sqlite3 ABI match, sqlite DB integrity + schema_version + row counts, settings store presence, keychain (best-effort keytar), workspace path readability, MCP config + per-stdio-server binary probe (5s timeout), provider config presence, audit log + signing key, WORM mirror path, free disk space, network policy + Local Only state, runner CLI probes (claude/opencode/aider via `--version`, 5s timeout each), provider HTTP `HEAD /v1/models` for any provider with a stored key. Output: JSON to stdout, traffic-light `✓ / ⚠ / ✗` text summary to stderr. Exit codes 0/1/2 = ok/warn/fail. Redaction: keys printed as `(len=N, …xyz)` — never echo values. `--help` flag. Wired as `"diagnose": "node apps/desktop/scripts/diagnose.mjs"` in root `package.json` scripts. Smoke test against fresh user-data dir: **12 ok, 3 warn, 0 fail in 2.5s** (warns are first-run state: no activeWorkspace, no keys, pnpm not on PATH in headless shell).
    - **`withTraceContext` recommendation** (documentation-only, not shipped) lives in the structured-logging section of the guide — AsyncLocalStorage-backed helper proposed for the 4 entry points (`startChatStream`, `runSubagentInWorker`, `runSubagentInline`, `fireScheduledTask`) so correlation IDs propagate without thread-through-every-call.

  - **Lane B (close remaining real items):** 8 files modified, all targeted typecheck/test green.
    1. **`assertProviderHonorsAbort` test helper (Todo.md L1198)** — SHIPPED. New `packages/core/src/test-helpers/assert-provider-honors-abort.ts` + barrel + `./test-helpers` subpath in `packages/core/package.json` exports map (mirrors the `./process/tree-kill` shape). Worked example test in `packages/provider-openai/src/assert-provider-honors-abort.test.ts` mocks fetch (no real HTTP). 5-line pattern doc added at top of new `packages/plugin-sdk/README.md`. provider-openai suite 50/50 green.
    2. **`PluginSearchPanel` registry-path security smell (L1267)** — NOT A REAL ISSUE. The panel already calls `window.opencodex.plugins.installFromRegistry(...)` (the `plugins:install-from-registry` IPC at `apps/desktop/src/shared/ipc-types.ts:659`). No filesystem-path coercion in current source. Phase 15.19 (or earlier) landed the fix; the bullet was a stale finding.
    3. **`SettingsRail` Cmd+F hijack (L1273)** — SHIPPED. Was genuinely `window`-level. Scoped to `.settings-view` root via `navRef.current?.closest('.settings-view')` + `addEventListener('keydown', ...)` with cleanup. Matches the ApprovalQueue/MergeReviewModal pattern from 15.9.
    4. **`main.tsx` vs `index.tsx` doc references (L1290)** — NOT A REAL ISSUE. Repo-wide grep (excluding node_modules) found 4 hits: `Todo.md`, `HANDOFF.md`, and two `.mjs` workflow scripts. No stale references in `docs/`, `website/`, `MANUAL.md`, `README.md`, or `CLAUDE.md`. `Todo.md` + `HANDOFF.md` self-references are commentary, not consumed paths.
    5. **`runner-aider` streaming flag (L1431)** — FLAG FLIPPED to `streaming: true`. `run()` pushes each stdout line into `pendingEvents` as it arrives and the outer generator yields them mid-flight — multiple `text_delta` events fire over real time, which is the contract definition of streaming. Added 3-line code comment + updated `website/pages/guides/runners.mdx` comparison table from "no (spinner only)" → "yes (line-by-line)". `packages/runner-aider/README.md` still claims `streaming: false` for UX-spinner reasons (out of Lane B's scope) — see Follow-ups below.
    6. **`AgentTreeView` cleanup race (L1281 second half)** — LANE 3'S CLAIM CONFIRMED. No `setInterval`/`setTimeout` in the file. Async work in `loadPreview` correctly guarded by `mountedRef` (set false in cleanup, checked after each await). File untouched.

  - **Lane C (Todo.md round-2 sweep):** 20 bullets flipped in the 15.9 area that Lane 3 (Phase 15.19) shipped but the prior cautious sweep missed. Per-bullet verification done via grep + read. Two not-a-real-issue findings confirmed via source inspection and flipped with inline `_(not a real issue — ...)_` suffix notes:
    - **L1276 (OllamaStep useCallback deps):** `runProbe` is `useCallback(..., [])` at line 104 with `selectedModelIdRef` at line 71. Lane 3 was correct — already-correct-in-main.
    - **L1288 (AgentRunRow nested-button):** Toggle `<button>` closes at line 94. Review/Resume buttons (lines 161, 170) live in sibling `audit-row-body` div (line 100). Not nested. Lane 3 was correct.
    - `window.opencodex` direct-access sites in Lane 3's 20-file scope: **0**. The two false-positive hits the agent saw were a type-cast inside `getBridge()` itself (`BudgetSpendIndicator.tsx:21`) and a JSDoc comment (`JobsPane.tsx:13`).
    - Total open bullets in Phase 15.9 after this sweep: **2** (L1281's AgentTreeView half is now also closed by Lane B; L1267 closed as not-an-issue; the truly remaining UX-deferred bullet in this area is none — every actionable item shipped).

  - **Orchestrator wrap-up:** Build + typecheck + test all green. No follow-up patches needed this round — Lane B's helper + Lane C's sweep + Lane A's docs don't intersect with test fixtures.

- **Build + typecheck + test:**
  - `pnpm typecheck` — clean across all 28 workspaces.
  - `pnpm build` — green at **21.81s** (Phase 15.19 close was 23.25s; -1.4s — within noise).
  - `pnpm test` — **1877 / 1885 pass, 8 skipped, 0 failed** (100% of runnable tests, +1 from 15.19 thanks to the new assertProviderHonorsAbort worked-example test).
  - `pnpm diagnose --help` — exits 0, prints usage.
  - `pnpm diagnose` — exits 1 (documented "warn" code; 12 ok, 3 warn, 0 fail on a fresh user-data dir).

## Verify Before Continuing

- [ ] **`pnpm diagnose` runs clean on your machine.** From repo root: `pnpm diagnose`. Expect a JSON blob to stdout + a traffic-light summary to stderr. Exit code 0 = all green, 1 = at least one warn, 2 = at least one hard fail. Warns are expected on fresh user-data dirs (no active workspace, no keys yet) — those are NOT a regression.

- [ ] **`docs/agent-debugging-guide.md` is the first stop for the next agent.** When a future session asks "why isn't X working?", point at this guide before grepping the codebase. The Failure-mode catalog and Subsystem map are designed to short-circuit the discovery phase.

- [ ] **`assertProviderHonorsAbort` test helper exists.** `grep -rn assertProviderHonorsAbort packages/` should show the helper at `packages/core/src/test-helpers/`, the worked-example test at `packages/provider-openai/src/`, and the pattern doc in `packages/plugin-sdk/README.md`. New provider authors should add `assertProviderHonorsAbort(() => new MyProvider(...))` to their test suite.

- [ ] **`runner-aider` is now declared `streaming: true`.** Read `packages/runner-aider/src/runner.ts:104` to confirm. The website comparison table at `website/pages/guides/runners.mdx` reflects the flip. The runner's local README still claims non-streaming for spinner-UX reasons — that's a follow-up.

- [ ] **`SettingsRail` Cmd+F is scoped to the Settings view only.** Open `/settings`. Press Cmd/Ctrl+F — focus jumps to the section search box. Open `/chat`. Press Cmd/Ctrl+F — Chrome's native find-in-page opens (or whatever the renderer's default Cmd+F behavior is), no rail interception.

- [ ] **No regression vs Phase 15.19 baseline.** `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` all exit 0. Test count went from 1876 → 1877 passing (the one new test is the worked-example for the abort helper).

## Next Task

**Phase 15.20 is closed. The actionable backlog is now empty.** Remaining items are user-required or explicit follow-up polish.

### Truly user-required (BLOCKED, ~6 items)

- `Todo.md:116` — OAuth handling for MCP servers (needs external OAuth setup).
- `Todo.md:173` — macOS code signing + notarization (needs user-owned Apple Developer cert + Apple ID).
- `Todo.md:174` — Windows code signing Authenticode (needs user-owned EV cert + hardware token).
- `Todo.md:184` — Public v0.1 release announcement (user task).
- `Todo.md:406` — `packages/runner-mcp-bridge` (explicit deferred stretch).
- `Todo.md:487–492` — Backlog needing user architecture decisions: cloud tasks, voice mode UX, mobile companion, team workspaces, visual workflow builder, JetBrains/VSCode integration.

### Pre-tag maintainer work (Phase 12 carry-over)

- Fill `PLACEHOLDERS.md` — 24 `@TODO-` / `TODO-org` / `TODO-repo` / `TODO-set-domain` occurrences. `pnpm check-placeholders` blocks `release-readiness.yml` until resolved.

### Architecture follow-up (not shipped, design discussion needed)

- `Todo.md:1151–1155` parent bullet still `- [ ]` because the v0.1 architecture sub-item (move plugin execution into `electron.utilityProcess.fork()` with `MessagePortMain` RPC + Node 20 `--permission` flags scoped to manifest-declared workspace + hosts; on macOS `sandbox-exec`, on Windows Job Object + `CreateRestrictedToken`, on Linux seccomp-bpf) is explicitly deferred per the closeout. The three Phase 15 deliverables (honest docs, hard-fail unsigned, symmetric `registerTool` permission gate) shipped and closed the "user is lied to" + "unsigned silent install" + "asymmetric tier gate" risks.

### Small polish discovered this session

- **`packages/runner-aider/README.md`** still claims `streaming: false` for UX-spinner reasons. The runner now reports `streaming: true`. Reconcile: either the README rationale is stale (update it), or the spinner-UX argument means the streaming flag is misleading (and we should add a `displayMode: 'spinner' | 'stream'` capability to `SubagentRunner`). The contract change is the bigger lift.
- **`withTraceContext` AsyncLocalStorage helper** — proposed in the debugging guide's structured-logging section. Would let any logger call inside the agent loop / chat runtime / scheduler automatically include `streamId`, `conversationId`, `runId`, `taskId` without thread-through-every-call. Easy follow-up — 4 entry points to wire.
- **Diagnose script extensions** — could add a `--bundle` flag that zips the JSON + redacted log tails into a single file for user-shareable bug reports. Today the JSON-blob output is good enough; bundle helper is a one-evening UX win.

**Repo remains shippable as v0.1 + Phases 9 / 10 / 11 / 12 / 13 / 14 / 15 / 15.19 / 15.20 once macOS+Windows certs land, `PLACEHOLDERS.md` is filled, and a public release is published.**

## Context Notes

### The pattern this session used (3-lane parallel fan-out + creative deliverable)

Per the user's `/goal` request ("deeply analyze this code base and come up with an easy way for future agents to determine how and why something might not be working as intended. Also check any open items on the todo.md and complete those tasks. Fan out as many agents as possible"), three lanes ran in parallel:

- **Lane A (creative artifact, 1 agent)** — debugging guide + diagnose script. The creative core of the goal. Took the longest (~16 min wall) because it required reading the codebase across all 21 subsystems before writing anything.
- **Lane B (final code items, 1 agent)** — 6 specific Todo.md bullets with clear file targets.
- **Lane C (Todo.md sweep round 2, 1 agent)** — bookkeeping; verifies + flips bullets that the prior sweep was too cautious about.

All three reported in <500 words each. Zero cross-lane conflicts (A touched `docs/` + `scripts/` + root `package.json`; B touched `packages/core` + a few renderer/runner files; C touched only `Todo.md`).

### How a future agent should USE the debugging guide

When the next session asks "X isn't working" / "diagnose Y":

1. Run `pnpm diagnose` first — captures the static health of every subsystem in 2-3 seconds.
2. Look at the Failure-mode catalog in `docs/agent-debugging-guide.md` for symptoms matching the user's report.
3. The catalog points at file:line. Read that file:line first, NOT a top-down architecture survey.
4. The Subsystem map names the IPC channel + setting + related test for every subsystem — confirms what to grep, log, or re-run.
5. If the symptom isn't in the catalog, add it. Keep the catalog current — that's how the doc stays useful.

### Why the diagnose script exits 1 on warns

Documented behavior. Exit 0 = all green, 1 = at least one warn (e.g., no API keys configured yet, no active workspace yet), 2 = at least one hard fail (e.g., DB integrity check failed, sqlite ABI mismatch). CI should NOT gate on `pnpm diagnose` as a green-only check — it's informational. If you want a gated check, use `pnpm diagnose 2>&1 | grep -c "✗"` and assert 0.

### Recurring vitest lessons (verified again this session)

- For RTL + jsdom test files use `import { type Mock } from 'vitest'` + bare `Mock` annotations.
- `vi.useFakeTimers` MUST scope to `['setTimeout', 'clearTimeout']` if RTL is in play. Including `Date` deadlocks `waitFor` against wall-clock. Replace `waitFor` with sync assertions inside `act(() => vi.advanceTimersByTime(N))`.
- Keydown listeners are NOW scoped to modal/section refs (15.9 + 15.20). Tests must dispatch on the dialog/root element, not `document`.
- `window.opencodex` direct reads are FORBIDDEN. Use `getBridge()` from `apps/desktop/src/renderer/bridge.ts`.

### Pre-existing carry-overs

- Node v20 pinned.
- Path has space + period (`OPEN UI.UX`) — quote in shell.
- `apps/desktop/src/test/setup.ts` Proxy-bridge test setup (15.1#5) is loaded via vitest `setupFiles`. Extend its mockBridge in-place rather than re-defining `window.opencodex` from scratch.
- `packages/core` exports map now has subpaths for `./process/tree-kill` (Phase 15.1) and `./test-helpers` (Phase 15.20). Add new subpaths as siblings — don't restructure the main `.` entry.

### Files added/touched this session (Phase 15.20)

**New files (5):**

- `docs/agent-debugging-guide.md` — the debugging guide
- `apps/desktop/scripts/diagnose.mjs` — the runnable health probe
- `packages/core/src/test-helpers/assert-provider-honors-abort.ts` — the abort-helper
- `packages/core/src/test-helpers/index.ts` — barrel
- `packages/provider-openai/src/assert-provider-honors-abort.test.ts` — worked example
- `packages/plugin-sdk/README.md` — pattern doc (also new)

**Edited (5):**

- `packages/core/src/index.ts` — re-export
- `packages/core/package.json` — exports map
- `apps/desktop/src/renderer/components/SettingsRail.tsx` — Cmd+F scoping
- `packages/runner-aider/src/runner.ts` — streaming flag flip
- `website/pages/guides/runners.mdx` — runner comparison table
- `Todo.md` — 20 bullets flipped in round-2 sweep
- root `package.json` — added `diagnose` script
- `HANDOFF.md` — this file
