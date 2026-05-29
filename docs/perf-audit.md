# Main-process sync-fs audit

Phase 14 perf workstream. Catalogues every synchronous `fs.*Sync` call on
the Electron main process (`apps/desktop/src/main/**`) that runs on the event
loop. Test files are excluded — they run under Vitest, not in the renderer
hot path.

Verdict column legend:

- **app-start** — runs once during `app.whenReady()` or first IPC call after
  startup. Each call is a one-shot bounded cost; moving to async would
  trade simpler code for marginal gains.
- **on-demand** — fires on user action (settings save, skill install, hook
  registration). Latency is hidden behind a button-click; not on the chat hot
  path.
- **hot** — runs from a code path that is in the renderer's interactive loop.
  These are the ones to flip first if a profile shows event-loop stalls.

| File:line                                                  | Symbol                                                                           | Verdict              | Notes                                                                                                                                                                                                |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/main/index.ts`                           | —                                                                                | n/a                  | No direct `*Sync` fs calls. All filesystem work runs through downstream modules.                                                                                                                     |
| `apps/desktop/src/main/agent/run-resume.ts:46`             | `existsSync(run.worktreePath)`                                                   | app-start            | Runs once during `hydrateRunRegistryFromStore()` on app-ready to drop dangling worktrees. Bounded by run-registry size.                                                                              |
| `apps/desktop/src/main/ollama/ollama-installer.ts:160,162` | `mkdtempSync`, `writeFileSync`                                                   | on-demand            | Triggered when user clicks "Install Ollama" in the onboarding wizard. Off the hot path.                                                                                                              |
| `apps/desktop/src/main/plugins/handlers.ts:40`             | `existsSync(installPath)`                                                        | on-demand            | IPC `plugins:uninstall` — invoked from the Plugins settings panel.                                                                                                                                   |
| `apps/desktop/src/main/plugins/manager.ts:314`             | `existsSync(sigPath)`                                                            | app-start            | Runs during plugin discovery on startup; bounded by plugin count (small).                                                                                                                            |
| `apps/desktop/src/main/rag/vector-store.ts:71`             | `mkdirSync(dbPath, { recursive: true })`                                         | app-start            | Runs once when SQLite vector store opens its directory.                                                                                                                                              |
| `apps/desktop/src/main/scheduler/git-hooks.ts:173..294`    | `existsSync`, `mkdirSync`, `rmSync`, `writeFileSync`, `readFileSync`, `statSync` | on-demand            | All inside `installGitHooks` / `uninstallGitHooks` / `readPortFile` — fired when the user toggles git-hook scheduling in Settings, never on every keystroke.                                         |
| `apps/desktop/src/main/skills/handlers.ts:158..207`        | `existsSync`, `readdirSync`, `mkdirSync`, `copyFileSync`                         | on-demand            | IPC `skills:import-bundled` and lookup of the skills source root — runs on first install of the bundled skill set.                                                                                   |
| `apps/desktop/src/main/skills/loader.ts:80..167`           | `existsSync`, `readFileSync`, `statSync`, `readdirSync`                          | app-start            | Initial skills scan on startup. Could be moved to a worker if the user has hundreds of skills; today this is fast (<5ms typical).                                                                    |
| `apps/desktop/src/main/skills/manager.ts:210..413`         | `existsSync`, `mkdirSync`, `rmSync`, `writeFileSync`, `readFileSync`             | on-demand            | `enableSkill`, `disableSkill`, `createSkill`, `installFromMarkdown`, head-summary read. Fires when user manages skills, never streaming.                                                             |
| `apps/desktop/src/main/tool-audit/worm-mirror.ts:112..125` | `existsSync`, `chmodSync`, `openSync`, `writeSync`                               | hot (low-throughput) | The WORM audit-log mirror writes one record per tool call. Tool calls happen during streaming but at human-rate (seconds apart), not per-token. Acceptable today; revisit if audit throughput grows. |
| `apps/desktop/src/main/workspace/handlers.ts:17`           | `statSync(p).isDirectory()`                                                      | on-demand            | IPC `workspace:set` validates the new path. User-initiated.                                                                                                                                          |
| `apps/desktop/src/main/workspace/workspaces-store.ts:30`   | `statSync(p).isDirectory()`                                                      | on-demand            | Validates a workspace path on add/select. User-initiated.                                                                                                                                            |

## Recommendations

1. **Do not move app-start calls to worker_threads.** They run once before any
   streaming happens. Async + worker plumbing would cost more code complexity
   than the wall-clock saves.
2. **WORM mirror** is the only sync-fs call that fires during a chat stream
   (one append per tool call). Profile under high-tool-call rate before
   converting to a worker. The append is bounded (single file handle, one
   `writeSync` per record), so the event-loop hit is small.
3. **Skills loader** (`skills/loader.ts`) is the most likely candidate for
   future worker_threads migration: it scans potentially hundreds of skill
   directories on startup. If cold-start exceeds the 1500ms budget on user
   machines, this is the first knob to turn.

## Notes

The Phase 14 brief instructs us to **audit only, not refactor** — the
worker_threads migration is left to a future phase once the bench script
identifies a regression that crosses the 1500ms / 50ms budgets.
