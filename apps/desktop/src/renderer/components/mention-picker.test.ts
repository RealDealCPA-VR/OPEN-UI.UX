import { describe, expect, it } from 'vitest';
import type { CodebaseSearchHit } from '../../shared/codebase-search';
import { getSlashTrigger } from './slash-commands';
import {
  buildMentionGroups,
  getMentionTrigger,
  removeMentionToken,
  selectableMentionEntries,
} from './mention-picker';

const fileHit = (path: string): CodebaseSearchHit => ({ path, kind: 'filename' });
const folderHit = (path: string): CodebaseSearchHit => ({ path, kind: 'folder' });

describe('getMentionTrigger', () => {
  it('detects @ at start of input', () => {
    expect(getMentionTrigger('@', 1)).toEqual({ query: '', start: 0 });
  });

  it('captures the query after @', () => {
    expect(getMentionTrigger('@foo', 4)).toEqual({ query: 'foo', start: 0 });
  });

  it('fires after a leading space (word boundary)', () => {
    expect(getMentionTrigger('hi @foo', 7)).toEqual({ query: 'foo', start: 3 });
  });

  it('fires after a newline', () => {
    expect(getMentionTrigger('line\n@foo', 9)).toEqual({ query: 'foo', start: 5 });
  });

  it('fires after a tab', () => {
    expect(getMentionTrigger('a\t@foo', 6)).toEqual({ query: 'foo', start: 2 });
  });

  it('returns null inside a word (no boundary)', () => {
    expect(getMentionTrigger('foo@bar', 7)).toBeNull();
  });

  it('returns null for an email address', () => {
    expect(getMentionTrigger('valentinohelp@gmail.com', 23)).toBeNull();
  });

  it('returns null when @ is preceded by a non-space symbol', () => {
    expect(getMentionTrigger('x.@foo', 6)).toBeNull();
  });

  it('returns null once whitespace breaks the token', () => {
    expect(getMentionTrigger('@foo bar', 8)).toBeNull();
  });

  it('returns null when there is no @', () => {
    expect(getMentionTrigger('hello', 5)).toBeNull();
  });

  it('returns null when caret is before the @', () => {
    expect(getMentionTrigger('@foo', 0)).toBeNull();
  });

  it('handles caret between @ and end', () => {
    expect(getMentionTrigger('@foobar', 4)).toEqual({ query: 'foo', start: 0 });
  });
});

describe('mutual exclusion vs slash', () => {
  it('an @ trigger position is not a slash trigger', () => {
    const value = 'hi @foo';
    const caret = value.length;
    expect(getMentionTrigger(value, caret)).not.toBeNull();
    expect(getSlashTrigger(value, caret)).toBeNull();
  });

  it('a leading slash is not an @ trigger', () => {
    const value = '/foo';
    const caret = value.length;
    expect(getSlashTrigger(value, caret)).not.toBeNull();
    expect(getMentionTrigger(value, caret)).toBeNull();
  });

  it('@ and / on separate tokens do not both fire at the same caret', () => {
    // Caret after the slash token: slash fires (line start), mention does not.
    const value = '@a\n/b';
    expect(getSlashTrigger(value, 5)).not.toBeNull();
    expect(getMentionTrigger(value, 5)).toBeNull();
  });
});

describe('buildMentionGroups', () => {
  it('routes filename hits to Files and folder hits to Folders', () => {
    const groups = buildMentionGroups(
      [fileHit('src/a.ts'), folderHit('src'), fileHit('src/b.ts')],
      '',
    );
    const files = groups.find((g) => g.header === 'Files');
    const folders = groups.find((g) => g.header === 'Folders');
    expect(files?.entries.map((e) => e.kind)).toEqual(['file', 'file']);
    expect(folders?.entries.map((e) => e.kind)).toEqual(['folder']);
  });

  it('always includes a disabled Symbols group', () => {
    const groups = buildMentionGroups([], '');
    const symbols = groups.find((g) => g.header === 'Symbols');
    expect(symbols).toBeDefined();
    expect(symbols?.disabled).toBe(true);
    expect(symbols?.badge).toBe('coming soon');
  });

  it('omits empty Files/Folders groups', () => {
    const groups = buildMentionGroups([fileHit('only.ts')], '');
    expect(groups.find((g) => g.header === 'Folders')).toBeUndefined();
    expect(groups.find((g) => g.header === 'Files')).toBeDefined();
  });

  it('filters hits by the query substring', () => {
    const groups = buildMentionGroups([fileHit('src/alpha.ts'), fileHit('src/beta.ts')], 'alpha');
    const files = groups.find((g) => g.header === 'Files');
    expect(files?.entries.map((e) => (e.kind === 'file' ? e.hit.path : ''))).toEqual([
      'src/alpha.ts',
    ]);
  });

  it('selectable entries exclude the disabled Symbols tier', () => {
    const groups = buildMentionGroups([fileHit('a.ts'), folderHit('dir')], '');
    const flat = selectableMentionEntries(groups);
    expect(flat.map((e) => e.kind)).toEqual(['file', 'folder']);
    expect(flat.some((e) => e.kind === 'symbol')).toBe(false);
  });
});

describe('removeMentionToken', () => {
  it('strips the in-progress @token through the caret', () => {
    const value = 'hi @foo';
    const trigger = getMentionTrigger(value, value.length);
    expect(trigger).not.toBeNull();
    if (!trigger) return;
    const result = removeMentionToken(value, trigger, value.length);
    expect(result.value).toBe('hi ');
    expect(result.caret).toBe(3);
  });

  it('preserves text after the caret', () => {
    const value = '@foo done';
    // caret sits right after '@foo'
    const trigger = getMentionTrigger(value, 4);
    expect(trigger).not.toBeNull();
    if (!trigger) return;
    const result = removeMentionToken(value, trigger, 4);
    expect(result.value).toBe(' done');
    expect(result.caret).toBe(0);
  });
});
