import { useCallback, useEffect, useState } from 'react';
import type {
  McpPromptEntry,
  McpResourceEntry,
  McpServerEntry,
  McpServerPreset,
  McpState,
} from '../../shared/mcp';

type PresetView = McpServerPreset;
type ExpandKind = 'tools' | 'resources' | 'prompts';

export function McpServersPanel(): JSX.Element {
  const [state, setState] = useState<McpState | null>(null);
  const [presets, setPresets] = useState<PresetView[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<{ serverId: string; kind: ExpandKind } | null>(null);
  const [prompts, setPrompts] = useState<McpPromptEntry[] | null>(null);
  const [resources, setResources] = useState<McpResourceEntry[] | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);

  useEffect(() => {
    void window.opencodex.mcp.list().then(setState);
    void window.opencodex.mcp.presets().then((p) => setPresets(p as PresetView[]));
    return window.opencodex.mcp.onChanged((next) => setState(next));
  }, []);

  const ensurePromptsLoaded = useCallback(async (): Promise<void> => {
    if (prompts !== null) return;
    try {
      const list = await window.opencodex.mcp.listPrompts();
      setPrompts(list);
    } catch {
      setPrompts([]);
    }
  }, [prompts]);

  const ensureResourcesLoaded = useCallback(async (): Promise<void> => {
    if (resources !== null) return;
    try {
      const list = await window.opencodex.mcp.listResources();
      setResources(list);
    } catch {
      setResources([]);
    }
  }, [resources]);

  if (!state) return <p className="settings-section-desc">Loading…</p>;

  const addedIds = new Set(state.servers.map((s) => s.id));
  const availablePresets = presets.filter((p) => !addedIds.has(p.id));

  const onAddPreset = async (preset: PresetView): Promise<void> => {
    setBusyId(preset.id);
    setError(null);
    try {
      await window.opencodex.mcp.add({ ...preset.template, enabled: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const onToggle = async (server: McpServerEntry): Promise<void> => {
    setBusyId(server.id);
    setError(null);
    try {
      await window.opencodex.mcp.setEnabled({ id: server.id, enabled: !server.enabled });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const onRemove = async (server: McpServerEntry): Promise<void> => {
    setBusyId(server.id);
    setError(null);
    try {
      await window.opencodex.mcp.remove({ id: server.id });
      setConfirmingRemove((id) => (id === server.id ? null : id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const onToggleExpand = (serverId: string, kind: ExpandKind): void => {
    const isOpen = expanded?.serverId === serverId && expanded.kind === kind;
    if (isOpen) {
      setExpanded(null);
      return;
    }
    setExpanded({ serverId, kind });
    if (kind === 'prompts') void ensurePromptsLoaded();
    if (kind === 'resources') void ensureResourcesLoaded();
  };

  return (
    <div className="mcp-panel">
      {error && (
        <div className="mcp-panel-error" role="alert">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            style={{
              marginLeft: 8,
              background: 'transparent',
              border: '1px solid currentColor',
              color: 'inherit',
              borderRadius: 4,
              padding: '2px 8px',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      {state.servers.length === 0 ? (
        <p className="settings-section-desc">
          No MCP servers configured. Add one from the curated presets below.
        </p>
      ) : (
        <ul className="mcp-server-list">
          {state.servers.map((server) => {
            const status = state.status[server.id];
            const counts = status
              ? {
                  tools: status.toolCount,
                  resources: status.resourceCount,
                  prompts: status.promptCount,
                }
              : { tools: 0, resources: 0, prompts: 0 };
            const busy = busyId === server.id;
            return (
              <li
                key={server.id}
                className="mcp-server-row"
                data-settings-anchor={`mcp:${server.id}`}
              >
                <div className="mcp-server-head">
                  <span className="mcp-server-name">{server.displayName}</span>
                  <span className={`mcp-status mcp-status-${status?.status ?? 'disconnected'}`}>
                    {busy && <InlineSpinner aria-label="Working" />}
                    {status?.status ?? 'disconnected'}
                  </span>
                </div>
                <div className="mcp-server-meta">
                  <span>kind: {server.config.kind}</span>
                  {status?.serverInfo && (
                    <span>
                      {status.serverInfo.name} v{status.serverInfo.version}
                    </span>
                  )}
                  {status && (
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      <CountButton label="tools" count={counts.tools} disabled />
                      <CountButton
                        label="resources"
                        count={counts.resources}
                        disabled={counts.resources === 0}
                        active={expanded?.serverId === server.id && expanded.kind === 'resources'}
                        onClick={() => onToggleExpand(server.id, 'resources')}
                      />
                      <CountButton
                        label="prompts"
                        count={counts.prompts}
                        disabled={counts.prompts === 0}
                        active={expanded?.serverId === server.id && expanded.kind === 'prompts'}
                        onClick={() => onToggleExpand(server.id, 'prompts')}
                      />
                    </span>
                  )}
                  {status?.lastError && <span className="mcp-error">{status.lastError}</span>}
                </div>
                {expanded?.serverId === server.id && expanded.kind === 'resources' && (
                  <ExpandedList
                    items={(resources ?? []).filter((r) => r.serverId === server.id)}
                    loading={resources === null}
                    render={(r) => (
                      <span key={r.resource.uri}>
                        <code style={{ fontSize: 11 }}>{r.resource.uri}</code>
                        {r.resource.name && r.resource.name !== r.resource.uri ? (
                          <span style={{ color: 'var(--text-muted,#98a0aa)' }}>
                            {' '}
                            — {r.resource.name}
                          </span>
                        ) : null}
                      </span>
                    )}
                  />
                )}
                {expanded?.serverId === server.id && expanded.kind === 'prompts' && (
                  <ExpandedList
                    items={(prompts ?? []).filter((p) => p.serverId === server.id)}
                    loading={prompts === null}
                    render={(p) => (
                      <span key={p.prompt.name}>
                        <code style={{ fontSize: 11 }}>{p.prompt.name}</code>
                        {p.prompt.description ? (
                          <span style={{ color: 'var(--text-muted,#98a0aa)' }}>
                            {' '}
                            — {p.prompt.description}
                          </span>
                        ) : null}
                      </span>
                    )}
                  />
                )}
                <div className="mcp-server-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void onToggle(server)}
                    disabled={busy}
                  >
                    {busy ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <InlineSpinner aria-hidden="true" /> Working…
                      </span>
                    ) : server.enabled ? (
                      'Disable'
                    ) : (
                      'Enable'
                    )}
                  </button>
                  {confirmingRemove === server.id ? (
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => void onRemove(server)}
                        disabled={busy}
                      >
                        Confirm remove
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setConfirmingRemove(null)}
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => setConfirmingRemove(server.id)}
                      disabled={busy}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {availablePresets.length > 0 && (
        <div className="mcp-presets">
          <h3>Curated presets</h3>
          <ul className="mcp-preset-list">
            {availablePresets.map((preset) => (
              <li key={preset.id} className="mcp-preset-row">
                <div className="mcp-preset-text">
                  <div className="mcp-preset-name">{preset.displayName}</div>
                  <div className="mcp-preset-desc">{preset.description}</div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void onAddPreset(preset)}
                  disabled={busyId === preset.id}
                >
                  {busyId === preset.id ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <InlineSpinner aria-hidden="true" /> Adding…
                    </span>
                  ) : (
                    'Add'
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <SpinnerStyles />
    </div>
  );
}

function CountButton({
  label,
  count,
  disabled,
  active,
  onClick,
}: {
  label: string;
  count: number;
  disabled?: boolean;
  active?: boolean;
  onClick?: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      style={{
        background: active ? 'var(--accent-soft, rgba(99,102,241,0.18))' : 'transparent',
        border: '1px solid var(--border, #2a2a32)',
        color: 'inherit',
        borderRadius: 999,
        padding: '1px 8px',
        fontSize: 11,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled && count === 0 ? 0.5 : 1,
      }}
    >
      {label}: {count}
    </button>
  );
}

function ExpandedList<T>({
  items,
  loading,
  render,
}: {
  items: T[];
  loading: boolean;
  render: (item: T) => JSX.Element;
}): JSX.Element {
  return (
    <div
      style={{
        margin: '6px 0',
        padding: '8px 10px',
        background: 'var(--bg-elevated, rgba(255,255,255,0.04))',
        borderRadius: 6,
        border: '1px solid var(--border, #2a2a32)',
      }}
    >
      {loading ? (
        <span style={{ fontSize: 12, color: 'var(--text-muted,#98a0aa)' }}>Loading…</span>
      ) : items.length === 0 ? (
        <span style={{ fontSize: 12, color: 'var(--text-muted,#98a0aa)' }}>None to show.</span>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
          {items.map((item, i) => (
            <li key={i}>{render(item)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InlineSpinner(props: { 'aria-label'?: string; 'aria-hidden'?: 'true' }): JSX.Element {
  return (
    <span
      role={props['aria-label'] ? 'status' : undefined}
      aria-label={props['aria-label']}
      aria-hidden={props['aria-hidden']}
      className="mcp-inline-spinner"
    />
  );
}

function SpinnerStyles(): JSX.Element {
  return (
    <style>{`
      .mcp-inline-spinner {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        border: 2px solid var(--border, #2a2a32);
        border-top-color: var(--accent, #6366f1);
        animation: mcp-spinner-rotate 0.7s linear infinite;
        vertical-align: -1px;
        margin-right: 4px;
      }
      @keyframes mcp-spinner-rotate {
        to { transform: rotate(360deg); }
      }
      @media (prefers-reduced-motion: reduce) {
        .mcp-inline-spinner { animation: none; }
      }
    `}</style>
  );
}
