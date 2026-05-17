# Handoff State

## Last Session Summary

- Scaffolded the full monorepo skeleton: root configs (LICENSE, README, package.json, pnpm-workspace, tsconfig.base, .gitignore, .prettierrc, .editorconfig), CLAUDE.md with embedded `/pickup` and `/handoff` protocol, master `Todo.md` covering all 7 phases, and architecture doc.
- Created Electron app skeleton at `apps/desktop/` with main / preload / renderer split and placeholder module directories (agent, providers, tools, mcp, plugins, rag, storage, shell, ipc).
- Created package skeletons for `@opencodex/core`, `@opencodex/providers`, `@opencodex/tools`, `@opencodex/plugin-sdk`, `@opencodex/mcp-client`, plus an `examples/plugins/hello-world` reference plugin. `@opencodex/core` has real interface stubs (`LLMProvider`, `ChatEvent`, `Tool`, `ModelCapabilities`); other packages have placeholder index files.

## Verify Before Continuing

- [ ] **Confirm Node 20+ and pnpm 9+ are installed** — run `node -v` and `pnpm -v`. If pnpm is missing: `npm install -g pnpm`.
- [ ] **Initialize git** — `git init && git add -A && git commit -m "initial scaffold"`. The repo is currently not a git repo; do this before any further changes.
- [ ] **Install deps** — run `pnpm install` from repo root. Expect it to succeed even though most packages have no real code yet (no provider SDKs or Electron deps are pinned beyond placeholders).
- [ ] **Verify the tree** — `pnpm -r typecheck` should pass against the stub interfaces. Build will fail until Phase 0.5 wires `electron-vite`; that's expected.

## Next Task

From [Todo.md](./Todo.md), the next unchecked items are in **Phase 0**:

> - [ ] Initialize git repo (`git init`), set default branch to `main`
> - [ ] Configure pnpm workspaces (root `package.json` + `pnpm-workspace.yaml` exist; verify `pnpm install` succeeds)
> - [ ] ESLint flat config (`eslint.config.js`) with TS + React rules
> - [ ] Husky + lint-staged pre-commit (lint + typecheck staged files)
> - [ ] Vitest base config (workspace-aware, runs all packages)
> - [ ] GitHub Actions: `ci.yml` running lint + typecheck + test + build on PR
> - [ ] CODEOWNERS, CODE_OF_CONDUCT.md, SECURITY.md, CONTRIBUTING.md
> - [ ] Issue + PR templates

Tackle in that order. Don't move on to Phase 0.5 (Electron scaffold) until `pnpm install`, `pnpm lint`, and `pnpm typecheck` all pass cleanly on a fresh clone.

## Context Notes

- **Folder path has a space + period** (`OPEN UI.UX`). Quote paths in shell commands. Some Windows tools (older npm scripts, certain pre-commit hooks) misbehave with this — if you hit weird path errors, this is the first thing to suspect.
- **Provider abstraction lives in `packages/core/src/provider.ts`**. The `LLMProvider` interface is the load-bearing contract for the whole project; every provider adapter and the agent runtime depend on it. Treat changes to this file as breaking-change-grade.
- **No provider SDKs installed yet.** The provider stub files in `packages/providers/src/*.ts` are just empty exports. When you install `openai`, `@anthropic-ai/sdk`, etc., do it inside the providers package, not at the root.
- **Plugins are first-class** (see [[project-opencodex]] memory). Don't introduce architectural assumptions that only built-in code can register tools or providers — everything routes through the registry.
- **`/pickup` and `/handoff` are the workflow.** Always end a session with `/handoff` (update Todo.md checkboxes + replace this file). Always start with `/pickup`.
- **MIT license** chosen for max adoption. Don't add code under an incompatible license (no GPL deps).
- **Electron was chosen over Tauri** for iteration speed. Don't propose a framework swap without strong evidence — the bet is already placed.
