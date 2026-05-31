import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ModelCapabilities } from '@opencodex/core';
import { CostComparisonTooltip } from './CostComparisonTooltip';
import { useSelectedModel } from '../state/selected-model-context';

const RECENTS_KEY = 'opencodex.model-picker.recents';
const RECENTS_MAX = 3;
// Above this many models the flat list gets unwieldy, so surface a search box.
const SEARCH_THRESHOLD = 8;

interface FlatModel {
  providerId: string;
  providerName: string;
  local: boolean;
  model: ModelCapabilities;
}

interface ProviderGroup {
  providerId: string;
  providerName: string;
  local: boolean;
  models: FlatModel[];
}

interface RecentEntry {
  providerId: string;
  modelId: string;
}

function readRecents(): RecentEntry[] {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is RecentEntry =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as RecentEntry).providerId === 'string' &&
          typeof (e as RecentEntry).modelId === 'string',
      )
      .slice(0, RECENTS_MAX);
  } catch {
    return [];
  }
}

function writeRecents(next: RecentEntry[]): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next.slice(0, RECENTS_MAX)));
  } catch {
    /* quota exceeded — ignore */
  }
}

function pushRecent(prev: RecentEntry[], entry: RecentEntry): RecentEntry[] {
  const filtered = prev.filter(
    (e) => !(e.providerId === entry.providerId && e.modelId === entry.modelId),
  );
  return [entry, ...filtered].slice(0, RECENTS_MAX);
}

function matchesQuery(m: FlatModel, q: string): boolean {
  if (q.length === 0) return true;
  return (
    m.model.displayName.toLowerCase().includes(q) ||
    m.model.id.toLowerCase().includes(q) ||
    m.providerName.toLowerCase().includes(q)
  );
}

export interface ModelPickerProps {
  conversationId?: string | null;
}

