import { describe, expect, it } from 'vitest';
import { parseRegistryPayload } from './registry';

describe('parseRegistryPayload', () => {
  it('parses a flat array of entries', () => {
    const res = parseRegistryPayload([
      {
        name: 'daily-standup',
        description: "Summarize yesterday's git activity",
        sourceUrl: 'https://example.com/skills/daily-standup/SKILL.md',
      },
    ]);
    expect(res.error).toBeNull();
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0]?.name).toBe('daily-standup');
  });

  it('parses an envelope { entries: [...] }', () => {
    const res = parseRegistryPayload({
      entries: [
        {
          name: 'security-audit',
          description: 'Scan for secrets',
          sourceUrl: 'https://example.com/security-audit/SKILL.md',
          author: 'jane',
          version: '1.0.0',
        },
      ],
    });
    expect(res.error).toBeNull();
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0]?.author).toBe('jane');
    expect(res.entries[0]?.version).toBe('1.0.0');
  });

  it('rejects entries with invalid kebab-case names', () => {
    const res = parseRegistryPayload([
      {
        name: 'BadName',
        description: 'x',
        sourceUrl: 'https://example.com/x.md',
      },
    ]);
    expect(res.error).not.toBeNull();
    expect(res.entries).toHaveLength(0);
  });

  it('rejects entries with missing description', () => {
    const res = parseRegistryPayload([
      {
        name: 'x',
        sourceUrl: 'https://example.com/x.md',
      },
    ]);
    expect(res.error).not.toBeNull();
  });

  it('rejects entries with non-URL sourceUrl', () => {
    const res = parseRegistryPayload([
      {
        name: 'x',
        description: 'y',
        sourceUrl: 'not-a-url',
      },
    ]);
    expect(res.error).not.toBeNull();
  });

  it('rejects non-array non-envelope payloads', () => {
    expect(parseRegistryPayload({ random: 'shape' }).error).not.toBeNull();
    expect(parseRegistryPayload('hello').error).not.toBeNull();
    expect(parseRegistryPayload(42).error).not.toBeNull();
  });

  it('accepts empty array as a valid (empty) registry', () => {
    const res = parseRegistryPayload([]);
    expect(res.error).toBeNull();
    expect(res.entries).toEqual([]);
  });
});
