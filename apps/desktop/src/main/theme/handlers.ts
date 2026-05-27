import { BrowserWindow } from 'electron';
import { z } from 'zod';
import {
  getRunnerCliPathRequestSchema,
  setHoverHintsRequestSchema,
  setRunnerCliPathRequestSchema,
} from '../../shared/ipc-types';
import { emit, registerInvoke } from '../ipc/registry';
import {
  getHoverHintsEnabled,
  getRunnerCliPath,
  getTheme,
  setHoverHintsEnabled,
  setRunnerCliPath,
  setTheme,
} from '../storage/settings';

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

  registerInvoke('settings:get-hover-hints', z.void(), () => getHoverHintsEnabled());

  registerInvoke('settings:set-hover-hints', setHoverHintsRequestSchema, (req) => {
    const next = setHoverHintsEnabled(req.enabled);
    for (const win of BrowserWindow.getAllWindows()) {
      emit(win.webContents, 'settings:hover-hints-changed', { enabled: next });
    }
  });

  registerInvoke('settings:get-runner-cli-path', getRunnerCliPathRequestSchema, (req) =>
    getRunnerCliPath(req.runnerId),
  );

  registerInvoke('settings:set-runner-cli-path', setRunnerCliPathRequestSchema, (req) => {
    setRunnerCliPath(req.runnerId, req.cliPath);
  });
}
