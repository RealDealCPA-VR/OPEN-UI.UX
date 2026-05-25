import { BrowserWindow } from 'electron';
import { z } from 'zod';
import { mcpServerEntrySchema } from '../../shared/mcp';
import { registerInvoke } from '../ipc/registry';
import {
  addServer,
  getAvailablePrompts,
  getAvailableResources,
  getMcpState,
  onMcpStateChange,
  removeServer,
  setServerEnabled,
  startAllServers,
} from './manager';
import { MCP_PRESETS } from './presets';
import { indexAllMcpResources, startMcpResourceAutoIndexing } from './resource-indexer';

export function registerMcpHandlers(): void {
  registerInvoke('mcp:list', z.void(), () => getMcpState());
  registerInvoke('mcp:add', mcpServerEntrySchema, (entry) =>
    addServer(mcpServerEntrySchema.parse(entry)),
  );
  registerInvoke('mcp:remove', z.object({ id: z.string().min(1) }), ({ id }) => removeServer(id));
  registerInvoke(
    'mcp:set-enabled',
    z.object({ id: z.string().min(1), enabled: z.boolean() }),
    ({ id, enabled }) => setServerEnabled(id, enabled),
  );
  registerInvoke('mcp:presets', z.void(), () => MCP_PRESETS);
  registerInvoke('mcp:list-prompts', z.void(), () => getAvailablePrompts());
  registerInvoke('mcp:list-resources', z.void(), () => getAvailableResources());
  registerInvoke('mcp:reindex-resources', z.void(), () => indexAllMcpResources());

  onMcpStateChange((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('mcp:changed', state);
    }
  });

  startMcpResourceAutoIndexing();
  void startAllServers();
}
