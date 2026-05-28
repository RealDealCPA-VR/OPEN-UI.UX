import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const STORAGE_KEY = 'opencodex.codebase.recent-files';
const MAX_RECENTS = 10;

function readRecents(): string[] {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === 'string').slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function basename(p: string): string {
  const cleaned = p.replace(/[\\/]$/, '');
  const parts = cleaned.split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}

export default function CodebaseContextPane(): JSX.Element {
  const navigate = useNavigate();
  const [recents, setRecents] = useState<string[]>(() => readRecents());

  useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (e.key === STORAGE_KEY) setRecents(readRecents());
    };
    window.addEventListener('storage', onStorage);
    const id = window.setInterval(() => {
      const fresh = readRecents();
      setRecents((prev) =>
        prev.length === fresh.length && prev.every((v, i) => v === fresh[i]) ? prev : fresh,
      );
    }, 2000);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="lcc-pane lcc-pane-codebase">
      <div className="lcc-pane-head">
        <span className="lcc-pane-title">Recent files</span>
      </div>
      {recents.length === 0 ? (
        <p className="lcc-pane-empty">Files you open in the codebase view will appear here.</p>
      ) : (
        <ul className="lcc-list">
          {recents.map((path) => (
            <li key={path} className="lcc-list-row">
              <button
                type="button"
                className="lcc-list-btn"
                onClick={() => navigate(`/codebase?file=${encodeURIComponent(path)}`)}
                title={path}
              >
                <span className="lcc-list-title">{basename(path)}</span>
                <span className="lcc-list-meta">{path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
