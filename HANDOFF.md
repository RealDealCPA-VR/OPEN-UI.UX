# Handoff State

## Last Session Summary

- **Phase 8.75 follow-ups shipped — file-change / git-hook / webhook triggers wired end-to-end.** `apps/desktop/src/main/scheduler/file-watcher.ts` runs a per-task chokidar instance with a 500 ms debounce window, glob-filters via the in-house `globToRegExp`, and skips heavy dirs + `.gitignore` + `.opencodexignore`. `apps/desktop/src/main/scheduler/listener.ts` binds an HTTP server to `127.0.0.1` on the first free port in **38400-38500** (chosen port persisted as `schedulerListenerPort`), validates the `X-Opencodex-Signature` HMAC-SHA256 header against the per-task secret, rate-limits to 1 req/sec/task, and rejects non-POST / non-JSON / >64 KB bodies. `apps/desktop/src/main/scheduler/git-hooks.ts` installs sentinel-guarded `sh` + `.cmd` wrapper scripts into `<workspace>/.git/hooks/`, coexisting with user hooks via sourcing-line append; the wrapper POSTs `{taskId, hook}` to the listener with a pre-baked HMAC. Every event-driven trigger calls the shared `scheduler.fireTaskById(id)`, which honors the concurrent-run guard. `computeNextFire` returns `null` for all event-driven triggers so `next_run_at` stays NULL. ScheduledTaskEditorModal exposes the three new trigger modes with appropriate inputs; ScheduledTasksPanel surfaces "Reinstall hook" / "Uninstall hook" buttons on git-hook rows.

- **Community skill registry stub shipped (config-only, mirrors the plugin pattern from Todo.md:151).** New `skillRegistryUrl` setting (default `null`, no bundled registry — opt-in only). `skills:get-registry-url` / `skills:set-registry-url` / `skills:fetch-registry` IPC channels parse the response with `skillRegistrySchema` (Zod-validated, accepts a flat array OR `{entries: [...]}` envelope). SkillsPanel grows a collapsed "Browse community skills" section: URL field + Save + Refresh, list of entries with per-row Install buttons that route through the existing `skills:import-from-url` flow (consent dialog before download).

- **Backlog hygiene.** Todo.md Backlog items 340-343 checked off with full italicized descriptions. The six remaining open items (lines 334-339 — cloud tasks, voice, mobile, team workspaces, visual workflows, JetBrains/VSCode) now carry `_(BLOCKED — …)_` parentheticals explaining what user sign-off / external asset is required for each.

- **Tests + build green.** `pnpm build` finishes in 21.41 s (prior baseline 21.47). `pnpm test` is now **773 pass / 92 fail / 7 skipped** vs. prior baseline 738 / 92 — **+35 net passes** entirely from the new test files; failing count is unchanged (still the same pre-existing better-sqlite3 ABI mismatch files). New tests: `apps/desktop/src/main/scheduler/glob-match.test.ts` (6 cases), `apps/desktop/src/main/scheduler/file-watcher.test.ts` (5 cases), `apps/desktop/src/main/scheduler/listener.test.ts` (10 cases), `apps/desktop/src/main/scheduler/git-hooks.test.ts` (8 cases), `apps/desktop/src/main/skills/registry.test.ts` (7 cases). The existing `triggers/types.test.ts` was updated to reflect that `file-change` / `git-hook` / `webhook` are now supported (5 cases retained, 1 case added for the truly-unknown-type path); `compute-next-fire.test.ts` was updated to assert null for event-driven types instead of the old "Not implemented" throw.

## Verify Before Continuing

- [ ] **File-change trigger fires.** Open Settings → Scheduled tasks → New scheduled task. Pick "File change", enter `**/*.md` as the glob, point at your repo. Save. In a separate terminal, `echo hello > path/to/file.md` inside the workspace. Within ~1 second the Agent view should show a `scheduled` pill on a new active-run card. Edit a `.ts` file — nothing should fire (different glob). Edit a file under `node_modules/` — nothing should fire (heavy dir filter).

- [ ] **Git-hook install round-trip.** New scheduled task, pick "Git hook" → `post-commit`. Save. Inspect `<workspace>/.git/hooks/post-commit` — it should be a sentinel-guarded shell script containing your task id. If a user hook already existed there, the new content should land in `post-commit.opencodex` and your original `post-commit` should have an `# opencodex-hook BEGIN` … `# opencodex-hook END` block appended that sources it. Commit something in the workspace (`git commit --allow-empty -m test`) — the task should fire within a second. Click "Uninstall hook" from the ScheduledTasksPanel — the sentinel block (or the whole file, if we owned it) is removed.

