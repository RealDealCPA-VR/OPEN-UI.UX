# Handoff State

## Last Session Summary

- **Got `pnpm dev` actually launching.** Five separate Electron/CJS/ESM/ABI issues were stacked; all patched (uncommitted). Diagnostic-by-elimination: `ELECTRON_RUN_AS_NODE=1` was the smoking gun — the user's shell env globally forces electron.exe into Node interpreter mode, so `require('electron')` returned the binary path string instead of the API. Unsetting it inside `pnpm dev` is now required.
- **Raycast/Arc-style visual redesign sweep** through `apps/desktop/src/renderer/styles.css` (~3600 lines). New design tokens (warm-zinc bases, indigo-violet accent, soft layered shadows, radii scale, Inter+JetBrains Mono fonts), pill-style active sidebar with custom-drawn SVG mask icons, frosted topbar/statusbar/chat-header via `backdrop-filter`, softer chat bubbles, button gradient with inset highlight, focus glow on inputs, glassy onboarding wizard (was completely unstyled before), translucent scrollbars.
- **No Todo.md items checked this session** — all work was orthogonal to the tracked backlog.

## Verify Before Continuing

- [ ] **Working tree is dirty with 8 uncommitted files.** Don't blindly commit them — the user has seen the dev launch + redesign and may want to keep iterating before a commit. Run `git status` first; ask before committing. Files:
  - `apps/desktop/electron.vite.config.ts` (workspace aliasing + CJS output for main/preload)
  - `apps/desktop/package.json` (`main: out/main/index.cjs`)
  - `apps/desktop/src/main/index.ts` (preload path `.mjs` → `.cjs`)
  - `apps/desktop/src/main/agent/worker-host.ts` (worker entry path `.js` → `.cjs`)
  - `apps/desktop/src/main/storage/settings.ts` (added `projectName: 'opencodex'` to electron-store)
  - `apps/desktop/src/main/updater.ts` (deferred `pkg.autoUpdater` access to fn-body so init is gated by `app.isPackaged`)
  - `apps/desktop/src/renderer/styles.css` (huge redesign diff)
  - `.claude/settings.local.json` (incidental)

- [ ] **Run `pnpm dev` correctly:** It MUST be invoked with `ELECTRON_RUN_AS_NODE` unset. Bash: `unset ELECTRON_RUN_AS_NODE && pnpm dev`. PowerShell: `Remove-Item Env:ELECTRON_RUN_AS_NODE; pnpm dev`. Otherwise `require('electron')` returns the binary path string and `BrowserWindow`/`app` are undefined. Consider patching the dev script to unset it inline so this footgun is gone — `cross-env ELECTRON_RUN_AS_NODE= electron-vite dev`.

- [ ] **`pnpm build`** — confirm it still succeeds end-to-end with the workspace-aliasing + CJS output changes. Last verified passing before the styles.css redesign; should still pass since CSS doesn't affect TS build.

- [ ] **Native modules rebuild.** `better-sqlite3` (and `keytar`) were rebuilt this session against Electron 30 ABI (NODE_MODULE_VERSION 123) via `pnpm dlx @electron/rebuild -f -w better-sqlite3 -v 30.5.1 -m apps/desktop`. If the user reruns `pnpm install` or `pnpm install --force` per the old HANDOFF instructions, the rebuild will be undone. Fix: pin `electron-rebuild` to a `postinstall` or document the manual step in the README.

- [ ] **Visual: open the dev app and walk every screen** — Chat, Agent, Codebase, Settings (every subsection), Onboarding wizard. The CSS sweep is large and there are likely off-pixel cases I missed.

## Next Task

The redesign is mid-iteration — the user explicitly asked for sleeker UI/UX, then asked specifically for icon swaps which were fixed (HashRouter + URL-encoded SVG masks). They have not yet greenlit the redesign as done. **Next session: continue the visual iteration loop** — open the dev app, get user feedback per screen, polish. Don't pivot to other Todo.md items unless the user redirects.

If the user does redirect to backlog work, the natural first item is wiring the existing `LanceVectorStore` (currently SQLite-shim) to a real `@lancedb/lancedb` install, then plugging the `chunkBySymbols` chunker into a real incremental indexer driven by the existing chokidar watcher.

## Context Notes

### Critical: `ELECTRON_RUN_AS_NODE` footgun

