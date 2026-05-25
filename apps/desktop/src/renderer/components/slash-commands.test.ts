import { describe, expect, it } from 'vitest';
import type { McpPromptEntry } from '../../shared/mcp';
import {
  applyInsert,
  filterPrompts,
  formatPromptInsert,
  getSlashTrigger,
  groupByServer,
} from './slash-commands';

const entry = (
  serverId: string,
  name: string,
  opts: { description?: string; args?: Array<{ name: string; required?: boolean }> } = {},
): McpPromptEntry => ({
  serverId,
  serverDisplayName: serverId,
  prompt: {
    name,
    ...(opts.description !== undefined ? { description: opts.description } : {}),
    ...(opts.args !== undefined ? { arguments: opts.args } : {}),
  },
});

describe('getSlashTrigger', () => {
  it('detects a leading slash at start of input', () => {
    expect(getSlashTrigger('/', 1)).toEqual({ query: '', start: 0 });
  });

  it('captures the query after the slash', () => {
    expect(getSlashTrigger('/foo', 4)).toEqual({ query: 'foo', start: 0 });
  });

  it('returns null when slash is not at start of line', () => {
    expect(getSlashTrigger('hello /foo', 10)).toBeNull();
  });

  it('detects slash after a newline', () => {
    expect(getSlashTrigger('first\n/foo', 10)).toEqual({ query: 'foo', start: 6 });
  });

  it('returns null after whitespace breaks the token', () => {
    expect(getSlashTrigger('/foo bar', 8)).toBeNull();
  });

  it('returns null when there is no slash', () => {
    expect(getSlashTrigger('hello', 5)).toBeNull();
  });

  it('returns null when caret is before the slash', () => {
    expect(getSlashTrigger('/foo', 0)).toBeNull();
  });

  it('handles caret between slash and end', () => {
    expect(getSlashTrigger('/foobar', 4)).toEqual({ query: 'foo', start: 0 });
  });
});

describe('filterPrompts', () => {
  const prompts = [
    entry('git', 'commit', { description: 'create a commit' }),
    entry('git', 'branch'),
    entry('fs', 'read-file', { description: 'open a file' }),
  ];

  it('returns all entries on empty query', () => {
    expect(filterPrompts(prompts, '').length).toBe(3);
  });

  it('filters by prompt name', () => {
    expect(filterPrompts(prompts, 'comm').map((e) => e.prompt.name)).toEqual(['commit']);
  });

  it('filters by server id', () => {
    expect(filterPrompts(prompts, 'fs').map((e) => e.prompt.name)).toEqual(['read-file']);
  });

  it('filters by description', () => {
    expect(filterPrompts(prompts, 'open').map((e) => e.prompt.name)).toEqual(['read-file']);
  });

  it('is case-insensitive', () => {
    expect(filterPrompts(prompts, 'COMM').length).toBe(1);
  });

  it('returns empty when no matches', () => {
    expect(filterPrompts(prompts, 'zzz')).toEqual([]);
  });
});

describe('groupByServer', () => {
  it('groups entries under their serverId preserving order', () => {
    const result = groupByServer([
      entry('git', 'commit'),
      entry('fs', 'read'),
      entry('git', 'branch'),
    ]);
    expect(result.map((g) => g.serverId)).toEqual(['git', 'fs']);
    expect(result[0]?.prompts.map((p) => p.prompt.name)).toEqual(['commit', 'branch']);
    expect(result[1]?.prompts.map((p) => p.prompt.name)).toEqual(['read']);
  });

  it('returns empty array for empty input', () => {
    expect(groupByServer([])).toEqual([]);
  });
});

describe('formatPromptInsert', () => {
  it('formats prompt without arguments', () => {
    expect(formatPromptInsert(entry('git', 'commit'))).toBe('/git:commit ');
  });

  it('formats prompt with required arguments', () => {
    const e = entry('git', 'commit', {
      args: [
        { name: 'message', required: true },
        { name: 'scope', required: true },
      ],
    });
    expect(formatPromptInsert(e)).toBe('/git:commit message=<message> scope=<scope>');
  });

  it('formats optional arguments with a ? marker', () => {
    const e = entry('git', 'commit', {
      args: [{ name: 'amend', required: false }],
    });
    expect(formatPromptInsert(e)).toBe('/git:commit amend=<amend?>');
  });
});

describe('applyInsert', () => {
  it('replaces the slash trigger with the formatted insert', () => {
    const trigger = { query: 'co', start: 0 };
    const result = applyInsert('/co rest', trigger, 3, '/git:commit ');
    expect(result.value).toBe('/git:commit  rest');
    expect(result.caret).toBe('/git:commit '.length);
  });

  it('preserves text before and after the trigger', () => {
    const value = 'line1\n/foo';
    const trigger = { query: 'foo', start: 6 };
    const result = applyInsert(value, trigger, 10, '/git:commit ');
    expect(result.value).toBe('line1\n/git:commit ');
    expect(result.caret).toBe('line1\n/git:commit '.length);
  });
});
