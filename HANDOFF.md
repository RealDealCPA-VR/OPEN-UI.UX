# Handoff State

## Last Session Summary

- Completed all 14 Phase 0.5 items. Main process now has protocol registration (`opencodex://`), single-instance lock, deep-link delivery (Windows `second-instance` + macOS `open-url`), pending-deep-link buffer for cold-launch URLs, tray with placeholder icon, packaged-only auto-updater, SQLite (WAL + FK + transactional migrations), electron-store-backed settings (Zod-validated), keytar secret storage, pino logger. New typed IPC dispatcher in `apps/desktop/src/main/ipc/registry.ts` validates every payload with Zod via `registerInvoke(channel, schema, handler)`.
- Renderer shell shipped: `HashRouter` (chosen over `BrowserRouter` for `file://` compatibility when packaged), sidebar nav with 4 routed views (chat/agent/codebase/settings), `DeepLinkRouter` listens to `app:deep-link` and parses `opencodex://chat`-style URLs into route navigations. Renderer also has a tiny structured-JSON `logger` wrapper.
- Fixed a latent runtime bug in the prior session's main entry: preload was loaded as `index.js` but electron-vite emits `out/preload/index.mjs`. Corrected to `.mjs`.

## Verify Before Continuing

- [ ] **Full CI still green** — run `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build`. All five should exit 0. Last run produced main 7.31 kB, preload 0.37 kB (.mjs), renderer 271.65 kB JS + 1.31 kB CSS.
- [ ] **Native deps load inside Electron** — run `pnpm --filter @opencodex/desktop dev` and look for `Error: The module '...' was compiled against a different Node.js version`. `better-sqlite3` and `keytar` install via prebuilt Node-ABI binaries; if Electron's bundled Node ABI differs from the system Node used at install time, they will fail at `require()` time. Fix path: add `@electron/rebuild` as a devDep and a `postinstall` script in `apps/desktop` that runs `electron-rebuild -f -w better-sqlite3,keytar`. Don't preemptively add this — only if the error appears.
- [ ] **Husky pre-commit hook** — `git config core.hooksPath` should print `.husky/_`. If empty, run `pnpm prepare`.

## Next Task

Phase 0.5 is done. Skip the two unchecked Phase 0 deferrals (Playwright config, CI `pnpm build` step). Move into **Phase 1 — Provider abstraction**, starting with the core contracts:

> ### Core contracts
>
> - [ ] `packages/core`: `LLMProvider` interface (chat, embed, capabilities)
> - [ ] `packages/core`: `ChatEvent` union (`text_delta`, `tool_call`, `tool_result`, `usage`, `done`, `error`)
> - [ ] `packages/core`: `ModelCapabilities` (toolUse, vision, streaming, contextWindow, pricing, embeddings)
> - [ ] `packages/core`: `Message` / `ContentBlock` shared types (text, image, tool_use, tool_result)
> - [ ] Provider registry + factory with config validation

Build these in order. The interface in `packages/core/src/provider.ts` is the load-bearing contract — every adapter under `packages/providers/*` (planned: openai, anthropic, google, xai, mistral, ollama, openrouter) will implement it, so think hard before locking the shape.

## Context Notes

### Typed IPC pattern (load-bearing)

- Add new channels to one of two registries in `apps/desktop/src/shared/ipc-types.ts`:
  - `IpcInvokeChannels` — request/response (renderer → main → renderer)
  - `IpcEventChannels` — main → renderer push events
- In main, register handlers via `registerInvoke('channel:name', zodSchema, handler)` from `apps/desktop/src/main/ipc/registry.ts`. Zod parsing is mandatory — never call `ipcMain.handle` directly. `safeParse` failure logs structured warning via pino and throws.
- For events, use `emit(webContents, channel, payload)` from the same registry.
- Renderer side: expose new methods on `window.opencodex` via `apps/desktop/src/preload/index.ts`. The `OpenCodexBridge` type export keeps the renderer's `window.opencodex` typed via `apps/desktop/src/renderer/global.d.ts`.

### electron-updater import quirk

`electron-updater` is CJS internally. The main entry uses `import pkg from 'electron-updater'; const { autoUpdater } = pkg;` (see `apps/desktop/src/main/updater.ts`). Named imports break under ESM with this package. Updater is only initialized when `app.isPackaged` is true, so dev runs don't trigger update checks.

### electron-store version

We're on `electron-store@10`, which is ESM-only. This works because the root `package.json` has `"type": "module"`. If you downgrade or another consumer breaks, that's why.

### SQLite migration pattern

Migrations live as a `MIGRATIONS` array of `{ version, sql }` in `apps/desktop/src/main/storage/db.ts`. To add a migration:

1. Append a new entry with the next version number — never edit an existing one.
2. Wrap multi-statement SQL inside the `sql` string (`.exec()` runs them all).
3. The runner is transactional via `database.transaction(...)`; partial migrations rollback.

Initial migration (v1) creates `conversations`, `messages`, `tool_calls` tables. Schema is intentionally minimal — Phase 2+ will extend it.

### Tray icon is empty

`apps/desktop/src/main/tray.ts` uses `nativeImage.createEmpty()`. On Windows this may not show the tray reliably. Real icons go in `apps/desktop/build/` per the README there. Replace before any visible release.

### Renderer routing

- `HashRouter` not `BrowserRouter` — required for `file://` protocol loading when packaged.
- `DeepLinkRouter` in `apps/desktop/src/renderer/App.tsx` parses `opencodex://<segment>` URLs into `/<segment>` routes via `parseDeepLink`. Unknown segments are ignored.
- Catch-all `<Route path="*">` redirects to `/chat`.

### Carry-overs from earlier sessions

- Folder path has a space + period (`OPEN UI.UX`). Quote in shell commands.
- `packages/core/src/provider.ts` is the load-bearing `LLMProvider` contract — changes are breaking-change-grade. **This is exactly what Phase 1 starts editing — be deliberate.**
- No provider SDKs installed yet. Install them inside `packages/providers/*`, not at root.
- MIT license — don't add GPL deps.
- `packages/*` build scripts (`tsc -p tsconfig.json`) emit nothing because `noEmit: true`. Path mappings point at `src/` for dev. Packages cannot be consumed from `dist/` — matters before publishing. Recommendation when needed: `tsup` per package.
- Path mappings in both `tsconfig.base.json` AND `apps/desktop/tsconfig.json` — TS does not merge `paths` from `extends`. When adding a new workspace package, update both.
- CI workflow at `.github/workflows/ci.yml` still does not run `pnpm build`. Could be added now (passes locally), but it just no-ops on every `packages/*` package — defer until those actually emit.
- Placeholders still to fill before going public: `@TODO-set-github-handle` (CODEOWNERS), `security@TODO-set-domain` (SECURITY.md), `github.com/TODO-org/TODO-repo` (issue template config).
