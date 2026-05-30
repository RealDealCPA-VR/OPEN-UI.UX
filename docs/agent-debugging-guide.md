# Agent Debugging Guide

Written for AI agents (and humans) who land in this repo with no prior context and need to answer "why isn't X working?" without re-reading the whole codebase. Complements `docs/architecture.md` (which describes intent) — this file describes failure shapes.

If you have not read it yet, skim `CLAUDE.md` and `docs/architecture.md` first. They are short. Everything below assumes that mental model.

## When something doesn't work, read this first

A 5-step flow. Do steps in order; bail out the moment you have a lead.

1. **Identify the subsystem.** Use the subsystem map below. Match the symptom (chat hangs, run never finishes, tool rejected, modal missing, file write silently lost, schedule never fires) to a row.
2. **Check the obvious health probe.** Run `pnpm diagnose` (see end of this doc). It runs ~15 probes that catch about 80% of "the app won't start" / "database empty" / "binary missing" / "key not configured" / "MCP server not installed" cases without launching Electron.
3. **Grep structured logs.** Logs are pino JSON to stderr. Filter on `streamId`, `conversationId`, `runId`, `taskId` — every long-lived operation tags its log lines with at least one of these. See "Structured logging" below.
4. **Re-run the relevant test.** Every subsystem row lists its primary test file. `pnpm vitest run <path>` re-runs in isolation. Tests are the highest-fidelity reproduction for everything except provider-network and Electron-window bugs.
5. **Diff against last known-good.** `git log --oneline -- <subsystem path>` then `git show <sha>` for the last commit that touched the file. Phase 15 closeout (`Todo.md` 15.18) is the most recent broad sweep; if a symptom looks regressive, check `Todo.md` 15.1–15.16 to see whether the fix was deliberate.

If steps 1–4 don't surface anything, ask the user. Random refactoring without a hypothesis wastes their time.

## Subsystem map — where does the thing you're debugging live?

