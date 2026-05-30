import { describe, expect, it } from 'vitest';
import { groupByCategory, mergePaletteResults, type PaletteAction } from './command-palette-derive';

const noopAction = (id: string, title: string, keywords: string[]): PaletteAction => ({
  id,
  title,
  subtitle: '',
  keywords,
  perform: () => undefined,
});

describe('mergePaletteResults — action category', () => {
  it('returns no actions when none are provided', () => {
    const entries = mergePaletteResults([], [], [], '');
    expect(groupByCategory(entries).action).toHaveLength(0);
  });

  it('returns all actions for an empty query', () => {
    const actions = [noopAction('a', 'A', ['one']), noopAction('b', 'B', ['two'])];
    const entries = mergePaletteResults([], [], [], '', { actions });
    const grouped = groupByCategory(entries);
    expect(grouped.action).toHaveLength(2);
    expect(grouped.action[0]?.title).toBe('A');
  });

  it('filters actions by query against title, subtitle, or keywords', () => {
    const actions = [
      noopAction('theme', 'Toggle theme', ['appearance', 'dark', 'light']),
      noopAction('chat', 'New chat', ['conversation']),
    ];
    let entries = mergePaletteResults([], [], [], 'dark', { actions });
    expect(groupByCategory(entries).action.map((a) => a.id)).toEqual(['action:theme']);

    entries = mergePaletteResults([], [], [], 'conversation', { actions });
    expect(groupByCategory(entries).action.map((a) => a.id)).toEqual(['action:chat']);

    entries = mergePaletteResults([], [], [], 'xyz', { actions });
    expect(groupByCategory(entries).action).toHaveLength(0);
  });

  it('puts action entries before other categories in keyboard-nav order', () => {
    const actions = [noopAction('a', 'A', ['x'])];
    const entries = mergePaletteResults([], [], [], 'a', { actions });
    expect(entries[0]?.category).toBe('action');
  });
});