export function ModelPicker({ conversationId = null }: ModelPickerProps = {}): JSX.Element {
  const { configuredProviders, selected, selectedCapabilities, loading, error, select } =
    useSelectedModel();
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [recents, setRecents] = useState<RecentEntry[]>(() => readRecents());
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Reset the search when the panel closes.
  useEffect(() => {
    if (open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery('');
  }, [open]);

  // Each time the panel opens, expand the provider that owns the current
  // selection so the user lands on their active model; everything else stays
  // collapsed until its provider name is clicked.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpanded(selected ? new Set([selected.providerId]) : new Set<string>());
  }, [open, selected]);

  const selectedProvider = useMemo(
    () => configuredProviders.find((p) => p.info.id === selected?.providerId) ?? null,
    [configuredProviders, selected],
  );

  const flatModels = useMemo<FlatModel[]>(() => {
    const out: FlatModel[] = [];
    for (const p of configuredProviders) {
      for (const model of p.info.models) {
        if (model.embeddings) continue;
        out.push({
          providerId: p.info.id,
          providerName: p.info.displayName,
          local: !p.info.requiresApiKey,
          model,
        });
      }
    }
    return out;
  }, [configuredProviders]);

  const recentModels = useMemo<FlatModel[]>(() => {
    const out: FlatModel[] = [];
    for (const r of recents) {
      const found = flatModels.find(
        (m) => m.providerId === r.providerId && m.model.id === r.modelId,
      );
      if (found) out.push(found);
    }
    return out;
  }, [flatModels, recents]);

  const normalizedQuery = query.trim().toLowerCase();
  const searching = normalizedQuery.length > 0;

  // One group per CONFIGURED provider (built straight from the providers list,
  // not from whatever models happen to exist) so every provider the user set
  // up in Settings always surfaces here — even if its model catalog is empty.
  const providerGroups = useMemo<ProviderGroup[]>(
    () =>
      configuredProviders.map((p) => {
        const models = p.info.models
          .filter((m) => !m.embeddings)
          .map<FlatModel>((model) => ({
            providerId: p.info.id,
            providerName: p.info.displayName,
            local: !p.info.requiresApiKey,
            model,
          }))
          .filter((m) => matchesQuery(m, normalizedQuery));
        return {
          providerId: p.info.id,
          providerName: p.info.displayName,
          local: !p.info.requiresApiKey,
          models,
        };
      }),
    [configuredProviders, normalizedQuery],
  );

  const matchCount = providerGroups.reduce((acc, g) => acc + g.models.length, 0);

  const hasOptions = configuredProviders.length > 0;
  const showSearch = flatModels.length > SEARCH_THRESHOLD;

  const buttonLabel = (() => {
    if (loading) return 'Loading…';
    if (!selected) return 'Select a model';
    if (!selectedCapabilities) return `${selected.providerId} · ${selected.modelId} (unavailable)`;
    return `${selectedProvider?.info.displayName ?? selected.providerId} · ${selectedCapabilities.displayName}`;
  })();

  const buttonClass =
    selected && !selectedCapabilities ? 'model-picker-btn warn' : 'model-picker-btn';

  const handlePick = (providerId: string, modelId: string): void => {
    void select({ providerId, modelId });
    setRecents((prev) => {
      const next = pushRecent(prev, { providerId, modelId });
      writeRecents(next);
      return next;
    });
    setOpen(false);
  };

  const toggleProvider = (providerId: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) next.delete(providerId);
      else next.add(providerId);
      return next;
    });
  };

  return (
    <div
      className="model-picker"
      ref={rootRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: 'relative' }}
    >
      <button
        type="button"
        className={buttonClass}
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="model-picker-label">{buttonLabel}</span>
        <span className="model-picker-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      <CostComparisonTooltip open={hovered && !open} conversationId={conversationId} />

      {open && (
        <div className="model-picker-pop" role="listbox">
          {error ? (
            <div className="model-picker-empty">Failed to load providers: {error}</div>
          ) : !hasOptions ? (
            <div className="model-picker-empty">
              No configured providers.{' '}
              <Link to="/settings" onClick={() => setOpen(false)}>
                Add API keys in Settings →
              </Link>
            </div>
          ) : (
            <>
              {showSearch ? (
                <input
                  type="search"
                  className="model-picker-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search models or providers…"
                  aria-label="Search models"
                  autoFocus
                />
              ) : null}
              <div className="model-picker-scroll">
                {searching && matchCount === 0 ? (
                  <div className="model-picker-empty">No models match your search.</div>
                ) : (
                  <>
                    {!searching && recentModels.length > 0 ? (
                      <div className="model-picker-group">
                        <div className="model-picker-group-head">Recent</div>
                        {recentModels.map((m) => (
                          <ModelRow
                            key={`recent:${m.providerId}:${m.model.id}`}
                            providerId={m.providerId}
                            providerName={m.providerName}
                            model={m.model}
                            selected={selected}
                            showProvider
                            onPick={(sel) => handlePick(sel.providerId, sel.modelId)}
                          />
                        ))}
                      </div>
                    ) : null}
                    {providerGroups.map((group) => {
                      // While searching, hide providers with no matches; otherwise
                      // every configured provider is listed (collapsed) by name.
                      if (searching && group.models.length === 0) return null;
                      const isExpanded = searching || expanded.has(group.providerId);
                      return (
                        <div key={group.providerId} className="model-picker-group">
                          <button
                            type="button"
                            className="model-picker-provider-head"
                            onClick={() => toggleProvider(group.providerId)}
                            aria-expanded={isExpanded}
                          >
                            <span className="model-picker-provider-caret" aria-hidden="true">
                              {isExpanded ? '▾' : '▸'}
                            </span>
                            <span className="model-picker-provider-name">{group.providerName}</span>
                            {group.local ? (
                              <span className="model-picker-local-tag">local</span>
                            ) : null}
                            <span className="model-picker-provider-count">
                              {group.models.length}
                            </span>
                          </button>
                          {isExpanded ? (
                            group.models.length > 0 ? (
                              group.models.map((m) => (
                                <ModelRow
                                  key={`${m.providerId}:${m.model.id}`}
                                  providerId={m.providerId}
                                  providerName={m.providerName}
                                  model={m.model}
                                  selected={selected}
                                  showProvider={false}
                                  onPick={(sel) => handlePick(sel.providerId, sel.modelId)}
                                />
                              ))
                            ) : (
                              <div className="model-picker-empty-hint">
                                No models available — check this provider in Settings.
                              </div>
                            )
                          ) : null}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface ModelRowProps {
  providerId: string;
  providerName?: string;
  model: ModelCapabilities;
  selected: { providerId: string; modelId: string } | null;
  showProvider?: boolean;
  onPick: (sel: { providerId: string; modelId: string }) => void;
}

function ModelRow({
  providerId,
  providerName,
  model,
  selected,
  showProvider = true,
  onPick,
}: ModelRowProps): JSX.Element {
  const isSelected =
    selected !== null && selected.providerId === providerId && selected.modelId === model.id;
  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      className={isSelected ? 'model-picker-row selected' : 'model-picker-row'}
      onClick={() => onPick({ providerId, modelId: model.id })}
    >
      <span className="model-picker-row-main">
        <span className="model-picker-row-name-line">
          <span className="model-picker-row-name">{model.displayName}</span>
          {model.pricing ? (
            <span className="model-picker-row-cost" title="Input / output per million tokens">
              ${formatPrice(model.pricing.inputPerMillion)} / $
              {formatPrice(model.pricing.outputPerMillion)} per M
            </span>
          ) : null}
        </span>
        {showProvider && providerName ? (
          <span className="model-picker-row-provider">{providerName}</span>
        ) : null}
        <ModelChips model={model} />
      </span>
      <ModelBadges model={model} />
    </button>
  );
}

function ModelChips({ model }: { model: ModelCapabilities }): JSX.Element {
  return (
    <span className="model-chips">
      <span className="chip chip-ctx">{formatContext(model.contextWindow)} ctx</span>
    </span>
  );
}

function ModelBadges({ model }: { model: ModelCapabilities }): JSX.Element {
  return (
    <span className="model-badges">
      {model.toolUse && (
        <span className="badge" title="Supports tool / function calling">
          tools
        </span>
      )}
      {model.vision && (
        <span className="badge" title="Accepts image inputs">
          vision
        </span>
      )}
      {model.promptCaching && (
        <span className="badge" title="Supports prompt caching">
          cache
        </span>
      )}
      {model.streaming && (
        <span className="badge badge-dim" title="Streams responses">
          stream
        </span>
      )}
    </span>
  );
}

function formatContext(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${Math.round(n / 1_000)}K`;
  }
  return String(n);
}

function formatPrice(n: number): string {
  if (n === 0) return '0';
  if (n < 1) return n.toFixed(2);
  if (n < 10) return n.toFixed(2).replace(/\.?0+$/, '');
  return n.toFixed(0);
}
