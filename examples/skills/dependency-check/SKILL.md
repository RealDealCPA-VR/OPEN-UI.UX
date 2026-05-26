---
name: dependency-check
description: Review package.json dependencies for outdated versions and look up known CVEs against the GitHub Advisory Database.
triggers:
  - dependency check
  - outdated deps
  - cve
  - vulnerabilities
tools:
  - read_file
  - glob
  - web_fetch
arguments:
  - name: scope
    description: Optional path-prefix to narrow which package.json files are scanned (default the whole workspace).
    required: false
---

You are reviewing dependencies in `{{workspace}}` on {{date}}.

1. Use `glob` to enumerate every `package.json` under the workspace
   (skip `node_modules/**`). If `{{scope}}` is set and isn't the literal
   placeholder, prefix the glob with it.

2. For each package.json, `read_file` it and pull out `dependencies` +
   `devDependencies`. Group them by direct vs. dev. De-duplicate when the
   same package appears across multiple workspaces.

3. For the 10 most-used non-dev dependencies, fetch the GitHub Advisory
   Database via `web_fetch` (allowlist permitting) to look up known CVEs.
   Endpoint:

   ```
   https://api.github.com/advisories?ecosystem=npm&affects=<package>
   ```

   If `web_fetch` is denied or hits the allowlist, fall back to reporting
   the version inventory only — do not invent advisory data.

4. Output a markdown table: `package | version | CVE count | most-severe |
recommendation`. Recommendation is one of `pin`, `upgrade major`,
   `upgrade minor`, or `OK`.

Wrap up with three concrete next-step bullets the maintainer should take
this week.
