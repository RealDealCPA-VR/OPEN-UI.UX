import { ipcMain } from 'electron';
import type { ZodType, ZodTypeDef } from 'zod';
import type {
  IpcEventChannel,
  IpcEventChannels,
  IpcInvokeChannel,
  IpcInvokeChannels,
} from '../../shared/ipc-types';
import { logger } from '../logger';

type InvokeHandler<C extends IpcInvokeChannel> = (
  req: IpcInvokeChannels[C]['request'],
) => Promise<IpcInvokeChannels[C]['response']> | IpcInvokeChannels[C]['response'];

export function registerInvoke<C extends IpcInvokeChannel>(
  channel: C,
  requestSchema: ZodType<IpcInvokeChannels[C]['request'], ZodTypeDef, unknown>,
  handler: InvokeHandler<C>,
): void {
  ipcMain.handle(channel, async (event, raw: unknown) => {
    const senderFrame = (event as { senderFrame?: Electron.WebFrameMain | null }).senderFrame;
    if (senderFrame && senderFrame.parent !== null) {
      logger.warn(
        { channel, url: senderFrame.url },
        'rejected IPC invoke from non-main frame (likely iframe/webview)',
      );
      throw new Error(`IPC channel "${channel}" is only callable from the main frame`);
    }
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn({ channel, issues: parsed.error.issues }, 'invalid IPC request');
      throw new Error(`invalid request for ${channel}: ${parsed.error.message}`);
    }
    return handler(parsed.data);
  });
}

export function emit<C extends IpcEventChannel>(
  webContents: Electron.WebContents,
  channel: C,
  payload: IpcEventChannels[C],
): void {
  if (webContents.isDestroyed()) return;
  webContents.send(channel, payload);
}
