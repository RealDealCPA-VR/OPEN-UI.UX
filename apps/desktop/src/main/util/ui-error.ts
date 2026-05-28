import { BrowserWindow } from 'electron';
import type { UiErrorEvent } from '../../shared/ui-errors';

/**
 * Broadcast a background-subsystem error to every renderer window so it can
 * surface a toast. The renderer-side toast adoption is owned by Lane A/E and
 * not required for this event to be safe to emit.
 */
export function emitUiError(payload: UiErrorEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send('ui:error', payload);
    } catch {
      // window may be tearing down — ignore
    }
  }
}
