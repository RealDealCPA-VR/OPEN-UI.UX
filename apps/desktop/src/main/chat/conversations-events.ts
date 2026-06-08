import { BrowserWindow } from 'electron';
import type { Conversation } from '../../shared/conversation';

/**
 * Push the current conversation list to every renderer window so sidebars can
 * live-update after a title/star/delete change without a manual refresh.
 */
export function broadcastConversationsChanged(conversations: Conversation[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('conversations:changed', { conversations });
    }
  }
}
