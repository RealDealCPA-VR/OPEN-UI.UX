import { describe, expect, it } from 'vitest';
import {
  INITIAL_THEME_ARG_PREFIX,
  isThemePreference,
  parseInitialThemeArg,
  resolveEffectiveTheme,
} from './theme';

describe('resolveEffectiveTheme', () => {
  it('returns light when preference is light, regardless of system', () => {
    expect(resolveEffectiveTheme('light', true)).toBe('light');
    expect(resolveEffectiveTheme('light', false)).toBe('light');
  });

  it('returns dark when preference is dark, regardless of system', () => {
    expect(resolveEffectiveTheme('dark', true)).toBe('dark');
    expect(resolveEffectiveTheme('dark', false)).toBe('dark');
  });

  it('follows system when preference is system', () => {
    expect(resolveEffectiveTheme('system', true)).toBe('dark');
    expect(resolveEffectiveTheme('system', false)).toBe('light');
  });
});

describe('isThemePreference', () => {
  it('accepts the three valid values', () => {
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('system')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isThemePreference('auto')).toBe(false);
    expect(isThemePreference('')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
    expect(isThemePreference(42)).toBe(false);
  });
});

describe('parseInitialThemeArg', () => {
  it('returns the parsed preference when arg is present', () => {
    expect(parseInitialThemeArg([`${INITIAL_THEME_ARG_PREFIX}light`])).toBe('light');
    expect(parseInitialThemeArg([`${INITIAL_THEME_ARG_PREFIX}dark`])).toBe('dark');
    expect(parseInitialThemeArg([`${INITIAL_THEME_ARG_PREFIX}system`])).toBe('system');
  });

  it('defaults to system when arg is absent', () => {
    expect(parseInitialThemeArg([])).toBe('system');
    expect(parseInitialThemeArg(['--other=foo'])).toBe('system');
  });

  it('defaults to system when arg value is invalid', () => {
    expect(parseInitialThemeArg([`${INITIAL_THEME_ARG_PREFIX}bogus`])).toBe('system');
  });

  it('returns the first matching arg', () => {
    expect(
      parseInitialThemeArg([
        '--unrelated=1',
        `${INITIAL_THEME_ARG_PREFIX}dark`,
        `${INITIAL_THEME_ARG_PREFIX}light`,
      ]),
    ).toBe('dark');
  });
});
