import { useEffect, useRef, useState } from 'react';
import type {
  FanoutConsentDecision,
  FanoutConsentRequestedEvent,
  FanoutPlanTask,
} from '../../shared/agent-tree';
import { Modal } from './Modal';

interface FanoutBridge {
  fanoutConsent?: (req: {
    runId: string;
    decision: FanoutConsentDecision;
    editedPlan?: FanoutPlanTask[];
  }) => Promise<{ ok: boolean; error?: string }>;
  onFanoutConsentRequested?: (
    listener: (payload: FanoutConsentRequestedEvent) => void,
  ) => () => void;
}

function bridge(): FanoutBridge | null {
  const win = window as unknown as { opencodex?: { agent?: FanoutBridge } };
  return win.opencodex?.agent ?? null;
}

export interface FanoutConsentModalProps {
  request: FanoutConsentRequestedEvent;
  onResolved: () => void;
}

export function FanoutConsentModal({ request, onResolved }: FanoutConsentModalProps): JSX.Element {
  const [plan, setPlan] = useState<FanoutPlanTask[]>(() => request.plan);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<FanoutConsentDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(() => {
    if (!request.autoAllowDelayMs) return null;
    const elapsed = Date.now() - request.requestedAt;
    return Math.max(0, request.autoAllowDelayMs - elapsed);
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!request.autoAllowDelayMs) return;
    let cancelled = false;
    const id = window.setInterval(() => {
      if (cancelled) return;
      const elapsed = Date.now() - request.requestedAt;
      const remaining = Math.max(0, (request.autoAllowDelayMs ?? 0) - elapsed);
      setRemainingMs(remaining);
      if (remaining <= 0) {
        window.clearInterval(id);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [request.autoAllowDelayMs, request.requestedAt]);

  const submit = async (decision: FanoutConsentDecision): Promise<void> => {
    const b = bridge();
    if (!b?.fanoutConsent) {
      setError('fanoutConsent bridge unavailable');
      return;
    }
    setBusy(decision);
    setError(null);
    try {
      const result = await b.fanoutConsent({
        runId: request.parentRunId,
        decision,
        ...(decision === 'edit' ? { editedPlan: plan } : {}),
      });
      if (!mountedRef.current) return;
      if (!result.ok) {
        setError(result.error ?? 'failed');
        return;
      }
      onResolved();
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const updateTask = (idx: number, patch: Partial<FanoutPlanTask>): void => {
    setPlan((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };

  return (
    <Modal
      open
      onClose={() => {}}
      labelledBy="fanout-consent-title"
      className="approval-modal"
      closeOnBackdrop={false}
    >
      <div style={{ maxWidth: 640, width: '90%', maxHeight: '80vh', overflowY: 'auto' }}>
        <header className="approval-modal-header">
          <h2 id="fanout-consent-title">Agent wants to spawn subtasks</h2>
        </header>
        <p style={{ marginTop: 4, color: 'var(--text-secondary)', fontSize: 12 }}>
          Parent run <code>{request.parentRunId.slice(0, 8)}</code> is planning to spawn{' '}
          {plan.length} subagent{plan.length === 1 ? '' : 's'}.
          {remainingMs !== null && remainingMs > 0 && (
            <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>
              auto-allow in {Math.ceil(remainingMs / 1000)}s
            </span>
          )}
        </p>

        <ul
          className="fanout-plan-list"
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {plan.map((task, idx) => (
            <li
              key={idx}
              style={{
                border: '1px solid var(--border-row-divider)',
                borderRadius: 'var(--radius-sm)',
                padding: 10,
                background: 'var(--bg-sunken)',
              }}
            >
              {editing ? (
                <>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 11,
                      color: 'var(--text-label)',
                      marginBottom: 4,
                    }}
                  >
                    Task #{idx + 1}
                  </label>
                  <textarea
                    className="settings-input"
                    value={task.task}
                    onChange={(e) => updateTask(idx, { task: e.target.value })}
                    rows={2}
                    style={{ width: '100%', fontSize: 12, resize: 'vertical' }}
                  />
                </>
              ) : (
                <>
                  <div style={{ fontSize: 12 }}>
                    <strong>#{idx + 1}</strong> {task.task}
                  </div>
                  {(task.runnerId || task.modelId) && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      {task.runnerId && <span>runner: {task.runnerId}</span>}
                      {task.runnerId && task.modelId && <span> · </span>}
                      {task.modelId && <span>model: {task.modelId}</span>}
                    </div>
                  )}
                  {task.reason && (
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
                      Reason: {task.reason}
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>

        {error && <p className="approvals-save-error">{error}</p>}

        <footer
          style={{
            marginTop: 16,
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            className="btn"
            onClick={() => setEditing((v) => !v)}
            disabled={busy !== null}
          >
            {editing ? 'Done editing' : 'Edit'}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => void submit('deny')}
            disabled={busy !== null}
          >
            {busy === 'deny' ? 'Denying…' : 'Deny'}
          </button>
          {editing && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void submit('edit')}
              disabled={busy !== null}
            >
              {busy === 'edit' ? 'Saving…' : 'Save edits & allow'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void submit('allow')}
            disabled={busy !== null}
          >
            {busy === 'allow' ? 'Allowing…' : 'Allow'}
          </button>
        </footer>
      </div>
    </Modal>
  );
}

export function useFanoutConsent(): {
  current: FanoutConsentRequestedEvent | null;
  clear: () => void;
} {
  const [current, setCurrent] = useState<FanoutConsentRequestedEvent | null>(null);
  useEffect(() => {
    const b = bridge();
    if (!b?.onFanoutConsentRequested) return;
    let cancelled = false;
    const off = b.onFanoutConsentRequested((payload) => {
      if (cancelled) return;
      setCurrent(payload);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);
  return { current, clear: () => setCurrent(null) };
}
