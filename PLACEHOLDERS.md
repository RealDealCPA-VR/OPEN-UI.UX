# Pre-tag Placeholders

Replace the literal placeholder strings below with real values before tagging v0.1. Lane D ships a `pnpm check-placeholders` script that fails CI if any of these are still present.

Each row links a `file:line` to the literal token the maintainer must replace. The `TBD` column is the maintainer's responsibility to fill before public release.

## `CODEOWNERS`

- [ ] `CODEOWNERS:10` — current: `@TODO-set-github-handle` → replace with: `<TBD GitHub handle / team>`
- [ ] `CODEOWNERS:13` — current: `@TODO-set-github-handle` → replace with: `<TBD GitHub handle / team>`
- [ ] `CODEOWNERS:14` — current: `@TODO-set-github-handle` → replace with: `<TBD GitHub handle / team>`
- [ ] `CODEOWNERS:17` — current: `@TODO-set-github-handle` → replace with: `<TBD GitHub handle / team>`
- [ ] `CODEOWNERS:18` — current: `@TODO-set-github-handle` → replace with: `<TBD GitHub handle / team>`
- [ ] `CODEOWNERS:19` — current: `@TODO-set-github-handle` → replace with: `<TBD GitHub handle / team>`
- [ ] `CODEOWNERS:20` — current: `@TODO-set-github-handle` → replace with: `<TBD GitHub handle / team>`

## `SECURITY.md`

- [ ] `SECURITY.md:12` — current: `security@TODO-set-domain` → replace with: `<TBD security contact email>`

## `.github/ISSUE_TEMPLATE/config.yml`

- [ ] `.github/ISSUE_TEMPLATE/config.yml:4` — current: `https://github.com/TODO-org/TODO-repo/security/advisories/new` → replace with: `<TBD org/repo>`
- [ ] `.github/ISSUE_TEMPLATE/config.yml:7` — current: `https://github.com/TODO-org/TODO-repo/discussions` → replace with: `<TBD org/repo>`

## `website/theme.config.tsx`

- [ ] `website/theme.config.tsx:8` — current: `https://github.com/TODO-org/TODO-repo` → replace with: `<TBD org/repo>`
- [ ] `website/theme.config.tsx:10` — current: `https://github.com/TODO-org/TODO-repo/blob/main/website` → replace with: `<TBD org/repo>` (must remain `/blob/<branch>/website` shape so Nextra's "Edit on GitHub" links resolve to actual file URLs)

## `website/pages/guides/accessibility.mdx`

- [ ] `website/pages/guides/accessibility.mdx:44` — current: `github.com/TODO-org/TODO-repo/issues/new?template=accessibility.yml` → replace with: `<TBD org/repo>`

## `website/pages/guides/architecture.mdx`

- [ ] `website/pages/guides/architecture.mdx:6` — current: `https://github.com/TODO-org/TODO-repo/blob/main/docs/architecture.md` → replace with: `<TBD org/repo>`

## `website/pages/guides/mcp.mdx`

- [ ] `website/pages/guides/mcp.mdx:6` — current: `https://github.com/TODO-org/TODO-repo/blob/main/docs/mcp-integration.md` → replace with: `<TBD org/repo>`

## `website/pages/guides/security.mdx`

- [ ] `website/pages/guides/security.mdx:6` — current: `https://github.com/TODO-org/TODO-repo/blob/main/docs/security-model.md` → replace with: `<TBD org/repo>`

## `website/pages/plugins/api.mdx`

- [ ] `website/pages/plugins/api.mdx:6` — current: `https://github.com/TODO-org/TODO-repo/tree/main/packages/plugin-sdk/src` → replace with: `<TBD org/repo>`

## `website/pages/plugins/authoring.mdx`

- [ ] `website/pages/plugins/authoring.mdx:6` — current: `https://github.com/TODO-org/TODO-repo/blob/main/docs/plugin-authoring.md` → replace with: `<TBD org/repo>`

## `website/pages/providers/authoring.mdx`

- [ ] `website/pages/providers/authoring.mdx:6` — current: `https://github.com/TODO-org/TODO-repo/blob/main/docs/provider-authoring.md` → replace with: `<TBD org/repo>`

## `website/pages/index.mdx`

- [ ] `website/pages/index.mdx:46` — current: `https://github.com/TODO-org/TODO-repo` → replace with: `<TBD org/repo>` (line moved from 30 after the Mission Control positioning rewrite added a hero image, blockquote, and the "Provider-agnostic as a feature, not a footnote" section above the License line)

## `RELEASE_NOTES_TEMPLATE.md`

- [ ] `RELEASE_NOTES_TEMPLATE.md:88` — current: `https://TODO-set-domain` → replace with: `<TBD canonical docs URL>` (the prior `https://opencodex.dev` literal was speculative and has been replaced with the standard `TODO-set-domain` sentinel so `pnpm check-placeholders` catches it).

## `website/public/hero-subagent-tree.svg`

- [ ] `website/public/hero-subagent-tree.svg` — current: hand-drawn SVG mock with watermark "Placeholder — TODO: replace with a real screenshot…" → replace with: a real PNG/WebP screenshot of the AgentRunDrawer subagent tree view (`apps/desktop/src/renderer/components/AgentRunDrawer.tsx`) at ~1280×720, dark theme, showing a root run that fanned out into 3–4 worker subagents in their own worktrees with at least one in each status (running / awaiting merge / approval pending). The README, MANUAL "Mission Control" section, and `website/pages/index.mdx` all reference this asset as the hero — keep the filename stable so the references don't break, or update all three callers.
