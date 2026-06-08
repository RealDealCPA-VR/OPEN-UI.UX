/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStoredPalette, isPaletteId, PALETTES } from './palette';

afterEach(() => {
  vi.unstubAllGlobals();
  try {
    window.localStorage.clear();
  } catch {
    // ignore
  }
});

describe('isPaletteId', () => {
  it('accepts the five known ids', () => {
    for (const p of PALETTES) expect(isPaletteId(p.id)).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(isPaletteId('teal')).toBe(false);
    expect(isPaletteId('')).toBe(false);
    expect(isPaletteId(null)).toBe(false);
    expect(isPaletteId(42)).toBe(false);
  });
});

describe('PALETTES', () => {
  it('has exactly five distinct palettes with clay first', () => {
    expect(PALETTES).toHaveLength(5);
    expect(PALETTES[0]?.id).toBe('clay');
    expect(new Set(PALETTES.map((p) => p.id)).size).toBe(5);
  });
});

describe('getStoredPalette', () => {
  it('returns the stored value when valid', () => {
    window.localStorage.setItem('opencodex-palette', 'ocean');
    expect(getStoredPalette()).toBe('ocean');
  });

  it('falls back to clay for a missing value', () => {
    window.localStorage.removeItem('opencodex-palette');
    expect(getStoredPalette()).toBe('clay');
  });

  it('falls back to clay for an invalid value', () => {
    window.localStorage.setItem('opencodex-palette', 'bogus');
    expect(getStoredPalette()).toBe('clay');
  });
});
