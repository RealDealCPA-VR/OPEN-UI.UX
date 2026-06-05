import { useCallback, useEffect, useState } from 'react';
import type { RestoreCheckpointResponse } from '../../shared/checkpoints';

interface CheckpointBridge {
  listForMessage: (
    messageId: string,
  ) => Promise<{
    items: Array<{ checkpoint: { id: string; status: string }; entryCount: number }>;
  }>;
  restore: (checkpointId: string) => Promise<RestoreCheckpointResponse>;
  onChanged: (listener: () => void) => () => void;
}

function checkpointBridge(): CheckpointBridge | null {
  const bridge = (window as unknown as { opencodex?: { checkpoints?: CheckpointBridge } })
    .opencodex;
  return bridge?.checkpoints ?? null;
}

const TOOLTIP =
  'Reverts every file this turn wrote (including deleting files it created) back to its pre-turn state. ' +
  'Note: edits made by shell commands (run_shell) are not tracked and will not be reverted.';

export function CheckpointRestoreButton({ messageId }: { messageId: string }): JSX.Element | null {
  const [checkpointId, setCheckpointId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    const bridge = checkpointBridge();
    if (!bridge) return;
    void bridge
      .listForMessage(messageId)
      .then((res) => {
        const active = res.items.find((i) => i.checkpoint.status === 'active' && i.entryCount > 0);
        setCheckpointId(active ? active.checkpoint.id : null);
      })
      .catch(() => setCheckpointId(null));
  }, [messageId]);

  useEffect(() => {
    refresh();
    const bridge = checkpointBridge();
    if (!bridge) return;
    const off = bridge.onChanged(() => refresh());
    return () => off();
  }, [refresh]);

  const onRestore = useCallback(() => {
    if (!checkpointId) return;
    const bridge = checkpointBridge();
    if (!bridge) return;
    setBusy(true);
    void bridge
      .restore(checkpointId)
      .catch(() => undefined)
      .finally(() => {
        setBusy(false);
        refresh();
      });
  }, [checkpointId, refresh]);

  if (!checkpointId) return null;

  return (
    <button
      type="button"
      className="checkpoint-restore-btn"
      data-testid="checkpoint-restore-turn"
      title={TOOLTIP}
      aria-label="Restore workspace files to before this turn"
      disabled={busy}
      onClick={onRestore}
    >
      {busy ? 'Restoring…' : 'Restore to before this turn'}
    </button>
  );
}
