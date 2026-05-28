# Contributing to OpenCodex

Thanks for considering a contribution. OpenCodex is MIT-licensed and built in the open — issues, PRs, and discussion are all welcome.

## Quick start

```sh
git clone <repo-url>
cd opencodex
pnpm install
pnpm typecheck     # confirms the tree is healthy
pnpm test          # runs Vitest across all packages
pnpm dev           # launches the Electron app in dev mode
```

Requirements: **Node 20+**, **pnpm 9+**.

> `pnpm dev` clears `ELECTRON_RUN_AS_NODE` inline via `cross-env` because some shells (notably Claude Code subprocess shells) set it globally. If it leaks through, Electron starts in Node-interpreter mode and `require('electron')` returns a string instead of the API. The dev script handles this for you — don't remove the `cross-env ELECTRON_RUN_AS_NODE=` prefix.

## Workflow

This project uses a session-baton model between contributors (and AI agents).

- [Todo.md](./Todo.md) is the master backlog.
- [HANDOFF.md](./HANDOFF.md) tracks the state between sessions: last summary, verification checks, next task.
- [CLAUDE.md](./CLAUDE.md) documents the working rules and `/pickup` + `/handoff` slash-command protocol for agents.

If you're a human contributor, the workflow is the same — just don't update HANDOFF.md unless you're explicitly picking up an agent session.

Use the `/pickup` and `/handoff` slash commands in Claude Code for one-step access (see `.claude/commands/`). Human contributors can either follow the same Todo.md/HANDOFF.md flow, or open PRs directly without updating HANDOFF.md.

### Working on the docs site

The `website/` directory is a separate Next.js + Nextra app excluded from the main pnpm workspace. Run `pnpm install && pnpm dev` inside `website/` to work on docs.

## Branches and commits

- Branch off `main`. Feature branches: `feat/<short-name>`. Fixes: `fix/<short-name>`. Docs: `docs/<short-name>`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org): `feat: add ollama provider`, `fix(rag): handle empty chunks`, `docs: clarify plugin manifest`.
- Keep PRs focused — one feature or fix per PR. Refactors that touch many files should be a separate PR from feature work.

## Pull request checklist

Before opening a PR:

- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] `pnpm format:check` passes
- [ ] Pre-commit hook ran (lint-staged + typecheck — installed automatically via `pnpm install`)
- [ ] If you changed the `LLMProvider` interface or any other contract in `packages/core/`, the PR description calls it out as a breaking change

CI runs lint + typecheck + test + format check on Linux, macOS, and Windows. PRs must be green to merge.

## Architecture rules

The locked decisions are in [CLAUDE.md](./CLAUDE.md). The most important ones for contributors:

- All LLM access goes through the `LLMProvider` interface in [`packages/core/src/provider.ts`](./packages/core/src/provider.ts). No provider-specific code outside `packages/providers/`.
- Plugins are first-class: tools, providers, and UI panels can be contributed via [`packages/plugin-sdk`](./packages/plugin-sdk/).
- MCP servers route through the same tool registry as built-in tools.
- No hosted backend. Everything runs locally; API keys live in the OS keychain.

If your proposed change conflicts with these decisions, open an issue to discuss before writing code.

## Code style

- TypeScript strict mode with `noUncheckedIndexedAccess`.
- ESM everywhere.
- Zod for runtime validation at every external boundary (provider responses, IPC payloads, plugin manifests, MCP messages).
- No `any` — use `unknown` + a Zod parse.
- File names: `kebab-case`. Type names: `PascalCase`. Functions/vars: `camelCase`.
- Comments: only when the _why_ is non-obvious. Don't comment what the code does.

## Reporting bugs

Open an issue using the bug report template. Include:

- OS and version
- Node + pnpm versions
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs (with secrets redacted)

## Reporting security issues

Do **not** open a public issue for security vulnerabilities. See [SECURITY.md](./SECURITY.md).

## Code of conduct

Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md). In short: be respectful, assume good faith, focus on the work.

### Before public tag

A handful of strings in the repo — GitHub handles in `CODEOWNERS`, the security email in `SECURITY.md`, the issue-template config, the website theme — are intentional placeholders waiting for the maintainer to fill in real values before v0.1. See [PLACEHOLDERS.md](./PLACEHOLDERS.md) for the full checklist. CI gates this with `pnpm check-placeholders`.
