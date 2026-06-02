import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProviderListItem, ProviderTestResult } from '../../shared/provider-config';
import { useSelectedModel } from '../state/selected-model-context';

const KEY_MASK = '••••••••';

interface ExtendedTestResult extends ProviderTestResult {
  latencyMs?: number;
  modelCount?: number;
}

interface DraftState {
  apiKey: string;
  apiKeyDirty: boolean;
  baseUrl: string;
  extra: Record<string, string>;
  busy: 'idle' | 'saving' | 'testing' | 'clearing';
  errors: string[];
  testResult: ExtendedTestResult | null;
  saved: boolean;
}

// Map a provider id + http status to a one-line suggested fix. We surface the
// real provider message above this; the fix is a humanizer hint.
function suggestedFix(providerId: string, result: ProviderTestResult): string | null {
  const status = result.httpStatus;
  const id = providerId.toLowerCase();
  if (!status && result.code === 'network') {
    return 'Check your network connection or proxy settings.';
  }
  if (!status && result.code === 'timeout') {
    return 'The provider did not respond in time. Retry in a moment.';
  }
  if (status === 401) {
    if (id.includes('openai')) {
      return 'Check your key has access to the chat completions endpoint.';
    }
    if (id.includes('anthropic')) {
      return 'Anthropic returned 401 — verify the key has not been revoked.';
    }
    return 'The key was rejected. Confirm it is current and copied without spaces.';
  }
  if (status === 403) {
    if (id.includes('anthropic')) {
      return 'Your key may be billing-limited. Check usage at console.anthropic.com.';
    }
    if (id.includes('openai')) {
      return 'Forbidden — your org may not have access to this model. Try a different model.';
    }
    return 'The provider refused the request. Check workspace/billing permissions.';
  }
  if (status === 429) {
    return 'Rate-limited. Wait a moment and retry.';
  }
  if (status === 404) {
    return 'Endpoint not found — verify the base URL override is correct.';
  }
  if (status && status >= 500 && status < 600) {
    return 'The provider is having trouble. Try again shortly.';
  }
  return null;
}

function makeDraft(item: ProviderListItem): DraftState {
  return {
    apiKey: '',
    apiKeyDirty: false,
    baseUrl: item.status.baseUrl ?? '',
    extra: { ...item.status.extra },
    busy: 'idle',
    errors: [],
    testResult: item.status.lastTestResult,
    saved: false,
  };
}

export function ProvidersPanel(): JSX.Element {
  const { reload: reloadSelectedModel } = useSelectedModel();
  const [items, setItems] = useState<ProviderListItem[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await window.opencodex.providers.list();
        if (cancelled) return;
        setItems(next);
        setDrafts((prev) => {
          const out: Record<string, DraftState> = {};
          for (const item of next) {
            out[item.info.id] = prev[item.info.id] ?? makeDraft(item);
          }
          return out;
        });
        setLoadError(null);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const applyItem = useCallback(
    (next: ProviderListItem) => {
      setItems((prev) =>
        prev ? prev.map((it) => (it.info.id === next.info.id ? next : it)) : prev,
      );
      setDrafts((prev) => ({ ...prev, [next.info.id]: makeDraft(next) }));
      reloadSelectedModel();
    },
    [reloadSelectedModel],
  );

  const setDraft = useCallback((id: string, patch: Partial<DraftState>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id]!, ...patch } }));
  }, []);

  if (loadError) {
    return (
      <div className="providers-error">
        Failed to load providers: {loadError}
        <button type="button" className="btn" onClick={reload}>
          Retry
        </button>
      </div>
    );
  }

  if (!items) {
    return <p className="providers-loading">Loading providers…</p>;
  }

  return (
    <div className="providers-panel">
      {items.map((item) => (
        <ProviderCard
          key={item.info.id}
          item={item}
          draft={drafts[item.info.id] ?? makeDraft(item)}
          onDraftChange={(patch) => setDraft(item.info.id, patch)}
          onApplyItem={applyItem}
        />
      ))}
    </div>
  );
}

interface ProviderCardProps {
  item: ProviderListItem;
  draft: DraftState;
  onDraftChange: (patch: Partial<DraftState>) => void;
  onApplyItem: (next: ProviderListItem) => void;
}

