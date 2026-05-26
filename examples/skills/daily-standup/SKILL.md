---
name: daily-standup
description: Summarize recent git activity in this workspace and group the work into a daily-standup style report.
triggers:
  - standup
  - daily summary
  - yesterday
tools:
  - run_shell
arguments:
  - name: since
    description: A date or git revspec to bound the activity window (default "yesterday").
    required: false
---

You are producing a daily-standup summary for `{{workspace}}` on {{date}}
(current branch: `{{git_branch}}`).

1. Run this shell command to collect recent commits and changed files:

   ```
   git log --since={{since}} --pretty=format:'%h %an %ad %s' --date=short --name-status
   ```

   If `{{since}}` was left as the literal placeholder, fall back to
   `git log --since=yesterday ...`.

2. Group the work into three sections — **Shipped**, **In progress**, and **Blockers**.
   Reason about which commits represent shipped work vs. WIP based on commit
   messages, presence of `WIP:` / `fixup!` prefixes, and reverts.

3. Render the report as concise markdown that a person could paste into a
   stand-up channel. Keep it under 20 lines unless the activity is unusually
   busy.

When you're done, end with a one-line summary of what you produced.
