import { BrowserWindow, globalShortcut } from 'electron';
import { logger } from '../logger';

let currentAccelerator: string | null = null;

export interface RegisterShortcutResult {
  accelerator: string;
  registered: boolean;
  error: string | null;
}

export function registerPttShortcut(accelerator: string): RegisterShortcutResult {
  unregisterPttShortcut();
  if (!accelerator || accelerator.trim().length === 0) {
    return { accelerator: '', registered: false, error: null };
  }
  try {
    const ok = globalShortcut.register(accelerator, () => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('voice:ptt-event', { kind: 'ptt-press' });
      }
    });
    if (!ok) {
      return {
        accelerator,
        registered: false,
        error: `Could not register shortcut: "${accelerator}" may be in use by another app.`,
      };
    }
    currentAccelerator = accelerator;
    return { accelerator, registered: true, error: null };
  } catch (err) {
    logger.warn({ err, accelerator }, 'failed to register PTT shortcut');
    return {
      accelerator,
      registered: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function unregisterPttShortcut(): void {
  if (currentAccelerator) {
    try {
      globalShortcut.unregister(currentAccelerator);
    } catch (err) {
      logger.warn({ err, accelerator: currentAccelerator }, 'failed to unregister PTT shortcut');
    }
    currentAccelerator = null;
  }
}

export function getCurrentPttShortcut(): string | null {
  return currentAccelerator;
}