The user's shell has `ELECTRON_RUN_AS_NODE=1` set globally (Claude Code's own subprocess invocation pattern, by all signs). When `electron-vite dev` spawns `electron.exe`, the variable is inherited and Electron starts in Node-interpreter mode — `process.type` is `undefined` instead of `'browser'`, and `require('electron')` returns the path string from `node_modules/electron/index.js` instead of the runtime API. This is the root cause of "BrowserWindow is undefined" / "app is undefined" errors and is invisible without a smoke test. **Always unset before launching.**

### Why main + preload moved to CJS

`apps/desktop/package.json` has `"type": "module"`. Electron 30 does support ESM main process imports per the official docs, but `import { BrowserWindow } from 'electron'` failed in this configuration (even with `ELECTRON_RUN_AS_NODE` unset — the named-export resolution doesn't work for Electron's CJS builtin under Node's stock ESM loader). Switching to CJS output (with `.cjs` extension to opt out of the `"type": "module"` interpretation) bypassed the issue entirely. Renderer stays ESM since it's browser-side. Configured in [electron.vite.config.ts:21-44](apps/desktop/electron.vite.config.ts#L21-L44) via `output: { format: 'cjs', entryFileNames: '*.cjs', chunkFileNames: 'chunks/[name]-[hash].cjs' }`.

### Why workspace packages get bundled instead of externalized

`externalizeDepsPlugin()` was leaving every `@opencodex/*` dep external, but those packages have `noEmit: true` in their tsconfigs (per the old HANDOFF: "switch to `tsup` before any `pnpm publish`"). So they have no `dist/index.js` to require at runtime. Fix: explicit `workspaceAliases` (maps `@opencodex/X` → `packages/X/src/index.ts`) + `externalizeDepsPlugin({ exclude: workspacePackageNames })` so Vite bundles them in. Also handles `electron-store@10` (ESM-only) the same way.

### Other targeted source patches

- [src/main/storage/settings.ts:77-81](apps/desktop/src/main/storage/settings.ts#L77-L81) — `electron-store@10` requires `projectName` (v8 didn't); package name has `@` prefix which the auto-derive rejects.
- [src/main/updater.ts:4-9](apps/desktop/src/main/updater.ts#L4-L9) — `const { autoUpdater } = pkg` at module load triggers `electron-updater`'s lazy getter, which constructs `NsisUpdater` → reads `app.version` BEFORE `app.whenReady()`. Moved access inside `getAutoUpdater()` fn; safe because `initAutoUpdater()` is gated by `app.isPackaged` (false in dev).

### Visual redesign — what to know

- **HashRouter quirk for icon selectors:** [src/renderer/App.tsx:17](apps/desktop/src/renderer/App.tsx#L17) uses `HashRouter`, so NavLink emits `href="#/chat"` not `href="/chat"`. Sidebar icon selectors in styles.css use `[href$='/chat']` (suffix match) — don't change to exact match.
- **SVG mask icons:** Inline data URIs in `.sidebar-link[href$='...']::before` rules. SVG `stroke` is hard-coded `black` (mask uses alpha; visible color comes from `background: currentColor` on the `::before`). `<` and `>` are URL-encoded as `%3C` / `%3E` because Chromium rejects raw `<>` inside `url(...)`.
- **Token system on `:root`** — about 75 CSS vars covering surfaces / borders / text / accent / status / shadows / radii / motion. Light theme override block on `:root[data-theme='light']` carries the same set. Adding new components: prefer adding to the token block, not hardcoding hex.
- **Frosted surfaces:** sidebar/topbar/statusbar/chat-header/chat-composer use `background: color-mix(in oklab, var(--bg-panel) 75%, transparent)` + `backdrop-filter: saturate(140%) blur(10px)`. The ambient body gradient (`body::before`-style radial-gradients) is what shows through.
- **Onboarding wizard styles** were missing entirely — the React component used `onboarding-wizard*` classes with zero matching CSS rules. Now appended at the bottom of styles.css. Probably worth a real eye-test in the dev app, since I wrote them blind.
- **Scrollbars + selection** got global polish at file end too (translucent pill-shaped scrollbars, accent-tinted selection).

### Pre-existing carry-overs still relevant

- Node v20 pinned. `better-sqlite3` must be rebuilt against Electron's ABI (not Node's) — `@electron/rebuild` is the tool, NOT `pnpm install --force`.
- Path has space + period (`OPEN UI.UX`) — quote in shell.
- `packages/*` tsconfig is `noEmit: true` — switch to `tsup` before any `pnpm publish`.
- Pre-public placeholders remain in CODEOWNERS / SECURITY.md / README.md: `@TODO-set-github-handle`, `security@TODO-set-domain`, `github.com/TODO-org/TODO-repo`.
