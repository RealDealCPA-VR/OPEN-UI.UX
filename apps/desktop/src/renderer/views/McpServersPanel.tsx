import { useEffect, useState } from 'react';
import type { McpServerEntry, McpServerPreset, McpState } from '../../shared/mcp';

type PresetView = McpServerPreset;

export function McpServersPanel(): JSX.Element {
  const [state, setState] = useState<McpState | null>(null);
  const [presets, setPresets] = useState<PresetView[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.opencodex.mcp.list().then(setState);
    void window.opencodex.mcp.presets().then((p) => setPresets(p as PresetView[]));
    return window.opencodex.mcp.onChanged((next) => setState(next));
  }, []);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mcp-panel">
      {error && <div className="mcp-panel-error">{error}</div>}
      {state.servers.length === 0 ? (
        <p className="settings-section-desc">No MCP servers configured.</p>
      ) : (
        <ul className="mcp-server-list">
          {state.servers.map((server) => {
            const status = state.status[server.id];
            return (
              <li key={server.id} className="mcp-server-row">
                <div className="mcp-server-head">
                  <span className="mcp-server-name">{server.displayName}</span>
                  <span className={`mcp-status mcp-status-${status?.status ?? 'disconnected'}`}>
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
                  {status && status.toolCount + status.resourceCount + status.promptCount > 0 && (
                    <span>
                      tools: {status.toolCount} · resources: {status.resourceCount} · prompts:{' '}
                      {status.promptCount}
                    </span>
                  )}
                  {status?.lastError && <span className="mcp-error">{status.lastError}</span>}
                </div>
                <div className="mcp-server-actions">
                  <button
                    type="button"
                    onClick={() => void onToggle(server)}
                    disabled={busyId === server.id}
                  >
                    {server.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onRemove(server)}
                    disabled={busyId === server.id}
                  >
                    Remove
                  </button>
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
                <div>
                  <div className="mcp-preset-name">{preset.displayName}</div>
                  <div className="mcp-preset-desc">{preset.description}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void onAddPreset(preset)}
                  disabled={busyId === preset.id}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
