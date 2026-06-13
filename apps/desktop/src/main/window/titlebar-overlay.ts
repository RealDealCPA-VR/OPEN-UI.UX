import {
  resolveEffectiveTheme,
  type EffectiveTheme,
  type ThemePreference,
} from '../../shared/theme';

export interface TitleBarOverlayColors {
  color: string;
  symbolColor: string;
  height: number;
}

// Mirrored by the win32 titlebar min-height in renderer/styles.css — keep the
// two in sync so header content never sits under the native caption buttons.
export const TITLEBAR_OVERLAY_HEIGHT = 36;

// Colors mirror the styles.css surface/text tokens (--bg-base / --text-muted)
// for each effective theme; the overlay is native chrome, so it cannot read
// CSS variables and needs the resolved values.
const OVERLAY_BY_THEME: Record<EffectiveTheme, { color: string; symbolColor: string }> = {
  dark: { color: '#161618', symbolColor: '#9ea0a6' },
  light: { color: '#faf9f5', symbolColor: '#5b554d' },
};

export function resolveTitleBarOverlay(effective: EffectiveTheme): TitleBarOverlayColors {
  return { ...OVERLAY_BY_THEME[effective], height: TITLEBAR_OVERLAY_HEIGHT };
}

export function titleBarOverlayForPreference(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): TitleBarOverlayColors {
  return resolveTitleBarOverlay(resolveEffectiveTheme(preference, systemPrefersDark));
}
