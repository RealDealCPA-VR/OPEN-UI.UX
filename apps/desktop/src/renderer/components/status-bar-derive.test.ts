import { describe, expect, it } from 'vitest';
import type { ContentBlock } from '@opencodex/core';
import {
  findRunningToolName,
  formatCostUsd,
  formatTokens,
  workspaceBasename,
} from './status-bar-derive';

describe('findRunningToolName', () => {
  it('returns null when there are no tool_use blocks', () => {
    const blocks: ContentBlock[] = [{ type: 'text', text: 'hi' }];
    expect(findRunningToolName(blocks)).toBeNull();
  });

  it('returns the tool name when a tool_use has no matching tool_result', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'reading…' },
      { type: 'tool_use', id: 'a', name: 'read_file', arguments: {} },
    ];
    expect(findRunningToolName(blocks)).toBe('read_file');
  });

  it('returns null after the tool_result arrives', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', id: 'a', name: 'read_file', arguments: {} },
      { type: 'tool_result', toolUseId: 'a', output: 'ok', isError: false },
    ];
    expect(findRunningToolName(blocks)).toBeNull();
  });

  it('returns the most recent unfinished tool when multiple are present', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', id: 'a', name: 'read_file', arguments: {} },
      { type: 'tool_result', toolUseId: 'a', output: 'ok', isError: false },
      { type: 'tool_use', id: 'b', name: 'grep', arguments: {} },
    ];
    expect(findRunningToolName(blocks)).toBe('grep');
  });

  it('skips tools whose results arrived out of order', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', id: 'a', name: 'read_file', arguments: {} },
      { type: 'tool_use', id: 'b', name: 'grep', arguments: {} },
      { type: 'tool_result', toolUseId: 'b', output: 'ok', isError: false },
    ];
    expect(findRunningToolName(blocks)).toBe('read_file');
  });
});

describe('workspaceBasename', () => {
  it('returns the last segment of a posix path', () => {
    expect(workspaceBasename('/home/me/project')).toBe('project');
  });

  it('returns the last segment of a windows path', () => {
    expect(workspaceBasename('C:\\Users\\VR\\Projects\\OpenCodex')).toBe('OpenCodex');
  });

  it('handles trailing separators', () => {
    expect(workspaceBasename('/home/me/project/')).toBe('project');
    expect(workspaceBasename('C:\\foo\\bar\\')).toBe('bar');
  });

  it('falls back to the full path when no separator is present', () => {
    expect(workspaceBasename('lonely')).toBe('lonely');
  });
});

describe('formatTokens', () => {
  it('formats with thousands separators', () => {
    expect(formatTokens(1234, 5678)).toBe('1,234 in · 5,678 out');
  });

  it('handles zero', () => {
    expect(formatTokens(0, 0)).toBe('0 in · 0 out');
  });
});

describe('formatCostUsd', () => {
  it('formats a positive cost to 4 decimals', () => {
    expect(formatCostUsd(0.1234)).toBe('$0.1234');
  });

  it('returns null for zero or negative cost', () => {
    expect(formatCostUsd(0)).toBeNull();
    expect(formatCostUsd(-1)).toBeNull();
  });

  it('returns null for non-finite cost', () => {
    expect(formatCostUsd(Number.NaN)).toBeNull();
    expect(formatCostUsd(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
