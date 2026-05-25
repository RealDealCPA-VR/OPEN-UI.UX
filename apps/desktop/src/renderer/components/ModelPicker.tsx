import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ModelCapabilities } from '@opencodex/core';
import type { ProviderListItem } from '../../shared/provider-config';
import { useSelectedModel } from '../state/selected-model-context';

export function ModelPicker(): JSX.Element {
  const { configuredProviders, selected, selectedCapabilities, loading, error, select } =
    useSelectedModel();
  const [open, setOpen] = useState(false);
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

  const selectedProvider = useMemo(
    () => configuredProviders.find((p) => p.info.id === selected?.providerId) ?? null,
    [configuredProviders, selected],
  );

  const hasOptions = configuredProviders.some((p) => p.info.models.some((m) => !m.embeddings));

  const buttonLabel = (() => {
    if (loading) return 'Loading…';
    if (!selected) return 'Select a model';
    if (!selectedCapabilities) return `${selected.providerId} · ${selected.modelId} (unavailable)`;
    return `${selectedProvider?.info.displayName ?? selected.providerId} · ${selectedCapabilities.displayName}`;
  })();

  const buttonClass =
    selected && !selectedCapabilities ? 'model-picker-btn warn' : 'model-picker-btn';

  return (
    <div className="model-picker" ref={rootRef}>
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
            configuredProviders.map((p) => (
              <ProviderGroup
                key={p.info.id}
                provider={p}
                selected={selected}
                onPick={(sel) => {
                  void select(sel);
                  setOpen(false);
                }}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface ProviderGroupProps {
  provider: ProviderListItem;
  selected: { providerId: string; modelId: string } | null;
  onPick: (sel: { providerId: string; modelId: string }) => void;
}

function ProviderGroup({ provider, selected, onPick }: ProviderGroupProps): JSX.Element | null {
  const chatModels = useMemo(
    () => provider.info.models.filter((m) => !m.embeddings),
    [provider.info.models],
  );

  const vendorBuckets = useMemo(() => {
    const buckets = new Map<string, ModelCapabilities[]>();
    for (const model of chatModels) {
      const slash = model.id.indexOf('/');
      const vendor = slash > 0 ? model.id.slice(0, slash) : '';
      const list = buckets.get(vendor);
      if (list) list.push(model);
      else buckets.set(vendor, [model]);
    }
    return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [chatModels]);

  const useVendorGrouping = chatModels.length > 15 && vendorBuckets.every(([v]) => v !== '');

  if (chatModels.length === 0) return null;

  if (!useVendorGrouping) {
    return (
      <div className="model-picker-group">
        <div className="model-picker-group-head">{provider.info.displayName}</div>
        {chatModels.map((model) => (
          <ModelRow
            key={model.id}
            providerId={provider.info.id}
            model={model}
            selected={selected}
            onPick={onPick}
          />
        ))}
      </div>
    );
  }

  const selectedVendor =
    selected && selected.providerId === provider.info.id
      ? (selected.modelId.split('/')[0] ?? null)
      : null;

  return (
    <div className="model-picker-group">
      <div className="model-picker-group-head">
        {provider.info.displayName}{' '}
        <span className="model-picker-count">({chatModels.length})</span>
      </div>
      {vendorBuckets.map(([vendor, models]) => (
        <VendorSubGroup
          key={vendor}
          providerId={provider.info.id}
          vendor={vendor}
          models={models}
          selected={selected}
          onPick={onPick}
          defaultOpen={vendor === selectedVendor}
        />
      ))}
    </div>
  );
}

interface ModelRowProps {
  providerId: string;
  model: ModelCapabilities;
  selected: { providerId: string; modelId: string } | null;
  onPick: (sel: { providerId: string; modelId: string }) => void;
}

function ModelRow({ providerId, model, selected, onPick }: ModelRowProps): JSX.Element {
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
        <span className="model-picker-row-name">{model.displayName}</span>
        <ModelChips model={model} />
      </span>
      <ModelBadges model={model} />
    </button>
  );
}

interface VendorSubGroupProps {
  providerId: string;
  vendor: string;
  models: ModelCapabilities[];
  selected: { providerId: string; modelId: string } | null;
  onPick: (sel: { providerId: string; modelId: string }) => void;
  defaultOpen: boolean;
}

function VendorSubGroup({
  providerId,
  vendor,
  models,
  selected,
  onPick,
  defaultOpen,
}: VendorSubGroupProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={open ? 'model-picker-vendor open' : 'model-picker-vendor'}>
      <button
        type="button"
        className="model-picker-vendor-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="model-picker-vendor-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="model-picker-vendor-name">{vendor}</span>
        <span className="model-picker-count">{models.length}</span>
      </button>
      {open ? (
        <div className="model-picker-vendor-body">
          {models.map((model) => (
            <ModelRow
              key={model.id}
              providerId={providerId}
              model={model}
              selected={selected}
              onPick={onPick}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ModelChips({ model }: { model: ModelCapabilities }): JSX.Element {
  return (
    <span className="model-chips">
      <span className="chip chip-ctx">{formatContext(model.contextWindow)} ctx</span>
      {model.pricing && (
        <span className="chip chip-price" title="Input / output per million tokens">
          ${formatPrice(model.pricing.inputPerMillion)} / $
          {formatPrice(model.pricing.outputPerMillion)} per M
        </span>
      )}
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