| Subsystem                  | Entry point                                                                                                                                                                                                                                  | Owns IPC                                                                      | Owns settings                                                     | Tests                                                                                         | First 3 places to look                                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chat runtime**           | `apps/desktop/src/main/chat/runner.ts:115` (`startChatStream`), `:240` (cancel), `:279` (`runStream`), `:554` (`executeToolCall`); cap at `MAX_TOOL_ITERATIONS=10` line 30                                                                   | `chat:start`, `chat:cancel`, `chat:stream-event`                              | `providers`, `selectedModels`                                     | `apps/desktop/src/main/chat/runner.test.ts`                                                   | Provider SSE flush, tool-loop iteration count, approval-gate decision in audit row                                                                                                       |
| **Agent loop / subagents** | `apps/desktop/src/main/agent/spawn-from-ui.ts:33` (`spawnFromUiAsync`); `worker-host.ts:60` (`isUtilityProcessAvailable`), `:79` (`runSubagentInWorker`), `:198` (`runSubagentInline`); `worker-entry.ts` (child process); `run-registry.ts` | `agent:spawn-from-ui`, `agent:abort-run`, `agent:run-changed`, `agent:tree-*` | `selectedModels`, runner config                                   | `worker-host.test.ts`, `spawn-from-ui.test.ts`, `internal-runner.test.ts`                     | `useWorker` true/false branch (worker spawn vs inline fallback), `runRegistry` row stopReason, runner package's `checkInstalled` result                                                  |
| **Tool registry**          | `packages/core/src/tool-registry.ts:11` (class), `:46` (`execute`); `apps/desktop/src/main/tools/registry.ts:15` (built-in wiring)                                                                                                           | `tools:list`                                                                  | tool-tier policy via approvals                                    | `packages/core/src/tool-registry.test.ts`, `packages/tools/src/*.test.ts`                     | Tool input Zod parse, pre-aborted signal (throws `ToolCancelledError`), tier→permission map for plugin tools                                                                             |
| **Approval system**        | `apps/desktop/src/main/chat/approvals.ts:42` (`ApprovalManager`), `:142` (`effectivePolicy`), `:171` (`getApprovalManager`); IPC in `chat/approval-handlers.ts`                                                                              | `approvals:queue`, `approvals:decide`, `approvals:event`                      | `approvalDefaults`, session overrides                             | `chat/approvals.test.ts`                                                                      | Per-tier default policy, session-scoped override, `readOnlyChatMode` flag (auto-rejects writes)                                                                                          |
| **Provider adapters**      | `packages/provider-*/src/index.ts` (each exports a `Factory`); `packages/core/src/provider.ts:29` (interface), `:48` (`ProviderFactory`); registry in `packages/core/src/registry.ts:18`                                                     | n/a (called from chat runner)                                                 | `providers.<id>` in settings                                      | `packages/provider-*/src/*.test.ts` (281 tests)                                               | SSE final-event flush, `mapHttpStatusToErrorCode` mapping, `assertValidApiKey` rejection of empty keys                                                                                   |
| **Runner adapters**        | `packages/runner-{claude-code,opencode,aider}/src/runner.ts`; install probe in each `check-installed.ts`; spawn through `treeKill` helper from `@opencodex/core/process/tree-kill`                                                           | called by `agent/worker-entry.ts`                                             | runner CLI paths in settings                                      | `packages/runner-*/src/*.test.ts` (58 tests)                                                  | `checkInstalled()` autoDetect fallback paths, `stdio:'pipe'` (NOT `'ignore'`) for auth prompts, ANSI-strip + 1 MiB LineBuffer cap                                                        |
| **MCP client**             | `packages/mcp-client/src/client.ts`; transports: `stdio-transport.ts`, `sse-transport.ts`, `http-transport.ts`; `host-guard.ts` for HTTP/SSE                                                                                                 | n/a (internal); main wraps via `mcp/manager.ts`                               | mcp servers persisted in storage (NOT a file)                     | `packages/mcp-client/src/*.test.ts` (35 tests)                                                | stderr-drain buffer at `stop()`, `scrubEnv` whitelist (PATH/HOME/SHELL + explicit env), `host-guard.ts` reject list (0.0.0.0/link-local/metadata)                                        |
| **RAG indexing**           | `apps/desktop/src/main/rag/multi-workspace-indexer.ts` (chunk→embed→upsert), `watcher.ts` (chokidar), `vector-store.ts` (`SqliteVectorStore`, was `LanceVectorStore`); chunker in `packages/rag-chunker`                                     | `codebase:*`                                                                  | indexing config in settings                                       | `rag/multi-workspace-indexer.test.ts`, `rag/vector-store.test.ts`                             | Embed provider resolved (yes/no), `.gitignore`/`.opencodexignore` live-reload, `pendingTransition` Promise chain on workspace switch                                                     |
| **Scheduler**              | `apps/desktop/src/main/scheduler/scheduler.ts:50` (`computeNextFire`); `runner.ts` (`fireScheduledTask`); `file-watcher.ts`, `git-hooks.ts`, `listener.ts` (webhook); per-task `tz` honored via cron-parser                                  | `tasks:*` IPC                                                                 | `schedulerEnabledInDev` (default false)                           | `scheduler.test.ts`, `runner.test.ts`, `git-hooks.test.ts`, `listener.test.ts`                | `schedulerEnabledInDev` flag in dev, per-task `maxConcurrentRunsPerTask`, monotonic fire-log (1000-entry ring)                                                                           |
| **Skills**                 | `apps/desktop/src/main/skills/loader.ts`, `watcher.ts`, `invoke.ts`, `substitute.ts`, `manager.ts`; `<arg name="x">…</arg>` fencing for user-arg prompt-injection                                                                            | `skills:*`                                                                    | skill registry in storage                                         | `skills/loader.test.ts`, `substitute.test.ts`, `import-from-url.test.ts`, `cron-sync.test.ts` | chokidar debounce, gray-matter frontmatter parse failure, `__current__` model marker for cron re-resolution                                                                              |
| **Plugins**                | `apps/desktop/src/main/plugins/manager.ts:186` (loader, **unsandboxed in main process** — see `docs/security-model.md`); `registry-installer.ts` (signed-only by default); `packages/plugin-sdk` (SDK)                                       | `plugins:*`                                                                   | plugin install list in storage                                    | `plugins/manager.test.ts`, `registry-installer.test.ts`                                       | `UnsignedPluginRefusedError` (must pass `{acceptUnsigned: true}` to override), `assertPluginTool`/`assertPluginProvider`/`assertPluginRunner` Zod parse at registration                  |
| **Memory**                 | `packages/memory-{local-fs,obsidian,notion}/src/index.ts`; `packages/memory-utils/src/{atomic-write,file-mutex,bm25,snippet}.ts`; main wiring `apps/desktop/src/main/memory/{manager,local-fs-runtime,handlers}.ts`                          | `memory:*`, `memory-local-fs:*`                                               | `memory.backend`, vault paths                                     | `packages/memory-*/src/*.test.ts` (83 tests)                                                  | `withFileLock` per-file mutex held, `atomicWrite` fsync+rename, CRLF preserved on Windows                                                                                                |
| **Storage / migrations**   | `apps/desktop/src/main/storage/db.ts:277` (`openDb`), `:11` (`MIGRATIONS` array), `:307` (`MAX_SUPPORTED_SCHEMA_VERSION`); `tool-audit.ts`, `conversations.ts`, `applied-diffs.ts`; FTS5 mirror table                                        | n/a                                                                           | DB at `userData/opencodex.db` (WAL)                               | `storage/db.test.ts`, `conversations.test.ts`, `tool-audit.test.ts`, `applied-diffs.test.ts`  | NODE_MODULE_VERSION dialog at `index.ts:359`, `withSqliteBusyRetry` wrap, `messages_fts` auto-mirror trigger                                                                             |
| **Settings**               | `apps/desktop/src/main/storage/settings.ts:152` (`settingsStore`, **lazy** via `lazy-electron-store.ts`); secrets in `secrets.ts` (keytar service `opencodex`)                                                                               | `settings:*`                                                                  | `userData/settings.json`                                          | `settings.test.ts` (where present)                                                            | `lazyElectronStore` Proxy — store does NOT exist until first property read, so an `import` alone won't fail; secret in keychain, not in `settings.json`                                  |
| **Telemetry / crash**      | `packages/telemetry` (PostHog shim), `packages/crash-reporting` (Sentry shim); main wiring `apps/desktop/src/main/telemetry/manager.ts`, `crash/manager.ts`; HMAC-SHA-256 `anonymizeId` (salt in keychain)                                   | `telemetry:*`, `crash:*`                                                      | `telemetry.enabled`, `crashReporting.enabled`                     | both packages' `*.test.ts`                                                                    | `closeCrash()` tears Sentry down on toggle-off (no need to relaunch); `scrubEvent` walks `exception.values[].frames[].vars/filename` + `breadcrumbs` + `request.headers/data`            |
| **Audit log + verify**     | `apps/desktop/src/main/tool-audit/handlers.ts`, `audit-signing.ts`, `audit-export.ts`, `worm-mirror.ts`; CLI in `packages/audit-verify/src/cli.ts` (real RFC 8785 JCS via `canonical.ts`)                                                    | `audit:*`                                                                     | audit retention + WORM enable in settings                         | `tool-audit/*.test.ts`, `packages/audit-verify/src/{cli,canonical,index}.test.ts`             | Embedded pubkey requires `--accept-embedded-pubkey` (default is pinned trust anchor), WORM platform disclaimer (Windows = best-effort), `withSqliteBusyRetry` on insert                  |
| **Renderer bridge**        | `apps/desktop/src/renderer/bridge.ts:5` (`getBridge()`); preload typed in `apps/desktop/src/preload/index.ts`                                                                                                                                | exposes `window.opencodex.*`                                                  | n/a                                                               | `bridge.test.ts`                                                                              | Direct `window.opencodex.x.y()` reads crash if bridge missing — always go through `getBridge()` (Phase 15.9 deferred a 13-site sweep; some components still call directly)               |
| **IPC**                    | `apps/desktop/src/shared/ipc-types.ts:411` (`IpcInvokeChannelsBase`), `:1242` (`IpcEventChannels`); `apps/desktop/src/main/ipc/registry.ts:15` (`registerInvoke`), `:38` (`emit`)                                                            | n/a (it IS the contract)                                                      | n/a                                                               | per-handler tests                                                                             | Zod `safeParse` failure (`invalid request for <channel>`), sub-frame rejection at `registry.ts:22`, `webContents.isDestroyed()` guard at `emit:43`                                       |
| **Network policy**         | `apps/desktop/src/main/security/network-policy.ts:95` (`checkOutbound`), `:120` (`assertOutboundAllowed`), `:61` (`isLoopbackHost`); wired into `session.webRequest.onBeforeRequest` from `index.ts`                                         | `network:*`                                                                   | `userData/privacy.json` (`localOnly`, `allowlist`)                | `network-policy.test.ts`                                                                      | Empty allowlist = "allow all" (logs startup warning, see JSDoc), IPv4-mapped IPv6 loopback recognition (`::ffff:127.0.0.1`), corrupt `privacy.json` fails closed (not silent permissive) |
| **Path guard**             | `packages/tools/src/path-guard.ts:4` (`PathEscapesWorkspaceError`), `:57` (`resolveWithinWorkspaceSync`), `:77` (`resolveWithinWorkspace` async); cached realpath per workspace root                                                         | n/a                                                                           | n/a                                                               | `packages/tools/src/path-guard.test.ts` (8 cases, symlink tests skip on Windows EPERM)        | activeWorkspace mismatch (the path is fine, but `workspaceRoot` is stale), symlink to outside workspace (rejected by realpath verify), not-yet-existing path under symlinked parent      |
| **Updater**                | `apps/desktop/src/main/updater.ts:72` (`initAutoUpdater`), `:84` (autoCheckLoop), `:113` (`checkForUpdates`), `:140` (`downloadUpdate`), `:145` (`quitAndInstall`), `:149` (`getStatus`)                                                     | `updates:*`                                                                   | electron-builder `channel: latest` + `OPENCODEX_RELEASE_TYPE` env | (no unit tests — gated by code-signed installer)                                              | `electron-updater` won't fire in dev (only in packaged), draft releases need manual promotion, status enum                                                                               |

