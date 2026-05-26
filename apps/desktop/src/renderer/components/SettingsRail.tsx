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
  return (
    <nav className="settings-rail" aria-label="Settings sections">
      <div className="settings-rail-search">
        <input
          type="search"
          className="settings-rail-search-input"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search settings…"
          aria-label="Search settings"
        />
      </div>
      <ul className="settings-rail-list">
        {sections.length === 0 ? (
          <li className="settings-rail-empty">No matches</li>
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
