# OpenCodex Positioning

Internal reference for the "Mission Control for AI coding agents" framing. Keep this in sync with `README.md`, `MANUAL.md`, the website landing, and any pitch / launch copy.

## One-line pitch

> Mission Control for AI coding agents — a standalone desktop app that lives next to your editor and drives Claude Code, Aider, OpenCode, and a built-in agent over any LLM.

## Expanded pitch (two sentences)

> OpenCodex is a standalone desktop app that lives next to your editor and drives Claude Code, Aider, OpenCode, and a built-in agent as runners — over any LLM you point it at. It unifies approvals, graphical diff review, signed audit logs, and merge review across every runner you wire up, so you stop juggling terminals and start shipping.

## Three pillars

1. **Runners** — one desktop that drives every major coding agent CLI as a first-class runner: the built-in agent, Claude Code, Aider, OpenCode, plus runners contributed by plugins. You pick the right tool per task; OpenCodex handles approvals, diffs, audit log, and merge review in a unified UI.
2. **Multi-agent orchestration** — fan out subtasks to parallel workers, each in its own git worktree so changes never collide. Watch the subagent tree, intervene, accept or reject merges per worker.
3. **MCP + plugins** — every MCP server you connect becomes a tool/resource/prompt source. Third-party packages contribute tools, providers, runners, and UI panels via the plugin SDK.

## Provider-agnostic as a first-class feature

This is a marketed feature, not architectural fine print:

- **Eight adapters ship in the box** — OpenAI, Anthropic, Google Gemini, xAI Grok, Mistral, Ollama (local), OpenRouter, Voyage (embed-only) — plus anything a plugin adds.
- **Switch mid-conversation.** The model picker groups by provider, shows capability badges (`tools` / `vision` / `cache` / `stream`) and cost-per-million inline.
- **One `LLMProvider` contract** in `packages/core`. No provider-specific code lives outside its package. The agent loop, the tool layer, and the UI never name a single vendor.
- **Bring your own provider** in one package + one interface implementation. Ship as a plugin or upstream it.

Marketing language: _"Switch providers like you switch fonts."_

## Lives next to your editor

OpenCodex is **standalone**. That word matters:

- It is not a VS Code extension.
- It is not a fork of an editor (a la Cursor / Windsurf).
- It is not a browser tab.
- It does not try to be your editor — it drives the agents that work in your editor's repo.

The desktop window sits on a second monitor, in another workspace, or behind your editor. You keep your IDE; OpenCodex owns the agent surface — approvals, diffs, audit, merge review, multi-agent fan-out, MCP, scheduled runs.

## Why "Mission Control"

- We are not another single-runner CLI. We are the surface that drives the runners.
- We are not a hosted IDE. Everything is local-first; keys stay in the OS keychain.
- We are not provider-locked. Every LLM goes behind a single `LLMProvider` contract.
- We are not opinionated about one workflow — chat, autonomous agent, multi-agent, scheduled, deep-linked, or webhook-triggered are all first-class entry points.

## When to use which word

- **Mission Control** → the product positioning. Hero copy, README intro, website landing.
- **Standalone desktop** → use whenever we're contrasting with editor-extensions, editor-forks, or browser tabs.
- **Provider-agnostic** → use as a noun phrase, not a footnote — it deserves its own subhead in every marketing surface.
- **Lives next to your editor** → the explicit "we don't replace your IDE" promise.
- **Desktop coding agent** → fall-back / SEO-friendly description for places where "Mission Control" reads as too marketing-y (e.g., academic write-ups, dry technical docs).

## What is intentionally _not_ in the headline

- Specific model names (those change quarterly).
- Specific runner versions (those are plugin-replaceable).
- Pricing or marketplace claims (OpenCodex itself is free, MIT-licensed).
- Editor names — even though we live next to one, we don't endorse a specific IDE.

## Hero asset

The website landing uses `website/public/hero-subagent-tree.svg` — currently a hand-drawn placeholder of the subagent tree view, with a watermark and a corresponding PLACEHOLDERS.md entry. Replace with a real screenshot of `apps/desktop/src/renderer/components/AgentRunDrawer.tsx` before v0.1 marketing — see PLACEHOLDERS.md for the exact spec (resolution, theme, what should be on screen). The README and MANUAL also reference this asset; keep the filename stable or update all three callers.

## See also

- `README.md` — public top-line summary.
- `MANUAL.md` → "Mission Control" intro section.
- `website/pages/index.mdx` — landing copy mirrors README intro.
- `PLACEHOLDERS.md` — hero-asset replacement spec.
- `docs/plugin-registry.md` — the plugin-registry schema (Tier 2 ecosystem deliverable).
- `CONTRIBUTING.md` → "Publishing a plugin" — the registry publish flow.
