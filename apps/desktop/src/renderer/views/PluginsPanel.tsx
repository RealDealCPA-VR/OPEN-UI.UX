import { useEffect, useMemo, useState } from 'react';
import type { Permission } from '@opencodex/plugin-sdk';
import { PluginSearchPanel } from '../components/PluginSearchPanel';
import type { PluginPreset } from '../../shared/ipc-types';
import type { PluginListItem } from '../../shared/plugins';

export function PluginsPanel(): JSX.Element {
  const [tab, setTab] = useState<'installed' | 'search'>('installed');
  const [plugins, setPlugins] = useState<PluginListItem[] | null>(null);
  const [presets, setPresets] = useState<PluginPreset[]>([]);
  const [registryUrl, setRegistryUrl] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingUninstall, setConfirmingUninstall] = useState<string | null>(null);

  useEffect(() => {
    void window.opencodex.plugins.list().then((r) => setPlugins(r.plugins));
    void window.opencodex.plugins.getRegistryUrl().then((r) => setRegistryUrl(r.url));
    void window.opencodex.plugins
      .listPresets()
      .then(setPresets)
      .catch(() => {
        // Non-fatal — preset cards just don't render.
      });
    return window.opencodex.plugins.onChanged((evt) => setPlugins(evt.plugins));
  }, []);

  const availablePresets = useMemo(() => {
    if (!plugins) return [];
    const installedNames = new Set(plugins.map((p) => p.manifest.name));
    return presets.filter((preset) => !installedNames.has(preset.id));
  }, [plugins, presets]);

  const onInstallPreset = async (presetId: string): Promise<void> => {
    setBusyId(`preset:${presetId}`);
    setError(null);
    try {
      const result = await window.opencodex.plugins.installPreset(presetId);
      setPlugins(result.plugins);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const onSideload = async (): Promise<void> => {
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

  if (tab === 'search') {
    return (
      <div className="plugins-panel">
        <div className="plugins-tabs settings-field-row">
          <button type="button" className="btn" onClick={() => setTab('installed')}>
            Installed
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setTab('search')}>
            Search
          </button>
        </div>
        <PluginSearchPanel />
      </div>
    );
  }

  if (!plugins) return <p className="settings-block-hint">Loading…</p>;

  return (
    <div className="plugins-panel">
      <div className="plugins-tabs settings-field-row">
        <button type="button" className="btn btn-primary" onClick={() => setTab('installed')}>
          Installed
        </button>
        <button type="button" className="btn" onClick={() => setTab('search')}>
          Search
        </button>
      </div>
      {error && <div className="mcp-panel-error">{error}</div>}

      {availablePresets.length > 0 && (
        <div className="settings-block plugins-presets">
          <h3 className="settings-subhead">Available plugins</h3>
          <p className="settings-block-hint">
            Bundled with OpenCodex. Click Install to enable — no download required.
          </p>
          <ul className="plugins-presets-list">
            {availablePresets.map((preset) => {
              const presetBusy = busyId === `preset:${preset.id}`;
              return (
                <li key={preset.id} className="plugins-preset-card">
                  <div className="plugins-preset-card-body">
                    <strong>{preset.displayName}</strong>
                    <p>{preset.description}</p>
                    {preset.installHint && (
                      <p className="plugins-preset-hint">{preset.installHint}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void onInstallPreset(preset.id)}
                    disabled={presetBusy}
                  >
                    {presetBusy ? 'Installing…' : 'Install'}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="plugins-toolbar">
        <button
          type="button"
          className="btn"
          onClick={() => void onSideload()}
          disabled={busyId === '__install__'}
          title="Pick a folder containing an opencodex.plugin.json (developer / power-user path)"
        >
          Sideload from folder…
        </button>
        <span className="plugins-registry">
          Registry: <code>{registryUrl ?? 'none configured'}</code>
        </span>
      </div>
      {plugins.length === 0 ? (
        <div className="audit-empty-state" role="status">
          <p className="audit-empty">No plugins installed.</p>
          <p className="audit-empty-sub">
            Plugins can contribute new tools, providers, runners, slash commands, or UI panels.
            Click <strong>Install from folder</strong> to load one from disk, or switch to the{' '}
            <strong>Registry</strong> tab to browse signed entries.
          </p>
        </div>
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
                  <span className="plugin-uninstall-confirm settings-field-row">
                    <span className="field-errors">Uninstall {item.manifest.displayName}?</span>
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
