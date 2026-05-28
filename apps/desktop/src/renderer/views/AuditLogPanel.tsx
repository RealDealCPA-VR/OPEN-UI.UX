import type { PermissionTier } from '@opencodex/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AUDIT_RETENTION_PRESETS,
  type ToolCallAuditDecision,
  type ToolCallAuditErrorFilter,
  type ToolCallAuditQuery,
  type ToolCallAuditQueryResult,
  type ToolCallAuditTriggerSource,
} from '../../shared/tool-audit';
import type { ToolListItem } from '../../shared/tools';

const PAGE_SIZE = 50;

type TimeRange = 'all' | '24h' | '7d' | '30d';

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  all: 'All time',
  '24h': 'Last 24h',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

const DECISION_LABELS: Record<ToolCallAuditDecision, string> = {
  auto: 'Auto',
  'prompt-allowed': 'Prompt → allow once',
  'prompt-allowed-session': 'Prompt → session',
  'prompt-allowed-always': 'Prompt → always',
  denied: 'Denied',
};

const ERROR_LABELS: Record<ToolCallAuditErrorFilter, string> = {
  any: 'Any',
  error: 'Errors only',
  success: 'Successful only',
};

function toSqliteTimestamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function timeRangeToSince(range: TimeRange): string | null {
  if (range === 'all') return null;
  const now = new Date();
  const offsetMs =
    range === '24h'
      ? 24 * 60 * 60 * 1000
      : range === '7d'
        ? 7 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;
  return toSqliteTimestamp(new Date(now.getTime() - offsetMs));
}

