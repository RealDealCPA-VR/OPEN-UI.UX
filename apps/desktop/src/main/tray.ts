import { app, Menu, nativeImage, Tray } from 'electron';
import type { BrowserWindow } from 'electron';

let tray: Tray | null = null;

export function createTray(getWindow: () => BrowserWindow | null): Tray {
  const icon = nativeImage.createEmpty();
  const instance = new Tray(icon);
  instance.setToolTip('OpenCodex');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Open OpenCodex',
      click: () => {
        const w = getWindow();
        if (!w) return;
        if (w.isMinimized()) w.restore();
        w.show();
        w.focus();
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  instance.setContextMenu(menu);

  instance.on('click', () => {
    const w = getWindow();
    if (!w) return;
    if (w.isVisible()) w.hide();
    else {
      w.show();
      w.focus();
    }
  });

  tray = instance;
  return instance;
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
