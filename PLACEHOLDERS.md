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

- [ ] `website/theme.config.tsx:7` — current: `https://github.com/TODO-org/TODO-repo` → replace with: `<TBD org/repo>`
- [ ] `website/theme.config.tsx:9` — current: `https://github.com/TODO-org/TODO-repo/tree/main/website` → replace with: `<TBD org/repo>`

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

- [ ] `website/pages/index.mdx:30` — current: `https://github.com/TODO-org/TODO-repo` → replace with: `<TBD org/repo>`

## Also worth a look

`RELEASE_NOTES_TEMPLATE.md:88` references `https://opencodex.dev` as the canonical documentation URL. If that domain is not yours (or is not registered yet), list it here and decide on a real docs URL before tagging v0.1.
