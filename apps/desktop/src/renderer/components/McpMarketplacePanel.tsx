import { useCallback, useEffect, useMemo, useState } from 'react';
import type { McpServerPreset, McpState } from '../../shared/mcp';
import type { McpFetchRegistryResponse, McpRegistryEntry } from '../../shared/mcp-registry';
import { getBridge } from '../bridge';

interface MarketplaceCard {
  id: string;
  source: 'preset' | 'registry';
  displayName: string;
  description: string;
  author?: string;
  version?: string;
  homepageUrl?: string;
  permissionCategories: string[];
  template: McpServerPreset['template'];
}

export function McpMarketplacePanel(): JSX.Element {
  const [state, setState] = useState<McpState | null>(null);
  const [presets, setPresets] = useState<readonly McpServerPreset[]>([]);
  const [registry, setRegistry] = useState<McpFetchRegistryResponse | null>(null);
  const [registryUrl, setRegistryUrlState] = useState<string>('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingUrl, setEditingUrl] = useState(false);
  const [draftUrl, setDraftUrl] = useState('');

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    void bridge.mcp.list().then(setState);
    void bridge.mcp.presets().then(setPresets);
    const off = bridge.mcp.onChanged((next) => setState(next));
    void bridge.mcp.getRegistryUrl().then(({ url }) => {
      setRegistryUrlState(url);
      setDraftUrl(url);
    });
    void bridge.mcp.fetchRegistry().then(setRegistry);
    return off;
  }, []);

  const onRefresh = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge) return;
    setError(null);
    const next = await bridge.mcp.fetchRegistry();
    setRegistry(next);
    if (next.error) setError(next.error);
  }, []);

  const onSaveUrl = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge) return;
    const trimmed = draftUrl.trim();
    try {
      const res = await bridge.mcp.setRegistryUrl(trimmed.length === 0 ? null : trimmed);
      setRegistryUrlState(res.url);
      setEditingUrl(false);
      const next = await bridge.mcp.fetchRegistry();
      setRegistry(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [draftUrl]);

  const cards: MarketplaceCard[] = useMemo(() => {
    const addedIds = new Set((state?.servers ?? []).map((s) => s.id));
    const fromPresets: MarketplaceCard[] = presets
      .filter((p) => !addedIds.has(p.id))
      .map((p) => ({
        id: `preset:${p.id}`,
        source: 'preset',
        displayName: p.displayName,
        description: p.description,
        permissionCategories: [],
        template: p.template,
      }));
    const fromRegistry: McpRegistryEntry[] = registry?.entries ?? [];
    const fromRegistryCards: MarketplaceCard[] = fromRegistry
      .filter((e) => !addedIds.has(e.template.id))
      .map((e) => ({
        id: `registry:${e.id}`,
        source: 'registry',
        displayName: e.displayName,
        description: e.description,
        ...(e.author !== undefined ? { author: e.author } : {}),
        ...(e.version !== undefined ? { version: e.version } : {}),
        ...(e.homepageUrl !== undefined ? { homepageUrl: e.homepageUrl } : {}),
        permissionCategories: e.permissionCategories ?? [],
        template: e.template,
      }));
    return [...fromPresets, ...fromRegistryCards];
  }, [presets, registry, state]);

  const onInstall = useCallback(async (card: MarketplaceCard) => {
    const bridge = getBridge();
    if (!bridge) return;
    setBusyId(card.id);
    setError(null);
    try {
      await bridge.mcp.add({ ...card.template, enabled: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }, []);

  return (
    <div className="mcp-marketplace">
      <header className="mcp-marketplace-head">
        <div>
          <h3 style={{ margin: 0 }}>MCP Marketplace</h3>
          <p className="settings-section-desc" style={{ margin: '4px 0 0 0' }}>
            Curated presets plus servers fetched from a remote registry. Installing only adds the
            config — you still need to enable it.
          </p>
        </div>
        <button type="button" className="btn" onClick={() => void onRefresh()}>
          Refresh
        </button>
      </header>
      <section className="mcp-marketplace-registry-url">
        {editingUrl ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="url"
              className="text-input"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              placeholder="https://opencodex.dev/mcp-registry.json"
              style={{ flex: 1 }}
            />
            <button type="button" className="btn btn-primary" onClick={() => void onSaveUrl()}>
              Save
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setEditingUrl(false);
                setDraftUrl(registryUrl);
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{registryUrl}</code>
            <button type="button" className="btn btn-ghost" onClick={() => setEditingUrl(true)}>
              Change
            </button>
            {registry?.cached && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>cached</span>
            )}
            {registry?.fetchedAt && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                fetched {new Date(registry.fetchedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        )}
      </section>
      {error && (
        <div className="mcp-panel-error" role="alert" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
      {registry?.error && (
        <div className="mcp-panel-error" role="alert" style={{ marginTop: 8 }}>
          Registry: {registry.error}
        </div>
      )}
      {cards.length === 0 ? (
        <p className="settings-section-desc" style={{ marginTop: 12 }}>
          Nothing to install — either everything is already installed or the registry is empty.
        </p>
      ) : (
        <ul className="mcp-marketplace-grid">
          {cards.map((card) => (
            <li key={card.id} className="mcp-marketplace-card">
              <div className="mcp-marketplace-card-head">
                <div className="mcp-marketplace-card-title">{card.displayName}</div>
                <span className={`mcp-marketplace-source-${card.source}`}>{card.source}</span>
              </div>
              <p className="mcp-marketplace-card-desc">{card.description}</p>
              {card.permissionCategories.length > 0 && (
                <div className="mcp-marketplace-perm-preview">
                  {card.permissionCategories.map((c) => (
                    <span key={c} className="mcp-perm-chip">
                      {c}
                    </span>
                  ))}
                </div>
              )}
              <div className="mcp-marketplace-card-meta">
                {card.author && <span>by {card.author}</span>}
                {card.version && <span>v{card.version}</span>}
                {card.homepageUrl && (
                  <a href={card.homepageUrl} target="_blank" rel="noopener noreferrer">
                    homepage
                  </a>
                )}
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void onInstall(card)}
                disabled={busyId === card.id}
              >
                {busyId === card.id ? 'Installing…' : 'Install'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
