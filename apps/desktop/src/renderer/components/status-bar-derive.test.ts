import { describe, expect, it } from 'vitest';
import type { ContentBlock } from '@opencodex/core';
import {
  computeTokenMeterSegments,
  findRunningToolName,
  formatCacheSavings,
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

describe('formatCacheSavings', () => {
  it('returns null when cached tokens are absent (cold/unsupported)', () => {
    expect(formatCacheSavings(null, 1000)).toBeNull();
    expect(formatCacheSavings(undefined, 1000)).toBeNull();
  });

  it('returns null when there are no input tokens to compare against', () => {
    expect(formatCacheSavings(500, null)).toBeNull();
    expect(formatCacheSavings(500, undefined)).toBeNull();
    expect(formatCacheSavings(500, 0)).toBeNull();
  });

  it('returns null when cached tokens are zero', () => {
    expect(formatCacheSavings(0, 1000)).toBeNull();
  });

  it('returns null for non-finite inputs', () => {
    expect(formatCacheSavings(Number.NaN, 1000)).toBeNull();
    expect(formatCacheSavings(500, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('formats compact cached tokens and percent share', () => {
    expect(formatCacheSavings(12_000, 28_000)).toBe('cache 12k · 43%');
  });

  it('formats sub-thousand cached tokens without a k suffix', () => {
    expect(formatCacheSavings(500, 1000)).toBe('cache 500 · 50%');
  });

  it('formats millions with an m suffix', () => {
    expect(formatCacheSavings(2_000_000, 4_000_000)).toBe('cache 2m · 50%');
  });

  it('never reports 0% — rounds away tiny non-zero shares to null', () => {
    expect(formatCacheSavings(1, 1_000_000)).toBeNull();
  });
});

describe('computeTokenMeterSegments', () => {
  it('returns ratio as tokens / context', () => {
    const m = computeTokenMeterSegments(1000, 4000);
    expect(m).not.toBeNull();
    expect(m?.tokens).toBe(1000);
    expect(m?.context).toBe(4000);
    expect(m?.ratio).toBe(0.25);
  });

  it('clamps ratio at 1 when tokens exceed context', () => {
    const m = computeTokenMeterSegments(8000, 4000);
    expect(m?.ratio).toBe(1);
  });

  it('clamps negative tokens to zero', () => {
    const m = computeTokenMeterSegments(-100, 4000);
    expect(m?.tokens).toBe(0);
    expect(m?.ratio).toBe(0);
  });

  it('returns null for non-positive context', () => {
    expect(computeTokenMeterSegments(100, 0)).toBeNull();
    expect(computeTokenMeterSegments(100, -1)).toBeNull();
  });

  it('returns null for non-finite inputs', () => {
    expect(computeTokenMeterSegments(Number.NaN, 4000)).toBeNull();
    expect(computeTokenMeterSegments(100, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
