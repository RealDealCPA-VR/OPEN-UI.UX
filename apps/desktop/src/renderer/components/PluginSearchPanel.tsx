import { useEffect, useMemo, useState } from 'react';

interface RegistryEntry {
  name: string;
  version: string;
  displayName: string;
  description?: string;
  author?: string;
  installUrl: string;
  permissions?: string[];
  contributions?: {
    tools?: string[];
    providers?: string[];
    runners?: string[];
    panels?: string[];
    slashCommands?: string[];
  };
  signature?: string;
  signer?: string;
}

type ContributionFilter = 'any' | 'tools' | 'providers' | 'runners' | 'panels';

export function PluginSearchPanel(): JSX.Element {
  const [entries, setEntries] = useState<RegistryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [contribFilter, setContribFilter] = useState<ContributionFilter>('any');
  const [permFilter, setPermFilter] = useState('');
  const [installingName, setInstallingName] = useState<string | null>(null);
  const [registryUrl, setRegistryUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const urlRes = await window.opencodex.plugins.getRegistryUrl();
        if (cancelled) return;
        setRegistryUrl(urlRes.url);
        const reg = await window.opencodex.plugins.fetchRegistry();
        if (cancelled) return;
        if (reg.error) {
          setError(reg.error);
          setEntries([]);
        } else {
          setEntries(reg.entries as RegistryEntry[]);
          setError(null);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setEntries([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = query.trim().toLowerCase();
    const permQ = permFilter.trim().toLowerCase();
    return entries.filter((entry) => {
      if (q.length > 0) {
        const hay = `${entry.name} ${entry.displayName} ${entry.description ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (contribFilter !== 'any') {
        const c = entry.contributions ?? {};
        const list = c[contribFilter];
        if (!list || list.length === 0) return false;
      }
      if (permQ.length > 0) {
        const perms = (entry.permissions ?? []).map((p) => p.toLowerCase());
        if (!perms.some((p) => p.includes(permQ))) return false;
      }
      return true;
    });
  }, [entries, query, contribFilter, permFilter]);

  const onInstall = async (entry: RegistryEntry): Promise<void> => {
    setInstallingName(entry.name);
    setError(null);
    try {
      // The install URL is honored by the existing plugins:install-from-path flow once the
      // download/extract path lands; for now the panel surfaces the install intent.
      await window.opencodex.plugins.installFromPath({ path: entry.installUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstallingName(null);
    }
  };

  if (!entries) {
    return <p className="settings-section-desc">Loading registry…</p>;
  }

  return (
    <div className="plugin-search-panel">
      <div className="plugin-search-toolbar">
        <input
          type="search"
          className="input"
          placeholder="Search by name or description…"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          data-testid="plugin-search-query"
        />
        <select
          className="input"
          value={contribFilter}
          onChange={(e) => setContribFilter(e.currentTarget.value as ContributionFilter)}
          aria-label="Contribution filter"
        >
          <option value="any">Any contribution</option>
          <option value="tools">Tools</option>
          <option value="providers">Providers</option>
          <option value="runners">Runners</option>
          <option value="panels">Panels</option>
        </select>
        <input
          type="search"
          className="input"
          placeholder="Permission contains…"
          value={permFilter}
          onChange={(e) => setPermFilter(e.currentTarget.value)}
          aria-label="Permission filter"
        />
      </div>
      <p className="plugins-registry">
        Registry: <code>{registryUrl ?? 'none configured'}</code>
      </p>
      {error && (
        <div className="mcp-panel-error" role="alert">
          {error}
        </div>
      )}
      {filtered.length === 0 ? (
        <p className="settings-section-desc">
          {entries.length === 0 ? 'Registry is empty.' : 'No plugins match your filters.'}
        </p>
      ) : (
        <ul className="plugin-list">
          {filtered.map((entry) => {
            const signed = Boolean(entry.signature && entry.signer);
            const busy = installingName === entry.name;
            return (
              <li key={`${entry.name}-${entry.version}`} className="plugin-row">
                <div className="plugin-head">
                  <span className="plugin-name">{entry.displayName}</span>
                  <span
                    className={`plugin-status plugin-status-${signed ? 'loaded' : 'pending-permissions'}`}
                    title={
                      signed ? `Signed by ${entry.signer}` : 'Unsigned — install at your own risk'
                    }
                  >
                    {signed ? `signed: ${entry.signer}` : 'unsigned'}
                  </span>
                </div>
                <div className="plugin-meta">
                  <span>v{entry.version}</span>
                  {entry.author && <span>by {entry.author}</span>}
                </div>
                {entry.description && <p className="plugin-desc">{entry.description}</p>}
                {entry.permissions && entry.permissions.length > 0 && (
                  <div className="plugin-perms">
                    {entry.permissions.map((p) => (
                      <span key={p} className="plugin-perm pending">
                        {p}
                      </span>
                    ))}
                  </div>
                )}
                <div className="plugin-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void onInstall(entry)}
                  >
                    {busy ? 'Installing…' : 'Install'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
