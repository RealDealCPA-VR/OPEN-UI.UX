# Website upgrade notes

Notes for future Nextra / docs-stack migrations. Not user-facing — kept here so the next maintainer doesn't have to re-derive what already broke.

## Nextra 2 → 3 (deferred)

The site currently runs on `nextra@^2.13` + `nextra-theme-docs@^2.13` with Next.js 14. Migrating to Nextra 3 is **out of scope** for the audit work — it's a multi-file API surface change that wants its own PR.

The big-ticket breakage to plan for:

- **`useNextSeoProps` is removed in Nextra 3.** Today `theme.config.tsx` uses `useNextSeoProps()` to drive `titleTemplate` and the default page description. In Nextra 3 this is replaced by the `head` field (or by overriding the per-page frontmatter). Plan: when migrating, port the current `useNextSeoProps()` body into `head({title, meta})` and verify the landing page no longer duplicates "opencodex-docs" in the title.
- **`docsRepositoryBase` shape.** Nextra 3 changed how the GitHub "Edit on GitHub" link composes file URLs. Re-test that the link resolves to `/blob/<branch>/website/pages/<file>.mdx` after the migration; the current `tree/main/website` → `blob/main/website` fix was specifically for the Nextra-2 behavior.
- **Next.js minimum version.** Nextra 3 requires Next.js 15+, which requires Node 20.18+ — confirm CI runners and contributors are on a compatible Node before flipping the dep.
- **Theme config types.** `DocsThemeConfig` lost several fields between v2 and v3. A clean migration is `pnpm add nextra@latest nextra-theme-docs@latest next@latest`, then `pnpm tsc -p website` and fix the typed config until it compiles.

When the migration lands, delete this file or replace it with the Nextra-3-specific notes the next migration will need.
