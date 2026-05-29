import { useCallback, useEffect, useMemo, useState } from 'react';
import type { McpState } from '../../shared/mcp';
import type { McpRunToolResponse, McpServerToolInfo } from '../../shared/mcp-registry';

interface RunnerState {
  open: boolean;
}

export function McpToolRunner(): JSX.Element | null {
  const [state, setState] = useState<RunnerState>({ open: false });
  const [mcpState, setMcpState] = useState<McpState | null>(null);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [tools, setTools] = useState<McpServerToolInfo[]>([]);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [argsJson, setArgsJson] = useState('{}');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<McpRunToolResponse | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
        e.preventDefault();
        setState((s) => ({ open: !s.open }));
      }
      if (e.key === 'Escape' && state.open) {
        setState({ open: false });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.open]);

  useEffect(() => {
    const onOpenWithTool = (e: Event): void => {
      const ce = e as CustomEvent<{ serverId?: unknown; toolName?: unknown }>;
      const detail = ce.detail;
      if (!detail) return;
      const serverId = typeof detail.serverId === 'string' ? detail.serverId : null;
      const toolName = typeof detail.toolName === 'string' ? detail.toolName : null;
      if (!serverId || !toolName) return;
      setSelectedServerId(serverId);
      setSelectedTool(toolName);
      setResult(null);
      setArgsJson('{}');
      setState({ open: true });
    };
    window.addEventListener('mcp:open-tool-runner', onOpenWithTool);
    return () => window.removeEventListener('mcp:open-tool-runner', onOpenWithTool);
  }, []);

  useEffect(() => {
    if (!state.open) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      void window.opencodex.mcp.list().then((res) => {
        if (!cancelled) setMcpState(res);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [state.open]);

  const connectedServers = useMemo(() => {
    if (!mcpState) return [];
    return mcpState.servers.filter((s) => mcpState.status[s.id]?.status === 'connected');
  }, [mcpState]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (!selectedServerId) {
        setTools([]);
        return;
      }
      void window.opencodex.mcp.listServerTools({ serverId: selectedServerId }).then((res) => {
        if (!cancelled) setTools(res.tools);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedServerId]);

  const onRun = useCallback(async () => {
    if (!selectedServerId || !selectedTool) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await window.opencodex.mcp.runTool({
        serverId: selectedServerId,
        toolName: selectedTool,
        argsJson,
      });
      setResult(res);
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
    }
  }, [argsJson, selectedServerId, selectedTool]);

  if (!state.open) return null;

  return (
    <div className="mcp-tool-runner-overlay" role="dialog" aria-modal="true">
      <div className="mcp-tool-runner-modal">
        <header className="mcp-tool-runner-head">
          <h3 style={{ margin: 0 }}>Run MCP tool</h3>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setState({ open: false })}
            aria-label="Close"
          >
            Close
          </button>
        </header>
        <div className="mcp-tool-runner-body">
          <label>
            <span>Server</span>
            <select
              value={selectedServerId ?? ''}
              onChange={(e) => {
                setSelectedServerId(e.target.value || null);
                setSelectedTool(null);
                setResult(null);
              }}
            >
              <option value="">Select…</option>
              {connectedServers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Tool</span>
            <select
              value={selectedTool ?? ''}
              onChange={(e) => {
                setSelectedTool(e.target.value || null);
                setResult(null);
              }}
              disabled={!selectedServerId}
            >
              <option value="">Select…</option>
              {tools.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          {selectedTool && (
            <p className="settings-section-desc" style={{ margin: '4px 0' }}>
              {tools.find((t) => t.name === selectedTool)?.description ?? ''}
            </p>
          )}
          <label>
            <span>Arguments (JSON)</span>
            <textarea
              rows={6}
              value={argsJson}
              onChange={(e) => setArgsJson(e.target.value)}
              spellCheck={false}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void onRun()}
              disabled={!selectedTool || running}
            >
              {running ? 'Running…' : 'Run'}
            </button>
          </div>
          {result && (
            <div
              className={result.ok && !result.isError ? 'mcp-tool-result' : 'mcp-tool-result-err'}
            >
              {result.error ? <pre>{result.error}</pre> : <pre>{result.resultJson ?? ''}</pre>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
