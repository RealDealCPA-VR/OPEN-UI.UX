# OpenCodex User Manual

A guided tour of every screen, concept, and shortcut. Read top-to-bottom for a complete overview, or jump to a section.

> **Looking for something else?** [README](./README.md) is the top-level project summary. [`docs/architecture.md`](./docs/architecture.md) is the developer-facing deep-dive. [`website/pages/guides/`](./website/pages/guides/) holds topical guides (MCP, plugins, scheduled tasks, runners, skills, accessibility).

---

## Contents

1. [What OpenCodex is](#what-opencodex-is)
2. [First-time setup](#first-time-setup)
3. [The interface at a glance](#the-interface-at-a-glance)
4. [Chat](#chat)
5. [Agent](#agent)
6. [Codebase](#codebase)
7. [Automations](#automations)
8. [Settings](#settings)
9. [Core concepts](#core-concepts)
10. [Common workflows](#common-workflows)
11. [Keyboard shortcuts](#keyboard-shortcuts)
12. [Troubleshooting](#troubleshooting)
13. [Privacy and data](#privacy-and-data)
14. [Getting help](#getting-help)

---

## What OpenCodex is

OpenCodex is a desktop coding agent. It runs locally on your machine and talks to whichever LLM provider you point it at. There is no hosted backend. Your API keys live in the OS keychain. Your code never leaves your machine unless you explicitly send it to the provider you configured.

It does five things:

- **Chat with any LLM** — OpenAI, Anthropic, Google Gemini, xAI Grok, Mistral, Ollama (local), OpenRouter, or any provider you add via a plugin.
- **Run a coding agent** in your repo — read, edit, run shell commands, search, fetch URLs, all gated by your approval policy.
- **Chat with your codebase** — AST-aware retrieval over your files so the model actually knows what's in your project.
- **Orchestrate multi-agent work** — fan out subtasks to parallel workers, each in its own git worktree so changes don't collide.
- **Schedule unattended tasks** — cron, file-change, git-hook, or webhook triggers fire prompts and queue the results for your review.

It also exposes a plugin SDK and is MCP-native — every MCP server you connect becomes a tool, resource, and prompt source.

---

## First-time setup

On first launch, the **Onboarding Wizard** opens. It's four steps:

1. **Pick a provider** — OpenAI, Anthropic, Google, Mistral, xAI, Ollama, or OpenRouter. Each step has a "Why?" line explaining what's about to happen.
2. **Enter your API key** — stored in the OS keychain via `keytar`. The wizard immediately calls the provider's "test" endpoint. If the key is rejected, you see the **actual provider error message** inline (not a generic "failed"), plus a "Try a different provider" link.
3. **Pick a workspace** — the folder OpenCodex will read, edit, and run shell commands inside. You can change this any time in **Settings → Workspace**.
4. **Start chatting** — a check animation marks completion (animates only if you don't have "Reduce motion" enabled in your OS).

**Skip for now** dismisses the wizard without marking onboarding complete. You'll see an `OnboardingBanner` at the top of the app with a "N of 4 done" chip and a **Resume setup** button.

If your provider key turns out to be wrong later, **Settings → Providers** has a **Test connection** button that reports latency, discovered model count, and (on failure) a one-line suggested fix.

---

## The interface at a glance

OpenCodex uses a **three-column layout**:

```
┌──────┬─────────────┬──────────────────────────────────┐
│ nav  │ context     │  main view                       │
│ rail │ pane        │                                  │
│      │             │                                  │
│  56  │  ~248       │  fills remaining width           │
└──────┴─────────────┴──────────────────────────────────┘
                                                      status bar (bottom)
```

- **Nav rail** (left, always visible): Chat / Agent / Codebase / Automations / Settings.
- **Context pane** (middle): per-route context — e.g., on `/chat` it's the conversation list; on `/automations` it's a live next-run countdown for each scheduled task.
- **Main view** (right): the actual surface you're working in.
- **Status bar** (bottom): live agent state, current tool, token usage with segmented meter against the model's context window, active workspace.

**Collapse the context pane** with `Cmd/Ctrl+\` or `Cmd/Ctrl+B`. The nav rail stays visible. Toggle persists across sessions.

**Jump between routes**: `Cmd/Ctrl+1` Chat, `Cmd/Ctrl+2` Agent, `Cmd/Ctrl+3` Codebase, `Cmd/Ctrl+4` Automations, `Cmd/Ctrl+5` Settings. Or `Cmd/Ctrl+,` opens Settings.

**Hover hints**: every icon-only button has a short hint that appears after 300ms of hover. Some show keyboard shortcuts inline (e.g., "Send · ⌘↩"). You can disable hints globally in **Settings → Accessibility**.

**Toasts**: non-blocking notifications appear bottom-right. Press `Esc` to dismiss the most recent. Toasts cover events like MCP server connection issues, retry-budget exhaustion in chat, scheduled run completion.

---

## Chat

The Chat view is the heart of the app — a conversation with the selected model, with optional tool-use.

### Picking a model

Top bar has the **model picker**. It groups models by provider, shows capability badges (`tools` / `vision` / `cache` / `stream`) and cost per million tokens inline. Your last 3 picks appear in a **Recent** group at the top. Capability badges drive UI gating — if the model can't use tools, the tools toggle disappears.

### The composer

- **Enter** sends. **Shift+Enter** inserts a newline.
- **Up arrow** on an empty composer recalls the last user message (handy when you want to tweak and resend).
- **Esc** cancels a streaming response. Partial assistant content is preserved — not wiped.
- **Cmd/Ctrl+K** opens the slash menu (skills and MCP prompts).
- The textarea auto-grows up to ~12 lines, then scrolls.
- Placeholder copy changes contextually: "Ask <model>…" / "Continue from subagent run…" / "Ask about this file…" / "Streaming… press Esc to stop".

### Send → Stop → Retry

The Send button morphs:

- **Send** when idle.
- **Stop** while streaming.
- **Retry** if the stream errored mid-response — clicking re-submits the last user message and attachments.

The chat-runner retries 429 / 5xx provider errors automatically with exponential backoff + jitter (1s, 2s, 4s), capped at 3 attempts, but **only while no text or tool call has been emitted yet**. Once partial output is on screen, errors surface to you directly so you can decide.

### Slash menu

Type `/` at the start of the composer to open it. Two groups:

- **Skills** — markdown-based prompt templates you author. See [Skills](#skills).
- **MCP — <server>** — prompts surfaced by each connected MCP server.

Navigate with `ArrowUp` / `ArrowDown`, insert with `Tab` or `Enter`, close with `Esc`. Each row shows the description right-aligned. Selecting inserts a template like `/skill:daily-standup arg1=<placeholder>`.

### Empty conversation

When you open a new chat with no messages, you see a one-line hook and three starter chips: **Explain this repo**, **Find TODOs in src/**, **Run the test suite**. Click any chip to seed the composer; modify and send.

### Tool-call cards

When the agent calls a tool, you see a card. Behavior:

- **Read tools** (`read_file`, `list_dir`, `glob`, `grep`, `web_fetch`) — collapsed by default on success. One row, tool name + status pill.
- **Errored calls** — auto-expanded with a destructive border.
- **Re-run button** — repopulates the composer with `Re-run this tool call: <name>(<args>)`. Useful when you tweaked the file and want to re-read.
- **Copy output** button on stdout.
- **Grep / glob results** — each `file:line` entry is clickable; clicking switches to Codebase view with that file pinned.

For `run_shell` calls there's also a **Terminal** pill that opens an embedded `xterm.js` view with ANSI escapes interpreted and a `$ command  (cwd: …)` banner.

### Markdown rendering

- Code blocks have a header row with **language pill** (left) and **Copy** + **Wrap/Unwrap** buttons (right). Copy swaps to "Copied" for 1.2s then reverts. Wrap appears only when a line exceeds 100 characters.
- **Citations** like `src/app.ts:42` or `app.ts:10-25` render as clickable pill buttons. Clicking pushes a `chat-to-codebase` transfer and switches to Codebase view with that file pinned.

### Status bar

- **Left**: agent state dot (Idle / Streaming / Error) + currently-running tool name (pulses while streaming).
- **Right**:
  - **Token meter** — segmented 64×6 bar against the model's context window when known. Color thresholds: green ≤70%, accent 70–90%, warn >90%.
  - **Workspace name** — click to open the workspace folder in your OS file manager (Finder / Explorer / Nautilus).

### Cross-view transfers

Chat connects to other views via "transfers" — typed messages on the renderer-side `transfer` channel. Examples:

- Citation click → **Codebase view** opens with the file pinned and the line highlighted.
- "Send to Agent" button in the chat header → **Agent view** opens with the spawn modal prefilled from the last user message.
- "Send to Codebase" button in the chat header → **Codebase view** opens with file references extracted from the assistant's reply pinned as filters.
- Reverse direction: finished agent runs and Codebase right-click "Ask agent about this file" both create a new chat seeded with relevant context.

---

## Agent

The Agent view is where you launch and monitor multi-step coding tasks. Use Chat for short conversational turns; use Agent for "go and make this happen, I'll review the diff."

### Spawning a task

Click **Spawn task** (top-right) or click "Spawn task" in the left context pane when the runs list is empty. The **Spawn Modal** opens:

- **Task** — free-text prompt describing what you want done.
- **Runner** — `OpenCodex built-in` is the default. Switch to **Claude Code**, **OpenCode**, or **Aider** if you have those CLIs installed (the dropdown shows install status per option). Selecting an external runner hides the provider/model selects and forces "Use git worktree" on.
- **Provider + Model** — only for the internal runner.
- **Workspace** — defaults to your active workspace.
- **Use git worktree** — when on, the task spawns in `<repo>/.opencodex/worktrees/<run-id>` on branch `opencodex/subagent/<run-id>`. The modal previews the exact branch + path. Always on for external runners.

**Cmd/Ctrl+Enter** submits. **Esc** closes. Validation errors render below the relevant field.

### Active runs

Each running task gets an **ActiveRunCard** at the top of the view:

- **Live progress bar** segmented against the run's iteration budget.
- **Current tool** badge that pulses while a tool is in-flight.
- **Token / iteration counter**.
- **Abort** button — confirms in-place (morphs into "Confirm abort" + Cancel). After confirmation, the run drains and slides into the history list.

### History

Below active runs, the history list shows completed and failed runs. Each row carries:

- Status pill (success / failed-danger / aborted).
- **Scheduled** badge when the run was triggered by a scheduled task.
- **Runner pill** when the runner was external.
- **Resume in chat** button — creates a new chat seeded with the run summary.

### Run drawer

Click any run to open the **AgentRunDrawer**:

- **Transcript** rendered as a log with monospace timestamps. Each tool block is independently expandable.
- **j / k** navigates between tool blocks.
- **Sticky scroll-to-bottom** while the run is streaming. If you scroll up, a **"Jump to latest ↓"** pill appears bottom-right; click to re-engage.
- **Sticky footer** with merge-review CTA (when applicable) and "Resume in chat".

### Merge review

For runs that landed in a git worktree, the drawer's "Review changes" button opens the **MergeReviewModal**:

- **Left pane**: per-file list with `+N -M` counts. Click a file to focus its diff.
- **Right pane**: full Monaco diff for the focused file. Per-hunk **Accept** / **Reject** controls. Keyboard: `j` / `k` next/prev hunk, `a` accept current, `r` reject current.
- **Accept** runs `git merge --no-ff <branch>` then deletes the worktree.
- **Reject** discards the worktree without merging.
- **Open in Codebase view** link per file (pushes an `agent-to-codebase` transfer).

Confirmation is in-place — no `window.confirm` dialogs.

### `runner_not_installed`

If you pick an external runner whose CLI isn't found on `PATH`, the run fails with `stopReason: runner_not_installed`. The drawer shows an inline callout with **Open Runners settings** that deep-links to the right place to set a CLI path override or install the runner.

---

## Codebase

The Codebase view is where you navigate your repo, search it, and preview files.

### File tree

Left side of the view. Behavior:

- **Filter input** at the top — 150ms debounce, matches on basename, auto-expands ancestors that contain matches.
- **Keyboard navigation**: `ArrowUp` / `ArrowDown` (or `j` / `k`) move selection, `ArrowRight` expands, `ArrowLeft` collapses (or jumps to parent), `Enter` / `Space` opens in preview.
- **Pending-edit pills** — when the agent has uncommitted edits to a file in a worktree, the tree row shows a "3 pending" pill. Click to push a `codebase-to-agent` transfer carrying the relevant run IDs and switch to the Agent view.
- **Right-click** opens a grouped context menu (Open / Edit / Share sections). `Esc` closes; menu position is clamped to the viewport.
- For trees larger than ~500 visible rows, the renderer windows the list internally (24px row height, ±10 row buffer).

### Search

The **CodebaseSearchBox** above the file tree:

- **Scope chips**: Current dir / Repo / MCP resources.
- **Result count + timing pill** appears after each search ("12 results · 84ms").
- **`Cmd/Ctrl+F`** refocuses the input from anywhere in the view.
- Snippets render with matches wrapped in `<mark>` (uses accent-soft tokens).
- Clicking a result opens that file in the preview pane at the matched line.

Backend uses ripgrep when available, with a JS regex fallback. Set `OPENCODEX_NO_RIPGREP=1` to force JS mode.

### Preview pane

Right side, lazy-loaded Monaco read-only editor:

- **Header** with language pill, click-to-copy path button, and three buttons: **Open in editor**, **Reveal in OS**, **Copy path**.
- **Line-number gutter** on.
- URL hash like `#L42` jumps to line 42 on mount, and on every `hashchange`.
- Empty state: "Select a file to preview."

### Recent files

The left context pane (when collapsed off main) shows your last 10 opened files under "Recent files" — pulled from `localStorage`. Clicking re-opens with `?file=<path>` so deep-links also work.

---

## Automations

Automations are prompts that fire on a schedule — cron, file-change, git-hook, or webhook. They reuse the same agent loop, approval system, audit log, and merge-review flow as manual spawns.

### The Automations view

- **Trigger-type filter chips** at the top (Manual / Cron / File / Git / Webhook) with live counts.
- **Three template cards** when the list is empty:
  - **Daily standup** — summarize git activity since yesterday.
  - **Weekly security audit** — scan for hardcoded secrets and weak crypto.
  - **Hourly TODO sweep** — grep open TODOs and group by file.
- **Per-task card** shows name, trigger description, next-run countdown ("in 3m", "tomorrow at 9:00"), last-status pill, and action buttons (Run now / History / Edit / Disable / Delete).

### Creating an automation

Click **New automation**. The **ScheduledTaskEditorModal** opens:

- **Trigger type**: card buttons for Manual / Cron / File / Git / Webhook. Selecting a card reveals its specific config.
- **Cron**: presets (Hourly / Daily 9am / Weekly Mon 9am / Custom). Each preset row shows its next-3-fires beside the label. The raw cron field validates as you type — red ring + "Invalid: <reason>" appears immediately.
- **File change**: glob input (e.g., `**/*.ts`). Triggers fire 500ms after a matching file change, coalesced.
- **Git hook**: pick `post-commit` or `pre-push`. The system installs a sentinel-guarded wrapper script in `.git/hooks/`, coexisting with any user-authored hook.
- **Webhook**: a "Generate" button creates a random 32-char hex secret. After save, "Copy URL" reveals the inbound URL once the local HTTP listener (binds to 127.0.0.1 on a port in 38400–38500) is up.
- **Prompt** — what to run. `{{workspace}}` / `{{date}}` / `{{git_branch}}` are substituted on each fire.
- **Provider + Model + Runner + Allowed tools** — same shape as the spawn modal.
- **Use worktree** — default on for git workspaces.

**Cmd/Ctrl+Enter** saves. **Esc** closes.

### Catch-up on app start

If a cron task's next-fire was in the past while the app was closed, OpenCodex fires it **once** at startup with a `was_catchup: true` flag — it does not replay every missed run. The run shows a "catch-up" annotation in its history.

### Notifications

Scheduled-run completions surface as:

- A tray notification on supported OSes.
- A toast in the running app.
- A badge on the Agent view.

Clicking the notification opens the run drawer with the merge-review CTA highlighted.

### Run history per task

Each task's row has a "History" button that opens a side-drawer paginated by run, reusing the same `AgentRunRow` component you see in Agent view. Click any past run to see its transcript + merge-review CTA.

---

## Settings

Two-pane layout: section rail on the left, panel on the right. The rail has a search input at the top (`Cmd/Ctrl+F` to refocus) that filters by title + description; `Esc` clears it.

URLs like `/settings/providers?highlight=openai` briefly pulse the matching row so deep-links from elsewhere are visible.

### The 16 sections

#### Theme

Light / Dark / System, each with a preview swatch (the System option shows a split swatch). Theme switch transitions smoothly; honors `prefers-reduced-motion`.

#### Workspace

Active workspace shown at the top. **Browse…** opens a native folder picker. **Recents** list with Open / Remove (in-place confirm). MRU dedupe, 10-item cap.

#### Providers

Per-provider rows: name + connection status + Test connection button. **Test connection** reports latency + discovered model count on success; HTTP status + one-line `suggestedFix` on failure (per-provider dictionary covers 401 / 403 / 429 / 404 / 5xx). Inline Retry. Each provider has its own config sub-card with the API key field (stored in OS keychain) and any provider-specific options.

#### Approvals

Per-tool policy grid. Each row:

- **Permission tier** (read / write / execute / network) and tier-default fallback ("Default for `write` tier: prompt").
- **Policy dropdown**: auto / prompt / deny — overrides the tier default.
- **Description tooltip** (native `title=` for now; tool descriptions exceed the HoverHint 5-word cap).
- `data-settings-anchor="tool:<name>"` so deep-links can pulse the right row.

#### Plugins

Card list: name + status badge (enabled / disabled / pending-permissions / pending-permissions-with-runner) + install path. Buttons: **Install from folder**, **Grant permissions**, **Enable** / **Disable**, **Uninstall** (in-place confirm). A "Plugin registry URL" field lets you point at a marketplace JSON; **Fetch registry** lists installable entries.

#### MCP

Card list of configured MCP servers. Per-card:

- Inline spinner during Enable / Disable / Add.
- **Tool / resource / prompt counts** — resources and prompts are clickable to expand an inline list of what each server exposes.
- Status pill + last-error friendly text.
- **Remove** (in-place confirm).
- **Curated presets** quick-add: filesystem, github, brave-search, sqlite.

#### Memory

Two backends bundled: **Obsidian** (filesystem-backed `.md` walker) and **Notion** (fetch-only API client, token stored in keychain). Per-backend: enable toggle, config inputs, **Test connection** + status pill. Memory tools surface in the same registry as builtins under `memory__obsidian__*` / `memory__notion__*`.

#### Updates

Current version + status pill (idle / checking / downloading / downloaded). **Auto-check** toggle (default on). **Check now** button. Updates wire through `electron-updater` against GitHub Releases — unsigned builds are still produced when signing creds are absent.

#### Telemetry

Opt-in **only**. PostHog + self-hosted Plausible style — events tracked are `app.launched`, `chat.message_sent` (provider+model hashed, no content), `agent.subagent_spawned`, `mcp.server_connected`. PII-free. API key + host inputs persist; **Saved** flash on save.

#### Crash reporting

Opt-in **only**. Sentry — DSN + environment select. `beforeSend` scrubs `event.request.url` of file paths and clears `event.user`.

#### Audit log

Every tool call OpenCodex executes is logged here: input, output, decision, timestamp, duration, error flag. **Filter chips** at top: tool name (multi-select), decision (auto / prompt-allowed / prompt-allowed-session / prompt-allowed-always / denied), trigger source (user / scheduled). **Click a row** to expand and see full input + output with per-pane Copy buttons. **Retention** select sets `auditRetentionDays`; **Clear log** is in-place confirm.

#### Indexing

Read-only chat-mode toggle (when on, the `ApprovalManager` denies any tool above the `read` tier — useful when you want a model that's strictly chatting _about_ code without touching it). Description of the `search_codebase` tool.

#### Skills

List of installed skills (user-level + project-level). Per-row:

- **Project badge** when the skill lives under `<workspace>/.opencodex/skills/`.
- **Enable / Disable** (writes a `.disabled` file in the skill dir so it survives reload).
- **Edit in editor** (opens the system editor via `shell.openPath`).
- **Schedule this skill** — prefills the Automations editor with the skill's body, cron, and allowed-tools.

Toolbar: **New skill from template**, **Import from URL** (consent prompt + write to disk; no execution), **Browse community skills** (expandable section pointing at a configurable registry URL).

#### Runners

The 15th section. Lists registered subagent runners: `internal` (built-in), plus any plugin-contributed runners. Per-row:

- Source badge (built-in / plugin displayName).
- **Install status** via the runner's `checkInstalled()` — green check or "Not installed → hint URL".
- **CLI path override** input — persists to `settings.runners.<id>.cliPath`. Useful when your CLI isn't on `PATH`.
- **Re-check** button.

#### Accessibility

- **Hover hints** toggle — global on/off. When off, all `<HoverHint>` wrappers stop firing (zero listeners attached). Toggle back on to restore.
- **Reduced motion** indicator — read-only display showing whether your OS preference is detected.

#### Help

This manual, rendered inside the app. Two-pane layout: filterable table of contents on the left, scrollable content on the right. Click any TOC entry to smooth-scroll to the section. The `?` link in the sidebar footer opens this panel from anywhere in the app; `/settings/help` is a stable deep-link.

#### Automations (deep-link redirect)

`/settings/scheduled-tasks` is a backwards-compat redirect to `/automations` preserving any `?prefillSkill=` query param. The actual UI lives in the top-level **Automations** view.

---

## Core concepts

### Providers and models

A **provider** is an adapter to one LLM API (OpenAI, Anthropic, Google, etc.). A **model** is one choice within a provider (`gpt-4o`, `claude-opus-4-7`, `gemini-2.0-flash`, etc.).

OpenCodex is provider-agnostic. The `LLMProvider` interface in `packages/core` is the contract every adapter implements. Capabilities (tool use, vision, streaming, context window, pricing, embeddings) are declared per model, and the UI gates features based on those declarations — e.g., the tools toggle disappears for non-tool models.

### Tools

Tools are the things the agent can do besides text generation. Built-in tools:

- **`read_file`** — read a file with offset/limit.
- **`write_file`** — atomic write via tmp + rename.
- **`edit_file`** — exact-string replacement with `replaceAll` flag.
- **`glob`** — file pattern matching.
- **`grep`** — regex search (ripgrep or JS fallback).
- **`list_dir`** — directory listing.
- **`run_shell`** — sandboxed shell exec with env scrub, cwd lock, timeout, output cap, process-tree kill on abort.
- **`web_fetch`** — HTTP GET / POST against an allow-list (`OPENCODEX_WEB_FETCH_ALLOWLIST`).
- **`search_codebase`** — RAG over your indexed workspace + connected MCP resources.

MCP servers add more tools dynamically, registered as `mcp__<serverId>__<toolName>`.

Plugins can add their own tools, registered as `plugin__<pluginId>__<toolName>`.

### Permission tiers and approval policy

Every tool is tagged with one of four **tiers**:

- **`read`** — file reads, search, list — default policy: **auto**.
- **`write`** — file writes, edits — default policy: **prompt**.
- **`execute`** — shell, anything that runs an external process — default policy: **prompt**.
- **`network`** — `web_fetch`, anything outbound — default policy: **prompt**.

The **policy** is one of `auto` (run silently), `prompt` (ask first), or `deny` (refuse). You can override per-tool in **Settings → Approvals**.

When a `prompt` tool fires, the **ApprovalQueue** modal opens with six buttons in a 2×3 grid:

- **Allow once** / **Deny once** — applies only to this call.
- **Allow session** / **Deny session** — applies for the remainder of this conversation.
- **Always allow** / **Always deny** — persists in Settings.

Keyboard `1`–`6` select the six buttons.

For `run_shell` specifically there's also an extra footer button: **Always allow this exact command** — useful when you keep running the same `pnpm test` or `git status` and don't want a generic "Always allow run_shell" (which is too broad).

The modal shows different previews per tool: write-file shows a diff, edit-file shows side-by-side replace, run_shell shows the boxed command + cwd + timeout, web_fetch shows method + URL + hostname + headers.

### Worktrees

When the agent (or scheduler) spawns a subtask in a git workspace with **Use worktree** on, OpenCodex creates a git worktree at `<repo>/.opencodex/worktrees/<run-id>` on branch `opencodex/subagent/<run-id>`. The subagent runs there. All writes go to the worktree, isolated from your main branch.

When the run completes, the **MergeReviewModal** lets you accept (runs `git merge --no-ff <branch>` then removes the worktree) or reject (just removes the worktree).

External runners (Claude Code, OpenCode, Aider) **always** require a git workspace + worktree — they can't run on non-git folders, by design, so their changes are always reviewable before merge.

### Runners

A **runner** is the harness that drives a subagent. There are four:

- **`internal`** — OpenCodex's built-in agent loop. Streams text, runs tools, respects approvals, default.
- **`claude-code`** — wraps the `claude` CLI in stream-json mode. Approvals inside the harness are Claude Code's, not OpenCodex's.
- **`opencode`** — wraps the `opencode` CLI with NDJSON parsing + a fallback text mode.
- **`aider`** — wraps `aider --yes`. Non-streaming.

Each external runner has a `checkInstalled()` that probes `<cli> --version` and reports either OK or a hint URL.

Pick the runner per task (in the spawn modal or scheduled-task editor) or per skill (via the optional `runner:` frontmatter field).

### Skills

A **skill** is a markdown file with YAML frontmatter that acts as a reusable, parameterized prompt. Example:

```markdown
---
name: daily-standup
description: Summarize git activity since yesterday
triggers: ['standup', 'daily']
tools: ['run_shell', 'grep']
arguments:
  - { name: since, description: 'time range', required: false }
cron: '0 9 * * *'
runner: internal
---

Summarize commits and PRs since {{since}} in {{workspace}}.
Active branch: {{git_branch}}.
```

- Lives at `~/.opencodex/skills/<name>/SKILL.md` (user-level) or `<workspace>/.opencodex/skills/<name>/SKILL.md` (project-level).
- Surfaced as `/skill:<name>` in the chat slash menu.
- If `cron:` is present, the system auto-creates a scheduled task pointing at this skill — a single source of truth for "a skill that also runs on a schedule".
- `{{workspace}}`, `{{date}}`, `{{git_branch}}` are built-in vars; `{{arg-name}}` placeholders substitute from invocation args.
- If `tools:` is present, the agent runs with **only those tools** for that turn (the global tool registry isn't mutated).

OpenCodex ships three starter skills (`daily-standup`, `security-audit`, `dependency-check`) and copies them into `~/.opencodex/skills/` on first run.

### MCP (Model Context Protocol)

MCP is a standard wire format for connecting LLM hosts to external tools and data. OpenCodex speaks MCP natively:

- **Tools** from an MCP server are registered as `mcp__<serverId>__<toolName>` in the same tool registry as built-ins.
- **Resources** are indexed for `search_codebase` alongside your workspace files.
- **Prompts** appear as `/server:prompt` in the slash menu.
- Transports supported: **stdio** (child process), **SSE**, **HTTP streamable**.

Configure in **Settings → MCP**. Curated presets quick-add filesystem / github / brave-search / sqlite servers. If a stdio server exits within 500ms of connect (i.e., the binary is broken), OpenCodex jumps straight to the long 30s backoff and emits a toast so you can fix the config without an infinite reconnect loop.

### Memory

Long-term memory backends — currently Obsidian and Notion. Configured in **Settings → Memory**. When enabled, memory tools surface as `memory__obsidian__*` / `memory__notion__*` in the tool registry (search / read / append / create-note variants per backend). Approvals apply.

### Plugins

Plugins extend OpenCodex without forking it. A plugin manifest declares:

- **Tools** it contributes.
- **Providers** it contributes (e.g., a new LLM).
- **Runners** it contributes (e.g., a new agent harness).
- **UI panels** it embeds (sandboxed iframes with a postMessage bridge).
- **Slash commands** it registers.
- **Permissions** it requests (e.g., `settings.read`, `settings.write`, `agent.runner`).

Install from a local directory in **Settings → Plugins**, then **Grant permissions**. Plugins run in the host process; permission grants gate the SDK host calls they make.

### Telemetry and crash reporting

Both opt-in, both off by default. Telemetry events are anonymized (provider+model hashed); message content is never included. Crash reports scrub URLs of file paths and clear user identifiers before send. You can configure your own PostHog instance or DSN in their respective settings panels.

---

## Common workflows

### "Explain this repo to me"

1. Open a new chat.
2. Click the **Explain this repo** starter chip — composer fills with a prompt.
3. Send. The model uses `search_codebase` (RAG) and `list_dir` to ground its answer.

### "Refactor this file"

1. In **Codebase**, navigate to the file. Right-click → **Ask agent about this file**.
2. Chat opens seeded with a `Re: <path>` system message.
3. Type your refactor request and send.
4. The agent will likely call `read_file` (auto-allow on read tier), then `edit_file` or `write_file` (prompts for approval — review the diff in the modal). Accept once or for the session.

### "Do this in parallel with a worktree"

1. Open **Agent**, click **Spawn task**.
2. Task: "Add dark-mode toggle to the Settings page. Tests included."
3. **Use worktree**: on. Submit.
4. Run streams in the right pane. When complete, click **Review changes**.
5. Per-file diff. Accept hunks (`a`) or whole files. Reject if you don't want it.

### "Run a nightly dependency check"

1. Open **Automations**. Click the **Daily standup** template — adjusts to your needs by editing.
2. Or click **New automation**, set trigger=Cron, preset=Daily 9am.
3. Prompt: "Check `package.json` for outdated dependencies and known CVEs via web_fetch. Group by severity."
4. Allowed tools: `read_file`, `web_fetch`.
5. **Use worktree** off (read-only task — nothing to merge).
6. Save. Next-run countdown appears in the left context pane.

### "Use Claude Code as the runner"

1. Install `claude` CLI on your machine.
2. **Settings → Runners → Claude Code** — verify the install status is OK (or set a CLI path override).
3. In any spawn modal or scheduled task, pick **Claude Code** in the Runner dropdown.
4. Submit. The run executes inside the worktree using Claude Code's harness, but lands back in OpenCodex's merge-review flow for accept/reject.

### "Connect a custom MCP server"

1. **Settings → MCP → Add server**.
2. Pick transport (stdio / SSE / HTTP).
3. For stdio: enter the command + args.
4. Save. The server appears in the list with a spinner; once connected, its tools / resources / prompts populate.
5. Click the **tools count** number to inspect what just got added to your tool registry.

### "Author and share a skill"

1. **Settings → Skills → New skill from template**.
2. Edit the generated `SKILL.md` (the button opens it in your system editor).
3. Save and reload — the skill appears under `/skill:<name>` in the chat composer.
4. To share: zip the skill dir, or publish to a registry URL and have others **Browse community skills**.

---

## Keyboard shortcuts

### Global

| Shortcut     | Action                                  |
| ------------ | --------------------------------------- |
| `Cmd/Ctrl+1` | Go to Chat                              |
| `Cmd/Ctrl+2` | Go to Agent                             |
| `Cmd/Ctrl+3` | Go to Codebase                          |
| `Cmd/Ctrl+4` | Go to Automations                       |
| `Cmd/Ctrl+5` | Go to Settings                          |
| `Cmd/Ctrl+,` | Open Settings                           |
| `Cmd/Ctrl+\` | Toggle left context pane                |
| `Cmd/Ctrl+B` | Toggle left context pane (legacy alias) |
| `Esc`        | Dismiss most recent toast               |

### Chat composer

| Shortcut                    | Action                    |
| --------------------------- | ------------------------- |
| `Enter`                     | Send                      |
| `Shift+Enter`               | Newline                   |
| `Esc`                       | Cancel streaming response |
| `Up arrow` (empty composer) | Recall last user message  |
| `Cmd/Ctrl+K`                | Open slash menu           |

### Slash menu

| Shortcut                | Action      |
| ----------------------- | ----------- |
| `ArrowUp` / `ArrowDown` | Cycle items |
| `Enter` / `Tab`         | Insert      |
| `Esc`                   | Close       |

### Modals (spawn / scheduled-task editor / merge-review)

| Shortcut         | Action        |
| ---------------- | ------------- |
| `Cmd/Ctrl+Enter` | Submit / Save |
| `Esc`            | Close         |

### Approval queue

| Shortcut | Action        |
| -------- | ------------- |
| `1`      | Allow once    |
| `2`      | Deny once     |
| `3`      | Allow session |
| `4`      | Deny session  |
| `5`      | Always allow  |
| `6`      | Always deny   |

### File tree

| Shortcut                            | Action                     |
| ----------------------------------- | -------------------------- |
| `ArrowUp` / `ArrowDown` / `j` / `k` | Move selection             |
| `ArrowRight`                        | Expand                     |
| `ArrowLeft`                         | Collapse or jump to parent |
| `Enter` / `Space`                   | Open in preview            |

### Codebase search

| Shortcut     | Action               |
| ------------ | -------------------- |
| `Cmd/Ctrl+F` | Refocus search input |

### Monaco diff (merge-review modal)

| Shortcut  | Action               |
| --------- | -------------------- |
| `j` / `k` | Next / previous hunk |
| `a`       | Accept current hunk  |
| `r`       | Reject current hunk  |

### Agent run drawer

| Shortcut  | Action                     |
| --------- | -------------------------- |
| `j` / `k` | Next / previous tool block |

### Settings rail

| Shortcut          | Action               |
| ----------------- | -------------------- |
| `Cmd/Ctrl+F`      | Focus section search |
| `Esc` (in search) | Clear search         |

---

## Troubleshooting

### "API key rejected" during onboarding

The actual provider error message renders inline in the wizard. Common causes:

- **OpenAI 401**: key is valid but lacks access to the chat completions endpoint. Verify in your OpenAI account.
- **Anthropic 403**: key may be billing-limited. Check usage and credit balance.
- **Google 400**: project hasn't enabled the Generative Language API. Enable in Google Cloud Console.
- **Ollama connection refused**: the Ollama daemon isn't running. Run `ollama serve` in a terminal.

Click **Try a different provider** to skip the failing one.

### "Tool failed: ENOENT"

You shouldn't see raw `ENOENT` anymore — every IPC handler routes through `friendlyErrorMessage` which maps it to "The file or folder doesn't exist." If you see a raw errno, it's a regression — please report.

### "Database is locked"

The audit-log and scheduled-task tables both wrap critical writes in `withSqliteBusyRetry` (50ms then 250ms). If the lock persists beyond 300ms, the operation fails with a friendly toast. Quitting and reopening the app usually clears the lock.

### "External runner: not installed"

The runner's CLI isn't on `PATH`. Two options:

1. Install it. Each runner's docs URL is shown in the install-status hint.
2. Set a CLI path override in **Settings → Runners → <runner> → CLI path**.

### "External runners require a git workspace"

External runners (Claude Code, OpenCode, Aider) only run inside git worktrees by design — so their writes are always reviewable. Either `git init` your workspace, or use the internal runner.

### Cron task isn't firing

- Check **Settings → Automations** that the task is **Enabled**.
- For dev builds, scheduler is gated by `app.isPackaged === true` OR `schedulerEnabledInDev`. In packaged builds, it's always on.
- Open the **History** drawer for the task — if it last fired but produced an error, you'll see the friendly message.
- For file-change triggers, verify the glob pattern with a quick `glob` tool call in chat.

### Webhook trigger returns 401

The HMAC signature didn't match. Check:

- **`X-Opencodex-Signature`** header is present.
- The signature is `sha256=<hex>` over the **raw request body** (not parsed JSON).
- The secret in your remote system matches the one in **Settings → Automations → <task> → Webhook secret**.

The local listener rate-limits to 1 req/sec/task; bursts above that return 429.

### MCP server stuck in "reconnecting"

If the child exited within 500ms of start, OpenCodex jumps to the 30s long-backoff and emits a toast — so you'll see the error rather than an invisible spin loop. Check the toast message and fix the server config.

### Updates panel says "Update failed to download"

Common causes: GitHub rate-limit, no network, signature verification failed (release wasn't signed). Auto-check loop continues every 4h. **Check now** retries immediately.

### "I can't find the toast that just disappeared"

Toasts default to 4500ms. Errors are sticky by default — they don't auto-dismiss. If you missed one, the underlying event is also in the **Audit log** for tool calls, or in the run history for run completions.

---

## Privacy and data

### What stays local

- **Your code** — never uploaded except to the LLM provider you configured.
- **Your API keys** — OS keychain only (`keytar`).
- **Your settings** — `electron-store` JSON file in the platform's user-data directory.
- **Your audit log** — SQLite database in the user-data directory. Retention configurable in **Settings → Audit log**.
- **Your conversations** — SQLite, same database.
- **Your vector index** — local SQLite-backed shim (LanceDB swap is one-class change when the native binary is available).
- **MCP server configs** — local. Their data flows depend on the server itself.

### What goes outbound

- **LLM API calls** — to the provider you configured, with the messages you send. Nothing else.
- **Embeddings** — same provider, same path, only when you trigger indexing.
- **Web fetch** — only domains on `OPENCODEX_WEB_FETCH_ALLOWLIST`. Denied by default.
- **Update checks** — to GitHub Releases (when `autoCheckForUpdates` is on).
- **Telemetry** — to PostHog / your self-hosted endpoint, only if **opt-in**. Anonymized; no message content.
- **Crash reports** — to Sentry / your DSN, only if **opt-in**. URLs scrubbed; no user identifiers.

### Read-only chat mode

**Settings → Indexing → Read-only chat mode** denies any tool above the `read` tier. Useful for chatting about a repo you don't want the model to modify — e.g., reviewing a colleague's branch.

---

## Getting help

- **Documentation**: this manual, plus topical guides in `website/pages/guides/` (architecture, MCP, plugins, runners, scheduled tasks, skills, accessibility).
- **Issue tracker**: see `README.md` for the GitHub link.
- **Logs**: every action goes through the structured `pino` logger in main process. Open Help → Show logs (or the platform's user-data directory) to see them.
- **Audit log**: every tool call OpenCodex executes is recorded — useful for reconstructing what happened in a previous session.

---

_This manual is versioned with the app. If you're reading it from a newer build, sections may have grown — search for what you need._
