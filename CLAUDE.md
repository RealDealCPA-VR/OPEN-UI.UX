# OpenCodex — Agent Working Rules

This file is read automatically by Claude Code at the start of every session.

## Project at a glance

OpenCodex is an open-source desktop coding agent that works with any LLM. Electron + TypeScript monorepo. MIT-licensed. v1 scope: local coding agent, RAG over codebases, multi-agent orchestration, MCP support, third-party plugin SDK.

Locked architectural decisions:

- **Framework**: Electron (main / preload / renderer + utility processes for subagents).
- **Monorepo**: pnpm workspaces. `apps/desktop`, `packages/*`, `examples/plugins/*`.
- **Provider abstraction**: every LLM goes behind the `LLMProvider` interface in [packages/core/src/provider.ts](packages/core/src/provider.ts). No provider-specific code outside `packages/providers/`.
- **Plugins are first-class**: tools, providers, and UI panels can all be contributed by third-party packages via [packages/plugin-sdk](packages/plugin-sdk/).
- **MCP-native**: MCP servers are surfaced through the same tool registry as built-in tools.
- **No backend service**. Everything runs locally. API keys live in the OS keychain via `keytar`.

## Agent Handoff Protocol

OpenCodex uses a two-file session baton so multiple agent runs can share the same backlog without losing context. The protocol is also available as the `/pickup` and `/handoff` slash commands.

### `/pickup` — start of every session

1. Read [HANDOFF.md](./HANDOFF.md) — last session's summary, verify-checks, next task.
2. Read [Todo.md](./Todo.md) — full backlog state.
3. Run any "Verify Before Continuing" checks listed in HANDOFF.md **before** writing code.
4. Begin work on the "Next Task" section.

### `/handoff` — end of every session

1. Update [Todo.md](./Todo.md) — check off `[x]` only tasks that actually shipped and work.
2. Replace [HANDOFF.md](./HANDOFF.md) entirely with these sections:

   ```
   # Handoff State

   ## Last Session Summary
   - <2-3 bullets on what was accomplished>

   ## Verify Before Continuing
   - [ ] Check 1: <what + how>
   - [ ] Check 2: <what + how>

   ## Next Task
   <Exact Todo.md item(s) to work on next, copied verbatim>

   ## Context Notes
   <Gotchas, decisions, file:line refs the next agent needs>
   ```

3. Run `pnpm build` to confirm the tree compiles.
4. Tell the user: `Handoff ready. Start a new session and say: /pickup`

Use the `/pickup` and `/handoff` slash commands in Claude Code for one-step access (see `.claude/commands/`). Human contributors can either follow the same Todo.md/HANDOFF.md flow, or open PRs directly without updating HANDOFF.md.

## Coding conventions

- TypeScript strict mode. `noUncheckedIndexedAccess` is on — handle `undefined` from array access.
- ESM everywhere. No CommonJS in new code.
- Zod for runtime validation at every external boundary (provider responses, IPC payloads, plugin manifests, MCP messages).
- No `any`. If you need an escape hatch, use `unknown` + a Zod parse.
- File names: kebab-case. Type names: PascalCase. Functions/vars: camelCase.
- No comments explaining what code does. Only why, and only when non-obvious.

## What not to do

- Don't introduce a second LLM abstraction outside `packages/core`. If something doesn't fit `LLMProvider`, extend the interface — don't bypass it.
- Don't bake provider-specific knowledge into the agent loop, the UI, or the tool layer.
- Don't add features that require a hosted backend. This project is local-first by design.
- Don't write to the user's repo without going through the approval system.
- Don't commit secrets, even in examples.
