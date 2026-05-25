import { BrowserWindow } from 'electron';
import { z } from 'zod';
import { registerInvoke } from '../ipc/registry';
import { clear, listRuns, onRunsChanged } from './run-registry';

export function registerAgentHandlers(): void {
  registerInvoke('agent:list-runs', z.void(), () => listRuns());
  registerInvoke('agent:clear-runs', z.void(), () => {
    clear();
    return listRuns();
  });

  onRunsChanged((runs) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('agent:runs-changed', { runs: [...runs] });
    }
  });
}
