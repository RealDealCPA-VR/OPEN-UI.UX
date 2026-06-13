import { BrowserWindow, nativeTheme } from 'electron';
import { z } from 'zod';
import { registerInvoke } from '../ipc/registry';
import { logger } from '../logger';
import { getTheme } from '../storage/settings';
import { titleBarOverlayForPreference } from './titlebar-overlay';

// Channel typing lives here (module augmentation) rather than in
// shared/ipc-types.ts: window chrome is main-process-only plumbing and this
// keeps the heavily-shared channel map untouched.
declare module '../../shared/ipc-types' {
  interface IpcInvokeChannels {
    'window:minimize': { request: void; response: void };
    'window:toggle-maximize': { request: void; response: { maximized: boolean } };
    'window:close': { request: void; response: void };
    'window:is-maximized': { request: void; response: { maximized: boolean } };
    'window:sync-titlebar-overlay': { request: void; response: void };
  }
}

// Invoke handlers receive no sender reference, so target the focused window
// and fall back to the first one (OpenCodex is single-window today).
function targetWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

export function applyTitleBarOverlayTheme(): void {
  if (process.platform !== 'win32') return;
  const overlay = titleBarOverlayForPreference(getTheme(), nativeTheme.shouldUseDarkColors);
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.setTitleBarOverlay(overlay);
    } catch (err) {
      logger.warn({ err }, 'failed to update titlebar overlay colors');
    }
  }
}

export function registerWindowChromeHandlers(): void {
  registerInvoke('window:minimize', z.void(), () => {
    targetWindow()?.minimize();
  });

  registerInvoke('window:toggle-maximize', z.void(), () => {
    const win = targetWindow();
    if (!win) return { maximized: false };
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
    return { maximized: win.isMaximized() };
  });

  registerInvoke('window:close', z.void(), () => {
    targetWindow()?.close();
  });

  registerInvoke('window:is-maximized', z.void(), () => ({
    maximized: targetWindow()?.isMaximized() ?? false,
  }));

  // Preference changes arrive via the preload's settings:theme-changed
  // subscription; this re-reads the persisted theme and recolors the overlay.
  registerInvoke('window:sync-titlebar-overlay', z.void(), () => {
    applyTitleBarOverlayTheme();
  });

  // System dark/light flips never go through settings:set-theme, so recolor
  // directly when preference is 'system'.
  nativeTheme.on('updated', () => applyTitleBarOverlayTheme());
}