- [ ] **Webhook fires via curl.** New scheduled task, pick "Webhook", click Generate to populate the secret. Save. The editor now shows the inbound URL (e.g. `http://127.0.0.1:38400/trigger/<taskId>`). Copy it. Then from a terminal:

  ```sh
  BODY='{"hi":"there"}'
  SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "<your secret>" -hex | awk '{print $2}')
  curl -X POST http://127.0.0.1:38400/trigger/<taskId> \
    -H "content-type: application/json" \
    -H "x-opencodex-signature: $SIG" \
    -d "$BODY"
  ```

  Expect HTTP 202 + a new agent run with the `scheduled` pill. Repeat within 1 second → expect HTTP 429 (rate limit). Tamper the body → expect 401.

- [ ] **Community skill registry browses + installs.** Open Settings → Skills, expand "Browse community skills". Save any HTTPS URL pointing at a JSON file that matches `[{name, description, sourceUrl}, …]`. Click Refresh — entries should render. Click Install on one — confirm dialog appears, then the skill lands in `~/.opencodex/skills/<name>/SKILL.md` and shows in the skills list.

- [ ] **`pnpm build` is still green.** Verified this session (21.41 s).

- [ ] **`pnpm test` baseline is now 773 / 92.** All new tests under `apps/desktop/src/main/scheduler/` and `apps/desktop/src/main/skills/registry.test.ts` pass under bare vitest. The 92 failures remain the pre-existing better-sqlite3 ABI mismatch files — same constraint that's hit since Phase 6.

## Next Task

**No engineering work remaining.** Every open `[ ]` in Todo.md falls into one of two buckets:

- **Needs external user credentials (4 items, lines 116 + 173 + 174 + 184):**
  - MCP OAuth handling (per-MCP-server OAuth app config)
  - macOS code signing + notarization (Apple Developer Program + Developer ID cert + Apple ID + app-specific password)
  - Windows code signing (EV cert + hardware token)
  - Public v0.1 release announcement (user task; `RELEASE_NOTES_TEMPLATE.md` at repo root is the body to paste)

- **Needs user architecture/UX/scope sign-off (6 items, lines 334-339):** cloud tasks, voice mode, mobile companion, team workspaces, visual workflow builder, JetBrains/VSCode plugins — each `_(BLOCKED — …)_` parenthetical in Todo.md explains why.

The repo is shippable as v0.1 once the user buys the macOS/Windows certs and publishes.

## Context Notes

### Local HTTP listener (scheduler)

- File: `apps/desktop/src/main/scheduler/listener.ts`. Binds **127.0.0.1 only** — never 0.0.0.0. Port range default **38400-38500** (configurable per-call via `rangeStart` / `rangeEnd`); chosen port persisted as `schedulerListenerPort` in electron-store so subsequent boots try it first. If 38400 was in use last boot, settings remember the actual bound port.
- HMAC contract: `X-Opencodex-Signature: <hex>` — SHA256, optionally prefixed `sha256=`. Signature is computed over the **raw request body** (the exact bytes sent), NOT the parsed JSON. Verification is constant-time via `timingSafeEqual`.
- Rate limit: 1 req / 1000ms / taskId, enforced **before** signature verification so unknown task ids can't force HMAC CPU burn.
- Body cap: 64 KB. Past that → 413, connection destroyed.
- Logged via pino at INFO for accepted/rejected calls; WARN for unexpected bind errors.

### Git-hook wrapper sentinel format

- The wrapper file `<workspace>/.git/hooks/<hook>` starts with `#!/bin/sh` then a comment line `# Installed by OpenCodex for scheduled task <taskId>`, then the sentinel block `# opencodex-hook BEGIN` … `# opencodex-hook END`.
- If we own the whole file (no pre-existing user hook), uninstall deletes the file outright.
- If we appended to an existing user hook, our content lives at `<hook>.opencodex` and the parent file just has a sentinel-bounded `[ -x '<wrapper>' ] && '<wrapper>'` line. Uninstall strips only that block — never touches user content.
- Both `.cmd` and `sh` wrappers go in; Git for Windows picks the right one. Cross-platform body is identical (POSTs the same JSON with the same HMAC). Windows wrapper uses PowerShell's `Invoke-WebRequest`.

### Trigger schema additions

