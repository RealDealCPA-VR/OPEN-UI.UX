import { describe, expect, it } from 'vitest';
import type { ContentBlock } from '@opencodex/core';
import { formatToolArguments, formatToolOutput, groupContentBlocks } from './tool-block-grouping';

describe('groupContentBlocks', () => {
  it('pairs tool_use with its matching tool_result by id', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'Let me check that.' },
      { type: 'tool_use', id: 'call_1', name: 'read_file', arguments: { path: 'a.ts' } },
      { type: 'tool_result', toolUseId: 'call_1', output: 'file contents', isError: false },
      { type: 'text', text: 'Done.' },
    ];
    const items = groupContentBlocks(blocks);
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ kind: 'text', text: 'Let me check that.' });
    expect(items[1]?.kind).toBe('tool');
    if (items[1]?.kind === 'tool') {
      expect(items[1].use.name).toBe('read_file');
      expect(items[1].result?.output).toBe('file contents');
    }
    expect(items[2]).toEqual({ kind: 'text', text: 'Done.' });
  });

  it('leaves result null when tool_use has no matching tool_result yet (in-flight)', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', id: 'call_x', name: 'run_shell', arguments: { command: 'ls' } },
    ];
    const items = groupContentBlocks(blocks);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('tool');
    if (items[0]?.kind === 'tool') {
      expect(items[0].result).toBeNull();
    }
  });

  it('preserves interleaved order across multiple tool turns', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'First I will read.' },
      { type: 'tool_use', id: 'a', name: 'read_file', arguments: { path: 'x' } },
      { type: 'tool_result', toolUseId: 'a', output: 'X', isError: false },
      { type: 'text', text: 'Then I will edit.' },
      { type: 'tool_use', id: 'b', name: 'edit_file', arguments: { path: 'x', oldStr: 'a' } },
      { type: 'tool_result', toolUseId: 'b', output: { bytesWritten: 1 }, isError: false },
      { type: 'text', text: 'Done.' },
    ];
    const items = groupContentBlocks(blocks);
    expect(items.map((i) => i.kind)).toEqual(['text', 'tool', 'text', 'tool', 'text']);
    if (items[1]?.kind === 'tool' && items[3]?.kind === 'tool') {
      expect(items[1].use.id).toBe('a');
      expect(items[3].use.id).toBe('b');
    }
  });

  it('marks errored tool_result via isError flag passed through', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', id: 'fail', name: 'web_fetch', arguments: { url: 'http://x' } },
      { type: 'tool_result', toolUseId: 'fail', output: 'denied', isError: true },
    ];
    const items = groupContentBlocks(blocks);
    expect(items[0]?.kind).toBe('tool');
    if (items[0]?.kind === 'tool') {
      expect(items[0].result?.isError).toBe(true);
    }
  });

  it('falls back to a synthetic tool entry when a tool_result has no preceding tool_use', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_result', toolUseId: 'orphan', output: 'stray', isError: false },
    ];
    const items = groupContentBlocks(blocks);
    expect(items).toHaveLength(1);
    if (items[0]?.kind === 'tool') {
      expect(items[0].use.id).toBe('orphan');
      expect(items[0].use.name).toBe('unknown');
      expect(items[0].result?.output).toBe('stray');
    } else {
      expect.fail('expected tool item');
    }
  });
});

describe('formatToolOutput', () => {
  it('returns strings as-is', () => {
    expect(formatToolOutput('hello')).toBe('hello');
  });

  it('JSON-stringifies objects with two-space indent', () => {
    expect(formatToolOutput({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it('renders null/undefined as empty string', () => {
    expect(formatToolOutput(null)).toBe('');
    expect(formatToolOutput(undefined)).toBe('');
  });
});

describe('formatToolArguments', () => {
  it('JSON-stringifies objects with two-space indent', () => {
    expect(formatToolArguments({ path: 'a.ts' })).toBe('{\n  "path": "a.ts"\n}');
  });

  it('returns empty string for null/undefined', () => {
    expect(formatToolArguments(null)).toBe('');
    expect(formatToolArguments(undefined)).toBe('');
  });

  it('returns strings as-is', () => {
    expect(formatToolArguments('raw')).toBe('raw');
  });
});
