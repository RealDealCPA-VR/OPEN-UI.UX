import type { StoredWindowBounds } from './settings';

export interface DisplayWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InitialWindowPlacement {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

export const DEFAULT_WINDOW_WIDTH = 1400;
export const DEFAULT_WINDOW_HEIGHT = 900;

// Require a meaningful sliver of the window to intersect a display so the
// titlebar stays grabbable after a monitor is unplugged or rearranged.
const MIN_VISIBLE_PX = 100;

function intersectsDisplay(bounds: StoredWindowBounds, area: DisplayWorkArea): boolean {
  const overlapX =
    Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
  const overlapY =
    Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
  return overlapX >= MIN_VISIBLE_PX && overlapY >= MIN_VISIBLE_PX;
}

/**
 * Compute the initial main-window placement from persisted bounds. Saved
 * position is honored only if it still intersects a connected display;
 * otherwise size (and maximized state) are kept but the OS picks the position.
 */
export function resolveInitialWindowPlacement(
  saved: StoredWindowBounds | null,
  displays: readonly DisplayWorkArea[],
): InitialWindowPlacement {
  if (!saved) {
    return { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT, maximized: false };
  }
  const visible = displays.some((d) => intersectsDisplay(saved, d));
  if (!visible) {
    return { width: saved.width, height: saved.height, maximized: saved.maximized };
  }
  return {
    x: saved.x,
    y: saved.y,
    width: saved.width,
    height: saved.height,
    maximized: saved.maximized,
  };
}
