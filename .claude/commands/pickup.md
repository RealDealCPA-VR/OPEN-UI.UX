Follow the Agent Handoff Protocol from CLAUDE.md — PICKUP phase:

1. Read `HANDOFF.md` — learn what the previous agent did and what's next
2. Read `Todo.md` — understand the full task list and what's checked off
3. If HANDOFF.md has a "Verify Before Continuing" section, run those checks NOW before writing any new code:
   - Confirm the last feature works (render check, logic check, no regressions)
   - Run `pnpm build` to verify the project compiles
   - If anything is broken, fix it before moving on
4. Review the "Context Notes" for patterns, gotchas, and specific references
5. Begin work on the "Next Task" section (or the next unchecked item in Todo.md)
