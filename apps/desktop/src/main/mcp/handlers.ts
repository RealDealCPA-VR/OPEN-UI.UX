import { BrowserWindow } from 'electron';
import { z } from 'zod';
import { mcpServerEntrySchema } from '../../shared/mcp';
import { registerInvoke } from '../ipc/registry';
import {
  addServer,
  getMcpState,
  onMcpStateChange,
  removeServer,
  setServerEnabled,
  startAllServers,
} from './manager';
import { MCP_PRESETS } from './presets';

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

  onMcpStateChange((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('mcp:changed', state);
    }
  });

  void startAllServers();
}
