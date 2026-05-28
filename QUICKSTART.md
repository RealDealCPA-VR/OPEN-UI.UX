# Quickstart

A 10-minute first run with OpenCodex. For depth, see the [User Manual](./MANUAL.md).

## Install

Requires **Node 20+** and **pnpm 9+**.

```sh
git clone <repo-url>
cd opencodex
pnpm install
pnpm dev
```

`pnpm dev` is a passthrough to `pnpm --filter @opencodex/desktop dev`, which launches the Electron app with hot reload. The first launch builds the renderer, so allow about a minute.

## First launch

The onboarding wizard walks you through four screens:

1. **Pick a provider.** Choose OpenAI, Anthropic, Google, xAI, Mistral, Ollama (local), or OpenRouter. The key is stored in your OS keychain via `keytar`, never on disk.
2. **Pick a default model.** The wizard lists models the provider reports and notes which ones support tool calls and vision.
3. **Pick a workspace.** Point at any local repo. OpenCodex indexes it on first open for chat-with-codebase.
4. **Review tool approvals.** Set per-tier defaults (`read`, `write`, `execute`, `network`) to `prompt` or `auto`. You can change these later in Settings.

Optional: the onboarding wizard now offers a "Connect a runner" step where you can hook up Claude Code, OpenCode, or Aider if installed.

## First chat

Open Chat and send: `Explain this repo to me`. The model streams back a summary with inline citations to files in the workspace. Click any citation and the codebase view opens to the cited file at the referenced line. Use this to verify the model is grounded in your actual code rather than hallucinating structure.

## First agent task

Open the Agent panel, click **Spawn task**, and enter: `Add a README badge for the MIT license`. The agent plans, edits in a per-task git worktree, and surfaces a diff for review. Click **Review changes** to see the proposed patch. Choose **Accept** to merge into the workspace branch, or **Reject** to discard the worktree.

## Next

- [User Manual](./MANUAL.md) — every screen, shortcut, and workflow.
- [Runner authoring](./docs/runner-authoring.md) — ship an agent-runner plugin.
- [MCP integration guide](./docs/mcp-integration.md) — connect MCP servers as tool sources.
