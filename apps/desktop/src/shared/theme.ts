export type ThemePreference = 'light' | 'dark' | 'system';
export type EffectiveTheme = 'light' | 'dark';

export const THEME_PREFERENCES: ThemePreference[] = ['light', 'dark', 'system'];

export const THEME_OPTIONS: ReadonlyArray<{
  value: ThemePreference;
  label: string;
  description: string;
}> = [
  { value: 'light', label: 'Light', description: 'Always use the light theme.' },
  { value: 'dark', label: 'Dark', description: 'Always use the dark theme.' },
  {
    value: 'system',
    label: 'System',
    description: 'Match the OS color-scheme preference.',
  },
];

export interface SetThemeRequest {
  preference: ThemePreference;
}

export interface ThemeChangedEvent {
  preference: ThemePreference;
}

export function resolveEffectiveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): EffectiveTheme {
  if (preference === 'light') return 'light';
  if (preference === 'dark') return 'dark';
  return systemPrefersDark ? 'dark' : 'light';
}

export function isThemePreference(v: unknown): v is ThemePreference {
  return v === 'light' || v === 'dark' || v === 'system';
}

export const INITIAL_THEME_ARG_PREFIX = '--initial-theme=';

export function parseInitialThemeArg(argv: readonly string[]): ThemePreference {
  for (const a of argv) {
    if (a.startsWith(INITIAL_THEME_ARG_PREFIX)) {
      const v = a.slice(INITIAL_THEME_ARG_PREFIX.length);
      if (isThemePreference(v)) return v;
    }
  }
  return 'system';
}
