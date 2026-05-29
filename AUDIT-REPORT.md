# OpenCodex Codebase Audit — 2026-05-29

Multi-agent audit of the OpenCodex monorepo. 21 finder agents fanned across packages, desktop main subsystems, renderer, build, docs, and a test-failure deep-dive. Every claim with severity ≥ medium was sent to an independent verifier agent that re-read the cited files and adversarially re-judged it.

## Baselines

| Check            | Result                    | Notes                                                                               |
| ---------------- | ------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm lint`      | ✅ pass                   | clean across all 27 packages                                                        |
| `pnpm typecheck` | ✅ pass                   | clean across all 27 packages                                                        |
| `pnpm test`      | ❌ **fail** — exit code 1 | **14 suites failed to collect + 192 tests failed** (1211 passed, 7 skipped of 1410) |

> ⚠️ The first capture run reported "exit 0" because the bash `tee` pipeline swallowed the real status. Re-running without `tee` confirmed exit 1.

## Headline numbers from the audit

- **22 areas audited** across packages, desktop main, renderer, build/CI, docs, tests
- **577 raw findings** → adversarially verified
- **62 high/critical** confirmed
- **139 medium** confirmed
- **261 low/nit** (passed through without verify)
- **43 findings rejected** by the verifier as not real or over-stated
- 338 sub-agents, ~11.4M tokens, ~33 min wall-clock

---

## Critical (CI is broken right now / security gaps that ship today)

### 1. CI is currently red on every push — `check-placeholders` blocks merges

`CODEOWNERS:10,13,14,17,18,19,20` still contain literal `@TODO-set-github-handle` strings. `SECURITY.md:12` still has `security@TODO-set-domain`. `.github/ISSUE_TEMPLATE/config.yml:4,7` have `TODO-org/TODO-repo`. `.github/workflows/ci.yml:45-46` runs `pnpm check-placeholders` **before** lint/typecheck/test, and `scripts/check-placeholders.mjs:5` regex-matches all of those, exits 1 on any hit. CI cannot pass until the placeholders are filled or the check is moved behind a release gate.

### 2. `pnpm build` is a no-op — published packages are broken

Every `packages/*/tsconfig.json` sets `"noEmit": true`, and every `package.json` `build` script is `tsc -p tsconfig.json`. So `pnpm -r build` runs without emitting **any** JS or `.d.ts`. Confirmed on disk: not one of the 22 packages has a populated `dist/`. The desktop app only survives because `apps/desktop/electron.vite.config.ts` aliases every `@opencodex/*` back to source. The moment anything resolves through `node_modules` it breaks:

- The `audit-verify` CLI (`packages/audit-verify/bin/audit-verify.mjs`) `import`s `../dist/index.js` — **the published binary cannot start.**
- `electron-builder` packaging picks up empty `dist/` directories.
- Any consumer that `npm install`s a published `@opencodex/*` package gets nothing executable.
- The CLAUDE.md handoff step _"Run `pnpm build` to confirm the tree compiles"_ is currently a typecheck, not a build.

**Fix:** drop `noEmit: true` from each package tsconfig (or move it to a `tsconfig.typecheck.json`); add `outDir: "dist"`, `rootDir: "src"`; add a CI step that fails when any package's declared `main` does not exist on disk.

### 3. Workspace sandbox can be escaped via a single symlink (`packages/tools/src/path-guard.ts:13-21`)

`resolveWithinWorkspace` only does lexical `path.resolve` + `path.relative`. It **never calls `fs.realpath`.** Any symlink that lives _inside_ the workspace but points outside it is treated as inside. Consequence: `read_file`, `write_file` (via `atomic-write.ts:10`), `edit_file`, `list_dir`, `glob`, `grep`, and `run_shell.cwd` can all read/write/exec anywhere on disk the agent process can reach. The agent doesn't have to plant the symlink — pnpm's own `node_modules` symlink farm is a benign trigger.

**Fix:** realpath the workspace root once at startup; for each access, realpath the deepest existing ancestor and re-verify it stays under that root. For `walk.ts/glob.ts/grep.ts`, default to `if (entry.isSymbolicLink()) continue;`.

### 4. Plugins run **unsandboxed** in the Electron main process — RCE one click away

`packages/plugin-sdk/src/loader.ts:51` is literally `mod = await import(moduleUrl)`. `apps/desktop/src/main/plugins/manager.ts:186-189` calls `plugin.activate(host)` directly in the main process. A plugin can `require('child_process').execSync(...)`, exfiltrate every API key via `keytar`, attach to `ipcMain`, etc. The advertised permission system only gates the _host helpers_ the plugin chooses to call; module-top-level code is unchecked. Worse, the docs lie:

- `apps/desktop/src/main/plugins/README.md:3` — _"in a sandboxed VM context"_
- `docs/plugin-authoring.md:81`, `docs/architecture.md:176` — same claim
- `docs/security-model.md:153-164` — partially honest but contradictory
- `SECURITY.md` lists "the plugin sandbox and permission model" as in-scope

`installPluginFromPath` accepts `acceptUnsigned: true` with only a `logger.warn`. The whole chain ⇒ a single `plugins:install-from-path` IPC payload is full RCE on the user's machine, while the user believes they're protected by a sandbox.

**Fix (in priority order):**

1. Today (minutes): correct the four doc files to stop claiming "sandboxed VM context." Don't ship a security lie even before the architecture lands.
2. Make `installPluginFromPath` hard-fail on unsigned plugins; require an explicit renderer-side consent dialog (not just a warn log).
3. Move plugin execution into `electron.utilityProcess.fork()` with `MessagePortMain` RPC and Node 20 `--permission` flags. The `runSubagentInWorker` pattern in `apps/desktop/src/main/agent/worker-host.ts` is the right template — reuse it. Do **not** use `node:vm` as a security boundary; sandbox escapes are trivial.

### 5. `better-sqlite3` ABI mismatch silently breaks the entire app for users

`apps/desktop/package.json:23` runs `electron-rebuild -f -w better-sqlite3 || echo 'rebuild-native skipped'`. The `|| echo` means any rebuild failure (no Python/MSVC toolchain, offline CI, sandboxed install) silently lets install succeed with a wrong-ABI binary in place. `apps/desktop/src/main/index.ts:188-193` then _catches_ the openDb error and just logs — the app boots into a window that looks fine, and every conversation/audit/search/workspace IPC handler subsequently throws `db not initialized`. The same root cause blocks every db-touching unit test today.

**Fix:**

1. Drop `|| echo`; let postinstall fail loudly. If a soft-fail is needed for non-DB CI legs, gate it on an explicit env opt-out.
2. In `index.ts`, catch the NODE_MODULE_VERSION error, surface a blocking `dialog.showErrorBox`, and refuse to register DB-dependent IPC handlers rather than letting them 500 silently.
3. For tests: either run vitest under Electron (`electron-vite test`), or add a `pretest` step that runs `npm rebuild better-sqlite3 --build-from-source` against the Node ABI. The current "rebuild against Electron AND test under Node" stance is incompatible with itself.

### 6. `@opencodex/core/process/tree-kill` subpath is not in the exports map

`packages/tools/src/run-shell.ts:5` and 5 other production files import `@opencodex/core/process/tree-kill`. `packages/core/package.json` `exports` only declares `"."`. Vitest's alias also maps `@opencodex/core` as a single-file alias, not a directory. Result: `packages/tools/src/run-shell.test.ts` + 3 other tests fail to collect; once `exports` is enforced (when `pnpm build` actually emits) production breaks in 6 places.

**Fix:** add the subpath to `packages/core/package.json` `exports`, and add `'@opencodex/core/process/tree-kill': r('./packages/core/src/process/tree-kill.ts')` to `vitest.config.ts` **before** the broader `@opencodex/core` alias (order matters).

---

## Test failures — three distinct root causes drive 192 failures

| Root cause                                                                                                                                                                                                                                                                                                                                                                                                                                       | Fixes that unblock most tests                                                                                                                                            | Cluster size                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. `vitest.config.ts` alias gaps** — `@opencodex/memory-local-fs`, `@opencodex/audit-verify`, `@opencodex/core/process/tree-kill`, and `monaco-editor` are not aliased. Combined with `noEmit` (no `dist/`) and monaco-editor declaring only `module:` (no `main:`), Vite cannot resolve them.                                                                                                                                                 | 4-line patch to `vitest.config.ts` (3 missing workspace aliases + an empty-shim mock for monaco-editor) plus the exports-map fix from §6                                 | ~6 suite collect failures + downstream cascades                                                                                                    |
| **B. `better-sqlite3` ABI 123 vs 115** — postinstall rebuilds for Electron 30; `pnpm test` runs on Node 20. Every `new Database(':memory:')` throws `ERR_DLOPEN_FAILED`, then `afterEach { db.close() }` re-throws because `db` is undefined.                                                                                                                                                                                                    | See §5                                                                                                                                                                   | All `main/{agent,chat,storage,scheduler,workspace,replay,tool-audit}` test clusters — single largest source                                        |
| **C. No shared `window.opencodex` shim in `setupFiles`** — `vitest.config.ts` sets `globals: false` with no `setupFiles`, so `@testing-library/react` `cleanup()` doesn't auto-run between tests **and** there is no default preload bridge. 3 components (`JobsPane`, `OllamaStep`, `LocalOnlyPill` partially) dereference `window.opencodex.*` synchronously in `useEffect` with no guard, so any test that transitively renders them crashes. | Add `setupFiles: ['./apps/desktop/src/test/setup.ts']`; in setup.ts install a Proxy shim for `window.opencodex` (with a `then` guard) and register `afterEach(cleanup)`. | OnboardingWizard, LeftColumnContextPane, BudgetSpendIndicator, AutomationsView, HoverHint, LocalOnlyPill, AgentSpawnModal, and most renderer tests |

Two real test-only bugs found by the verifier (not infrastructure):

- `spawn-from-ui.test.ts` — abort test missing `isGitRepo` mock.
- `runner-probe.test.ts` — cache-TTL test races against vitest fake timers.

---

## High (correctness/security/UX issues you should fix before shipping)

### Electron security boundary (`apps/desktop/src/main/...`)

- **No CSP installed on the renderer session.** Combined with no `will-navigate` / `setWindowOpenHandler` / `setPermissionRequestHandler`, an XSS or rogue link gets full access to the `window.opencodex` bridge (which includes `agent:spawn-from-ui`, `runner:install`, `plugins:install-from-path`, `skills:import-from-url`, `mcp:run-tool`).
- **Deep-link handler forwards `opencodex://` URLs to the renderer without parsing.**
- **`registerInvoke` never checks `event.senderFrame` / `event.sender`** — sub-frames can call privileged IPC.
- **Network policy is advisory only** — the `security/` subsystem defines an allowlist kernel with good Zod schemas, but **no `session.webRequest` filter is installed**. Enforcement requires every caller to remember `assertOutboundAllowed`. Empty allowlist silently means _allow all_.

### MCP protocol bugs (`packages/mcp-client`)

- **`StdioTransport` never drains child stderr** — every chatty MCP server deadlocks once stderr buffers fill (~64 KB).
- **Full parent env (including every API key) is handed to the spawned MCP server.**
- **No host allowlist on HTTP/SSE transports** — SSRF + arbitrary localhost/metadata-IP fetch via a poisoned `mcp_servers.json`.
- **Client cannot handle server-initiated JSON-RPC requests** — `sampling/elicit` silently drop and the server hangs.
- **Request timeouts never send `notifications/cancelled`** — server-side work leaks.

### Provider abstraction (`packages/core`)

- **`zodToJSONSchema` is hand-rolled** and throws for `ZodLiteral`, `ZodUnion`, `ZodDiscriminatedUnion`, `ZodEffects` (any `.refine()`/`.transform()`), `ZodAny`, `ZodUnknown`, `ZodTuple`, `ZodLazy`. Any plugin-SDK tool using `.refine()` or unions **throws at registration**. Replace with the `zod-to-json-schema` npm package.
- **`ChatRequest` has no `toolChoice` / `responseFormat`** — providers will fork their own conventions. Add typed optionals.
- **`stopReason` lacks `'cancelled'`** and error events lack a `code` field — callers string-match across locales.
- **`collectSubagentResult` mislabels cancellation as `'budget_exceeded'`** (`runner.ts:160-162`), lets late `done` events clobber prior `error` state, and lets iterator throws escape as raw rejections (`for await` has no try/catch).

### Provider packages (×8)

- **Every SSE reader drops the final event** if the stream ends without trailing `\n\n`. None call `reader.cancel()` on early break — HTTP connection leak.
- **OpenAI Responses API silently drops `tool`-role messages with string content.**
- **OpenRouter `capabilities()` returns undefined for any model not in the static list** — even when `listModels()` just returned it live.
- **Google maps SAFETY/RECITATION/BLOCKLIST to `stop_sequence`** — policy blocks become silently empty turns.
- **OpenAI tool-call deltas require `index` field** — many OpenAI-compatible servers omit it; xAI/OpenRouter inherit the bug.
- **No provider populates `costUsd`** despite pricing being available → desktop's budget accrual only fires when `costUsd > 0`, so token-only usage events are uncapped.
- **All providers ship static `KNOWN` model arrays** with no live refresh except OpenRouter.

### Runners (`packages/runner-{aider,claude-code,opencode}`)

- **Aider runs `--yes` without `--no-auto-commits`** → aider auto-commits to the user's repo, bypassing the OpenCodex approval system (explicitly forbidden by CLAUDE.md).
- **opencode runner uses flags (`--headless`, `--message`) that don't exist** in the real CLI — likely never worked.
- **`spawn` on Windows without `shell:true`** breaks the most common install shapes (`.cmd` from pip/npm/scoop).
- **`scrubEnv` strips every `*_API_KEY`** + `XDG_CONFIG_HOME`, then sets `stdio: 'ignore'` — the CLI can't authenticate and hangs at the auth prompt. The probe then reports "timeout — set path in Settings", misdiagnosing auth as install.
- **Windows fallback path list is a stub** (`C:\Program Files\<name>\<name>.exe`) that doesn't match any real install location.
- **No runner honors `budget.maxWallTimeMs`** despite the field being on the contract.

### Audit / signing (`packages/audit-verify`)

- **Canonicalization is fragile** — only the bundle's top-level five keys are stabilized; `entries[*].input/output` are `z.unknown()` blobs whose JSON property order depends on the parser. Any reserializer in the chain breaks signatures, and no second implementation can reliably reproduce the canonical bytes.
- **`bin/audit-verify.mjs` imports `../dist/index.js`** which doesn't exist (see §2).
- **`cli.test.ts` never actually spawns the bin** — assembles a 21-line stub string and asserts `toContain(...)` on it. False coverage.
- **WORM mirror does not actually implement write-once or tamper-evident semantics** on any platform (explicitly a no-op on Windows).

### Telemetry & crash-reporting

- **Crash-reporting opt-out is broken at runtime** — toggling off in settings does not tear Sentry down until next launch.
- **`scrubEvent` misses every Sentry surface that actually carries PII** — it walks `event.user`/`request.url`/`extra` but skips `event.exception` (stack frames + frame.vars), `breadcrumbs`, `contexts`, `tags`, `request.data/headers`, and `message`. Sentry's default integrations (Net, Console, Breadcrumbs) capture LLM URLs, console logs with `workspaceRoot`/conversationId/model IDs, and request bodies.
- **Telemetry queue is unbounded** — events accumulate forever if posthog-node fails to import.
- **All `track()` events land on `distinctId: 'anonymous'`** — `identify()` is functionally dead, all installs co-mingled.
- **`anonymizeId` is a 32-bit non-cryptographic hash** — trivially reversible against the small space of provider/model strings. Pseudonymization, not anonymization.
- **No sampling/rate-limit/maxBreadcrumbs** — 100% capture once enabled.

### Renderer (`apps/desktop/src/renderer/...`)

- **13 of 34 components in components/ A-M dereference `window.opencodex.X` with no null-check** (AppShell, ApprovalQueue, ActiveRunCard, AgentRunDrawer, AgentSpawnModal, AgentTreeView, BudgetSpendIndicator, CodebasePreviewPane, CodebaseSearchBox, CommandPalette, DraftPrModal, FileTree, JobsPane, MCP\* surfaces, MergeReviewModal, MergeConflictResolver, EmbeddedTerminal). A partial preload load crashes the entire renderer because AppShell is the root. The newer `AddToMemoryButton`, `AgentResumePrompt`, `AgentTreeView.bridge()`, `MultiWorkspaceSelector`, `FanoutConsentModal` **do** null-check — those are the reference pattern. Wire a single helper, fix 13 sites in one PR.
- **`MergeReviewModal` passes `runId` as `conversationId`** to `regenerateHunk`, and **`repoRoot='.'`** to `DraftPrModal` and `MergeConflictResolver`. Data-loss risk on the wrong repo.
- **No focus trap on any modal**, no focus restore. Every `aria-modal` dialog leaks focus to background content.
- **No React `ErrorBoundary` anywhere** — `SettingsView.tsx:43` throws synchronously when `SETTINGS_SECTIONS` is empty; any panel crash blanks the whole shell.
- **Global `*:focus-visible { outline: none }` in styles.css** removes keyboard focus indicators across the entire app (WCAG 2.4.7).
- **`--text-muted` / `--text-faint` fall below AA contrast in dark mode.** Several undefined CSS vars (`--surface-2/3`, `--text-1/2`) produce unstyled elements.
- **`OnboardingWizard` mounts on the `ollama` step** but `OllamaStep` reads `window.opencodex.ollama.{probe, listInstallableManagers}` synchronously in `useEffect` — root cause of the OnboardingWizard test failures + a real runtime crash if preload is delayed.
- **`PluginSearchPanel` installs registry URLs as if they were filesystem paths.**
- **`SettingsRail` installs a window-level Cmd+F hijack** that conflicts with embedded Monaco.
- **`OnboardingBanner` uses `window.location.reload()`** to relaunch the wizard — nukes in-flight chat state.

### Codebase / RAG / Git

- **`MultiWorkspaceIndexer.onBatch` only logs** — `addWorkspace`/file edits never reindex. `@opencodex/rag-chunker` is imported zero times in main; no embedding provider is ever invoked. Searches always return empty in production despite the README's promise.
- **`LanceVectorStore` is a SQLite shim that writes `lance.db`** — masquerades as LanceDB; migration trap.
- **`searchByVector` is O(N) full-scan** with per-query cosine norm — unusable at monorepo scale.
- **Watcher singleton `setWatchedWorkspace` leaks chokidar handles** on rapid workspace switches.
- **`.gitignore` is read once at start**, never refreshed; custom glob parser miscompiles character classes.
- **`draftPr` ships unredacted diffs to whichever cloud LLM provider is configured** — violates the project's local-first secret posture.
- **`openPrInBrowser` does `host.includes('github')`** — `evilgithubclone.com` passes.
- **`branchFromConversation` accepts caller-supplied `baseRef` without `--` separator or format validation** — `--orphan` works as a checkout flag.
- **No submodule handling anywhere.**

### Scheduler & triggers

- **Cron next-fire is hardcoded to UTC** — "every day at 9am" runs at the wrong wall-clock time everywhere outside UTC. No per-task tz field.
- **After-sleep/wake catch-up only fires the most-recent missed slot** but `next_run_at` stays stale.
- **`* * * * *` (every minute) can stack unbounded** under back-pressure because the concurrent-run guard re-schedules immediately on completion.
- **Git-hook URLs bake the listener port at install time** and only refresh for currently-enabled tasks.
- **`skills:import-from-url` accepts any HTTPS host** — no allowlist, no certificate pinning, no checksum.
- **Skill substitution is purely textual** — `{{arg_name}}` lands inside the system prompt with no prompt-injection mitigation.
- **Onboarding flow has no resumable state** — a user closing mid-wizard starts over.

### MCP / providers in main

- **`providers/catalog.test.ts` and `selected-model/resolve.test.ts`** both fail at module-load with `"Please specify the projectName option"` because `storage/settings.ts:137` constructs `new Store<Settings>(...)` at module top-level (outside Electron, electron-store falls through to `conf` which throws). One-line fix: make Store creation lazy.
- **Provider catalog is a static hand-edited list** — never refreshed from live `/v1/models`.
- **Ollama `listModels` returns the hardcoded catalog**, not what's actually installed.
- **Ollama probe hardcodes `127.0.0.1:11434`** — ignores configured baseUrl / `OLLAMA_HOST` / IPv6. 800ms timeout is too tight for cold start.
- **No precedence layer for selected model** — single flat global. No auto-clear when a model disappears from the catalog.
- **`providers:save` preserves previous `lastTestResult` after the API key changes** — UI shows "Last tested OK" against an untested key.

### Build / CI / Config

- **`vitest.config.ts` missing aliases**: `@opencodex/memory-local-fs`, `@opencodex/audit-verify` (see §6 and root cause A).
- **CI never runs e2e (Playwright)**.
- **`apps/desktop/e2e/smoke.spec.ts:7` references `out/main/index.js`** but `electron-vite` emits `index.cjs` — ENOENT before launch.
- **`tsconfig.base.json` is missing path mappings** for `provider-voyage`, the three `runner-*` packages.
- **`docs.yml` uses npm in a pnpm monorepo** — drifts the docs site lockfile.
- **Husky v9 deprecation shim** will fail under v10.
- **electron-builder has no Linux signing, no autoupdate `channel:`, and ships `releaseType: draft`** — autoupdates won't reach end users until releases are manually promoted.

### Docs drift

- **`MANUAL.md`** describes a 5-item nav rail with Cmd+1..5; reality is 7 items with Cmd+1..6, including Runners and Reviewer routes the doc never mentions. Calls Runners "the 15th Settings section" — it's a top-level `/runners` route. Says onboarding is 4 steps — it's 6. Says 16 Settings sections — it's 19 (Routing, Privacy, Budgets undocumented).
- **`README.md` and `CLAUDE.md`** both reference `packages/providers/` which doesn't exist. README package tree omits 6+ real packages (`audit-verify`, `telemetry`, `crash-reporting`, `rag-chunker`, `runner-*`, `memory-local-fs`).
- **`SECURITY.md`** in-scope list omits the runner adapters, memory backends, audit-verify, and the 127.0.0.1 webhook listener.
- **`Todo.md`** undercounts shipped work — Reviewer view, create-opencodex-plugin scaffold, audit-verify CLI, memory-local-fs backend, and all four reference plugins ship but appear as `- [ ]`.
- A stray temp file **`CUsersVRProjectsOPEN-UI-UX-handoff-fmt.tmp`** at repo root (malformed shell-path artifact) is committed and trips `check-placeholders`.

---

## Recommended fix sequence (highest leverage first)

1. **Fill placeholders or gate `check-placeholders` to a release workflow** — unblocks every PR and CI run. (§1)
2. **Land the 3 test-infrastructure fixes:** add the 3 missing vitest aliases, add `setupFiles` with a `window.opencodex` shim and `cleanup()`, add a `pretest` step that rebuilds `better-sqlite3` against Node ABI. Expected to take ~180 of the 192 failing tests back to green. Then triage the residual ~12 as real bugs. (Root causes A/B/C)
3. **Fix the plugin sandbox lie:** correct 4 doc files today; flip `installPluginFromPath` to hard-fail on unsigned, then begin `utilityProcess.fork()` work. (§4)
4. **Fix `noEmit` + add post-build `dist/` existence assertion** to CI. (§2)
5. **Path-guard realpath + symlink rejection.** Single-file change with high security payoff. (§3)
6. **Better-sqlite3 postinstall + blocking dialog on ABI mismatch.** (§5)
7. **MCP transport: drain stderr, scrub env, add host allowlist, route server-initiated requests.** (high-impact silent-hang fixes)
8. **Renderer: shared `bridge()` helper + null-check the 13 components in one PR; add `ErrorBoundary` around `SettingsView`; ship a shared `<Modal>` with focus trap.** (UX flawlessness §)
9. **Replace hand-rolled `zodToJSONSchema` with the npm package.** (Unblocks plugin SDK tool authoring.)
10. **CSP + `will-navigate` + `setWindowOpenHandler` + `setPermissionRequestHandler` on the BrowserWindow.** (Electron hardening baseline.)
11. Provider polishing: SSE final-event fix, `reader.cancel()` on break, `costUsd` population, OpenAI tool-role drop, Google SAFETY mapping, OpenRouter capabilities for live models.
12. Docs: rewrite the MANUAL nav-rail/Settings/onboarding/keyboard-shortcut sections to match shipped reality; fix the README package tree; remove the temp file; resolve `SECURITY.md` placeholder.

## What's already good

- TypeScript: strict + `noUncheckedIndexedAccess` + lint cleanly across all 27 packages.
- Provider abstraction: 7 LLM-producing providers + voyage share a remarkably consistent skeleton; tool-use translation is largely correct; abort signals are wired through.
- Telemetry/crash adapters: opt-in by default, disabled path doesn't import the SDK (the "no backend service" rule is honored at the package layer; the leakage problems are at _what_ gets captured when on).
- IPC layer: `registerInvoke` is Zod-validated; the preload itself is types-only and exposes no raw `fs`/`spawn`/`ipcRenderer`.
- The newer renderer components (post-AgentTree refactor) consistently null-check the bridge — keep that pattern as the standard.

---

_Full per-finding details (location, evidence, verifier reasoning, suggested fix) are in the workflow result at `C:\Users\VR\AppData\Local\Temp\claude\C--Users-VR\c264b828-eb04-4d32-9ce0-c6d8d6164eaf\tasks\weycfg4qm.output`._