function ProviderCard({ item, draft, onDraftChange, onApplyItem }: ProviderCardProps): JSX.Element {
  const { info, status } = item;

  const chatModelCount = useMemo(
    () => info.models.filter((m) => !m.embeddings).length,
    [info.models],
  );
  const embedModelCount = useMemo(
    () => info.models.filter((m) => m.embeddings).length,
    [info.models],
  );

  const handleSave = async (): Promise<void> => {
    onDraftChange({ busy: 'saving', errors: [], saved: false });
    try {
      const resp = await window.opencodex.providers.save({
        id: info.id,
        ...(draft.apiKeyDirty ? { apiKey: draft.apiKey || null } : {}),
        baseUrl: draft.baseUrl.trim() || null,
        extra: draft.extra,
      });
      if (resp.errors.length > 0) {
        onDraftChange({
          busy: 'idle',
          errors: resp.errors.map((e) => `${e.path}: ${e.message}`),
        });
        return;
      }
      onApplyItem(resp.item);
      // applyItem replaces the draft with a fresh one; surface the saved chip
      // via a follow-up patch on the *new* draft (the onDraftChange closure
      // still targets the same id).
      onDraftChange({ saved: true });
      window.setTimeout(() => onDraftChange({ saved: false }), 1500);
    } catch (err) {
      onDraftChange({
        busy: 'idle',
        errors: [err instanceof Error ? err.message : String(err)],
      });
    }
  };

  const handleTest = async (): Promise<void> => {
    onDraftChange({ busy: 'testing', testResult: null });
    const start = performance.now();
    try {
      const result = await window.opencodex.providers.test({ id: info.id });
      const latencyMs = Math.round(performance.now() - start);
      const next: ExtendedTestResult = {
        ...result,
        latencyMs,
        modelCount: result.ok ? chatModelCount + embedModelCount : undefined,
      };
      onDraftChange({ busy: 'idle', testResult: next });
    } catch (err) {
      onDraftChange({
        busy: 'idle',
        testResult: {
          ok: false,
          code: 'unknown',
          message: err instanceof Error ? err.message : String(err),
          latencyMs: Math.round(performance.now() - start),
        },
      });
    }
  };

  const handleClear = async (): Promise<void> => {
    onDraftChange({ busy: 'clearing', errors: [] });
    try {
      const next = await window.opencodex.providers.delete({ id: info.id });
      onApplyItem(next);
    } catch (err) {
      onDraftChange({
        busy: 'idle',
        errors: [err instanceof Error ? err.message : String(err)],
      });
    }
  };

  const statusLabel = !info.requiresApiKey
    ? 'Local'
    : status.hasApiKey
      ? 'Configured'
      : 'Not configured';
  const statusClass = !info.requiresApiKey
    ? 'pill pill-local'
    : status.hasApiKey
      ? 'pill pill-ok'
      : 'pill pill-warn';

  return (
    <section className="provider-card">
      <header className="provider-card-head">
        <div className="provider-card-head-main">
          <h2>{info.displayName}</h2>
          <span className="provider-meta-text">
            {chatModelCount} chat · {embedModelCount} embed
          </span>
        </div>
        <span className={statusClass}>{statusLabel}</span>
      </header>

      <div className="provider-card-body">
        {info.requiresApiKey && (
          <label className="field">
            <span className="field-label">API key</span>
            <input
              type="password"
              autoComplete="off"
              placeholder={status.hasApiKey ? KEY_MASK : 'sk-…'}
              value={draft.apiKey}
              onChange={(e) => onDraftChange({ apiKey: e.target.value, apiKeyDirty: true })}
            />
          </label>
        )}

        <label className="field">
          <span className="field-label">Base URL override</span>
          <input
            type="text"
            placeholder={info.defaultBaseUrl}
            value={draft.baseUrl}
            onChange={(e) => onDraftChange({ baseUrl: e.target.value })}
          />
        </label>

        {info.extraFields.map((field) => (
          <label key={field.name} className="field">
            <span className="field-label">{field.label}</span>
            <input
              type={field.type}
              placeholder={field.placeholder}
              value={draft.extra[field.name] ?? ''}
              onChange={(e) =>
                onDraftChange({ extra: { ...draft.extra, [field.name]: e.target.value } })
              }
            />
            {field.description && <span className="field-help">{field.description}</span>}
          </label>
        ))}

        {draft.errors.length > 0 && (
          <ul className="field-errors">
            {draft.errors.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        )}

        {draft.testResult && (
          <div
            className={
              draft.testResult.ok ? 'test-result test-result-ok' : 'test-result test-result-err'
            }
            role={draft.testResult.ok ? undefined : 'alert'}
          >
            <div>
              {draft.testResult.ok ? '✓ ' : '✗ '}
              {draft.testResult.message}
              {draft.testResult.ok && draft.testResult.latencyMs !== undefined && (
                <span className="test-result-time">
                  {' '}
                  · {draft.testResult.latencyMs} ms
                  {draft.testResult.modelCount !== undefined && (
                    <>
                      {' '}
                      · {draft.testResult.modelCount} model
                      {draft.testResult.modelCount === 1 ? '' : 's'} discovered
                    </>
                  )}
                </span>
              )}
              {!draft.testResult.ok && draft.testResult.httpStatus && (
                <span className="test-result-time"> · HTTP {draft.testResult.httpStatus}</span>
              )}
              {status.lastTestedAt && (
                <span className="test-result-time"> · {formatTime(status.lastTestedAt)}</span>
              )}
            </div>
            {!draft.testResult.ok &&
              (() => {
                const fix = suggestedFix(info.id, draft.testResult);
                return fix ? (
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 12,
                      color: 'var(--text-muted)',
                    }}
                  >
                    Suggested fix: {fix}
                  </div>
                ) : null;
              })()}
            {!draft.testResult.ok && (
              <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void handleTest()}
                  disabled={draft.busy !== 'idle'}
                >
                  Retry test
                </button>
              </div>
            )}
          </div>
        )}

        {draft.saved && (
          <p
            aria-live="polite"
            style={{
              fontSize: 12,
              color: 'var(--success)',
              margin: '4px 0 0',
              transition: 'opacity 300ms ease',
            }}
          >
            Saved
          </p>
        )}
      </div>

      <footer className="provider-card-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void handleSave()}
          disabled={draft.busy !== 'idle'}
        >
          {draft.busy === 'saving' ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void handleTest()}
          disabled={draft.busy !== 'idle'}
        >
          {draft.busy === 'testing' ? 'Testing…' : 'Test connection'}
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => void handleClear()}
          disabled={
            draft.busy !== 'idle' ||
            (!status.hasApiKey && !status.baseUrl && Object.keys(status.extra).length === 0)
          }
        >
          {draft.busy === 'clearing' ? 'Clearing…' : 'Clear'}
        </button>
      </footer>
    </section>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}
