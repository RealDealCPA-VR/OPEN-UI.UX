import { useEffect, useMemo } from 'react';
import type { CodebaseSearchHit } from '../../shared/codebase-search';
import { buildMentionGroups, selectableMentionEntries, type MentionEntry } from './mention-picker';

interface MentionPickerProps {
  query: string;
  hits: ReadonlyArray<CodebaseSearchHit>;
  loading: boolean;
  activeIndex: number;
  onSelectFile: (hit: CodebaseSearchHit) => void;
  onSelectFolder: (hit: CodebaseSearchHit) => void;
  onActiveIndexChange: (index: number) => void;
  onClose: () => void;
}

export function MentionPicker({
  query,
  hits,
  loading,
  activeIndex,
  onSelectFile,
  onSelectFolder,
  onActiveIndexChange,
}: MentionPickerProps): JSX.Element | null {
  const groups = useMemo(() => buildMentionGroups(hits, query), [hits, query]);
  const flat = useMemo(() => selectableMentionEntries(groups), [groups]);

  useEffect(() => {
    if (activeIndex >= flat.length && flat.length > 0) {
      onActiveIndexChange(0);
    }
  }, [flat.length, activeIndex, onActiveIndexChange]);

  if (flat.length === 0 && !loading) {
    return (
      <div className="slash-commands slash-commands-empty" role="listbox">
        <div className="slash-commands-empty-text">
          {query.trim().length === 0
            ? 'Type to search files and folders'
            : `No matches for "${query}"`}
        </div>
      </div>
    );
  }

  const select = (entry: MentionEntry): void => {
    if (entry.kind === 'file') onSelectFile(entry.hit);
    else if (entry.kind === 'folder') onSelectFolder(entry.hit);
  };

  let flatIndex = 0;
  return (
    <div className="slash-commands" role="listbox" aria-label="Mention context picker">
      {loading ? (
        <div className="slash-commands-group">
          <div className="slash-commands-group-head">Searching…</div>
        </div>
      ) : null}
      {groups.map((group) => (
        <div key={group.header} className="slash-commands-group">
          <div className="slash-commands-group-head">
            {group.header}
            {group.badge ? <span className="pill pill-local">{group.badge}</span> : null}
          </div>
          {group.entries.map((entry) => {
            if (entry.kind === 'symbol') {
              return (
                <button
                  key="symbol:coming-soon"
                  type="button"
                  role="option"
                  aria-selected={false}
                  aria-disabled
                  disabled
                  className="slash-commands-item"
                  style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}
                >
                  <span className="slash-commands-name" style={{ flexShrink: 0 }}>
                    {entry.label}
                  </span>
                  <span className="slash-commands-desc slash-commands-desc-right">coming soon</span>
                </button>
              );
            }
            const idx = flatIndex++;
            const active = idx === activeIndex;
            const path = entry.hit.path;
            return (
              <button
                key={`${entry.kind}:${path}`}
                type="button"
                role="option"
                aria-selected={active}
                className={`slash-commands-item${active ? ' slash-commands-item-active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(entry);
                }}
                onMouseEnter={() => onActiveIndexChange(idx)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}
              >
                <span className="slash-commands-name" style={{ flexShrink: 0 }}>
                  {entry.kind === 'folder' ? `${path}/` : path}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
