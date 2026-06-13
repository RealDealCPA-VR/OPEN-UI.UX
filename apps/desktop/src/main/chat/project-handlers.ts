import { BrowserWindow } from 'electron';
import { z } from 'zod';
import { registerInvoke } from '../ipc/registry';
import type { Project } from '../../shared/projects';
import {
  createProject,
  deleteProject,
  listProjects,
  renameProject,
  setProjectInstructions,
} from '../storage/projects';
import { listConversations, setConversationProject } from '../storage/conversations';
import { broadcastConversationsChanged } from './conversations-events';

const MAX_INSTRUCTIONS_LENGTH = 20_000;

/** Push the current project list to every renderer window after a mutation. */
export function broadcastProjectsChanged(projects: Project[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('projects:changed', { projects });
    }
  }
}

export function registerProjectHandlers(): void {
  registerInvoke('projects:list', z.void(), () => listProjects());

  registerInvoke('projects:create', z.object({ name: z.string().min(1).max(200) }), (req) => {
    const created = createProject(req.name);
    broadcastProjectsChanged(listProjects());
    return created;
  });

  registerInvoke(
    'projects:rename',
    z.object({ id: z.string().min(1), name: z.string().min(1).max(200) }),
    (req) => {
      const renamed = renameProject(req.id, req.name);
      broadcastProjectsChanged(listProjects());
      return renamed;
    },
  );

  registerInvoke(
    'projects:setInstructions',
    z.object({ id: z.string().min(1), instructions: z.string().max(MAX_INSTRUCTIONS_LENGTH) }),
    (req) => {
      const updated = setProjectInstructions(req.id, req.instructions);
      broadcastProjectsChanged(listProjects());
      return updated;
    },
  );

  registerInvoke('projects:delete', z.object({ id: z.string().min(1) }), (req) => {
    deleteProject(req.id);
    broadcastProjectsChanged(listProjects());
    // Deleting a project unassigns its conversations, so sidebars need both.
    broadcastConversationsChanged(listConversations());
  });

  registerInvoke(
    'conversations:assignProject',
    z.object({ id: z.string().min(1), projectId: z.string().min(1).nullable() }),
    (req) => {
      const updated = setConversationProject(req.id, req.projectId);
      broadcastConversationsChanged(listConversations());
      return updated;
    },
  );
}