## Failure-mode catalog — symptom → likely cause → file:line

Each entry is short and points at the file you'd open first. The reproducer column is the smallest test or command that would have caught it.

### Chat runtime

- **Chat hangs on first token** → provider SSE never flushed trailing event after stream end → check the provider's SSE reader (every provider should call `reader.cancel()` on consumer break + flush on stream end — Phase 15.6 swept all 6). Verify: re-run `packages/provider-<x>/src/streaming.test.ts`. Cross-check: blocking NODE_MODULE_VERSION dialog at `apps/desktop/src/main/index.ts:344` may have fired and been dismissed — check stderr.
- **Chat fails with "Authorization" garbled error** → API key rotated externally; the keychain entry under service `opencodex` is stale → `apps/desktop/src/main/storage/secrets.ts`. Verify: `pnpm diagnose` reports `provider HTTP` probe.
- **Chat loop exits with stopReason='tool_use' but no result** → `MAX_TOOL_ITERATIONS=10` exceeded → `chat/runner.ts:30`. Verify: count `tool_call` events in audit log for that conversationId.
- **Tool execution rejected with `ToolCancelledError`** → consumer aborted before `execute()` → `packages/core/src/tool-registry.ts:49`. Likely the user hit cancel or a downstream `AbortController.abort()` cascaded.
- **Tool execution rejected with `PathEscapesWorkspaceError`** → realpath verify caught a symlink escape, OR `activeWorkspace` mismatch (the path is valid for one workspace but the runner has a stale `workspaceRoot`) → `packages/tools/src/path-guard.ts:4`. Verify: print `ctx.workspaceRoot` at the call site.
- **Approval modal never appears for a write tool** → effective policy on that tier is `'auto'`, OR session override active, OR `readOnlyChatMode` toggled on → `chat/approvals.ts:142`. Inspect `effectivePolicy(...)` for that tier.

