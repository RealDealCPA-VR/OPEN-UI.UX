import { useCallback, useMemo, useState } from 'react';
import { Markdown } from '../components/Markdown';
import { slugifyHeading } from '../components/markdown-parse';
import manualMarkdown from '../../../../../MANUAL.md?raw';

interface TocEntry {
  level: number;
  text: string;
  id: string;
}

function buildToc(text: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const lines = text.split('\n');
  let inFence = false;
  for (const line of lines) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const level = (match[1] as string).length;
    const raw = match[2] as string;
    entries.push({ level, text: raw.replace(/[`*_~]/g, ''), id: slugifyHeading(raw) });
  }
  return entries;
}

export function HelpPanel(): JSX.Element {
  const [filter, setFilter] = useState('');
  const toc = useMemo(() => buildToc(manualMarkdown), []);
  const filteredToc = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return toc;
    return toc.filter((e) => e.text.toLowerCase().includes(q));
  }, [toc, filter]);

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className="help-panel">
      <div className="help-toc" aria-label="Manual sections">
        <input
          className="settings-input help-toc-search"
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter sections"
          aria-label="Filter manual sections"
        />
        <ul className="help-toc-list">
          {filteredToc.map((entry) => (
            <li key={entry.id} className={`help-toc-l${entry.level}`}>
              <button type="button" className="help-toc-link" onClick={() => scrollTo(entry.id)}>
                {entry.text}
              </button>
            </li>
          ))}
          {filteredToc.length === 0 ? <li className="help-toc-empty">No sections match.</li> : null}
        </ul>
      </div>
      <div className="help-content">
        <Markdown text={manualMarkdown} />
      </div>
    </div>
  );
}
