import { BrowserWindow } from 'electron';
import { z } from 'zod';
import { registerInvoke } from '../ipc/registry';
import { getReadOnlyChatMode, setReadOnlyChatMode } from '../storage/settings';

export function registerReadOnlyChatHandlers(): void {
  registerInvoke('chat:get-read-only-mode', z.void(), () => ({ readOnly: getReadOnlyChatMode() }));
  registerInvoke('chat:set-read-only-mode', z.object({ readOnly: z.boolean() }), ({ readOnly }) => {
    const next = setReadOnlyChatMode(readOnly);
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('chat:read-only-changed', { readOnly: next });
    }
    return { readOnly: next };
  });
}
