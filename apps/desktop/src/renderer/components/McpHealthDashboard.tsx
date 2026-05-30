import { useCallback, useEffect, useState } from 'react';
import type { McpHealthStats } from '../../shared/mcp-registry';
import { getBridge } from '../bridge';

export function McpHealthDashboard(): JSX.Element {
  const [stats, setStats] = useState<McpHealthStats[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge) return;
    const res = await bridge.mcp.getHealthStats();
    setStats(res.stats);
  }, []);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    queueMicrotask(() => {
      void refresh();
    });
    const off = bridge.mcp.onChanged(() => {
      void refresh();
    });
    return () => {
      off();
    };
  }, [refresh]);

  if (stats === null) return <p className="settings-section-desc">Loading…</p>;
  if (stats.length === 0) {
    return <p className="settings-section-desc">No MCP servers configured.</p>;
  }

  return (
    <div className="mcp-health">
      <ul className="mcp-health-list">
        {stats.map((s) => {
          const isExpanded = expanded === s.serverId;
          return (
            <li key={s.serverId} className="mcp-health-row">
              <div className="mcp-health-head">
                <span className="mcp-health-name">{s.serverId}</span>
                <span className={`mcp-status mcp-status-${s.status}`}>{s.status}</span>
              </div>
              <div className="mcp-health-meta">
                <span>
                  Last seen: {s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : 'never'}
                </span>
                <span>Reconnects: {s.reconnectCount}</span>
                <span>Errors: {s.errorCount}</span>
              </div>
              {s.recentErrors.length > 0 && (
                <div className="mcp-health-errors">
                  <strong>Recent errors:</strong>
                  <ul>
                    {s.recentErrors.slice(-3).map((e, i) => (
                      <li key={`${e.at}-${i}`}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {new Date(e.at).toLocaleTimeString()}
                        </span>{' '}
                        — {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setExpanded(isExpanded ? null : s.serverId)}
              >
                {isExpanded ? 'Hide timeline' : `Show timeline (${s.events.length} events)`}
              </button>
              {isExpanded && (
                <ol className="mcp-health-timeline">
                  {s.events
                    .slice()
                    .reverse()
                    .map((e, i) => (
                      <li key={`${e.at}-${i}`} className={`mcp-health-event-${e.kind}`}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {new Date(e.at).toLocaleString()}
                        </span>{' '}
                        <strong>{e.kind}</strong>
                        {e.detail ? ` — ${e.detail}` : ''}
                      </li>
                    ))}
                </ol>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
