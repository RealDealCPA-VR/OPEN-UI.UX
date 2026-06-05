import { useEffect, useRef } from 'react';
import type { SettingsSection } from '../views/settings-sections';

export interface SettingsRailProps {
  sections: readonly SettingsSection[];
  activeSlug: string;
  onSelect: (slug: string) => void;
  query: string;
  onQueryChange: (next: string) => void;
}

export function SettingsRail({
  sections,
  activeSlug,
  onSelect,
  query,
  onQueryChange,
}: SettingsRailProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Scope Cmd/Ctrl+F to the enclosing .settings-view so the shortcut does
    // not steal focus when the user is anywhere else in the app.
    const settingsRoot = navRef.current?.closest('.settings-view');
    if (!settingsRoot) return;
    const onKey = (e: Event): void => {
      const ke = e as KeyboardEvent;
      const isMeta = ke.metaKey || ke.ctrlKey;
      if (isMeta && ke.key === 'f') {
        ke.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    settingsRoot.addEventListener('keydown', onKey);
    return () => settingsRoot.removeEventListener('keydown', onKey);
  }, []);

  return (
    <nav ref={navRef} className="settings-rail" aria-label="Settings sections">
      <div className="settings-rail-search">
        <input
          ref={inputRef}
          type="search"
          className="settings-rail-search-input"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search settings…"
          aria-label="Search settings"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query.length > 0) {
              e.preventDefault();
              onQueryChange('');
            }
          }}
        />
        {query.length > 0 && (
          <button
            type="button"
            className="settings-rail-search-clear"
            onClick={() => onQueryChange('')}
            aria-label="Clear search"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <line
                x1="1"
                y1="1"
                x2="9"
                y2="9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <line
                x1="9"
                y1="1"
                x2="1"
                y2="9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>
      <ul className="settings-rail-list">
        {sections.length === 0 ? (
          <li className="settings-rail-empty">No matches for &ldquo;{query}&rdquo;</li>
        ) : (
          sections.map((section) => {
            const active = section.slug === activeSlug;
            return (
              <li key={section.slug}>
                <button
                  type="button"
                  className={active ? 'settings-rail-link active' : 'settings-rail-link'}
                  onClick={() => onSelect(section.slug)}
                  aria-current={active ? 'page' : undefined}
                >
                  {section.title}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </nav>
  );
}
