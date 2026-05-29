import { describe, expect, it } from 'vitest';
import {
  linkHunksToToolCalls,
  type MonacoDiffHunk,
  type ToolCallProvenanceInput,
} from './monaco-diff-helpers';

const sampleHunk: MonacoDiffHunk = {
  index: 0,
  originalStartLine: 1,
  originalEndLine: 1,
  modifiedStartLine: 1,
  modifiedEndLine: 1,
  kind: 'modify',
};

describe('linkHunksToToolCalls', () => {
  it('returns hunks with empty provenance when no tool calls', () => {
    const result = linkHunksToToolCalls({ filePath: 'src/a.ts', hunks: [sampleHunk] }, []);
    expect(result).toHaveLength(1);
    expect(result[0]?.provenance).toEqual([]);
  });

  it('attaches matching tool calls by filePath', () => {
    const calls: ToolCallProvenanceInput[] = [
      {
        id: 'tc-1',
        toolName: 'edit_file',
        filePath: 'src/a.ts',
        messageId: 'm1',
        createdAt: '2026-01-01',
        decision: 'auto',
        isError: false,
      },
      {
        id: 'tc-2',
        toolName: 'read_file',
        filePath: 'src/other.ts',
      },
    ];
    const result = linkHunksToToolCalls({ filePath: 'src/a.ts', hunks: [sampleHunk] }, calls);
    expect(result).toHaveLength(1);
    expect(result[0]?.provenance).toHaveLength(1);
    expect(result[0]?.provenance[0]?.toolCallId).toBe('tc-1');
    expect(result[0]?.provenance[0]?.toolName).toBe('edit_file');
  });

  it('normalises path separators', () => {
    const calls: ToolCallProvenanceInput[] = [
      { id: 'tc-1', toolName: 'edit_file', filePath: 'src\\nested\\a.ts' },
    ];
    const result = linkHunksToToolCalls(
      { filePath: 'src/nested/a.ts', hunks: [sampleHunk] },
      calls,
    );
    expect(result[0]?.provenance).toHaveLength(1);
  });

  it('falls back to all tool calls when no filePath match found', () => {
    const calls: ToolCallProvenanceInput[] = [
      { id: 'tc-1', toolName: 'shell', filePath: null },
      { id: 'tc-2', toolName: 'plan', filePath: undefined },
    ];
    const result = linkHunksToToolCalls({ filePath: 'src/a.ts', hunks: [sampleHunk] }, calls);
    expect(result[0]?.provenance).toHaveLength(2);
  });

  it('strips leading ./ when comparing', () => {
    const calls: ToolCallProvenanceInput[] = [
      { id: 'tc-1', toolName: 'edit_file', filePath: './src/a.ts' },
    ];
    const result = linkHunksToToolCalls({ filePath: 'src/a.ts', hunks: [sampleHunk] }, calls);
    expect(result[0]?.provenance).toHaveLength(1);
  });
});
