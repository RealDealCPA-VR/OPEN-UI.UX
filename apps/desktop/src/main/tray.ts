import { app, Menu, nativeImage, Tray } from 'electron';
import type { BrowserWindow } from 'electron';
import { resolveAppIconPath } from './app-icon';

let tray: Tray | null = null;

export function createTray(getWindow: () => BrowserWindow | null): Tray {
  const icon = nativeImage.createFromPath(resolveAppIconPath());
  const trayImage = icon.isEmpty() ? icon : icon.resize({ width: 16, height: 16 });
  const instance = new Tray(trayImage);
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
