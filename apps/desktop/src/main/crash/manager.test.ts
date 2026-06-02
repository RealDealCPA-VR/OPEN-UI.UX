import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrashReportingSettings } from '../storage/settings';

vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.3' },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const initCrash = vi.fn();
const closeCrash = vi.fn(async (..._args: unknown[]) => {});

vi.mock('@opencodex/crash-reporting', () => ({
  initCrash: (...args: unknown[]) => initCrash(...args),
  closeCrash: (...args: unknown[]) => closeCrash(...args),
}));

let stored: CrashReportingSettings;

vi.mock('../storage/settings', () => ({
  getCrashReportingSettings: (): CrashReportingSettings => stored,
  setCrashReportingSettings: (patch: Partial<CrashReportingSettings>): CrashReportingSettings => {
    stored = { ...stored, ...patch };
    return stored;
  },
}));

const { initCrashReporting, updateCrashReportingConfig, shutdownCrashReporting } =
  await import('./manager');

function makeClient(enabled: boolean): { enabled: boolean } {
  return { enabled };
}

beforeEach(() => {
  stored = { enabled: false, dsn: '', environment: 'production', allowedHosts: [] };
  initCrash.mockReset();
  closeCrash.mockClear();
  // By default mirror real behavior: a client is "enabled" only when config says so.
  initCrash.mockImplementation(async (cfg: { enabled: boolean; dsn: string }) =>
    makeClient(cfg.enabled && cfg.dsn.trim().length > 0),
  );
});

describe('crash reporting manager gating', () => {
  it('installs a disabled (non-enabled) client when settings are off', async () => {
    await initCrashReporting();
    expect(initCrash).toHaveBeenCalledTimes(1);
    expect(initCrash).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, dsn: '', release: '1.2.3' }),
    );
    const installed = await initCrash.mock.results[0]?.value;
    expect(installed).toMatchObject({ enabled: false });
  });

  it('enable-from-off installs an enabled client', async () => {
    await initCrashReporting();
    initCrash.mockClear();

    const cfg = await updateCrashReportingConfig({
      enabled: true,
      dsn: 'https://key@o1.ingest.sentry.io/1',
    });

    expect(cfg.enabled).toBe(true);
    expect(initCrash).toHaveBeenCalledTimes(1);
    expect(closeCrash).not.toHaveBeenCalled();
  });

  it('disable from enabled tears down the client without reinstalling', async () => {
    stored = {
      enabled: true,
      dsn: 'https://key@o1.ingest.sentry.io/1',
      environment: 'production',
      allowedHosts: [],
    };
    await initCrashReporting();
    initCrash.mockClear();
    closeCrash.mockClear();

    await updateCrashReportingConfig({ enabled: false });

    expect(closeCrash).toHaveBeenCalledTimes(1);
    expect(initCrash).not.toHaveBeenCalled();
  });

  it('toggling dsn while enabled tears down and reinstalls', async () => {
    stored = {
      enabled: true,
      dsn: 'https://key@o1.ingest.sentry.io/1',
      environment: 'production',
      allowedHosts: [],
    };
    await initCrashReporting();
    initCrash.mockClear();
    closeCrash.mockClear();

    await updateCrashReportingConfig({ dsn: 'https://key@o2.ingest.sentry.io/2' });

    expect(closeCrash).toHaveBeenCalledTimes(1);
    expect(initCrash).toHaveBeenCalledTimes(1);
    expect(initCrash).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://key@o2.ingest.sentry.io/2' }),
    );
  });

  it('enabled with an empty dsn does not yield an enabled client', async () => {
    await initCrashReporting();
    initCrash.mockClear();
    closeCrash.mockClear();

    await updateCrashReportingConfig({ enabled: true, dsn: '   ' });

    // willBeEnabled is false because the trimmed dsn is empty: no install, no teardown.
    expect(initCrash).not.toHaveBeenCalled();
    expect(closeCrash).not.toHaveBeenCalled();
  });

  it('shutdown tears down an installed enabled client', async () => {
    stored = {
      enabled: true,
      dsn: 'https://key@o1.ingest.sentry.io/1',
      environment: 'production',
      allowedHosts: [],
    };
    await initCrashReporting();
    closeCrash.mockClear();

    await shutdownCrashReporting();

    expect(closeCrash).toHaveBeenCalledTimes(1);
  });

  it('forwards allowedHosts to the client only when present', async () => {
    stored = {
      enabled: true,
      dsn: 'https://key@o1.ingest.sentry.io/1',
      environment: 'production',
      allowedHosts: ['example.com'],
    };
    await initCrashReporting();

    expect(initCrash).toHaveBeenCalledWith(
      expect.objectContaining({ allowedHosts: ['example.com'] }),
    );
  });
});
