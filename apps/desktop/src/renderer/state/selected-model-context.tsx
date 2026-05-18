import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ModelCapabilities } from '@opencodex/core';
import type { ProviderListItem } from '../../shared/provider-config';
import type { SelectedModel } from '../../shared/selected-model';

interface SelectedModelContextValue {
  providers: ProviderListItem[];
  configuredProviders: ProviderListItem[];
  selected: SelectedModel | null;
  selectedCapabilities: ModelCapabilities | null;
  loading: boolean;
  error: string | null;
  select(next: SelectedModel | null): Promise<void>;
  reload(): void;
}

const SelectedModelContext = createContext<SelectedModelContextValue | null>(null);

function isConfigured(item: ProviderListItem): boolean {
  return !item.info.requiresApiKey || item.status.hasApiKey;
}

function findCapabilities(
  providers: ProviderListItem[],
  sel: SelectedModel | null,
): ModelCapabilities | null {
  if (!sel) return null;
  const provider = providers.find((p) => p.info.id === sel.providerId);
  if (!provider) return null;
  return provider.info.models.find((m) => m.id === sel.modelId) ?? null;
}

export function SelectedModelProvider({ children }: { children: ReactNode }): JSX.Element {
  const [providers, setProviders] = useState<ProviderListItem[] | null>(null);
  const [selected, setSelected] = useState<SelectedModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, sel] = await Promise.all([
          window.opencodex.providers.list(),
          window.opencodex.selectedModel.get(),
        ]);
        if (cancelled) return;
        setProviders(list);
        setSelected(sel);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const select = useCallback(async (next: SelectedModel | null) => {
    const result = await window.opencodex.selectedModel.set(next);
    setSelected(result);
  }, []);

  const safeProviders = useMemo(() => providers ?? [], [providers]);
  const configuredProviders = useMemo(() => safeProviders.filter(isConfigured), [safeProviders]);
  const selectedCapabilities = useMemo(
    () => findCapabilities(safeProviders, selected),
    [safeProviders, selected],
  );

  const value = useMemo<SelectedModelContextValue>(
    () => ({
      providers: safeProviders,
      configuredProviders,
      selected,
      selectedCapabilities,
      loading: providers === null,
      error,
      select,
      reload,
    }),
    [
      providers,
      safeProviders,
      configuredProviders,
      selected,
      selectedCapabilities,
      error,
      select,
      reload,
    ],
  );

  return <SelectedModelContext.Provider value={value}>{children}</SelectedModelContext.Provider>;
}

export function useSelectedModel(): SelectedModelContextValue {
  const ctx = useContext(SelectedModelContext);
  if (!ctx) {
    throw new Error('useSelectedModel must be used inside <SelectedModelProvider>');
  }
  return ctx;
}
