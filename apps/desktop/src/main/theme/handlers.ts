import { BrowserWindow } from 'electron';
import { z } from 'zod';
import { emit, registerInvoke } from '../ipc/registry';
import { getTheme, setTheme } from '../storage/settings';

const setThemeRequest = z.object({
  preference: z.enum(['light', 'dark', 'system']),
});

export function registerThemeHandlers(): void {
  registerInvoke('settings:get-theme', z.void(), () => getTheme());

  registerInvoke('settings:set-theme', setThemeRequest, (req) => {
    const next = setTheme(req.preference);
    for (const win of BrowserWindow.getAllWindows()) {
      emit(win.webContents, 'settings:theme-changed', { preference: next });
    }
    return next;
  });
}
