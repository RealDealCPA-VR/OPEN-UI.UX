import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import {
  SHORTCUTS_CATALOG,
  filterShortcuts,
  type ShortcutEntry,
  type ShortcutGroup,
} from './shortcuts-catalog';

export interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsModal({
  open,
  onClose,
}: KeyboardShortcutsModalProps): JSX.Element | null {
  const [query, setQuery] = useState('');
  const groups = useMemo<ShortcutGroup[]>(() => filterShortcuts(SHORTCUTS_CATALOG, query), [query]);
  const total = useMemo(() => groups.reduce((acc, g) => acc + g.entries.length, 0), [groups]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="kb-shortcuts-title"
      describedBy="kb-shortcuts-desc"
      className="kb-shortcuts-modal"
      backdropClassName="kb-shortcuts-backdrop"
      initialFocusSelector="input.kb-shortcuts-search"
    >
      <div className="kb-shortcuts-header">
        <h2 id="kb-shortcuts-title" className="kb-shortcuts-title">
          Keyboard shortcuts
        </h2>
        <p id="kb-shortcuts-desc" className="kb-shortcuts-desc">
          Every shortcut in OpenCodex. Press <kbd>Esc</kbd> to close.
        </p>
        <input
          type="text"
          className="kb-shortcuts-search"
          placeholder="Filter shortcuts…"
          aria-label="Filter shortcuts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      <div className="kb-shortcuts-body" role="region" aria-label="Shortcut list">
        {total === 0 ? (
          <div className="kb-shortcuts-empty">No shortcuts match &ldquo;{query}&rdquo;.</div>
        ) : (
          groups.map((g) => (
            <section key={g.scope} className="kb-shortcuts-group">
              <header className="kb-shortcuts-group-head">
                <h3 className="kb-shortcuts-group-title">{g.title}</h3>
                <p className="kb-shortcuts-group-desc">{g.description}</p>
              </header>
              <ul className="kb-shortcuts-list">
                {g.entries.map((entry) => (
                  <ShortcutRow key={entry.id} entry={entry} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
      <footer className="kb-shortcuts-footer">
        <span className="kb-shortcuts-footer-note">
          See <a href="#/settings/help">the user manual</a> for full documentation.
        </span>
        <button type="button" className="kb-shortcuts-close-btn" onClick={onClose}>
          Close
        </button>
      </footer>
    </Modal>
  );
}

function ShortcutRow({ entry }: { entry: ShortcutEntry }): JSX.Element {
  const tokens = entry.keys.split(/\s+/).filter((t) => t.length > 0);
  return (
    <li className="kb-shortcuts-row">
      <span className="kb-shortcuts-row-label">{entry.label}</span>
      <span className="kb-shortcuts-row-keys" aria-label={`shortcut: ${entry.keys}`}>
        {tokens.map((tok, i) => (
          <span key={`${entry.id}-${i}-${tok}`} className="kb-shortcuts-row-key-token">
            {/* Render keyboard caps for single-key tokens, plain text for connectives like "or" or "/" */}
            {isConnective(tok) ? (
              <span className="kb-shortcuts-row-sep">{tok}</span>
            ) : (
              <kbd>{tok}</kbd>
            )}
          </span>
        ))}
      </span>
    </li>
  );
}

function isConnective(tok: string): boolean {
  return tok === 'or' || tok === '+';
}
