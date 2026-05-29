import { useCallback, useEffect, useState } from 'react';
import type { McpServerGrant } from '../../shared/mcp-registry';

export function McpPermissionSurface(): JSX.Element {
  const [grants, setGrants] = useState<McpServerGrant[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await window.opencodex.mcp.getPermissions();
      setGrants(res.grants);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
    const off = window.opencodex.mcp.onChanged(() => {
      void refresh();
    });
    return off;
  }, [refresh]);

  const onRevoke = useCallback(
    async (serverId: string) => {
      setBusyId(serverId);
      setError(null);
      try {
        const res = await window.opencodex.mcp.revokePermission({ serverId });
        if (!res.ok) setError(res.error ?? 'Failed to revoke');
        await refresh();
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  if (grants === null) {
    return <p className="settings-section-desc">Loading…</p>;
  }

  if (grants.length === 0) {
    return (
      <p className="settings-section-desc">
        No MCP servers installed. Permissions show up here once you install a server.
      </p>
    );
  }

  return (
    <div className="mcp-permissions">
      {error && (
        <div className="mcp-panel-error" role="alert">
          {error}
        </div>
      )}
      <ul className="mcp-perm-list">
        {grants.map((grant) => (
          <li key={grant.serverId} className="mcp-perm-row">
            <div className="mcp-perm-head">
              <span className="mcp-perm-name">{grant.serverDisplayName}</span>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void onRevoke(grant.serverId)}
                disabled={busyId === grant.serverId}
              >
                {busyId === grant.serverId ? 'Revoking…' : 'Revoke (uninstall)'}
              </button>
            </div>
            {grant.categories.length === 0 ? (
              <p className="settings-section-desc">No permissions classified.</p>
            ) : (
              <ul className="mcp-perm-categories">
                {grant.categories.map((cat) => (
                  <li
                    key={cat.id}
                    className={`mcp-perm-cat mcp-perm-cat-${cat.severity}`}
                    data-severity={cat.severity}
                  >
                    <span className="mcp-perm-cat-label">{cat.label}</span>
                    <span className="mcp-perm-cat-desc">{cat.humanReadable}</span>
                  </li>
                ))}
              </ul>
            )}
            {grant.toolNames.length > 0 && (
              <details className="mcp-perm-tools">
                <summary>Tools exposed ({grant.toolNames.length})</summary>
                <ul>
                  {grant.toolNames.map((name) => (
                    <li key={name}>
                      <code style={{ fontSize: 11 }}>{name}</code>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
