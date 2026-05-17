Follow the Agent Handoff Protocol from CLAUDE.md — HANDOFF phase:

1. **Update Todo.md** — check off `[x]` every task you fully completed. Only mark complete if the feature is actually working. Leave partially-done tasks unchecked.

2. **Update HANDOFF.md** — replace the entire file with a fresh handoff using these exact sections:

```
# Handoff State

## Last Session Summary
- <What was accomplished — 2-3 bullet points>

## Verify Before Continuing
- [ ] Check 1: <describe what to verify and how>
- [ ] Check 2: <describe what to verify and how>

## Next Task
<The exact Todo.md item(s) to work on next, copied verbatim>

## Context Notes
<Any gotchas, patterns, or decisions the next agent needs to know>
<Reference specific line numbers or function names if helpful>
```

3. **Verify the build** — run `pnpm build` to confirm everything compiles.

4. **Tell the user**: "Handoff ready. Start a new session and say: `/pickup`"
