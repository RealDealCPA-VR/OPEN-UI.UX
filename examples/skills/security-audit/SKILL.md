---
name: security-audit
description: Sweep the workspace for hardcoded secrets, weak crypto primitives, and obvious injection holes.
triggers:
  - security audit
  - secret scan
  - hardcoded
tools:
  - grep
  - read_file
  - glob
arguments:
  - name: scope
    description: Optional glob to narrow the audit scope (e.g. "src/**/*.ts").
    required: false
---

You are running a focused security audit over `{{workspace}}` on {{date}}.

If the user provided `{{scope}}`, restrict every search to that glob. Otherwise
search the whole tracked workspace, but skip `node_modules`, `dist`, `out`,
`build`, `.next`, `.turbo`, and `coverage`.

Investigate these categories in order. For each finding, report the
**file:line**, a one-sentence risk summary, and a suggested remediation.

1. **Hardcoded secrets.** grep for `AKIA[0-9A-Z]{16}`, `sk-[A-Za-z0-9]{20,}`,
   `Bearer [A-Za-z0-9._-]{20,}`, `password\s*[:=]`, `api[_-]?key\s*[:=]`. Read
   any matching file to confirm context before flagging.

2. **Weak crypto.** grep for `md5\(`, `sha1\(`, `createCipher\(` (without
   `iv`), `Math.random` in security-sensitive contexts (`token`, `password`,
   `nonce`).

3. **Shell injection.** grep for `child_process.exec\(` taking a user-shaped
   variable, `eval\(`, `Function\(` with non-literal first argument.

4. **Path traversal.** grep for `path.join\(.+req\.` and similar patterns
   where user input lands in a filesystem path without normalization.

End with a prioritized **High / Medium / Low** triage list. If nothing is
found in a category, say so explicitly rather than omitting it.
