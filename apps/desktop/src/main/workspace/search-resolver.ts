import {
  setSearchWorkspaceResolver,
  type SearchWorkspaceResolver,
  type WorkspaceForSearch,
} from '@opencodex/tools';
import { getWorkspaceById, listWorkspaces } from './workspaces-store';

function toForSearch(ws: { id: string; path: string; ragEnabled: boolean }): WorkspaceForSearch {
  return { id: ws.id, workspaceRoot: ws.path };
}

export function buildSearchWorkspaceResolver(): SearchWorkspaceResolver {
  return {
    resolve(id: string): WorkspaceForSearch | null {
      const ws = getWorkspaceById(id);
      if (!ws || !ws.ragEnabled) return null;
      return toForSearch(ws);
    },
    listEnabled(): WorkspaceForSearch[] {
      return listWorkspaces()
        .filter((w) => w.ragEnabled)
        .map(toForSearch);
    },
  };
}

export function installSearchWorkspaceResolver(): void {
  setSearchWorkspaceResolver(buildSearchWorkspaceResolver());
}

export function uninstallSearchWorkspaceResolver(): void {
  setSearchWorkspaceResolver(null);
}
