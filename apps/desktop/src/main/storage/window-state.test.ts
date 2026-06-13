import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  resolveInitialWindowPlacement,
} from './window-state';

const primary = { x: 0, y: 0, width: 1920, height: 1080 };

describe('resolveInitialWindowPlacement', () => {
  it('falls back to defaults when nothing is saved', () => {
    expect(resolveInitialWindowPlacement(null, [primary])).toEqual({
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
      maximized: false,
    });
  });

  it('restores saved bounds that fit a connected display', () => {
    const saved = { x: 100, y: 50, width: 1200, height: 800, maximized: false };
    expect(resolveInitialWindowPlacement(saved, [primary])).toEqual({
      x: 100,
      y: 50,
      width: 1200,
      height: 800,
      maximized: false,
    });
  });

  it('preserves the maximized flag', () => {
    const saved = { x: 0, y: 0, width: 1000, height: 700, maximized: true };
    expect(resolveInitialWindowPlacement(saved, [primary]).maximized).toBe(true);
  });

  it('drops the position (keeps size) when the window is fully off-screen', () => {
    const saved = { x: 5000, y: 5000, width: 1200, height: 800, maximized: false };
    expect(resolveInitialWindowPlacement(saved, [primary])).toEqual({
      width: 1200,
      height: 800,
      maximized: false,
    });
  });

  it('drops the position when only a sub-threshold sliver remains visible', () => {
    // 50px of horizontal overlap < the 100px minimum.
    const saved = { x: 1870, y: 100, width: 1200, height: 800, maximized: false };
    const placement = resolveInitialWindowPlacement(saved, [primary]);
    expect(placement.x).toBeUndefined();
    expect(placement.y).toBeUndefined();
  });

  it('honors a position on a secondary display', () => {
    const secondary = { x: 1920, y: 0, width: 1920, height: 1080 };
    const saved = { x: 2100, y: 80, width: 1100, height: 750, maximized: false };
    expect(resolveInitialWindowPlacement(saved, [primary, secondary]).x).toBe(2100);
  });

  it('drops the position when there are no displays at all', () => {
    const saved = { x: 100, y: 100, width: 1200, height: 800, maximized: false };
    expect(resolveInitialWindowPlacement(saved, []).x).toBeUndefined();
  });
});
