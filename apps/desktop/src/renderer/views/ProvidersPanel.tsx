import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProviderListItem, ProviderTestResult } from '../../shared/provider-config';

const KEY_MASK = '••••••••';

interface DraftState {
  apiKey: string;
  apiKeyDirty: boolean;
  baseUrl: string;
  extra: Record<string, string>;
  busy: 'idle' | 'saving' | 'testing' | 'clearing';
  errors: string[];
  testResult: ProviderTestResult | null;
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
  };
}

export function ProvidersPanel(): JSX.Element {
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

  const applyItem = useCallback((next: ProviderListItem) => {
    setItems((prev) => (prev ? prev.map((it) => (it.info.id === next.info.id ? next : it)) : prev));
    setDrafts((prev) => ({ ...prev, [next.info.id]: makeDraft(next) }));
  }, []);

  const setDraft = useCallback((id: string, patch: Partial<DraftState>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id]!, ...patch } }));
  }, []);

  if (loadError) {
    return (
      <div className="providers-error">
        Failed to load providers: {loadError}
        <button type="button" onClick={reload}>
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
    onDraftChange({ busy: 'saving', errors: [] });
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
    } catch (err) {
      onDraftChange({
        busy: 'idle',
        errors: [err instanceof Error ? err.message : String(err)],
      });
    }
  };

  const handleTest = async (): Promise<void> => {
    onDraftChange({ busy: 'testing', testResult: null });
    try {
      const result = await window.opencodex.providers.test({ id: info.id });
      onDraftChange({ busy: 'idle', testResult: result });
    } catch (err) {
      onDraftChange({
        busy: 'idle',
        testResult: {
          ok: false,
          code: 'unknown',
          message: err instanceof Error ? err.message : String(err),
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
        <div>
          <h2>{info.displayName}</h2>
          <div className="provider-meta">
            <span className={statusClass}>{statusLabel}</span>
            <span className="provider-meta-text">
              {chatModelCount} chat · {embedModelCount} embed
            </span>
          </div>
        </div>
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
          <p
            className={
              draft.testResult.ok ? 'test-result test-result-ok' : 'test-result test-result-err'
            }
          >
            {draft.testResult.ok ? '✓ ' : '✗ '}
            {draft.testResult.message}
            {status.lastTestedAt && (
              <span className="test-result-time"> · {formatTime(status.lastTestedAt)}</span>
            )}
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
