import { BrowserWindow } from 'electron';
import { z } from 'zod';
import { registerInvoke } from '../ipc/registry';
import { ollamaInstallProgressChannel, ollamaInstallRequestSchema } from '../../shared/ollama';
import { probeOllama } from './ollama-probe';
import { getAvailableOllamaInstallers, installOllama } from './ollama-installer';

export function registerOllamaHandlers(): void {
  registerInvoke('ollama:probe', z.void(), async () => probeOllama());

  registerInvoke('ollama:list-installable-managers', z.void(), async () => {
    const installers = await getAvailableOllamaInstallers();
    return { installers };
  });

  registerInvoke('ollama:install', ollamaInstallRequestSchema, async (req) => {
    return await installOllama(req.installer, (chunk) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(ollamaInstallProgressChannel, chunk);
      }
    });
  });
}
