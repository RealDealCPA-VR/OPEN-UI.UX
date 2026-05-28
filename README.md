# OpenCodex

An open-source desktop coding agent that works with **any LLM**.

OpenCodex is a from-scratch, MIT-licensed reimagining of the Codex desktop experience. It runs locally on macOS, Windows, and Linux, talks to whichever LLM provider you point it at, and ships with a real plugin system plus first-class Model Context Protocol (MCP) support.

## What it does

- **Local coding agent** — reads, edits, and runs code in your repo with per-tool approval gates.
- **Chat with your codebase** — AST-aware RAG (tree-sitter + hybrid vector/keyword search) so the model actually knows what's in your project.
- **Multi-agent orchestration** — fan out subtasks to parallel workers, each with its own model, scope, and git worktree.
- **Any LLM** — built-in adapters for OpenAI, Anthropic, Google Gemini, xAI Grok, Mistral, Ollama (local), and OpenRouter. Add your own via plugins.
- **MCP-native** — every MCP server you connect becomes a tool/resource source automatically.
- **Plugins** — third-party tools, providers, and UI panels. Plugin SDK ships with v1.

## Using OpenCodex

The **[User Manual](./MANUAL.md)** is a guided tour of every screen, concept, keyboard shortcut, and workflow. Start there if you've just installed OpenCodex and want to understand what's in front of you.

## Status

Pre-v0.1, actively scaffolding. See [Todo.md](./Todo.md) for the master backlog and [HANDOFF.md](./HANDOFF.md) for current session state.

## Architecture

See [docs/architecture.md](./docs/architecture.md). TL;DR: Electron monorepo, pnpm workspaces, TypeScript everywhere, provider-agnostic `LLMProvider` interface at the core.

## Repo layout

```
apps/
  desktop/             Electron app (main / preload / renderer)
packages/
  core/                LLMProvider, Tool, ChatEvent interfaces — the contracts
  providers/           OpenAI, Anthropic, Google, xAI, Mistral, Ollama, OpenRouter adapters
  tools/               Built-in tools (read_file, run_shell, grep, ...)
  plugin-sdk/          Public SDK for third-party plugin authors
  mcp-client/          Model Context Protocol client (stdio / SSE / HTTP)
examples/
  plugins/             Reference plugins for SDK consumers
docs/
```

## Development

Requires Node 20+, pnpm 9+.

```sh
pnpm install
pnpm dev          # runs apps/desktop in dev mode
pnpm build        # builds everything
pnpm test         # runs vitest across packages
```

## Contributing

Workflow uses `/pickup` and `/handoff` agent protocols — see [CLAUDE.md](./CLAUDE.md). Human contributors can use the same Todo.md/HANDOFF.md flow or open PRs directly.

## License

MIT. See [LICENSE](./LICENSE).
