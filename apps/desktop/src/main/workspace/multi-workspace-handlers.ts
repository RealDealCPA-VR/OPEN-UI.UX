import { BrowserWindow } from 'electron';
import { z } from 'zod';
import { emit, registerInvoke } from '../ipc/registry';
import { logger } from '../logger';
import {
  createWorkspaceRequestSchema,
  deleteWorkspaceRequestSchema,
  linkWorkspaceRequestSchema,
  listConversationWorkspacesRequestSchema,
  setPrimaryWorkspaceRequestSchema,
  setWorkspaceRagEnabledRequestSchema,
  unlinkWorkspaceRequestSchema,
} from '../../shared/workspaces';
import type {
  ListConversationWorkspacesRequest,
  ListWorkspacesResponse,
  WorkspaceEntry,
} from '../../shared/workspaces';
import {
  createWorkspace,
  deleteWorkspace,
  linkConversation,
  listWorkspaces,
  listWorkspacesForConversation,
  setPrimary,
  setRagEnabled,
  unlinkConversation,
  WorkspaceNotFoundError,
  WorkspacePathError,
} from './workspaces-store';
import { getActiveMultiWorkspaceIndexer } from '../rag/multi-workspace-indexer';

function broadcast(workspaces: WorkspaceEntry[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    emit(win.webContents, 'workspaces:changed', { workspaces });
  }
}

function snapshot(): ListWorkspacesResponse {
  return { workspaces: listWorkspaces() };
}

export function registerMultiWorkspaceHandlers(): void {
  registerInvoke('workspaces:list', z.void(), (): ListWorkspacesResponse => snapshot());

  registerInvoke(
    'workspaces:create',
    createWorkspaceRequestSchema,
    async (req): Promise<ListWorkspacesResponse> => {
      try {
        const created = createWorkspace({
          path: req.path,
          displayName: req.displayName,
          ragEnabled: req.ragEnabled,
          setPrimary: req.setPrimary,
        });
        const indexer = getActiveMultiWorkspaceIndexer();
        if (indexer) {
          await indexer.addWorkspace(created.id);
        }
        const next = snapshot();
        broadcast(next.workspaces);
        return next;
      } catch (err) {
        if (err instanceof WorkspacePathError) {
          logger.warn({ err: err.message, path: req.path }, 'workspaces:create rejected');
          throw err;
        }
        throw err;
      }
    },
  );

  registerInvoke(
    'workspaces:delete',
    deleteWorkspaceRequestSchema,
    async (req): Promise<ListWorkspacesResponse> => {
      try {
        deleteWorkspace(req.id);
      } catch (err) {
        if (err instanceof WorkspaceNotFoundError) {
          throw err;
        }
        throw err;
      }
      const indexer = getActiveMultiWorkspaceIndexer();
      if (indexer) {
        await indexer.removeWorkspace(req.id);
      }
      const next = snapshot();
      broadcast(next.workspaces);
      return next;
    },
  );

  registerInvoke(
    'workspaces:set-primary',
    setPrimaryWorkspaceRequestSchema,
    (req): ListWorkspacesResponse => {
      setPrimary(req.id);
      const next = snapshot();
      broadcast(next.workspaces);
      return next;
    },
  );

  registerInvoke(
    'workspaces:set-rag-enabled',
    setWorkspaceRagEnabledRequestSchema,
    async (req): Promise<ListWorkspacesResponse> => {
      setRagEnabled(req.id, req.enabled);
      const indexer = getActiveMultiWorkspaceIndexer();
      if (indexer) {
        if (req.enabled) await indexer.addWorkspace(req.id);
        else await indexer.removeWorkspace(req.id);
      }
      const next = snapshot();
      broadcast(next.workspaces);
      return next;
    },
  );

  registerInvoke(
    'workspaces:link-to-conversation',
    linkWorkspaceRequestSchema,
    (req): { workspaces: WorkspaceEntry[] } => {
      linkConversation(req.conversationId, req.workspaceId);
      return { workspaces: listWorkspacesForConversation(req.conversationId) };
    },
  );

  registerInvoke(
    'workspaces:unlink-from-conversation',
    unlinkWorkspaceRequestSchema,
    (req): { workspaces: WorkspaceEntry[] } => {
      unlinkConversation(req.conversationId, req.workspaceId);
      return { workspaces: listWorkspacesForConversation(req.conversationId) };
    },
  );

  registerInvoke(
    'workspaces:list-for-conversation',
    listConversationWorkspacesRequestSchema,
    (req: ListConversationWorkspacesRequest): { workspaces: WorkspaceEntry[] } => ({
      workspaces: listWorkspacesForConversation(req.conversationId),
    }),
  );
}