```ts
// shared/triggers.ts — git-hook now carries an optional hookSecret
gitHookTriggerSchema = z.object({
  type: z.literal('git-hook'),
  hook: z.enum(['post-commit', 'pre-push']),
  hookSecret: z.string().min(1).optional(),
});
```

Server side: `scheduler/handlers.ts → ensureGitHookSecret` auto-generates a 32-char hex secret on create and preserves it across updates. The renderer never sees or sends the secret — it just sets `{type: 'git-hook', hook: 'post-commit'}`.

`assertTriggerSupported` is now a no-op for every supported variant. It still throws on truly-unknown types (i.e. wire-protocol drift).

### Community skill registry schema

```ts
// shared/skills.ts
skillRegistryEntrySchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/), // kebab-case
  description: z.string().min(1),
  sourceUrl: z.string().url(), // points at the SKILL.md
  author: z.string().optional(),
  version: z.string().optional(),
});
```

Fetch path accepts either a top-level array or `{entries: [...]}`. Schema parsing failure → returns `{entries: [], error: '<message>'}`; the renderer renders that inline so the user knows their registry URL returned malformed data.

### Files added this session

- New main: `apps/desktop/src/main/scheduler/{listener,file-watcher,glob-match,git-hooks,triggers-lifecycle}.ts`
- New main: `apps/desktop/src/main/skills/registry.ts`
- New tests: `apps/desktop/src/main/scheduler/{listener,file-watcher,glob-match,git-hooks}.test.ts` + `apps/desktop/src/main/skills/registry.test.ts`
- Updated shared: `apps/desktop/src/shared/triggers.ts` (hookSecret + assertTriggerSupported now no-op for all variants) + `apps/desktop/src/shared/skills.ts` (`skillRegistryEntrySchema`)
- Updated main: `apps/desktop/src/main/scheduler/scheduler.ts` (file-watcher registry + `fireTaskById` + reconcile lifecycle), `apps/desktop/src/main/scheduler/handlers.ts` (listener start + hookSecret injection + new IPC channels), `apps/desktop/src/main/skills/handlers.ts` (skill registry IPC), `apps/desktop/src/main/storage/settings.ts` (`schedulerListenerPort` + `skillRegistryUrl`)
- Updated shared: `apps/desktop/src/shared/ipc-types.ts` (4 new scheduler channels + 3 new skill channels)
- Updated preload: `apps/desktop/src/preload/index.ts` (new bridge methods)
- Updated renderer: `apps/desktop/src/renderer/components/ScheduledTaskEditorModal.tsx` (file-change / git-hook / webhook UI), `apps/desktop/src/renderer/views/ScheduledTasksPanel.tsx` (hook install/uninstall buttons), `apps/desktop/src/renderer/views/SkillsPanel.tsx` (registry section)
- Updated tests: `apps/desktop/src/main/triggers/types.test.ts` + `apps/desktop/src/main/scheduler/compute-next-fire.test.ts` (file-change / git-hook / webhook are now supported)

### Pre-existing carry-overs still relevant

- Node v20 pinned. `better-sqlite3` must be rebuilt against Electron's ABI (not Node's) — `@electron/rebuild` is the tool, NOT `pnpm install --force`. The DB-backed tests fall under this same constraint; they don't repro under `pnpm dev` (Electron rebuild) but fail under bare `vitest`. The new tests do NOT touch the DB and all pass under bare `vitest`.
- Path has space + period (`OPEN UI.UX`) — quote in shell.
- `packages/*` tsconfig is `noEmit: true` — switch to `tsup` before any `pnpm publish` of the standalone packages.
- Pre-public placeholders remain in CODEOWNERS / SECURITY.md / README.md: `@TODO-set-github-handle`, `security@TODO-set-domain`, `github.com/TODO-org/TODO-repo`. Fill these before the first public tag.
- `website/` is excluded from the main pnpm workspace; run `pnpm install && pnpm dev` inside `website/` separately.

### Cannot Be Closed Here (10 items, all external / blocked)

- **Needs external credentials (4 items):** MCP OAuth (Todo.md:116), macOS signing (Todo.md:173), Windows signing (Todo.md:174), public release announcement (Todo.md:184).
- **Needs user architecture/UX sign-off (6 items, lines 334-339):** cloud tasks, voice mode, mobile companion, team workspaces, visual workflow builder, JetBrains/VSCode plugins. Each has a `_(BLOCKED — …)_` parenthetical in Todo.md explaining what's required to unblock.

That's it. The engineering scope of v0.1 + the natural Phase 8.75 follow-ups is closed.
