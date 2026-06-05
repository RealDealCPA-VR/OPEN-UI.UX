import type { CodebaseSearchHit } from '../../shared/codebase-search';

export interface MentionTrigger {
  query: string;
  start: number;
}

export type MentionEntry =
  | { kind: 'file'; hit: CodebaseSearchHit }
  | { kind: 'folder'; hit: CodebaseSearchHit }
  | { kind: 'symbol'; label: string; disabled: true };

export interface MentionGroup {
  header: string;
  badge?: string;
  disabled?: boolean;
  entries: MentionEntry[];
}

/**
 * Parallel of getSlashTrigger but for the '@' context picker. Fires only at a
 * WORD BOUNDARY — '@' must be at the start of the value or immediately preceded
 * by whitespace. Returns null when '@' is glued to a preceding word character
 * (so email addresses like `name@host` never open the picker). The query
 * terminates at the first whitespace after '@'.
 */
export function getMentionTrigger(value: string, caret: number): MentionTrigger | null {
  if (caret < 1 || caret > value.length) return null;
  let i = caret - 1;
  while (i >= 0) {
    const ch = value[i];
    if (ch === undefined) return null;
    if (ch === '@') {
      const prev = i === 0 ? undefined : value[i - 1];
      // Word-boundary gate: start-of-string or whitespace before '@'. Anything
      // else (a letter/digit/symbol, e.g. an email local part) is not a trigger.
      if (prev !== undefined && !/\s/.test(prev)) return null;
      const query = value.slice(i + 1, caret);
      if (/\s/.test(query)) return null;
      return { query, start: i };
    }
    if (ch === '\n' || ch === ' ' || ch === '\t') return null;
    i--;
  }
  return null;
}

function matchesQuery(hit: CodebaseSearchHit, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return hit.path.toLowerCase().includes(q);
}

/**
 * Split codebase search hits into the grouped dropdown model: Files, Folders,
 * and a disabled "Symbols" tier (coming soon). File/folder groups are omitted
 * when empty; the Symbols group is always present but disabled.
 */
export function buildMentionGroups(
  hits: ReadonlyArray<CodebaseSearchHit>,
  query: string,
): MentionGroup[] {
  const groups: MentionGroup[] = [];
  const files: MentionEntry[] = [];
  const folders: MentionEntry[] = [];
  for (const hit of hits) {
    if (!matchesQuery(hit, query)) continue;
    if (hit.kind === 'folder') {
      folders.push({ kind: 'folder', hit });
    } else {
      files.push({ kind: 'file', hit });
    }
  }
  if (files.length > 0) {
    groups.push({ header: 'Files', entries: files });
  }
  if (folders.length > 0) {
    groups.push({ header: 'Folders', entries: folders });
  }
  groups.push({
    header: 'Symbols',
    badge: 'coming soon',
    disabled: true,
    entries: [{ kind: 'symbol', label: 'Symbol search', disabled: true }],
  });
  return groups;
}

/**
 * The flat list of *selectable* entries (disabled Symbols excluded), in display
 * order. Used to drive keyboard navigation so the active index never lands on a
 * disabled tier.
 */
export function selectableMentionEntries(groups: ReadonlyArray<MentionGroup>): MentionEntry[] {
  const out: MentionEntry[] = [];
  for (const g of groups) {
    if (g.disabled) continue;
    for (const e of g.entries) {
      if (e.kind === 'symbol') continue;
      out.push(e);
    }
  }
  return out;
}

export interface ApplyMentionResult {
  value: string;
  caret: number;
}

/**
 * Remove the in-progress `@token` (from trigger.start through the caret) so the
 * picker selection can be represented as an attachment chip rather than inline
 * text. Collapses a now-redundant leading space if the token sat mid-line.
 */
export function removeMentionToken(
  value: string,
  trigger: MentionTrigger,
  caret: number,
): ApplyMentionResult {
  const before = value.slice(0, trigger.start);
  const after = value.slice(caret);
  const next = before + after;
  return { value: next, caret: before.length };
}
