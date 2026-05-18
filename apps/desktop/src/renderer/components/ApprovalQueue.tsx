import { useCallback, useEffect, useState } from 'react';
import type { ApprovalDecision, ApprovalRequest, ApprovalScope } from '../../shared/approvals';

export function ApprovalQueue(): JSX.Element | null {
  const [queue, setQueue] = useState<ApprovalRequest[]>([]);

  useEffect(() => {
    return window.opencodex.approvals.onRequest((req) => {
      setQueue((prev) => [...prev, req]);
    });
  }, []);

  const respond = useCallback(
    async (request: ApprovalRequest, decision: ApprovalDecision, scope: ApprovalScope) => {
      try {
        await window.opencodex.approvals.respond({
          requestId: request.requestId,
          decision,
          scope,
        });
      } finally {
        setQueue((prev) => prev.filter((r) => r.requestId !== request.requestId));
      }
    },
    [],
  );

  if (queue.length === 0) return null;
  const current = queue[0];
  if (!current) return null;

  return (
    <div className="approval-modal-backdrop" role="dialog" aria-modal="true">
      <div className="approval-modal">
        <header className="approval-modal-header">
          <span className="approval-modal-tier">{current.permissionTier}</span>
          <h2>{current.toolName}</h2>
        </header>
        <p className="approval-modal-description">{current.toolDescription}</p>
        <pre className="approval-modal-args">{formatArgs(current.arguments)}</pre>
        {queue.length > 1 && (
          <p className="approval-modal-queue">
            {queue.length - 1} more approval{queue.length - 1 === 1 ? '' : 's'} pending
          </p>
        )}
        <div className="approval-modal-actions">
          <div className="approval-modal-action-group">
            <button onClick={() => void respond(current, 'allow', 'once')}>Allow once</button>
            <button onClick={() => void respond(current, 'allow', 'session')}>
              Allow for session
            </button>
            <button onClick={() => void respond(current, 'allow', 'always')}>Allow always</button>
          </div>
          <div className="approval-modal-action-group">
            <button onClick={() => void respond(current, 'deny', 'once')}>Deny once</button>
            <button onClick={() => void respond(current, 'deny', 'session')}>
              Deny for session
            </button>
            <button onClick={() => void respond(current, 'deny', 'always')}>Deny always</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatArgs(args: unknown): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}