### Agent loop / subagents

- **Subagent run silently exits** → `runSubagentInWorker` fork failed and `spawn-from-ui` fell through to `runSubagentInline`; the inline path then errored without surfacing → `agent/spawn-from-ui.ts:77` (the `logger.error` "worker failed; falling back to inline"). The result row should carry `stopReason: 'runner_error'`.
- **Subagent crashes immediately on spawn** → runner CLI not installed → `runner-install.ts` + each runner's `check-installed.ts`. The probe's friendly hint is shown in the run row's error.
- **External runner hangs at auth prompt** → Phase 15.7 fixed `stdio: 'ignore'` to `'pipe'` and closes stdin properly. If you see a hang, verify `apps/desktop/src/main/agent/worker-entry.ts` is using the latest runner package versions (look for ANSI-strip + `childStdin?.end()`).
- **External runner spawns then immediately exits with auth failure** → `scrubEnv` overzealous → `runner-*/src/runner.ts`. Keys preserved: `*_API_KEY`, `*_API_BASE`, `*_BASE_URL`, `XDG_*`, runner-prefix.
- **Budget caps not honored** → `opts.budget.maxWallTimeMs` not enforced by runner → check `runner.ts` honor the deadline. Phase 15.7 wired all three runners.
- **Aider silently commits to user's repo** → regression — Phase 15.7 added `--no-auto-commits`. If reproduced, check `packages/runner-aider/src/runner.ts` for the flag.

### Provider adapters

- **Provider returns "invalid api key" immediately** → `assertValidApiKey` rejected empty/whitespace key → `packages/core/src/api-key.ts`. Settings UI clears `lastTestResult` when the key changes (Phase 15.12).
- **Provider chat emits `error` with `code: 'content_filter'`** → Google SAFETY/RECITATION/BLOCKLIST/PROHIBITED_CONTENT/SPII finishReason → `packages/provider-google/src/index.ts` (Phase 15.6 maps these). Not a transport bug.
- **OpenRouter `capabilities()` returns undefined for a model that exists** → live `listModels()` not merged into capability cache pre-15.6. Verify the merge in `packages/provider-openrouter/src/index.ts`.
- **Cost stays at $0 in budget UI** → `costUsd` not populated on usage events → `packages/core/src/api-key.ts:computeCostUsd`. Provider's static pricing table may be missing the model id.
- **Tool calls in OpenAI-compatible servers (xAI/OpenRouter/Mistral) get dropped** → tool-call delta `index` field absent on some servers; the adapter must fall back to keying by `id`. Phase 15.6 propagated the fix; regression: each provider's stream parser.

### MCP client

- **MCP server keeps reconnecting** → child stderr buffer filled the pipe (the parent stopped draining), child blocked on `write(2)`, timeouts cascade → `packages/mcp-client/src/stdio-transport.ts`. Phase 15.4 added stderr drain into a 16 KB tail buffer surfaced on `stop()`. Inspect `_lastStderrTail` on the transport.
- **MCP HTTP/SSE transport refuses to connect** → `host-guard.ts` rejected the URL (0.0.0.0, link-local 169.254.x, metadata IP, or not in per-server allowlist) → `packages/mcp-client/src/host-guard.ts`.
- **MCP server-initiated request hangs** → before Phase 15.4 the client could not dispatch `sampling`/`elicit`. Now it returns method-not-found by default. Hook a handler via `client.onServerRequest(...)`.
- **MCP request "times out" but server keeps working** → ensure `notifications/cancelled` is sent on timeout — Phase 15.4 added this. Check `packages/mcp-client/src/client.ts`.
- **MCP `listChanged` notifications never arrive over HTTP** → long-lived GET SSE channel not open → `packages/mcp-client/src/http-transport.ts`. Phase 15.4 wired this.
- **MCP server inherits all of OpenCodex's env (including LLM API keys)** → regression — Phase 15.4 scrubs env to PATH/HOME/SHELL/Windows-essentials + `config.env`. Verify `packages/mcp-client/src/stdio-transport.ts`.

