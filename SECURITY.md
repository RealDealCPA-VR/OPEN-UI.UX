# Security Policy

OpenCodex is a local-first coding agent that executes tools, runs shell commands, and edits source files on your machine. We take vulnerability reports seriously.

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report privately via either:

- GitHub's [Private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) (preferred — go to the repo's Security tab → Report a vulnerability).
- Email: `security@TODO-set-domain` (replace with project contact before publishing).

Please include:

- A description of the issue and its impact
- Steps to reproduce, or a minimal proof of concept
- Affected version(s) — commit SHA or release tag
- Your name and contact info if you'd like credit

We will acknowledge your report within **72 hours** and aim to provide an initial assessment within **7 days**.

## Disclosure process

1. You report the issue privately.
2. We confirm the vulnerability and determine affected versions.
3. We develop and test a fix in a private branch.
4. We coordinate a release date with you (typically within 30 days for high-severity issues, sooner for actively exploited ones).
5. We publish the fix, issue a security advisory, and credit you (unless you prefer to remain anonymous).

## Scope

In scope:

- The OpenCodex desktop application (`apps/desktop`)
- Core packages (`packages/core`, `packages/providers`, `packages/tools`, `packages/plugin-sdk`, `packages/mcp-client`)
- The plugin sandbox and permission model
- The tool approval system
- Secure key storage integration (keychain via `keytar`)

Out of scope:

- Third-party plugins (report to the plugin's own maintainers)
- Third-party MCP servers (report to the MCP server's maintainers)
- Vulnerabilities in upstream dependencies that are already publicly disclosed — we track those via `pnpm audit` and Dependabot

## Supported versions

Pre-v0.1: only the `main` branch is supported. Once v0.1 ships, this section will list the supported release lines.

## Hardening guidance

OpenCodex executes code suggested by an LLM. Recommended defaults:

- Keep tool approvals on **prompt** mode for `write`, `execute`, and `network` tiers unless you're in a trusted, sandboxed workspace.
- Review the per-tool audit log (`Settings → Audit`) periodically.
- Install plugins only from authors you trust. Review the requested permissions on install.
- Run untrusted workspaces inside an OS-level sandbox or VM until you've reviewed the agent's planned actions.