function formatTimestamp(raw: string): string {
  // SQLite CURRENT_TIMESTAMP returns "YYYY-MM-DD HH:MM:SS" in UTC.
  const iso = raw.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString();
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function safePretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function AuditLogPanel(): JSX.Element {
  const [data, setData] = useState<ToolCallAuditQueryResult | null>(null);
  const [tools, setTools] = useState<ToolListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [toolFilter, setToolFilter] = useState<string>('');
  const [decisionFilter, setDecisionFilter] = useState<string>('');
  const [errorFilter, setErrorFilter] = useState<ToolCallAuditErrorFilter>('any');
  const [triggerFilter, setTriggerFilter] = useState<ToolCallAuditTriggerSource | ''>('');
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [page, setPage] = useState(0);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyToClipboard = useCallback(async (key: string, text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((k) => (k === key ? null : k));
      }, 1200);
    } catch {
      // best-effort
    }
  }, []);

  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  const [retentionLoaded, setRetentionLoaded] = useState(false);
  const [retentionPending, setRetentionPending] = useState(false);
  const [retentionStatus, setRetentionStatus] = useState<string | null>(null);
  const [retentionError, setRetentionError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearConfirming, setClearConfirming] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await window.opencodex.tools.list();
        if (!cancelled) setTools(t);
      } catch {
        if (!cancelled) setTools([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await window.opencodex.toolAudit.getRetention();
        if (!cancelled) {
          setRetentionDays(r.retentionDays);
          setRetentionLoaded(true);
        }
      } catch (err) {
        if (!cancelled) {
          setRetentionError(err instanceof Error ? err.message : String(err));
          setRetentionLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const tierByTool = useMemo(() => {
    const out: Record<string, PermissionTier> = {};
    for (const t of tools ?? []) out[t.name] = t.permissionTier;
    return out;
  }, [tools]);

  const query: ToolCallAuditQuery = useMemo(
    () => ({
      toolNames: toolFilter ? [toolFilter] : undefined,
      decisions: decisionFilter ? [decisionFilter as ToolCallAuditDecision] : undefined,
      errorState: errorFilter,
      since: timeRangeToSince(timeRange),
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [toolFilter, decisionFilter, errorFilter, timeRange, page],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const result = await window.opencodex.toolAudit.query(query);
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query, reloadToken]);

  const resetPageAnd = useCallback((fn: () => void): void => {
    setPage(0);
    fn();
  }, []);

  const onChangeRetention = useCallback(async (value: string): Promise<void> => {
    const nextDays = value === '' ? null : Number(value);
    if (nextDays !== null && (!Number.isFinite(nextDays) || nextDays < 1)) return;
    setRetentionPending(true);
    setRetentionError(null);
    setRetentionStatus(null);
    try {
      const result = await window.opencodex.toolAudit.setRetention({ retentionDays: nextDays });
      setRetentionDays(result.retentionDays);
      setRetentionStatus(
        result.retentionDays === null
          ? 'Retention disabled — entries kept indefinitely.'
          : result.deletedCount > 0
            ? `Retention set to ${result.retentionDays} days · purged ${result.deletedCount} entr${result.deletedCount === 1 ? 'y' : 'ies'}.`
            : `Retention set to ${result.retentionDays} days · nothing to purge.`,
      );
      setPage(0);
      setReloadToken((t) => t + 1);
    } catch (err) {
      setRetentionError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetentionPending(false);
    }
  }, []);

  const onClearLog = useCallback(async (): Promise<void> => {
    setClearing(true);
    setClearConfirming(false);
    setRetentionError(null);
    setRetentionStatus(null);
    try {
      const result = await window.opencodex.toolAudit.clear();
      setRetentionStatus(
        `Cleared ${result.deletedCount} entr${result.deletedCount === 1 ? 'y' : 'ies'}.`,
      );
      setPage(0);
      setReloadToken((t) => t + 1);
    } catch (err) {
      setRetentionError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearing(false);
    }
  }, []);

  const retentionSelectValue = retentionDays === null ? '' : String(retentionDays);
  const isPresetRetention =
    retentionDays === null || AUDIT_RETENTION_PRESETS.some((p) => p.days === retentionDays);

  const facetToolNames = data?.facets.toolNames ?? [];
  const facetDecisions = data?.facets.decisions ?? [];

  const total = data?.total ?? 0;
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, (page + 1) * PAGE_SIZE);
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <div className="audit-panel">
      <div className="audit-toolbar">
        <label className="audit-filter">
          <span className="audit-filter-label">Retention</span>
          <select
            className="approvals-select"
            value={retentionSelectValue}
            disabled={!retentionLoaded || retentionPending}
            onChange={(e) => {
              void onChangeRetention(e.target.value);
            }}
          >
            {AUDIT_RETENTION_PRESETS.map((p) => (
              <option key={p.label} value={p.days === null ? '' : String(p.days)}>
                {p.label}
              </option>
            ))}
            {!isPresetRetention && retentionDays !== null && (
              <option value={String(retentionDays)}>{retentionDays} days (custom)</option>
            )}
          </select>
        </label>
        {clearConfirming ? (
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--danger, #dc2626)' }}>
              Delete every row? This cannot be undone.
            </span>
            <button
              type="button"
              className="audit-clear-button"
              onClick={() => {
                void onClearLog();
              }}
              disabled={clearing || retentionPending}
            >
              {clearing ? 'Clearing…' : 'Confirm clear'}
            </button>
            <button
              type="button"
              onClick={() => setClearConfirming(false)}
              style={{
                background: 'transparent',
                border: '1px solid var(--border, #2a2a32)',
                color: 'var(--text-muted, #98a0aa)',
                borderRadius: 4,
                padding: '4px 10px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="audit-clear-button"
            disabled={clearing || retentionPending}
            onClick={() => setClearConfirming(true)}
          >
            Clear log
          </button>
        )}
        {retentionStatus && <span className="audit-retention-status">{retentionStatus}</span>}
        {retentionError && (
          <span className="audit-retention-error">Retention error: {retentionError}</span>
        )}
      </div>

      <div className="audit-filters">
        <label className="audit-filter">
          <span className="audit-filter-label">Tool</span>
          <select
            className="approvals-select"
            value={toolFilter}
            onChange={(e) => resetPageAnd(() => setToolFilter(e.target.value))}
          >
            <option value="">All tools</option>
            {facetToolNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="audit-filter">
          <span className="audit-filter-label">Decision</span>
          <select
            className="approvals-select"
            value={decisionFilter}
            onChange={(e) => resetPageAnd(() => setDecisionFilter(e.target.value))}
          >
            <option value="">All decisions</option>
            {facetDecisions.map((d) => (
              <option key={d} value={d}>
                {DECISION_LABELS[d] ?? d}
              </option>
            ))}
          </select>
        </label>

        <label className="audit-filter">
          <span className="audit-filter-label">Result</span>
          <select
            className="approvals-select"
            value={errorFilter}
            onChange={(e) =>
              resetPageAnd(() => setErrorFilter(e.target.value as ToolCallAuditErrorFilter))
            }
          >
            {(['any', 'success', 'error'] as ToolCallAuditErrorFilter[]).map((v) => (
              <option key={v} value={v}>
                {ERROR_LABELS[v]}
              </option>
            ))}
          </select>
        </label>

        <label className="audit-filter">
          <span className="audit-filter-label">Time range</span>
          <select
            className="approvals-select"
            value={timeRange}
            onChange={(e) => resetPageAnd(() => setTimeRange(e.target.value as TimeRange))}
          >
            {(['all', '24h', '7d', '30d'] as TimeRange[]).map((r) => (
              <option key={r} value={r}>
                {TIME_RANGE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>

        <label className="audit-filter">
          <span className="audit-filter-label">Trigger</span>
          <select
            className="approvals-select"
            value={triggerFilter}
            onChange={(e) =>
              resetPageAnd(() =>
                setTriggerFilter(e.target.value as ToolCallAuditTriggerSource | ''),
              )
            }
          >
            <option value="">All triggers</option>
            <option value="user">User</option>
            <option value="scheduled">Scheduled</option>
          </select>
        </label>
      </div>

      {loadError && <p className="approvals-save-error">Failed to load audit log: {loadError}</p>}

      {!data && !loadError && <p className="approvals-loading">Loading…</p>}

      {data &&
        data.rows.filter((r) => !triggerFilter || r.triggerSource === triggerFilter).length === 0 &&
        !loadError && (
          <p className="audit-empty">
            No tool calls match these filters
            {total === 0 && page === 0 ? '. The audit log is empty so far.' : '.'}
          </p>
        )}

      {data && data.rows.length > 0 && (
        <>
          <ul className="audit-list">
            {data.rows
              .filter((r) => !triggerFilter || r.triggerSource === triggerFilter)
              .map((row) => {
                const tier = tierByTool[row.toolName] ?? null;
                const isExpanded = expandedId === row.id;
                return (
                  <li key={row.id} className="audit-row">
                    <div className="audit-row-head">
                      <button
                        type="button"
                        className="audit-row-toggle"
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${row.toolName} details`}
                        onClick={() => setExpandedId(isExpanded ? null : row.id)}
                      >
                        <span className="audit-row-time">{formatTimestamp(row.createdAt)}</span>
                        <span className="audit-row-tool">
                          {tier && (
                            <span className={`pill tool-tier tool-tier-${tier}`}>{tier}</span>
                          )}
                          <code className="approvals-tool-name">{row.toolName}</code>
                        </span>
                        <span
                          className={`pill audit-decision audit-decision-${decisionClass(row.decision)}`}
                        >
                          {DECISION_LABELS[row.decision] ?? row.decision}
                        </span>
                        {row.isError && <span className="pill audit-error-pill">Error</span>}
                        {row.triggerSource === 'scheduled' && (
                          <span className="pill" title="Triggered by a scheduled task">
                            scheduled
                          </span>
                        )}
                        <span className="audit-row-duration">{formatDuration(row.durationMs)}</span>
                      </button>
                      <Link
                        className="audit-row-convo"
                        to={buildConversationLink(row.conversationId, row.messageId)}
                        title={`Open conversation: ${row.conversationTitle}`}
                      >
                        {row.conversationTitle}
                      </Link>
                      <span className="audit-row-caret" aria-hidden>
                        {isExpanded ? '▾' : '▸'}
                      </span>
                    </div>
                    {isExpanded && (
                      <div className="audit-row-body">
                        <div className="audit-row-section">
                          <div className="audit-row-section-head">
                            <h4>Input</h4>
                            {row.inputTruncated && (
                              <span className="audit-truncated">truncated</span>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                void copyToClipboard(`in:${row.id}`, safePretty(row.input))
                              }
                              style={{
                                marginLeft: 'auto',
                                fontSize: 11,
                                background: 'transparent',
                                border: '1px solid var(--border, #2a2a32)',
                                borderRadius: 4,
                                padding: '2px 8px',
                                cursor: 'pointer',
                                color: 'var(--text-muted, #98a0aa)',
                              }}
                            >
                              {copiedKey === `in:${row.id}` ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                          <pre className="audit-row-pre">{safePretty(row.input)}</pre>
                        </div>
                        <div className="audit-row-section">
                          <div className="audit-row-section-head">
                            <h4>Output</h4>
                            {row.outputTruncated && (
                              <span className="audit-truncated">truncated</span>
                            )}
                            {row.output !== null && (
                              <button
                                type="button"
                                onClick={() =>
                                  void copyToClipboard(`out:${row.id}`, safePretty(row.output))
                                }
                                style={{
                                  marginLeft: 'auto',
                                  fontSize: 11,
                                  background: 'transparent',
                                  border: '1px solid var(--border, #2a2a32)',
                                  borderRadius: 4,
                                  padding: '2px 8px',
                                  cursor: 'pointer',
                                  color: 'var(--text-muted, #98a0aa)',
                                }}
                              >
                                {copiedKey === `out:${row.id}` ? 'Copied' : 'Copy'}
                              </button>
                            )}
                          </div>
                          <pre
                            className={`audit-row-pre${row.isError ? ' audit-row-pre-error' : ''}`}
                          >
                            {row.output === null ? '(no output)' : safePretty(row.output)}
                          </pre>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
          </ul>

          <div className="audit-pagination">
            <span className="audit-pagination-count">
              Showing {rangeStart}–{rangeEnd} of {total}
            </span>
            <div className="audit-pagination-buttons">
              <button
                type="button"
                className="audit-page-button"
                disabled={page === 0 || loading}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="audit-page-button"
                disabled={page >= lastPage || loading}
                onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function decisionClass(decision: ToolCallAuditDecision): string {
  if (decision === 'denied') return 'denied';
  if (decision === 'auto') return 'auto';
  return 'prompted';
}

export function buildConversationLink(conversationId: string, messageId: string): string {
  const params = new URLSearchParams({
    conversationId,
    messageId,
  });
  return `/chat?${params.toString()}`;
}