### RAG indexing

- **Codebase search returns nothing** → `MultiWorkspaceIndexer.onBatch` failing silently OR no embedding provider configured → `apps/desktop/src/main/rag/multi-workspace-indexer.ts`. Verify: `pnpm diagnose` `provider config` probe shows a provider with embed capability.
- **Search picks up files that should be ignored** → `.gitignore` cache stale → `apps/desktop/src/main/file-tree/handlers.ts` has a 5s TTL cache and live-reload on change. Force reload by editing `.gitignore` (touch the file).
- **Search is O(N) slow** → `searchByVector` is a SQLite shim with magnitude-bucket prefilter — not an ANN index → `apps/desktop/src/main/rag/vector-store.ts` (`SqliteVectorStore`, formerly `LanceVectorStore`). Known limitation; see Phase 15.10.

### Scheduler

- **Cron task never fires in dev** → `schedulerEnabledInDev = false` by default → `apps/desktop/src/main/storage/settings.ts:118`. Flip in Settings.
- **Cron fires at wrong wall-clock time** → per-task `tz` not set (defaults to UTC) → `scheduler.ts:62` (cron-parser tz option). Set `trigger.tz` to user's IANA zone.
- **`* * * * *` task stacks unbounded** → `maxConcurrentRunsPerTask` cap missing → check `scheduler.ts` `runningCounts` map.
- **Catch-up only fires once after sleep** → expected; logs `scheduler.missed_slots: N` via telemetry. Look in pino logs.
- **Git-hook never triggers OpenCodex** → the hook script reads the listener port from `<workspace>/.git/hooks/opencodex-port` at runtime — if the file is missing or stale, the hook posts to the wrong port → `apps/desktop/src/main/scheduler/git-hooks.ts`.

### Skills

- **Skill template doesn't pick up edits** → chokidar debounce, OR frontmatter parse failed silently → `apps/desktop/src/main/skills/watcher.ts` + `loader.ts` (gray-matter). Tail logs for `skills: parse failed`.
- **Skill cron pinned to wrong model after user switched** → expected pre-15.11; now uses `__current__` marker that re-resolves the selected model at fire time → `skills/cron-sync.ts`.
- **Skill import-from-URL refused** → registry mismatch (host not in allowlist) or `sha256` mismatch → `skills/handlers.ts` import path.

### Plugins

- **Plugin install fails with "UnsignedPluginRefusedError"** → plugin is unsigned and `acceptUnsigned` not set → `apps/desktop/src/main/plugins/manager.ts`. Override only for trusted fixtures.
- **Plugin tool registration silently does nothing** → `assertPluginTool` Zod parse threw and was caught upstream → `packages/plugin-sdk/src/loader.ts`. Inspect the registration log line.
- **Plugin code has unscoped access to Node/Electron APIs** → expected today; the plugin loader runs in the main process. `docs/security-model.md#plugin-sandbox` documents this honestly. Hardening to `utilityProcess.fork()` deferred (Phase 15.2 carryover).

### Memory

- **Memory backend writes silently lost** → per-file mutex (`withFileLock`) not held by the caller, concurrent appends clobbered → `packages/memory-utils/src/file-mutex.ts`. All built-in backends are wired correctly; check custom plugins.
- **CRLF flattened to LF on Windows** → Phase 15.13 detects-and-preserves EOL on read/write. Regression check: `packages/memory-local-fs/src/index.ts`.
- **`## heading` inside a fenced code block created a phantom section** → fence-depth tracking missing → fixed in `packages/memory-local-fs/src/sections.ts`.

### Storage / migrations

- **App opens to a blank window with no errors** → better-sqlite3 ABI mismatch — the NODE_MODULE_VERSION dialog at `apps/desktop/src/main/index.ts:344` should fire and exit. If it didn't, the catch on `:356` mis-classified the message. Run `pnpm rebuild-native`.
- **DB refuses to open with "schema_version X > MAX_SUPPORTED"** → the DB was written by a newer build → `storage/db.ts:307`. Either reinstall the newer build or delete the DB.
- **Writes flake under load** → `withSqliteBusyRetry` not wrapping the call site → see `apps/desktop/src/main/util/sqlite-retry.ts`. Phase 15.12 wrapped conversation + applied-diffs writes.
- **FTS5 search returns stale results** → trigger-based mirror table out of sync; manual rebuild path was removed Phase 15.12 (auto-mirror is canonical) → see `messages_fts` triggers in `storage/db.ts`.

### Settings / secrets

- **`getSettings()` reads stale defaults** → `settingsStore` is **lazy** — the store doesn't exist until first property access (electron-store defers `conf` path resolution to that point). If your test imports `storage/settings.ts` before Electron is ready, reads return defaults until first write → `apps/desktop/src/main/storage/lazy-electron-store.ts`.
- **API key gone after relaunch** → keychain entry deleted by OS keychain reset, OR `keytar` failed to load (no native binary) → `apps/desktop/src/main/storage/secrets.ts`. `pnpm diagnose` reports keychain probe.

