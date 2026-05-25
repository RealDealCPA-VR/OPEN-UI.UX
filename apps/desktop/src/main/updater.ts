import pkg from 'electron-updater';
import { logger } from './logger';

function getAutoUpdater() {
  return pkg.autoUpdater;
}

export function initAutoUpdater(): void {
  const autoUpdater = getAutoUpdater();
  autoUpdater.logger = logger;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => logger.error({ err }, 'auto-updater error'));
  autoUpdater.on('update-available', (info) =>
    logger.info({ version: info.version }, 'update available'),
  );
  autoUpdater.on('update-not-available', () => logger.debug('no update available'));
  autoUpdater.on('download-progress', (p) =>
    logger.debug({ percent: p.percent }, 'update download progress'),
  );
  autoUpdater.on('update-downloaded', (info) =>
    logger.info({ version: info.version }, 'update downloaded'),
  );
}

export async function checkForUpdates(): Promise<void> {
  await getAutoUpdater().checkForUpdates();
}
