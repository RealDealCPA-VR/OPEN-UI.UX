# OpenCodex

### Mission control for AI coding agents. Any LLM. Your machine. Yours.

OpenCodex is the desktop cockpit your AI coding tools deserve. It runs locally on macOS, Windows, and Linux, talks to whichever LLM you point it at, and turns Claude Code, Aider, OpenCode, and its own built-in agent into a single, keyboard-driven control room — with approvals, diffs, audit logs, and zero vendor lock-in.

**MIT licensed. Local-first. Provider-agnostic. Plugin-extensible. Built to ship.**

> Stop juggling terminals. Start shipping.

---

## The pitch in five seconds

Your AI coding agents currently live in your terminal. Each one has its own CLI, its own approval model, its own log file, its own opinion about your repo. Switching between them is friction. Trusting them blindly is risk. Running them in parallel? Forget it.

**OpenCodex puts a roof over all of it.**

- One **UI** that drives every agent you already use
- One **approval system** that gates every tool call before it touches your repo
- One **signed audit log** (Ed25519) so you can prove what happened
- One **graphical diff review** that beats `git diff` on its best day
- **Any** LLM you want. Switch mid-conversation if the vibes are off.

---

## What's in the box

|                               |                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Built-in coding agent**     | Reads, edits, and runs code in your repo with per-tool approval gates                                       |
| **Chat with your codebase**   | AST-aware RAG (tree-sitter + hybrid vector/keyword search). The model actually knows what's in your project |
| **Multi-agent orchestration** | Fan out subtasks to parallel workers — each with its own model, scope, and git worktree                     |
| **Pluggable runners**         | Built-in, Claude Code, OpenCode, Aider — or ship your own via a plugin                                      |
| **Any LLM**                   | OpenAI, Anthropic, Google Gemini, xAI Grok, Mistral, Ollama (local), OpenRouter. Add more via plugins       |
| **MCP native**                | Every Model Context Protocol server becomes a tool/resource source automatically                            |
| **First-class plugin SDK**    | Tools, providers, runners, UI panels. Third-party on day one                                                |
| **Cross-platform**            | macOS, Windows, Linux — one codebase, one experience                                                        |
| **Local-first**               | No backend service. Keys live in your OS keychain. Your code never leaves your machine                      |

---

## Why OpenCodex vs the rest

**Aider** is brilliant in a terminal. Editor-bound. Python-centric.
**Claude Code** is polished. Anthropic-only.
**OpenCodex** is provider-agnostic by design, plugin-extensible from the first commit, and ships as a real desktop app with graphical diff review, signed audit logs, and an approval queue you can actually trust.

Love Aider? Love Claude Code? **OpenCodex drives them as runners.** It does not compete. It composes.

---

## Sixty seconds to your first agent

```sh
pnpm install
pnpm dev
```

That's it. The [QUICKSTART](./QUICKSTART.md) walks you the rest of the way in under ten minutes — installer to first chat to first multi-agent run.

---

## The good parts

- **[User Manual](./MANUAL.md)** — every screen, every shortcut, every workflow. Read this first.
- **[Architecture](./docs/architecture.md)** — Electron + pnpm workspaces + the `LLMProvider` contract that keeps providers swappable forever.
- **[Roadmap](./Todo.md)** — master backlog. Watch us ship.
- **[Handoff Protocol](./HANDOFF.md)** — how multi-session agent work picks up where it left off without losing context.

---

## What it looks like under the hood

```
apps/
  desktop/             Electron app (main / preload / renderer)
packages/
  core/                LLMProvider, Tool, ChatEvent — the contracts
  providers/           OpenAI · Anthropic · Google · xAI · Mistral · Ollama · OpenRouter
  tools/               Built-in tools (read_file, run_shell, grep, ...)
  plugin-sdk/          Public SDK for third-party plugin authors
  mcp-client/          Model Context Protocol client (stdio / SSE / HTTP)
  memory-*             Pluggable memory backends (local-fs, Notion, Obsidian, ...)
  runner-*             Runner adapters (claude-code, opencode, aider)
examples/
  plugins/             Reference plugins for SDK consumers
docs/
```

Every LLM goes behind one interface. Every tool, every runner, every memory backend is swappable. No part of OpenCodex knows the name of a specific provider — and that's a feature.

---

## Dev setup

Node 20+, pnpm 9+. Then:

```sh
pnpm install
pnpm dev          # apps/desktop in dev mode
pnpm build        # builds everything
pnpm test         # vitest across all packages
```

---

## The principles

1. **Local-first, always.** No hosted backend. Your repo, your keys, your machine.
2. **Provider-agnostic by contract.** One `LLMProvider` interface. No provider-specific code outside its package.
3. **Plugins are first-class.** Tools, providers, runners, UI panels — all contributable.
4. **Approvals before actions.** Nothing touches your repo without you saying yes.
5. **Composable, not competitive.** If a great CLI exists, we drive it. We don't reinvent it.

---

## Status

Pre-v0.1, sprinting. See [Todo.md](./Todo.md) for the master backlog and [HANDOFF.md](./HANDOFF.md) for current session state. Things move fast. Stars and feedback wildly appreciated.

---

## Contributing

`/pickup` and `/handoff` agent protocols documented in [CLAUDE.md](./CLAUDE.md). Humans and agents alike are welcome — open a PR or follow the Todo.md/HANDOFF.md flow.

---

## License

[MIT](./LICENSE). Because your tools should belong to you.

---

**OpenCodex** — your code. Your keys. Your agents. All in one place.