### Telemetry / crash

- **"Telemetry disabled" but events still going out** → before Phase 15.8 Sentry tore down only on next launch. Now `closeCrash()` runs on toggle-off. Check `apps/desktop/src/main/crash/manager.ts`.
- **Sentry breadcrumbs leak PII** → `scrubEvent` walks `exception.values[].frames[].vars/filename`, `breadcrumbs`, `contexts`, `tags`, `request.headers/data`, `message` — if a new surface ships, extend the scrub. See `packages/crash-reporting/src/scrub.ts`.
- **PostHog hostname not allowed** → host allowlist enforced → `packages/telemetry/src/manager.ts`. Add the self-hosted host to settings.

### Audit log + verify

- **`audit-verify` fails signature with "JSON property order mismatch"** → expected before Phase 15.12; now uses real RFC 8785 JCS in `packages/audit-verify/src/canonical.ts`. If reproduced, the bundle was signed by a build older than the fix.
- **`audit-verify` passes against any bundle** → you didn't pin a trust anchor and the CLI defaulted to `--accept-embedded-pubkey`. The post-15.12 CLI rejects this by default — pass `--public-key <path>` instead.
- **WORM mirror append failure leaves toggle inconsistent** → `setWormEnabled(true)` reverts to disabled on `openSync` failure (Phase 15.12). Check `tool-audit/worm-mirror.ts`. On Windows, write-once semantics are best-effort — see `WORM_PLATFORM_DISCLAIMER` constant for the honest copy.

### Renderer / UI

- **Renderer crashes blank screen** → `ErrorBoundary` swallow OR `window.opencodex.x.y` read on a missing bridge → use `getBridge()` from `renderer/bridge.ts:5`. ABI mismatch dialog (above) should normally fire first.
- **Modal won't close on Escape** → modal not wrapped in shared `<Modal>` → `apps/desktop/src/renderer/components/Modal.tsx`. Phase 15.9 migrated AgentSpawnModal, DraftPrModal, ApprovalQueue; some remain.
- **Global keystroke (1-6, j/k, a/r) hijacked while focus is elsewhere** → Phase 15.9 scoped listeners to modal refs. If reproduced, check the modal's `onKeyDown` is on the dialog element, not `window`.
- **Theme flashes wrong color on first paint** → `index.html` `<meta name="theme-color">` + data-theme bootstrap should run pre-React. Phase 15.9 wired this — if a flash returns, check `index.html` head order.

### Network policy

- **Outbound request blocked unexpectedly** → empty allowlist = "allow all" by design (logs startup warning); non-empty allowlist filters. Check `userData/privacy.json` (`localOnly`, `allowlist`). `pnpm diagnose` reports counts.
- **Loopback request to `::ffff:127.0.0.1` blocked** → Phase 15.3 added IPv4-mapped IPv6 loopback recognition. Regression: `apps/desktop/src/main/security/network-policy.ts:61`.

### IPC

- **Renderer call throws "invalid request for <channel>"** → Zod `safeParse` failed on the request → `apps/desktop/src/main/ipc/registry.ts:30`. Check the `requestSchema` for that channel in `apps/desktop/src/shared/ipc-types.ts`.
- **IPC call throws "IPC channel ... is only callable from the main frame"** → Phase 15.3 sub-frame rejection. A nested iframe (e.g. plugin panel) tried to call privileged IPC. Routes plugin/iframe IPC through the host bridge or via post-message.
- **Renderer `emit()` event lost on window close** → `webContents.isDestroyed()` guard at `registry.ts:43`. Expected behavior; the broadcaster also checks before sending.

### Provider switch

- **Provider switch mid-conversation loses tool-result blocks** → `resend strategy 'summary-only'` drops tool blocks → `apps/desktop/src/main/chat/provider-switch-handlers.ts`. Check the resend policy.
- **Selected model auto-cleared with a toast** → `reconcileSelectedModelsForProvider` detected the model is no longer in the live catalog → `apps/desktop/src/main/selected-model/handlers.ts`. User needs to pick a new model.

### Updater

- **`checkForUpdates` returns "no updates" but a tag is published** → release is still in `draft` state (electron-builder ships drafts by default unless `OPENCODEX_RELEASE_TYPE` overrides) → `apps/desktop/src/main/updater.ts:113`. Manual-promotion model documented.
- **Updater never fires in dev** → expected: electron-updater is no-op for unpackaged builds. Test against a packaged build.

### Path guard

- **Write succeeds in test but fails in app** → test runs sync `resolveWithinWorkspaceSync` while production runs the async version which does realpath on the deepest existing ancestor. A path under a symlinked workspace parent will resolve differently → `packages/tools/src/path-guard.ts:77`.
- **Windows symlink test silently skipped** → Windows symlinks require admin/dev-mode; the test skips on EPERM. Not a real failure.

