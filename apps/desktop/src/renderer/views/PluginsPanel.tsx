import { useEffect, useState } from 'react';
import type { Permission } from '@opencodex/plugin-sdk';
import type { PluginListItem } from '../../shared/plugins';

export function PluginsPanel(): JSX.Element {
  const [plugins, setPlugins] = useState<PluginListItem[] | null>(null);
  const [registryUrl, setRegistryUrl] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingUninstall, setConfirmingUninstall] = useState<string | null>(null);

  useEffect(() => {
    void window.opencodex.plugins.list().then((r) => setPlugins(r.plugins));
    void window.opencodex.plugins.getRegistryUrl().then((r) => setRegistryUrl(r.url));
    return window.opencodex.plugins.onChanged((evt) => setPlugins(evt.plugins));
  }, []);

  if (!plugins) return <p className="settings-section-desc">Loading…</p>;

  const onInstall = async (): Promise<void> => {
    setBusyId('__install__');
    setError(null);
    try {
      const result = await window.opencodex.plugins.browseAndInstall();
      if (!result.canceled) setPlugins(result.plugins);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const onToggle = async (item: PluginListItem): Promise<void> => {
    setBusyId(item.id);
    setError(null);
    try {
      const result = await window.opencodex.plugins.setEnabled({
        id: item.id,
        enabled: !item.enabled,
      });
      setPlugins(result.plugins);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const onGrant = async (item: PluginListItem): Promise<void> => {
    setBusyId(item.id);
    setError(null);
    try {
      const result = await window.opencodex.plugins.grantPermissions({
        id: item.id,
        permissions: item.manifest.permissions as Permission[],
      });
      setPlugins(result.plugins);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const onUninstall = async (item: PluginListItem): Promise<void> => {
    setBusyId(item.id);
    setError(null);
    try {
      const result = await window.opencodex.plugins.uninstall({ id: item.id });
      setPlugins(result.plugins);
      setConfirmingUninstall(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="plugins-panel">
      {error && <div className="mcp-panel-error">{error}</div>}
      <div className="plugins-toolbar">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void onInstall()}
          disabled={busyId === '__install__'}
        >
          Install from folder…
        </button>
        <span className="plugins-registry">
          Registry: <code>{registryUrl ?? 'none configured'}</code>
        </span>
      </div>
      {plugins.length === 0 ? (
        <p className="settings-section-desc">No plugins installed.</p>
      ) : (
        <ul className="plugin-list">
          {plugins.map((item) => (
            <li key={item.id} className="plugin-row">
              <div className="plugin-head">
                <span className="plugin-name">{item.manifest.displayName}</span>
                <span className={`plugin-status plugin-status-${item.status}`}>{item.status}</span>
              </div>
              <div className="plugin-meta">
                <span>v{item.manifest.version}</span>
                {item.manifest.author && <span>by {item.manifest.author}</span>}
                {item.registeredTools.length > 0 && (
                  <span>tools: {item.registeredTools.length}</span>
                )}
              </div>
              {item.manifest.description && (
                <p className="plugin-desc">{item.manifest.description}</p>
              )}
              {item.manifest.permissions.length > 0 && (
                <div className="plugin-perms">
                  {item.manifest.permissions.map((p) => (
                    <span
                      key={p}
                      className={`plugin-perm ${
                        item.grantedPermissions.includes(p) ? 'granted' : 'pending'
                      }`}
                    >
                      {p}
                    </span>
                  ))}
                </div>
              )}
              {item.lastError && (
                <div className="plugin-error" role="alert">
                  {item.lastError}
                </div>
              )}
              {item.status === 'pending-permissions' &&
                item.manifest.contributions.runners &&
                item.manifest.contributions.runners.length > 0 && (
                  <div className="plugin-runners-preamble">
                    This plugin will register {item.manifest.contributions.runners.length} agent
                    runner
                    {item.manifest.contributions.runners.length === 1 ? '' : 's'}:{' '}
                    {item.manifest.contributions.runners.map((r) => r.displayName).join(', ')}
                  </div>
                )}
              <div className="plugin-actions">
                {item.status === 'pending-permissions' && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void onGrant(item)}
                    disabled={busyId === item.id}
                  >
                    Grant permissions
                  </button>
                )}
                <button
                  type="button"
                  className="btn"
                  onClick={() => void onToggle(item)}
                  disabled={busyId === item.id}
                >
                  {item.enabled ? 'Disable' : 'Enable'}
                </button>
                {confirmingUninstall === item.id ? (
                  <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: 'var(--danger, #dc2626)' }}>
                      Uninstall {item.manifest.displayName}?
                    </span>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => void onUninstall(item)}
                      disabled={busyId === item.id}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setConfirmingUninstall(null)}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => setConfirmingUninstall(item.id)}
                    disabled={busyId === item.id}
                  >
                    Uninstall
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
