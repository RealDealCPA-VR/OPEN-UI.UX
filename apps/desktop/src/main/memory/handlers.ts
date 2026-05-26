import { BrowserWindow } from 'electron';
import { z } from 'zod';
import { registerInvoke } from '../ipc/registry';
import {
  applyMemoryConfig,
  clearNotionToken,
  getMemoryStatus,
  onMemoryConfigChange,
  setNotionToken,
  testMemoryConnection,
} from './manager';
import {
  memoryBackendIdSchema,
  setMemoryConfigRequestSchema,
  setNotionTokenRequestSchema,
  testMemoryConnectionRequestSchema,
} from '../../shared/memory';

export function registerMemoryHandlers(): void {
  registerInvoke('memory:get-status', z.void(), async () => getMemoryStatus());
  registerInvoke('memory:set-config', setMemoryConfigRequestSchema, async (req) =>
    applyMemoryConfig(req.config),
  );
  registerInvoke('memory:test-connection', testMemoryConnectionRequestSchema, async (req) =>
    testMemoryConnection(req.backend),
  );
  registerInvoke('memory:set-notion-token', setNotionTokenRequestSchema, async (req) =>
    setNotionToken(req.token),
  );
  registerInvoke('memory:clear-notion-token', z.void(), async () => clearNotionToken());
  registerInvoke('memory:reload', z.void(), async () => {
    const status = await getMemoryStatus();
    return status;
  });

  // expose schema validators so caller cannot send arbitrary backend ids
  void memoryBackendIdSchema;

  onMemoryConfigChange((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('memory:config-changed', { status });
    }
  });
}