## Key paths — where state lives on disk

OS user-data directory (`app.getPath('userData')`):

| File                          | Format                | Owned by                                             | Notes                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | --------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `opencodex.db`                | SQLite (WAL)          | `apps/desktop/src/main/storage/db.ts:279`            | All persistent state: `conversations`, `messages`, `tool_calls` (audit), `scheduled_tasks`, `scheduled_task_runs`, `budgets`, `budget_spend`, `agent_runs_persistent`, `workspaces`, `conversation_workspaces`, `applied_diffs`, `indexed_files_meta`, `schema_migrations`, `messages_fts` (FTS5 mirror). Schema version capped at `MAX_SUPPORTED_SCHEMA_VERSION` (refuses downgrade). |
| `opencodex.db-wal`, `-shm`    | WAL sidecars          | better-sqlite3                                       | Normal under WAL mode.                                                                                                                                                                                                                                                                                                                                                                 |
| `settings.json`               | JSON (electron-store) | `apps/desktop/src/main/storage/settings.ts:152`      | Non-secret prefs: providers (without keys), `selectedModels`, `schedulerEnabledInDev`, `antiSycophancyEnabled`, `approvalDefaults`, allowlists, etc. Lazy-loaded.                                                                                                                                                                                                                      |
| `routing.json`                | JSON (electron-store) | `apps/desktop/src/main/routing/routing-store.ts:20`  | Active routing policy.                                                                                                                                                                                                                                                                                                                                                                 |
| `privacy.json`                | JSON (electron-store) | `apps/desktop/src/main/security/store.ts:14`         | `localOnly`, `allowlist`. Fails closed on corruption (does NOT default permissive).                                                                                                                                                                                                                                                                                                    |
| `audit-worm.ndjson`           | NDJSON                | `apps/desktop/src/main/tool-audit/worm-mirror.ts:23` | Append-only audit mirror. Best-effort on Windows (see `WORM_PLATFORM_DISCLAIMER`).                                                                                                                                                                                                                                                                                                     |
| `vectors.db` (was `lance.db`) | SQLite                | `apps/desktop/src/main/rag/vector-store.ts`          | RAG embeddings. Misnamed historically — see Phase 15.10 rename.                                                                                                                                                                                                                                                                                                                        |

OS keychain (service `opencodex`, via `keytar`):

- Provider API keys (per `providerId`)
- Telemetry HMAC salt (per-install random, used by `anonymizeId`)
- Audit signing key (for the user-export bundle signer)

Per-workspace state (under `<workspace>/.opencodex/`):

- `worktrees/<id>/` — subagent git worktrees on branch `opencodex/subagent/<id>`
- `.gitignore` augmentation via `.opencodexignore` (read by `packages/tools/src/opencodex-ignore.ts`, picomatch)

Per-workspace state (under `<workspace>/.git/hooks/`):

- `opencodex-port` — current scheduler webhook port; the git hook script reads this at runtime so re-launching the app with a different port doesn't break hooks installed earlier.

## Structured logging — where to grep

- **Logger:** pino, configured in `apps/desktop/src/main/logger.ts`. Default level is `info` in prod, `debug` in dev. Override via `LOG_LEVEL=trace pnpm dev`. JSON to stderr.
- **Base context:** `{ proc: 'main' }`. Worker processes use `{ proc: 'worker', runId }`.
- **Correlation IDs in active use today:**
  - `streamId` — every chat stream. Created in `chat/runner.ts:177` via `randomUUID()`. Logged at error sites (`runner.ts:453`, `:640`).
  - `conversationId` — DB-level identifier carried through chat events. Stable across the chat's lifetime.
  - `runId` — agent run identifier from `run-registry.recordStart()`. Carried through worker-host, worker-entry, run-store-bridge.
  - `taskId` — scheduled task ID. Logged in scheduler tick, runner, fire-log entries.
  - Per-provider call: no requestId today (providers wrap their own SDK calls). Add one when debugging — provider adapters accept an `AbortSignal` and could be threaded with a correlation tag.
- **How to enable verbose logging:** `LOG_LEVEL=debug pnpm dev` (covers main + workers). `LOG_LEVEL=trace` for the loudest output. There is no settings toggle today.

### Recommended follow-up (not landed): `withTraceContext`

The codebase has four correlation IDs (`streamId` / `conversationId` / `runId` / `taskId`) that should be on every log line inside their scope but are only added at error sites. A centralized helper would standardize this:

```ts
// proposed — packages/core/src/trace.ts
export function withTraceContext<T>(
  ctx: { streamId?: string; conversationId?: string; runId?: string; taskId?: string },
  fn: () => Promise<T>,
): Promise<T>;
```

Implemented via Node `AsyncLocalStorage`, threaded through a logger child: `logger.child(als.getStore() ?? {})`. Drop-in at the four entry points (`startChatStream`, `runSubagentInWorker`, `runSubagentInline`, `fireScheduledTask`). Not shipping now — recommendation only.

## Common gotchas — things that look broken but aren't

