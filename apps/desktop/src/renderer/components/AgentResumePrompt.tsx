import { useEffect, useState } from 'react';
import type {
  AgentPendingResume,
  AgentResumeDecision,
  AgentResumePromptEvent,
} from '../../shared/agent-resume';

interface OpencodexResumeBridge {
  agent?: {
    onResumePrompt?: (listener: (payload: AgentResumePromptEvent) => void) => () => void;
    respondResume?: (
      runId: string,
      decision: AgentResumeDecision,
    ) => Promise<{ ok: boolean; error?: string }>;
  };
}

function readBridge(): OpencodexResumeBridge['agent'] | null {
  const w = window as unknown as { opencodex?: OpencodexResumeBridge };
  return w.opencodex?.agent ?? null;
}

export function AgentResumePrompt(): JSX.Element | null {
  const [queue, setQueue] = useState<AgentPendingResume[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bridge = readBridge();
    const sub = bridge?.onResumePrompt;
    if (!sub) return;
    const off = sub((payload) => {
      setQueue((prev) => {
        const ids = new Set(prev.map((p) => p.runId));
        const merged = [...prev];
        for (const p of payload.pending) if (!ids.has(p.runId)) merged.push(p);
        return merged;
      });
    });
    return () => off();
  }, []);

  if (queue.length === 0) return null;
  const current = queue[0];
  if (!current) return null;

  const respond = async (decision: AgentResumeDecision): Promise<void> => {
    const bridge = readBridge();
    if (!bridge?.respondResume) {
      setError('Resume bridge is unavailable.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await bridge.respondResume(current.runId, decision);
      if (!res.ok) {
        setError(res.error ?? 'request failed');
        return;
      }
      setQueue((prev) => prev.slice(1));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="approval-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Resume interrupted agent run"
    >
      <div className="approval-modal agent-resume-modal" data-testid="agent-resume-prompt">
        <div className="approval-modal-header">
          <h2>Resume interrupted run?</h2>
        </div>
        <p className="approval-modal-description">
          This run was in progress when OpenCodex last quit. Its worktree is still on disk.
        </p>
        <dl className="agent-resume-detail">
          <dt>Task</dt>
          <dd>{current.task}</dd>
          <dt>Worktree</dt>
          <dd>
            <code>{current.worktreePath}</code>
          </dd>
          <dt>Runner</dt>
          <dd>{current.runnerId}</dd>
          <dt>Started</dt>
          <dd>{new Date(current.startedAt).toLocaleString()}</dd>
        </dl>
        {error ? <p className="approvals-save-error">{error}</p> : null}
        <div className="agent-resume-actions">
          <button
            type="button"
            className="btn"
            onClick={() => void respond('discard')}
            disabled={busy}
          >
            Discard
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void respond('resume')}
            disabled={busy}
            autoFocus
          >
            Resume
          </button>
        </div>
      </div>
    </div>
  );
}
