import { describe, expect, it } from 'vitest';
import {
  resolveTitleBarOverlay,
  titleBarOverlayForPreference,
  TITLEBAR_OVERLAY_HEIGHT,
} from './titlebar-overlay';

describe('resolveTitleBarOverlay', () => {
  it('returns the dark surface/text tokens for the dark theme', () => {
    expect(resolveTitleBarOverlay('dark')).toEqual({
      color: '#161618',
      symbolColor: '#9ea0a6',
      height: TITLEBAR_OVERLAY_HEIGHT,
    });
  });

  it('returns the light surface/text tokens for the light theme', () => {
    expect(resolveTitleBarOverlay('light')).toEqual({
      color: '#faf9f5',
      symbolColor: '#5b554d',
      height: TITLEBAR_OVERLAY_HEIGHT,
    });
  });

  it('uses CSS hex colors that native chrome accepts (no var() refs)', () => {
    for (const effective of ['dark', 'light'] as const) {
      const overlay = resolveTitleBarOverlay(effective);
      expect(overlay.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(overlay.symbolColor).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('titleBarOverlayForPreference', () => {
  it('honors explicit light/dark preferences regardless of the system theme', () => {
    expect(titleBarOverlayForPreference('dark', false)).toEqual(resolveTitleBarOverlay('dark'));
    expect(titleBarOverlayForPreference('light', true)).toEqual(resolveTitleBarOverlay('light'));
  });

  it('follows the system theme when preference is system', () => {
    expect(titleBarOverlayForPreference('system', true)).toEqual(resolveTitleBarOverlay('dark'));
    expect(titleBarOverlayForPreference('system', false)).toEqual(resolveTitleBarOverlay('light'));
  });
});
