import { BrowserWindow, dialog } from 'electron';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { emit, registerInvoke } from '../ipc/registry';
import { logger } from '../logger';
import {
  clearActiveWorkspace,
  getWorkspaceState,
  removeWorkspaceFromHistory,
  setActiveWorkspace,
} from '../storage/settings';
import type { WorkspaceState } from '../../shared/workspace';

function isExistingDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function broadcastChange(state: WorkspaceState): WorkspaceState {
  for (const win of BrowserWindow.getAllWindows()) {
    emit(win.webContents, 'workspace:changed', { state });
  }
  return state;
}

export function registerWorkspaceHandlers(): void {
  registerInvoke('workspace:get', z.void(), () => getWorkspaceState());

  registerInvoke(
    'workspace:set-active',
    z.object({ path: z.string().min(1) }),
    (req): WorkspaceState => {
      const resolved = resolve(req.path);
      if (!isExistingDirectory(resolved)) {
        logger.warn({ path: resolved }, 'rejected workspace:set-active — not a directory');
        return broadcastChange(removeWorkspaceFromHistory(resolved));
      }
      return broadcastChange(setActiveWorkspace(resolved));
    },
  );

  registerInvoke('workspace:browse', z.void(), async (): Promise<WorkspaceState> => {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const opts: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose workspace folder',
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) {
      return getWorkspaceState();
    }
    const picked = result.filePaths[0];
    if (!picked || !isExistingDirectory(picked)) {
      return getWorkspaceState();
    }
    return broadcastChange(setActiveWorkspace(picked));
  });

  registerInvoke(
    'workspace:remove',
    z.object({ path: z.string().min(1) }),
    (req): WorkspaceState => broadcastChange(removeWorkspaceFromHistory(req.path)),
  );

  registerInvoke('workspace:clear-active', z.void(), () => broadcastChange(clearActiveWorkspace()));
}
