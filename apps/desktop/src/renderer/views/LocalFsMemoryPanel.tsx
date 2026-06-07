import { useCallback, useEffect, useState } from 'react';

interface LocalFsConfigShape {
  enabled: boolean;
  prependToSystemPrompt: boolean;
  maxPrependBytes: number;
}

const DEFAULT_CONFIG: LocalFsConfigShape = {
  enabled: false,
  prependToSystemPrompt: false,
  maxPrependBytes: 4096,
};

export function LocalFsMemoryPanel(): JSX.Element {
  const [config, setConfig] = useState<LocalFsConfigShape | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await window.opencodex.memory.getStatus();
        if (cancelled) return;
        const localFs = (
          status.config as unknown as { backends?: { localFs?: LocalFsConfigShape } }
        ).backends?.localFs;
        setConfig({ ...DEFAULT_CONFIG, ...(localFs ?? {}) });
        const read = await window.opencodex.memory.readLocal?.().catch(() => null);
        if (!cancelled && read && typeof read === 'object' && 'path' in read) {
          setPath((read as { path: string }).path);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(
    async (next: LocalFsConfigShape) => {
      if (!config) return;
      setPending(true);
      setError(null);
      try {
        const status = await window.opencodex.memory.getStatus();
        const merged = {
          ...status.config,
          backends: {
            ...(status.config as { backends: Record<string, unknown> }).backends,
            localFs: next,
          },
        };
        await window.opencodex.memory.setConfig(merged as never);
        setConfig(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending(false);
      }
    },
    [config],
  );

  if (!config) {
    return (
      <p className="local-fs-memory-loading settings-skeleton">Loading local memory settings…</p>
    );
  }

  return (
    <div className="local-fs-memory-panel" data-settings-anchor="local-fs-memory">
      <div className="settings-block">
        <h3 className="settings-subhead">Local memory file</h3>
        <p className="settings-block-hint">
          Single markdown file per workspace at <code>.opencodex/memory.md</code>. The agent gets
          three tools: read, search (BM25), append. Optionally prepend the file to every chat system
          prompt.
        </p>
        {path && (
          <p className="settings-block-hint" style={{ fontFamily: 'var(--font-mono)' }}>
            {path}
          </p>
        )}
      </div>

      <div className="settings-divider" />

      <div className="settings-block">
        <label className="toggle">
          <input
            type="checkbox"
            checked={config.enabled}
            disabled={pending}
            onChange={(e) => void save({ ...config, enabled: e.target.checked })}
          />
          <span>Enable local memory tools</span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={config.prependToSystemPrompt}
            disabled={pending || !config.enabled}
            onChange={(e) => void save({ ...config, prependToSystemPrompt: e.target.checked })}
          />
          <span>Prepend memory.md to chat system prompt</span>
        </label>
      </div>

      <div className="settings-divider" />

      <div className="settings-block">
        <span className="settings-field-label">Max prepend bytes</span>
        <div className="settings-field-row">
          <input
            className="settings-input"
            type="number"
            min={256}
            max={65536}
            step={256}
            value={config.maxPrependBytes}
            disabled={pending || !config.enabled || !config.prependToSystemPrompt}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (!Number.isFinite(n) || n < 256) return;
              void save({ ...config, maxPrependBytes: n });
            }}
          />
        </div>
      </div>

      {error !== null && (
        <div role="alert" className="field-errors">
          {error}
        </div>
      )}
    </div>
  );
}
