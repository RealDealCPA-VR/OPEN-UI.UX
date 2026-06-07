import { describe, expect, it } from 'vitest';
import {
  applyHunkDecisions,
  countLineDelta,
  extractHunksFromLineChanges,
  formatHunkRange,
  summarizeHunks,
  type LineChangeLike,
  type MonacoDiffHunk,
} from './monaco-diff-helpers';

function makeChange(
  origStart: number,
  origEnd: number,
  modStart: number,
  modEnd: number,
): LineChangeLike {
  return {
    originalStartLineNumber: origStart,
    originalEndLineNumber: origEnd,
    modifiedStartLineNumber: modStart,
    modifiedEndLineNumber: modEnd,
  };
}

describe('extractHunksFromLineChanges', () => {
  it('returns empty for null input', () => {
    expect(extractHunksFromLineChanges(null)).toEqual([]);
  });

  it('classifies pure additions', () => {
    // Monaco encodes an insertion as originalEnd < originalStart
    const hunks = extractHunksFromLineChanges([makeChange(3, 2, 3, 5)]);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.kind).toBe('add');
    expect(hunks[0]?.modifiedStartLine).toBe(3);
    expect(hunks[0]?.modifiedEndLine).toBe(5);
  });

  it('classifies pure removals', () => {
    // Monaco encodes a deletion as modifiedEnd < modifiedStart
    const hunks = extractHunksFromLineChanges([makeChange(3, 5, 3, 2)]);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.kind).toBe('remove');
  });

  it('classifies modifications', () => {
    const hunks = extractHunksFromLineChanges([makeChange(3, 5, 3, 6)]);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.kind).toBe('modify');
  });

  it('assigns sequential indexes', () => {
    const hunks = extractHunksFromLineChanges([
      makeChange(1, 1, 1, 1),
      makeChange(5, 5, 5, 5),
      makeChange(9, 9, 9, 9),
    ]);
    expect(hunks.map((h) => h.index)).toEqual([0, 1, 2]);
  });
});

describe('summarizeHunks', () => {
  it('returns no-change message for empty list', () => {
    expect(summarizeHunks([])).toBe('No changes');
  });

  it('summarises counts by kind', () => {
    const hunks: MonacoDiffHunk[] = [
      {
        index: 0,
        originalStartLine: 3,
        originalEndLine: 2,
        modifiedStartLine: 3,
        modifiedEndLine: 5,
        kind: 'add',
      },
      {
        index: 1,
        originalStartLine: 7,
        originalEndLine: 9,
        modifiedStartLine: 7,
        modifiedEndLine: 6,
        kind: 'remove',
      },
      {
        index: 2,
        originalStartLine: 12,
        originalEndLine: 14,
        modifiedStartLine: 11,
        modifiedEndLine: 13,
        kind: 'modify',
      },
    ];
    expect(summarizeHunks(hunks)).toBe('3 hunks: +1 added, -1 removed, ~1 modified');
  });

  it('uses singular noun for single hunk', () => {
    const hunks: MonacoDiffHunk[] = [
      {
        index: 0,
        originalStartLine: 1,
        originalEndLine: 0,
        modifiedStartLine: 1,
        modifiedEndLine: 1,
        kind: 'add',
      },
    ];
    expect(summarizeHunks(hunks)).toBe('1 hunk: +1 added');
  });
});

describe('countLineDelta', () => {
  it('returns zero for empty hunks', () => {
    expect(countLineDelta([])).toEqual({ added: 0, removed: 0 });
  });

  it('counts an insertion as added only', () => {
    const hunks: MonacoDiffHunk[] = [
      {
        index: 0,
        originalStartLine: 3,
        originalEndLine: 2,
        modifiedStartLine: 3,
        modifiedEndLine: 5,
        kind: 'add',
      },
    ];
    expect(countLineDelta(hunks)).toEqual({ added: 3, removed: 0 });
  });

  it('counts a deletion as removed only', () => {
    const hunks: MonacoDiffHunk[] = [
      {
        index: 0,
        originalStartLine: 3,
        originalEndLine: 5,
        modifiedStartLine: 3,
        modifiedEndLine: 2,
        kind: 'remove',
      },
    ];
    expect(countLineDelta(hunks)).toEqual({ added: 0, removed: 3 });
  });

  it('counts a modification as both', () => {
    const hunks: MonacoDiffHunk[] = [
      {
        index: 0,
        originalStartLine: 3,
        originalEndLine: 4,
        modifiedStartLine: 3,
        modifiedEndLine: 6,
        kind: 'modify',
      },
    ];
    expect(countLineDelta(hunks)).toEqual({ added: 4, removed: 2 });
  });
});

