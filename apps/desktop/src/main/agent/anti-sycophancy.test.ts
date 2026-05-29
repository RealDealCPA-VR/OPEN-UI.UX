import { describe, expect, it } from 'vitest';
import { ANTI_SYCOPHANCY_CLAUSE, appendAntiSycophancyClause } from './anti-sycophancy';

describe('ANTI_SYCOPHANCY_CLAUSE', () => {
  it('contains the three required directives from Todo.md', () => {
    expect(ANTI_SYCOPHANCY_CLAUSE).toMatch(/premise is wrong/i);
    expect(ANTI_SYCOPHANCY_CLAUSE).toMatch(/disagree/i);
    expect(ANTI_SYCOPHANCY_CLAUSE).toMatch(/validated/i);
  });
});

describe('appendAntiSycophancyClause', () => {
  it('appends the clause when enabled', () => {
    const out = appendAntiSycophancyClause('You are a helpful agent.', true);
    expect(out).toContain('You are a helpful agent.');
    expect(out).toContain(ANTI_SYCOPHANCY_CLAUSE);
    expect(out.endsWith(ANTI_SYCOPHANCY_CLAUSE)).toBe(true);
  });

  it('separates with blank line for markdown readability', () => {
    const out = appendAntiSycophancyClause('Base prompt.', true);
    expect(out).toBe(`Base prompt.\n\n${ANTI_SYCOPHANCY_CLAUSE}`);
  });

  it('returns the original prompt verbatim when disabled', () => {
    const base = 'You are an orchestrator.';
    expect(appendAntiSycophancyClause(base, false)).toBe(base);
  });

  it('trims trailing whitespace before appending', () => {
    const out = appendAntiSycophancyClause('Base prompt.\n\n  ', true);
    expect(out).toBe(`Base prompt.\n\n${ANTI_SYCOPHANCY_CLAUSE}`);
  });

  it('returns only the clause when base prompt is empty', () => {
    expect(appendAntiSycophancyClause('', true)).toBe(ANTI_SYCOPHANCY_CLAUSE);
    expect(appendAntiSycophancyClause('   \n  ', true)).toBe(ANTI_SYCOPHANCY_CLAUSE);
  });
});
