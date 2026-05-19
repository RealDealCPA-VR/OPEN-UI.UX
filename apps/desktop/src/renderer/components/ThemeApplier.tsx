import { useEffect } from 'react';
import { resolveEffectiveTheme, type ThemePreference } from '../../shared/theme';

function apply(preference: ThemePreference): void {
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const effective = resolveEffectiveTheme(preference, systemDark);
  document.documentElement.setAttribute('data-theme', effective);
}

export function ThemeApplier(): null {
  useEffect(() => {
    let current: ThemePreference = window.opencodex.theme.getInitialPreference();
    apply(current);

    void window.opencodex.theme.get().then((p) => {
      current = p;
      apply(current);
    });

    const unsubscribe = window.opencodex.theme.onChanged((payload) => {
      current = payload.preference;
      apply(current);
    });

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onMediaChange = (): void => {
      if (current === 'system') apply(current);
    };
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onMediaChange);
    } else {
      media.addListener(onMediaChange);
    }

    return () => {
      unsubscribe();
      if (typeof media.removeEventListener === 'function') {
        media.removeEventListener('change', onMediaChange);
      } else {
        media.removeListener(onMediaChange);
      }
    };
  }, []);

  return null;
}
