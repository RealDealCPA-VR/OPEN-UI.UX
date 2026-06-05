import { BrowserWindow } from 'electron';
import {
  listCheckpointsForMessageRequestSchema,
  listCheckpointsForRunRequestSchema,
  restoreCheckpointRequestSchema,
  type CheckpointListItem,
  type CheckpointsChangedEvent,
  type ListCheckpointsResponse,
  type RestoreCheckpointResponse,
} from '../../shared/checkpoints';
import { registerInvoke } from '../ipc/registry';
import {
  countCheckpointEntries,
  getCheckpoint,
  listCheckpointsForMessage,
  listCheckpointsForRun,
} from '../storage/checkpoints';
import { restoreCheckpoint } from './manager';

function broadcastChanged(event: CheckpointsChangedEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('checkpoints:changed', event);
  }
}

function toListResponse(items: CheckpointListItem[]): ListCheckpointsResponse {
  return { items };
}

export function registerCheckpointHandlers(): void {
  registerInvoke(
    'checkpoints:list-for-message',
    listCheckpointsForMessageRequestSchema,
    (req): ListCheckpointsResponse => {
      const checkpoints = listCheckpointsForMessage(req.messageId);
      const items: CheckpointListItem[] = checkpoints.map((checkpoint) => ({
        checkpoint,
        entryCount: countCheckpointEntries(checkpoint.id),
      }));
      return toListResponse(items);
    },
  );

  registerInvoke(
    'checkpoints:list-for-run',
    listCheckpointsForRunRequestSchema,
    (req): ListCheckpointsResponse => {
      const checkpoints = listCheckpointsForRun(req.runId);
      const items: CheckpointListItem[] = checkpoints.map((checkpoint) => ({
        checkpoint,
        entryCount: countCheckpointEntries(checkpoint.id),
      }));
      return toListResponse(items);
    },
  );

  registerInvoke(
    'checkpoints:restore',
    restoreCheckpointRequestSchema,
    async (req): Promise<RestoreCheckpointResponse> => {
      const checkpoint = getCheckpoint(req.checkpointId);
      if (!checkpoint) {
        throw new Error(`Unknown checkpoint: ${req.checkpointId}`);
      }
      const result = await restoreCheckpoint(req.checkpointId);
      broadcastChanged({
        scope: checkpoint.scope,
        conversationId: checkpoint.conversationId,
        messageId: checkpoint.messageId,
        runId: checkpoint.runId,
      });
      return result;
    },
  );
}
