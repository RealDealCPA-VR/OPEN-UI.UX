# OpenCodex Positioning

Internal reference for the "Mission Control for AI coding agents" framing. Keep this in sync with `README.md`, `MANUAL.md`, the website landing, and any pitch / launch copy.

## One-line pitch

> Mission Control for AI coding agents — your standalone desktop that drives Claude Code, Aider, OpenCode, and a built-in agent over any LLM.

## Three pillars

1. **Runners** — one desktop that drives every major coding agent CLI as a first-class runner: the built-in agent, Claude Code, Aider, OpenCode, plus runners contributed by plugins. You pick the right tool per task; OpenCodex handles approvals, diffs, audit log, and merge review in a unified UI.
2. **Multi-agent orchestration** — fan out subtasks to parallel workers, each in its own git worktree so changes never collide. Watch the subagent tree, intervene, accept or reject merges per worker.
3. **MCP + plugins** — every MCP server you connect becomes a tool/resource/prompt source. Third-party packages contribute tools, providers, runners, and UI panels via the plugin SDK.

## Why "Mission Control"

- We are not another single-runner CLI. We are the surface that drives the runners.
- We are not a hosted IDE. Everything is local-first; keys stay in the OS keychain.
- We are not provider-locked. Every LLM goes behind a single `LLMProvider` contract.
- We are not opinionated about one workflow — chat, autonomous agent, multi-agent, scheduled, deep-linked, or webhook-triggered are all first-class entry points.

## When to use which word

- **Mission Control** → the product positioning. Hero copy, README intro, website landing.
- **Desktop coding agent** → fall-back / SEO-friendly description for places where "Mission Control" reads as too marketing-y (e.g., academic write-ups, dry technical docs).
- **Standalone** → emphasize when contrasting with hosted IDEs or browser extensions.

## What is intentionally _not_ in the headline

- Specific model names (those change quarterly).
- Specific runner versions (those are plugin-replaceable).
- Pricing or marketplace claims (OpenCodex itself is free, MIT-licensed).

## See also

- `README.md` — public top-line summary.
- `MANUAL.md` → "Mission Control" intro section.
- `website/pages/index.mdx` — landing copy mirrors README intro.
