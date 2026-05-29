import { describe, expect, it } from 'vitest';
import type { ConversationSearchHit } from '../../shared/conversation-search';
import type { CodebaseSearchHit } from '../../shared/codebase-search';
import type { Skill } from '../../shared/skills';
import {
  flattenForKeyboardNav,
  groupByCategory,
  mergePaletteResults,
} from './command-palette-derive';

const messageHit = (override: Partial<ConversationSearchHit> = {}): ConversationSearchHit => ({
  conversationId: 'c1',
  conversationTitle: 'My chat',
  messageId: 'm1',
  role: 'user',
  createdAt: '2026-05-28T12:00:00.000Z',
  snippet: '…hello [[world]]…',
  score: -1,
  ...override,
});

const fileHit = (override: Partial<CodebaseSearchHit> = {}): CodebaseSearchHit => ({
  path: 'src/foo/bar.ts',
  kind: 'content',
  line: 3,
  snippet: 'foo bar',
  ...override,
});

const skill = (override: Partial<Skill> = {}): Skill => ({
  id: 'skill-1',
  name: 'verify',
  scope: 'user',
  description: 'Run and verify',
  frontmatter: {
    name: 'verify',
    description: 'Run and verify',
  },
  body: '',
  sourcePath: '/skills/verify.md',
  disabled: false,
  ...override,
});

describe('mergePaletteResults', () => {
  it('returns an empty list when all inputs are empty and query is blank', () => {
    expect(mergePaletteResults([], [], [], '')).toEqual([]);
  });

  it('produces entries for messages, files, and matching skills', () => {
    const entries = mergePaletteResults([messageHit()], [fileHit()], [skill()], 'verify');
    const categories = entries.map((e) => e.category);
    expect(categories).toContain('message');
    expect(categories).toContain('file');
    expect(categories).toContain('skill');
  });

  it('filters skills whose name and description do not include the query', () => {
    const entries = mergePaletteResults(
      [],
      [],
      [
        skill({ id: 'a', name: 'foo', description: 'something' }),
        skill({ id: 'b', name: 'bar', description: 'whatever' }),
      ],
      'foo',
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.skill?.name).toBe('foo');
  });

  it('returns all skills when query is empty', () => {
    const entries = mergePaletteResults([], [], [skill(), skill({ id: 's2', name: 'other' })], '');
    expect(entries.filter((e) => e.category === 'skill')).toHaveLength(2);
  });

  it('caps entries per category by the perCategoryLimit option', () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      messageHit({ messageId: `m${i}`, conversationId: `c${i}` }),
    );
    const entries = mergePaletteResults(many, [], [], 'q', { perCategoryLimit: 5 });
    expect(entries.filter((e) => e.category === 'message')).toHaveLength(5);
  });

  it('builds stable ids per category', () => {
    const entries = mergePaletteResults(
      [messageHit({ messageId: 'msg-1' })],
      [fileHit({ path: 'x.ts', line: 7 })],
      [skill({ id: 'sk-1' })],
      '',
    );
    const ids = entries.map((e) => e.id);
    expect(ids).toContain('message:msg-1');
    expect(ids).toContain('file:x.ts:7');
    expect(ids).toContain('skill:sk-1');
  });

  it('builds a subtitle from the message snippet stripped of excess whitespace', () => {
    const entries = mergePaletteResults(
      [messageHit({ snippet: '   …multi   spaces   here…   ' })],
      [],
      [],
      'q',
    );
    expect(entries[0]?.subtitle).toBe('…multi spaces here…');
  });
});

describe('groupByCategory', () => {
  it('groups by category preserving order within group', () => {
    const entries = mergePaletteResults(
      [messageHit({ messageId: 'a' }), messageHit({ messageId: 'b' })],
      [fileHit({ path: 'a.ts' })],
      [],
      '',
    );
    const grouped = groupByCategory(entries);
    expect(grouped.message.map((e) => e.message?.messageId)).toEqual(['a', 'b']);
    expect(grouped.file).toHaveLength(1);
    expect(grouped.skill).toHaveLength(0);
  });
});

describe('flattenForKeyboardNav', () => {
  it('orders entries messages → files → skills', () => {
    const entries = mergePaletteResults(
      [messageHit({ messageId: 'm1' })],
      [fileHit({ path: 'f1' })],
      [skill({ id: 's1' })],
      '',
    );
    const flat = flattenForKeyboardNav(entries);
    expect(flat.map((e) => e.category)).toEqual(['message', 'file', 'skill']);
  });
});
