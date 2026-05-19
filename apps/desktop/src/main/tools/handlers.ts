import { z } from 'zod';
import { registerInvoke } from '../ipc/registry';
import { getToolRegistry } from './registry';

export function registerToolHandlers(): void {
  registerInvoke('tools:list', z.void(), () =>
    getToolRegistry()
      .list()
      .map((t) => ({
        name: t.name,
        description: t.description,
        permissionTier: t.permissionTier,
      })),
  );
}
