import { describe, expect, it } from 'vitest';
import { parseConflictMarkers } from './merge-conflict-resolver';

describe('parseConflictMarkers', () => {
  it('returns empty for clean content', () => {
    expect(parseConflictMarkers('src/a.ts', 'line one\nline two\n')).toEqual([]);
  });

  it('parses a single 2-way conflict', () => {
    const content = `line one
<<<<<<< HEAD
ours line
=======
theirs line
>>>>>>> feature
line tail
`;
    const result = parseConflictMarkers('src/a.ts', content);
    expect(result).toHaveLength(1);
    const hunk = result[0];
    expect(hunk?.filePath).toBe('src/a.ts');
    expect(hunk?.ours).toBe('ours line');
    expect(hunk?.theirs).toBe('theirs line');
    expect(hunk?.base).toBeNull();
    expect(hunk?.index).toBe(0);
    expect(hunk?.startLine).toBe(2);
  });

  it('parses a 3-way conflict with base section', () => {
    const content = `<<<<<<< HEAD
ours
||||||| base
base content
=======
theirs
>>>>>>> branch
`;
    const result = parseConflictMarkers('a.ts', content);
    expect(result).toHaveLength(1);
    expect(result[0]?.ours).toBe('ours');
    expect(result[0]?.theirs).toBe('theirs');
    expect(result[0]?.base).toBe('base content');
  });

  it('parses multiple conflicts in same file', () => {
    const content = `<<<<<<< HEAD
a-ours
=======
a-theirs
>>>>>>> b
middle
<<<<<<< HEAD
b-ours
=======
b-theirs
>>>>>>> b
`;
    const result = parseConflictMarkers('x.ts', content);
    expect(result).toHaveLength(2);
    expect(result[0]?.ours).toBe('a-ours');
    expect(result[1]?.ours).toBe('b-ours');
    expect(result[0]?.index).toBe(0);
    expect(result[1]?.index).toBe(1);
  });

  it('honors startIndex offset', () => {
    const content = `<<<<<<< HEAD
x
=======
y
>>>>>>> b
`;
    const result = parseConflictMarkers('x.ts', content, 5);
    expect(result[0]?.index).toBe(5);
  });
});
