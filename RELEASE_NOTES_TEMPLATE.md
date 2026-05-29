# OpenCodex vX.Y.Z

> Copy this template into a GitHub Release when announcing a new version.
> Delete sections that aren't applicable.

## What's new

- Headline feature or improvement.
- Second headline feature.
- Third headline feature.

## Notable changes

- Behavior or default that changed since the previous release.
- New configuration knob users may want to know about.

## Bug fixes

- Short description (#issue-number).
- Short description (#issue-number).

## Migration notes

If users need to do anything on upgrade (re-grant a permission, reindex a workspace, regenerate a config), spell it out here. Otherwise delete this section.

## Known issues

- Open bugs deferred to the next release (link to issue tracker).

## Checksums

Replace this block with the SHA-256 of each artifact attached to the release. Generate with:

```sh
shasum -a 256 release/*
```

```
<sha256>  OpenCodex-X.Y.Z-x64.dmg
<sha256>  OpenCodex-X.Y.Z-arm64.dmg
<sha256>  OpenCodex-Setup-X.Y.Z.exe
<sha256>  OpenCodex-X.Y.Z-x64.AppImage
<sha256>  OpenCodex-X.Y.Z-x64.deb
<sha256>  OpenCodex-X.Y.Z-x64.rpm
```

## Contributors

Thanks to everyone who shipped this release:

- @handle — area of work
- @handle — area of work

---

## Unreleased — Unified left column + Automations + Hover hints + Pluggable runners

> Working notes for the next release. Move into the template above when cutting the tag.

### What's new

- **Unified left column.** The nav rail and the context pane now share a single left-edge surface, replacing the prior split between Settings sub-nav and per-view sidebars. Switch between Chat, Files, Agent, Automations, Plugins, and Settings from the rail; the context pane to its right shows whatever is relevant to the current view (conversation list, file tree, scheduled-task list, etc.).
- **Automations is a top-level nav item.** Scheduled Tasks have been promoted out of Settings into their own destination, reachable from the new nav rail. Old deep links to `Settings → Scheduled Tasks` redirect.
- **Hover hints.** Short tooltips (five words or fewer) now appear when you hover or focus icon-only controls in the chrome. Toggle at Settings → Accessibility → Show hover hints. Underlying `aria-label`s are unaffected, so screen readers still announce every control with the toggle off.
- **Pluggable agent runners.** New `SubagentRunner` interface in `@opencodex/core` plus three first-party adapters: Claude Code (`@opencodex/runner-claude-code`), OpenCode (`@opencodex/runner-opencode`), and Aider (`@opencodex/runner-aider`). Plugins can register their own runner via `host.registerRunner(...)` gated by the new `agent.runner` permission. Scheduled tasks gain a `runnerId` field; skills gain an optional `runner:` frontmatter field that applies to the auto-registered cron task.

### Notable changes

- The left sidebar's previous layout is recoverable by collapsing the context pane (Settings → Appearance → Collapse context pane, or drag the divider all the way left). Deep links from previous sessions continue to resolve.
- External-runner tasks (Claude Code / OpenCode / Aider / plugin) **always** run inside a per-task git worktree. There is no fallback to writing directly into a non-git workspace — external-runner runs in a non-git workspace fail with `stopReason: 'runner_error'`. The internal runner is unchanged.
- **Approval-model caveat for external runners.** Out-of-process tool calls bypass OpenCodex's per-call approval modals — the spawned CLI's own approval system is authoritative. The audit log records the run start, the run end, and the resulting diff, not the individual tool calls. Keep using the `internal` runner if you need strict per-call approval.
- Scheduled task `allowedTools` is **advisory** for external runners; enforcement is the CLI's responsibility.

### How to recover the prior workflow

- Collapse the context pane (drag divider left or Settings → Appearance → Collapse context pane).
- Bookmark `Automations` from the new nav rail if you used `Settings → Scheduled Tasks` frequently.
- All previously-deep-linked URLs (including `opencodex://settings/scheduled-tasks`) still resolve via redirect.
- Hover hints can be turned off at Settings → Accessibility → Show hover hints.

### Migration notes

- No data migration required. Existing scheduled tasks default to `runnerId: 'internal'` and keep their behavior. Add a `runner:` field to a SKILL.md or pick a runner in the Automations editor to opt in.
- To use an external runner: enable the runner package from the Plugins panel, grant the `agent.runner` permission when prompted, install the underlying CLI (`claude` / `opencode` / `aider`), and (optionally) set a `cliPath` override at Settings → Runners.

---

OpenCodex is MIT-licensed. Full documentation: <https://TODO-set-domain> (the maintainer must replace this with the real docs URL before tagging; tracked in [PLACEHOLDERS.md](./PLACEHOLDERS.md)).