- **better-sqlite3 ABI mismatch:** the dialog at `index.ts:344` fires; run `pnpm rebuild-native` from `apps/desktop`. The `pretest` / `predev` / `prebuild` `ensure-native-abi.mjs` script auto-heals if the sentinel doesn't match — but only on those entry points.
- **Repo path has a space and a period:** `C:\Users\VR\Projects\OPEN UI.UX` — quote paths in shell commands, and prefer absolute paths in tool calls.
- **Node v20 pinned:** `engines.node >= 20` in root `package.json`. Do not run with v22 — better-sqlite3 prebuilt binaries may not match.
- **`vi.useFakeTimers` MUST be scoped:** call sites that need fake timers should do `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })` (NOT the Date defaults) — faking `setImmediate` deadlocks RTL `waitFor`. Two real test failures (`HoverHint.test.tsx`, `runner-probe.test.ts`) traced to this.
- **Keydown listeners are scoped to modal refs (Phase 15.9):** tests that dispatch keydown on `document.body` for modal interactions will not trigger handlers. Dispatch on the dialog element.
- **`window.opencodex` direct read crashes when bridge is missing:** use `getBridge()` from `renderer/bridge.ts` and null-check.
- **Plugin "sandbox" is not a sandbox today:** the loader hard-fails unsigned plugins by default (`UnsignedPluginRefusedError`), but signed plugins run in the main process with full Node + Electron access. The v0.1 architectural rework (utilityProcess.fork + Node `--permission`) is deferred.
- **electron-store is lazy:** `settingsStore` is a Proxy — the underlying Store is constructed on first property access. Importing the module alone does not allocate it, so test setup that pre-imports `storage/settings.ts` won't trigger Electron path resolution prematurely.
- **Anti-sycophancy clause** is appended to system prompts by default. Toggle in Settings → Approvals. If a model's output suddenly feels stiff, this is the cause.
- **Aider's `--no-auto-commits`** is mandatory in this codebase. The runner sets it explicitly — the user's repo never gets auto-committed by aider.
- **`pnpm test` ABI gate:** `pretest` script runs `ensure-native-abi.mjs node` which rebuilds better-sqlite3 against Node ABI. After tests, run `pnpm dev` and it rebuilds against Electron ABI on `predev`.
- **`stdio: 'pipe'` not `'ignore'` for runners (Phase 15.7):** runner CLIs (claude, opencode, aider) need stdin to be a real (closed) pipe so they don't hang on TTY-detection auth prompts. If you see a hang, check the runner package version.

## Running diagnostics — `pnpm diagnose`

From the repo root:

```sh
pnpm diagnose
```

Runs without launching Electron. ~15 probes execute in series, each wrapped in try/catch so one bad probe doesn't kill the run. Output:

- **stdout:** a JSON blob: `{ probes: { <name>: { ok: boolean, durationMs: number, detail: <any> } }, summary: { okCount, warnCount, errCount } }`.
- **stderr:** a human-readable summary, traffic-light per probe: `✓` ok, `⚠` warn, `✗` fail. (Bare ASCII characters; no emojis per CLAUDE.md.)

Redaction: API keys are never printed — diagnose reports a length + 3-char suffix only (`(len=51, …xyz)`). File contents are never echoed.

Probes shipped today:

1. Node + pnpm versions (vs `engines`)
2. better-sqlite3 ABI probe (Node ABI in a child process)
3. SQLite database (open, `pragma integrity_check`, row counts for `conversations`, `tool_calls`, `messages`, `scheduled_tasks`, `agent_runs_persistent`, WAL detect)
4. Settings store (`userData/settings.json` parse, key presence — values never echoed for `*key`/`*token`)
5. Keychain probe (`keytar.findCredentials('opencodex')` — count only)
6. Workspace probe (`activeWorkspace` exists + readable)
7. MCP config probe (storage rows, enabled count)
8. Provider config probe (configured provider ids — NOT keys)
9. Audit log probe (row count, last timestamp, signing key presence)
10. WORM mirror probe (configured path exists, if enabled)
11. Free disk space (userData + workspace)
12. Network policy probe (`userData/privacy.json` allowlist length + `localOnly`)
13. MCP stdio binaries probe (`<command> --help` 5s timeout per enabled server)
14. Runner CLI probes (`claude --version`, `opencode --version`, `aider --version` — 5s timeout each)
15. Provider HTTP probes (`GET /v1/models` HEAD/GET — 5s timeout — only if a key is stored)

The diagnose script exit code mirrors the worst probe: 0 if all OK, 1 if any warn, 2 if any fail. Useful in CI gates and `bash -e` scripts.

## Pointers

- `docs/architecture.md` — design intent
- `docs/security-model.md` — current trust model (especially plugin loader)
- `docs/positioning.md` — what OpenCodex is / isn't
- `docs/local-only-threat-model.md` — network policy boundaries
- `Todo.md` 15.18 closeout — the most recent broad sweep; cross-reference if a symptom looks regressive
- `MANUAL.md` — per-screen / per-shortcut reference (good for UI-shape questions)
