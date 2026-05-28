export interface MonacoDiffHunk {
  index: number;
  originalStartLine: number;
  originalEndLine: number;
  modifiedStartLine: number;
  modifiedEndLine: number;
  kind: 'add' | 'remove' | 'modify';
}

/**
 * Minimal shape of Monaco's `ILineChange`, mirrored here so this module
 * has no compile-time dependency on `monaco-editor` (which has no standard
 * package main entry and breaks Vite's dependency scan).
 */
export interface LineChangeLike {
  readonly originalStartLineNumber: number;
  readonly originalEndLineNumber: number;
  readonly modifiedStartLineNumber: number;
  readonly modifiedEndLineNumber: number;
}

export function extractHunksFromLineChanges(
  changes: readonly LineChangeLike[] | null,
): MonacoDiffHunk[] {
  if (!changes) return [];
  return changes.map((c, index) => ({
    index,
    originalStartLine: c.originalStartLineNumber,
    originalEndLine: c.originalEndLineNumber,
    modifiedStartLine: c.modifiedStartLineNumber,
    modifiedEndLine: c.modifiedEndLineNumber,
    kind: classifyHunk(c),
  }));
}

function classifyHunk(c: LineChangeLike): MonacoDiffHunk['kind'] {
  const originalEmpty = c.originalEndLineNumber < c.originalStartLineNumber;
  const modifiedEmpty = c.modifiedEndLineNumber < c.modifiedStartLineNumber;
  if (originalEmpty && !modifiedEmpty) return 'add';
  if (!originalEmpty && modifiedEmpty) return 'remove';
  return 'modify';
}

export function summarizeHunks(hunks: readonly MonacoDiffHunk[]): string {
  if (hunks.length === 0) return 'No changes';
  let added = 0;
  let removed = 0;
  let modified = 0;
  for (const h of hunks) {
    if (h.kind === 'add') added++;
    else if (h.kind === 'remove') removed++;
    else modified++;
  }
  const parts: string[] = [];
  if (added) parts.push(`+${added} added`);
  if (removed) parts.push(`-${removed} removed`);
  if (modified) parts.push(`~${modified} modified`);
  return `${hunks.length} hunk${hunks.length === 1 ? '' : 's'}: ${parts.join(', ')}`;
}

export interface HunkLineDelta {
  added: number;
  removed: number;
}

/**
 * Sum per-line additions/removals across hunks. An "add" hunk counts only
 * the modified-side span; "remove" only the original-side; "modify" counts
 * both (lines replaced).
 */
export function countLineDelta(hunks: readonly MonacoDiffHunk[]): HunkLineDelta {
  let added = 0;
  let removed = 0;
  for (const h of hunks) {
    const origLen =
      h.originalEndLine < h.originalStartLine ? 0 : h.originalEndLine - h.originalStartLine + 1;
    const modLen =
      h.modifiedEndLine < h.modifiedStartLine ? 0 : h.modifiedEndLine - h.modifiedStartLine + 1;
    if (h.kind === 'add') added += modLen;
    else if (h.kind === 'remove') removed += origLen;
    else {
      added += modLen;
      removed += origLen;
    }
  }
  return { added, removed };
}

export function formatHunkRange(hunk: MonacoDiffHunk): string {
  const orig = formatLineRange(hunk.originalStartLine, hunk.originalEndLine);
  const mod = formatLineRange(hunk.modifiedStartLine, hunk.modifiedEndLine);
  return `original ${orig} → modified ${mod}`;
}

function formatLineRange(startLine: number, endLine: number): string {
  if (endLine < startLine) return `at ${startLine}`;
  if (startLine === endLine) return `L${startLine}`;
  return `L${startLine}-${endLine}`;
}

export interface HunkApplicationInput {
  originalText: string;
  modifiedText: string;
  hunks: readonly MonacoDiffHunk[];
  acceptedHunkIndexes: readonly number[];
}

export interface HunkApplicationResult {
  text: string;
  accepted: MonacoDiffHunk[];
  rejected: MonacoDiffHunk[];
}

/**
 * Collate per-hunk accept/reject decisions into a final text.
 *
 * Walks the original lines top-to-bottom; for each accepted hunk,
 * substitutes the modified-side lines from that hunk; for each rejected
 * (or undecided) hunk, keeps the original-side lines. Lines outside any
 * hunk are always copied verbatim.
 */
export function applyHunkDecisions(input: HunkApplicationInput): HunkApplicationResult {
  const original = splitLines(input.originalText);
  const modified = splitLines(input.modifiedText);
  const accepted = new Set(input.acceptedHunkIndexes);

  const sorted = [...input.hunks].sort((a, b) => a.originalStartLine - b.originalStartLine);

  const out: string[] = [];
  let cursor = 0;
  const acceptedHunks: MonacoDiffHunk[] = [];
  const rejectedHunks: MonacoDiffHunk[] = [];

  for (const hunk of sorted) {
    const origStart = Math.max(0, hunk.originalStartLine - 1);
    const origEndExclusive =
      hunk.originalEndLine < hunk.originalStartLine ? origStart : hunk.originalEndLine;

    while (cursor < origStart && cursor < original.length) {
      const line = original[cursor];
      if (line !== undefined) out.push(line);
      cursor++;
    }

    if (accepted.has(hunk.index)) {
      const modStart = Math.max(0, hunk.modifiedStartLine - 1);
      const modEndExclusive =
        hunk.modifiedEndLine < hunk.modifiedStartLine ? modStart : hunk.modifiedEndLine;
      for (let i = modStart; i < modEndExclusive && i < modified.length; i++) {
        const line = modified[i];
        if (line !== undefined) out.push(line);
      }
      acceptedHunks.push(hunk);
    } else {
      for (let i = origStart; i < origEndExclusive && i < original.length; i++) {
        const line = original[i];
        if (line !== undefined) out.push(line);
      }
      rejectedHunks.push(hunk);
    }
    cursor = origEndExclusive;
  }

  while (cursor < original.length) {
    const line = original[cursor];
    if (line !== undefined) out.push(line);
    cursor++;
  }

  return { text: out.join('\n'), accepted: acceptedHunks, rejected: rejectedHunks };
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.split(/\r\n|\r|\n/);
}
