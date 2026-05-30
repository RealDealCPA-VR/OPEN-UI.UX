import { describe, expect, it, vi } from 'vitest';
import { buildPaletteActions } from './command-palette-actions';
import { SETTINGS_SECTIONS } from '../views/settings-sections';

function makeCtx(): {
  navigate: ReturnType<typeof vi.fn>;
  openShortcuts: ReturnType<typeof vi.fn>;
} {
  return { navigate: vi.fn(), openShortcuts: vi.fn() };
}

describe('buildPaletteActions', () => {
  it('returns one entry per settings section plus base actions', () => {
    const ctx = makeCtx();
    const actions = buildPaletteActions({
      navigate: ctx.navigate,
      openShortcuts: ctx.openShortcuts,
    });
    // base actions (>=10) + one per settings section
    expect(actions.length).toBeGreaterThanOrEqual(SETTINGS_SECTIONS.length + 10);
  });

  it('every action has a non-empty id, title, and at least one keyword', () => {
    const ctx = makeCtx();
    const actions = buildPaletteActions({
      navigate: ctx.navigate,
      openShortcuts: ctx.openShortcuts,
    });
    for (const a of actions) {
      expect(a.id.length).toBeGreaterThan(0);
      expect(a.title.length).toBeGreaterThan(0);
      expect(a.keywords.length).toBeGreaterThan(0);
    }
  });

  it('ids are unique', () => {
    const ctx = makeCtx();
    const actions = buildPaletteActions({
      navigate: ctx.navigate,
      openShortcuts: ctx.openShortcuts,
    });
    const ids = new Set(actions.map((a) => a.id));
    expect(ids.size).toBe(actions.length);
  });

  it('open-shortcuts action invokes openShortcuts callback', () => {
    const ctx = makeCtx();
    const actions = buildPaletteActions({
      navigate: ctx.navigate,
      openShortcuts: ctx.openShortcuts,
    });
    const open = actions.find((a) => a.id === 'open-shortcuts');
    expect(open).toBeDefined();
    open?.perform();
    expect(ctx.openShortcuts).toHaveBeenCalledTimes(1);
  });

  it('settings actions navigate to the right slug', () => {
    const ctx = makeCtx();
    const actions = buildPaletteActions({
      navigate: ctx.navigate,
      openShortcuts: ctx.openShortcuts,
    });
    const theme = actions.find((a) => a.id === 'settings-theme');
    expect(theme).toBeDefined();
    theme?.perform();
    expect(ctx.navigate).toHaveBeenCalledWith('/settings/theme');
  });

  it('goto actions navigate to top-level routes', () => {
    const ctx = makeCtx();
    const actions = buildPaletteActions({
      navigate: ctx.navigate,
      openShortcuts: ctx.openShortcuts,
    });
    const chat = actions.find((a) => a.id === 'goto-chat');
    chat?.perform();
    expect(ctx.navigate).toHaveBeenCalledWith('/chat');
  });
});
