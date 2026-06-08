export type PaletteId = 'clay' | 'indigo' | 'ocean' | 'emerald' | 'violet';

export interface PaletteOption {
  id: PaletteId;
  label: string;
  description: string;
  /** Representative swatch color shown in the picker. */
  swatch: string;
}

// Orthogonal to light/dark: a palette only re-tints the accent family. "Clay"
// is the default (the base tokens in styles.css); the rest are applied via the
// [data-palette] attribute.
export const PALETTES: readonly PaletteOption[] = [
  { id: 'clay', label: 'Clay', description: 'Warm terracotta (default)', swatch: '#c15f3c' },
  { id: 'indigo', label: 'Indigo', description: 'Cool blue-violet', swatch: '#5e5ce6' },
  { id: 'ocean', label: 'Ocean', description: 'Deep teal', swatch: '#0e7d8c' },
  { id: 'emerald', label: 'Emerald', description: 'Fresh green', swatch: '#15803d' },
  { id: 'violet', label: 'Violet', description: 'Rich purple', swatch: '#7c3aed' },
];

const STORAGE_KEY = 'opencodex-palette';
const DEFAULT_PALETTE: PaletteId = 'clay';
const VALID_IDS = new Set<PaletteId>(PALETTES.map((p) => p.id));

export const PALETTE_CHANGED_EVENT = 'opencodex:palette-changed';

export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === 'string' && VALID_IDS.has(value as PaletteId);
}

/** Read the persisted palette, falling back to the default for missing/invalid. */
export function getStoredPalette(): PaletteId {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isPaletteId(raw) ? raw : DEFAULT_PALETTE;
  } catch {
    return DEFAULT_PALETTE;
  }
}

/** Reflect the palette onto the document so the CSS [data-palette] rules apply. */
export function applyPalette(id: PaletteId): void {
  document.documentElement.setAttribute('data-palette', id);
}

/** Persist + apply + notify any open pickers. */
export function setStoredPalette(id: PaletteId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // localStorage may be disabled — the in-session apply below still works.
  }
  applyPalette(id);
  window.dispatchEvent(new CustomEvent<PaletteId>(PALETTE_CHANGED_EVENT, { detail: id }));
}