describe('formatHunkRange', () => {
  it('formats a multi-line modify hunk', () => {
    expect(
      formatHunkRange({
        index: 0,
        originalStartLine: 3,
        originalEndLine: 5,
        modifiedStartLine: 3,
        modifiedEndLine: 6,
        kind: 'modify',
      }),
    ).toBe('original L3-5 → modified L3-6');
  });

  it('formats a single-line range', () => {
    expect(
      formatHunkRange({
        index: 0,
        originalStartLine: 4,
        originalEndLine: 4,
        modifiedStartLine: 4,
        modifiedEndLine: 4,
        kind: 'modify',
      }),
    ).toBe('original L4 → modified L4');
  });

  it('formats an insert (empty original side)', () => {
    expect(
      formatHunkRange({
        index: 0,
        originalStartLine: 3,
        originalEndLine: 2,
        modifiedStartLine: 3,
        modifiedEndLine: 5,
        kind: 'add',
      }),
    ).toBe('original at 3 → modified L3-5');
  });
});

describe('applyHunkDecisions', () => {
  it('returns original text when no hunks', () => {
    const result = applyHunkDecisions({
      originalText: 'a\nb\nc',
      modifiedText: 'a\nb\nc',
      hunks: [],
      acceptedHunkIndexes: [],
    });
    expect(result.text).toBe('a\nb\nc');
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it('keeps original lines when all hunks rejected', () => {
    const result = applyHunkDecisions({
      originalText: 'a\nb\nc',
      modifiedText: 'a\nB\nc',
      hunks: [
        {
          index: 0,
          originalStartLine: 2,
          originalEndLine: 2,
          modifiedStartLine: 2,
          modifiedEndLine: 2,
          kind: 'modify',
        },
      ],
      acceptedHunkIndexes: [],
    });
    expect(result.text).toBe('a\nb\nc');
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it('applies modified lines for accepted hunks', () => {
    const result = applyHunkDecisions({
      originalText: 'a\nb\nc',
      modifiedText: 'a\nB\nc',
      hunks: [
        {
          index: 0,
          originalStartLine: 2,
          originalEndLine: 2,
          modifiedStartLine: 2,
          modifiedEndLine: 2,
          kind: 'modify',
        },
      ],
      acceptedHunkIndexes: [0],
    });
    expect(result.text).toBe('a\nB\nc');
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toEqual([]);
  });

  it('mixes accepted and rejected hunks correctly', () => {
    // original: 1=a, 2=b, 3=c, 4=d, 5=e
    // modified: 1=a, 2=B, 3=c, 4=D, 5=e
    const result = applyHunkDecisions({
      originalText: 'a\nb\nc\nd\ne',
      modifiedText: 'a\nB\nc\nD\ne',
      hunks: [
        {
          index: 0,
          originalStartLine: 2,
          originalEndLine: 2,
          modifiedStartLine: 2,
          modifiedEndLine: 2,
          kind: 'modify',
        },
        {
          index: 1,
          originalStartLine: 4,
          originalEndLine: 4,
          modifiedStartLine: 4,
          modifiedEndLine: 4,
          kind: 'modify',
        },
      ],
      acceptedHunkIndexes: [1],
    });
    expect(result.text).toBe('a\nb\nc\nD\ne');
    expect(result.accepted.map((h) => h.index)).toEqual([1]);
    expect(result.rejected.map((h) => h.index)).toEqual([0]);
  });

  it('handles insertion hunks (empty original range)', () => {
    // original: 1=a, 2=c
    // modified: 1=a, 2=NEW, 3=c
    // Monaco's encoding: originalStart=2, originalEnd=1 means insertion before line 2
    const result = applyHunkDecisions({
      originalText: 'a\nc',
      modifiedText: 'a\nNEW\nc',
      hunks: [
        {
          index: 0,
          originalStartLine: 2,
          originalEndLine: 1,
          modifiedStartLine: 2,
          modifiedEndLine: 2,
          kind: 'add',
        },
      ],
      acceptedHunkIndexes: [0],
    });
    expect(result.text).toBe('a\nNEW\nc');
  });

  it('handles deletion hunks (empty modified range)', () => {
    // original: 1=a, 2=GONE, 3=c
    // modified: 1=a, 2=c
    const result = applyHunkDecisions({
      originalText: 'a\nGONE\nc',
      modifiedText: 'a\nc',
      hunks: [
        {
          index: 0,
          originalStartLine: 2,
          originalEndLine: 2,
          modifiedStartLine: 2,
          modifiedEndLine: 1,
          kind: 'remove',
        },
      ],
      acceptedHunkIndexes: [0],
    });
    expect(result.text).toBe('a\nc');
  });

  it('rejects a deletion hunk by keeping the original line', () => {
    const result = applyHunkDecisions({
      originalText: 'a\nGONE\nc',
      modifiedText: 'a\nc',
      hunks: [
        {
          index: 0,
          originalStartLine: 2,
          originalEndLine: 2,
          modifiedStartLine: 2,
          modifiedEndLine: 1,
          kind: 'remove',
        },
      ],
      acceptedHunkIndexes: [],
    });
    expect(result.text).toBe('a\nGONE\nc');
  });

  it('sorts hunks by original start line before applying', () => {
    const result = applyHunkDecisions({
      originalText: 'a\nb\nc\nd\ne',
      modifiedText: 'a\nB\nc\nD\ne',
      hunks: [
        {
          index: 1,
          originalStartLine: 4,
          originalEndLine: 4,
          modifiedStartLine: 4,
          modifiedEndLine: 4,
          kind: 'modify',
        },
        {
          index: 0,
          originalStartLine: 2,
          originalEndLine: 2,
          modifiedStartLine: 2,
          modifiedEndLine: 2,
          kind: 'modify',
        },
      ],
      acceptedHunkIndexes: [0, 1],
    });
    expect(result.text).toBe('a\nB\nc\nD\ne');
  });

  // Per-hunk partial accept at the approval gate: a strict subset is kept.
  it('reconstructs a 3-hunk diff with the MIDDLE hunk rejected', () => {
    // original lines: 1=a 2=b 3=c 4=d 5=e
    // modified lines: 1=A 2=b 3=C 4=d 5=E (hunks at 1, 3, 5)
    const hunks: MonacoDiffHunk[] = [
      {
        index: 0,
        originalStartLine: 1,
        originalEndLine: 1,
        modifiedStartLine: 1,
        modifiedEndLine: 1,
        kind: 'modify',
      },
      {
        index: 1,
        originalStartLine: 3,
        originalEndLine: 3,
        modifiedStartLine: 3,
        modifiedEndLine: 3,
        kind: 'modify',
      },
      {
        index: 2,
        originalStartLine: 5,
        originalEndLine: 5,
        modifiedStartLine: 5,
        modifiedEndLine: 5,
        kind: 'modify',
      },
    ];
    const result = applyHunkDecisions({
      originalText: 'a\nb\nc\nd\ne',
      modifiedText: 'A\nb\nC\nd\nE',
      hunks,
      acceptedHunkIndexes: [0, 2],
    });
    // First + last accepted (A, E), middle (C) rejected → keeps original c.
    expect(result.text).toBe('A\nb\nc\nd\nE');
    expect(result.accepted.map((h) => h.index)).toEqual([0, 2]);
    expect(result.rejected.map((h) => h.index)).toEqual([1]);
  });

  it('reconstructs across a CRLF original without re-emitting carriage returns', () => {
    // splitLines normalises \r\n; the joined output uses \n.
    const result = applyHunkDecisions({
      originalText: 'a\r\nb\r\nc',
      modifiedText: 'a\r\nB\r\nc',
      hunks: [
        {
          index: 0,
          originalStartLine: 2,
          originalEndLine: 2,
          modifiedStartLine: 2,
          modifiedEndLine: 2,
          kind: 'modify',
        },
      ],
      acceptedHunkIndexes: [0],
    });
    expect(result.text).toBe('a\nB\nc');
  });

  it('handles the empty-file → content edge (new file, single add hunk)', () => {
    const result = applyHunkDecisions({
      originalText: '',
      modifiedText: 'line1\nline2',
      hunks: [
        {
          index: 0,
          originalStartLine: 1,
          originalEndLine: 0,
          modifiedStartLine: 1,
          modifiedEndLine: 2,
          kind: 'add',
        },
      ],
      acceptedHunkIndexes: [0],
    });
    expect(result.text).toBe('line1\nline2');
  });

  it('rejecting the sole add hunk on an empty file yields empty text', () => {
    const result = applyHunkDecisions({
      originalText: '',
      modifiedText: 'line1\nline2',
      hunks: [
        {
          index: 0,
          originalStartLine: 1,
          originalEndLine: 0,
          modifiedStartLine: 1,
          modifiedEndLine: 2,
          kind: 'add',
        },
      ],
      acceptedHunkIndexes: [],
    });
    expect(result.text).toBe('');
  });
});
