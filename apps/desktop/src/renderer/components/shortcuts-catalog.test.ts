import { describe, expect, it } from 'vitest';
import { SHORTCUTS_CATALOG, filterShortcuts } from './shortcuts-catalog';

describe('SHORTCUTS_CATALOG', () => {
  it('exposes at least one group', () => {
    expect(SHORTCUTS_CATALOG.length).toBeGreaterThan(0);
  });

  it('every group has a non-empty title, description, and entries list', () => {
    for (const g of SHORTCUTS_CATALOG) {
      expect(g.title.length).toBeGreaterThan(0);
      expect(g.description.length).toBeGreaterThan(0);
      expect(g.entries.length).toBeGreaterThan(0);
    }
  });

  it('every entry has a unique id', () => {
    const ids = new Set<string>();
    for (const g of SHORTCUTS_CATALOG) {
      for (const e of g.entries) {
        expect(ids.has(e.id)).toBe(false);
        ids.add(e.id);
      }
    }
  });

  it('includes the ? shortcut for opening this overlay', () => {
    const found = SHORTCUTS_CATALOG.flatMap((g) => g.entries).find((e) => e.keys === '?');
    expect(found).toBeDefined();
    expect(found?.label.toLowerCase()).toContain('shortcut');
  });
});

describe('filterShortcuts', () => {
  it('returns all groups when query is empty', () => {
    const out = filterShortcuts(SHORTCUTS_CATALOG, '');
    expect(out.length).toBe(SHORTCUTS_CATALOG.length);
  });

  it('returns only matching entries when query is set', () => {
    const out = filterShortcuts(SHORTCUTS_CATALOG, 'palette');
    expect(out.length).toBeGreaterThan(0);
    for (const g of out) {
      for (const e of g.entries) {
        const haystack = `${e.label} ${e.keys} ${g.title}`.toLowerCase();
        expect(haystack).toContain('palette');
      }
    }
  });

  it('matches the key glyph itself', () => {
    const out = filterShortcuts(SHORTCUTS_CATALOG, '⌘ 1');
    expect(out.flatMap((g) => g.entries).some((e) => e.keys.includes('⌘ 1'))).toBe(true);
  });

  it('returns an empty array for no matches', () => {
    expect(filterShortcuts(SHORTCUTS_CATALOG, 'xyz-nothing-matches')).toHaveLength(0);
  });

  it('does not mutate the input', () => {
    const before = JSON.stringify(SHORTCUTS_CATALOG);
    filterShortcuts(SHORTCUTS_CATALOG, 'nav');
    expect(JSON.stringify(SHORTCUTS_CATALOG)).toBe(before);
  });
});
