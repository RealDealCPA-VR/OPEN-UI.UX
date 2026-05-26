# OpenCodex Docs Site

Nextra-powered documentation site for OpenCodex. Deployed to GitHub Pages via [`.github/workflows/docs.yml`](../.github/workflows/docs.yml).

## Local development

This package is intentionally **not part of the root pnpm workspace** — `pnpm install` at the repo root does not pull in 500MB of Next deps. Install separately:

```sh
cd website
pnpm install         # or npm install / yarn install
pnpm dev             # http://localhost:3000
```

## Build

```sh
cd website
pnpm install
pnpm build           # emits static site to website/out
```

## Page layout

```
website/
  pages/
    index.mdx            # landing
    _meta.json           # top-level nav order
    guides/
      _meta.json
      architecture.mdx   # mirrors docs/architecture.md
      security.mdx       # mirrors docs/security-model.md
      mcp.mdx            # mirrors docs/mcp-integration.md
    plugins/
      _meta.json
      authoring.mdx      # mirrors docs/plugin-authoring.md
      api.mdx            # SDK API reference (generated from @opencodex/plugin-sdk)
    providers/
      _meta.json
      authoring.mdx      # mirrors docs/provider-authoring.md
```

Each MDX page is intentionally a thin mirror of the source-of-truth markdown in `docs/`. Keep them in sync — if you change one, change the other.

## Why not in pnpm workspace?

Nextra pulls in the entire Next.js + React tree. We don't want every contributor to pay that install cost. The docs site only matters at release time and for documentation contributors.

If you want to add it to the workspace later, append `'website'` to `pnpm-workspace.yaml`.
