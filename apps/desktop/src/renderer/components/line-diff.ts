export type DiffLineKind = 'context' | 'add' | 'remove';

export interface DiffLine {
  kind: DiffLineKind;
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

export interface DiffOptions {
  maxLines?: number;
}

export interface DiffResult {
  lines: DiffLine[];
  truncated: boolean;
  added: number;
  removed: number;
}

const DEFAULT_MAX_LINES = 400;

export function diffLines(before: string, after: string, options: DiffOptions = {}): DiffResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const a = splitLines(before);
  const b = splitLines(after);
  const ops = lcsDiff(a, b);

  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op === 'add') added++;
    else if (op === 'del') removed++;
  }

  const lines: DiffLine[] = [];
  let oldIdx = 0;
  let newIdx = 0;
  let truncated = false;

  for (const op of ops) {
    if (lines.length >= maxLines) {
      truncated = true;
      break;
    }
    if (op === 'eq') {
      lines.push({
        kind: 'context',
        oldLine: oldIdx + 1,
        newLine: newIdx + 1,
        text: a[oldIdx] ?? '',
      });
      oldIdx++;
      newIdx++;
    } else if (op === 'del') {
      lines.push({
        kind: 'remove',
        oldLine: oldIdx + 1,
        newLine: null,
        text: a[oldIdx] ?? '',
      });
      oldIdx++;
    } else {
      lines.push({
        kind: 'add',
        oldLine: null,
        newLine: newIdx + 1,
        text: b[newIdx] ?? '',
      });
      newIdx++;
    }
  }

  return { lines, truncated, added, removed };
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.split(/\r\n|\r|\n/);
}

type Op = 'eq' | 'add' | 'del';

function lcsDiff(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map(() => 'add' as Op);
  if (m === 0) return a.map(() => 'del' as Op);

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const row = dp[i];
      const next = dp[i + 1];
      if (!row || !next) continue;
      if (a[i] === b[j]) {
        row[j] = (next[j + 1] ?? 0) + 1;
      } else {
        row[j] = Math.max(next[j] ?? 0, row[j + 1] ?? 0);
      }
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push('eq');
      i++;
      j++;
    } else {
      const down = dp[i + 1]?.[j] ?? 0;
      const right = dp[i]?.[j + 1] ?? 0;
      if (down >= right) {
        ops.push('del');
        i++;
      } else {
        ops.push('add');
        j++;
      }
    }
  }
  while (i < n) {
    ops.push('del');
    i++;
  }
  while (j < m) {
    ops.push('add');
    j++;
  }
  return ops;
}
