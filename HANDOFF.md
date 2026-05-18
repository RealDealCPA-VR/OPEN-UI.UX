# Handoff State

## Last Session Summary

- Completed Phase 0 foundations: pnpm workspaces verified, ESLint 9 flat config with TS + React + react-hooks rules, Prettier + `.prettierignore`, Husky 9 `pre-commit` running `lint-staged` + full repo typecheck, Vitest workspace mode (`vitest.workspace.ts` + `vitest.config.ts`), GitHub Actions `ci.yml` (lint + typecheck + test + format check on Linux/Windows/macOS).
- Added community health files: `CODEOWNERS`, `CODE_OF_CONDUCT.md` (links to Contributor Covenant 2.1), `SECURITY.md`, `CONTRIBUTING.md`, plus `.github/ISSUE_TEMPLATE/{config,bug_report,feature_request}.yml` and `pull_request_template.md`. All contain `TODO-set-github-handle` / `TODO-set-domain` / `TODO-org` placeholders.
- Restructured every per-package `tsconfig.json` to be typecheck-only (`noEmit: true`, no `rootDir`/`outDir`) and added `@opencodex/*` path mappings in `tsconfig.base.json` so workspace packages resolve to source at dev time. `apps/desktop/tsconfig.json` duplicates the path mappings (TS child `paths` replaces parent's, not merges) and adds `baseUrl: "."`. Root `package.json` now has `"type": "module"` to align with the ESM-everywhere rule.

## Verify Before Continuing

- [ ] **Full local CI still green** — run `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`. All four should exit 0. If any fail, fix before continuing.
- [ ] **Husky pre-commit hook installed** — run `git config core.hooksPath`; expect `.husky/_`. If empty, run `pnpm prepare`.
- [ ] **No stray `dist/` directories** in `packages/*/` (we removed `outDir` configs; if you see one, it's stale from before).

## Next Task

Phase 0 has 2 unchecked items, both intentionally deferred. Skip them for now and move into **Phase 0.5 — Electron scaffold**. The first items are:

> - [ ] `apps/desktop`: Electron 30+ + Vite + React 18 + TS scaffold
> - [ ] Configure `electron-vite` for separate main / preload / renderer builds
> - [ ] Main process entry with single-instance lock + deep-link handling
> - [ ] Preload bridge with `contextBridge` typed API (`window.opencodex.*`)
> - [ ] Renderer: React app shell with router (chat / agent / codebase / settings)

Tackle in that order. The `apps/desktop/` skeleton already has the directory layout from the previous session (`src/main/`, `src/preload/`, `src/renderer/`, `src/shared/`), an `electron.vite.config.ts` file, and placeholder entry files — they need real Electron deps installed and the build pipeline wired.

## Context Notes

### tsconfig strategy (load-bearing for the whole repo)

- **Typecheck-only configs**: every `packages/*/tsconfig.json`, `apps/desktop/tsconfig.json`, and `examples/plugins/hello-world/tsconfig.json` is now `noEmit: true` with no `rootDir`/`outDir`. They exist solely for `pnpm -r typecheck`.
- **Build state is mixed**:
  - `pnpm build` exits 0 across the whole tree.
  - `apps/desktop` produces real artifacts in `out/{main,preload,renderer}/` via `electron-vite build` — the previous session's prediction that builds would fail until Phase 0.5 turned out to be wrong; electron-vite was already wired enough to build the skeleton.
  - `packages/*` build scripts (`tsc -p tsconfig.json`) emit **nothing** because `noEmit: true`. Their `dist/` directories stay empty (or contain only `tsconfig.tsbuildinfo`). This is fine at dev time because path mappings point at `src/`, but **packages cannot be consumed from `dist/`** — that matters before publishing or before a non-workspace consumer pulls them in.
  - Recommendation for when real package builds are needed: `tsup` per package (one tiny config per consumer, ESM output, dts generation, watch mode), OR TypeScript project references with a separate `tsconfig.build.json` per package + `tsc -b`. `tsup` is less ceremony and plays nicely alongside the existing `electron-vite` setup.
- **Path mappings** in `tsconfig.base.json` resolve `@opencodex/*` to each package's `src/index.ts`. `apps/desktop/tsconfig.json` duplicates them under its own `paths` because TS does not merge `paths` from `extends`. If you add a new workspace package, update **both** places.

### CI workflow gap

- `.github/workflows/ci.yml` does not run `pnpm build` yet. It currently runs `pnpm install --frozen-lockfile`, lint, typecheck, test, and format check across a 3-OS matrix. `pnpm build` could be added now (it exits 0 and produces real Electron artifacts), but consider deferring the CI build step until `packages/*` actually emit something — otherwise CI just rebuilds Electron and silently no-ops on every package, which is misleading.

### Pre-commit hook

- `.husky/pre-commit` runs `pnpm lint-staged` then `pnpm -r typecheck`. The typecheck-on-every-commit can be slow on big diffs — if it becomes painful, switch to `tsc-files` on staged files instead.

### Placeholders to fill in before going public

- `CODEOWNERS`: every `@TODO-set-github-handle` → real GitHub handle.
- `SECURITY.md`: `security@TODO-set-domain` → real contact.
- `.github/ISSUE_TEMPLATE/config.yml`: `github.com/TODO-org/TODO-repo` → real repo URL.

### Carry-overs from the prior session

- Folder path has a space + period (`OPEN UI.UX`). Quote paths in shell commands.
- `packages/core/src/provider.ts` is the load-bearing `LLMProvider` contract — changes are breaking-change-grade.
- No provider SDKs installed yet. Install them inside `packages/providers/`, not at root.
- MIT license — don't add GPL deps.
- Electron was chosen over Tauri for iteration speed.
- The repo's `.git` was already initialized before this session started; the user confirmed it.
