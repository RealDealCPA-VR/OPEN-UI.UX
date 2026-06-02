import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelemetrySettings } from '../storage/settings';

vi.mock('electron', () => ({
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

interface FakeClient {
  enabled: boolean;
  track: ReturnType<typeof vi.fn>;
  identify: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
}

const createdClients: FakeClient[] = [];
const createTelemetry = vi.fn();
const anonymizeId = vi.fn((input: string, salt: string) => `${input}:${salt}`);
const generateInstallSalt = vi.fn(() => 'fresh-salt');

vi.mock('@opencodex/telemetry', () => ({
  createTelemetry: (...args: unknown[]) => createTelemetry(...args),
  anonymizeId: (...args: [string, string]) => anonymizeId(...args),
  generateInstallSalt: () => generateInstallSalt(),
}));

let stored: TelemetrySettings;
let salt: string;

vi.mock('../storage/settings', () => ({
  getTelemetrySettings: (): TelemetrySettings => stored,
  setTelemetrySettings: (patch: Partial<TelemetrySettings>): TelemetrySettings => {
    stored = { ...stored, ...patch };
    return stored;
  },
  getTelemetryInstallSalt: (): string => salt,
  setTelemetryInstallSalt: (s: string): string => {
    salt = s;
    return s;
  },
}));

const { initTelemetry, updateTelemetryConfig, shutdownTelemetry, track } =
  await import('./manager');

function makeClient(enabled: boolean): FakeClient {
  const client: FakeClient = {
    enabled,
    track: vi.fn(),
    identify: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
  return client;
}

beforeEach(() => {
  stored = { enabled: false, apiKey: '', host: null, allowedHosts: [] };
  salt = 'install-salt';
  createdClients.length = 0;
  createTelemetry.mockReset();
  anonymizeId.mockClear();
  generateInstallSalt.mockClear();
  createTelemetry.mockImplementation((cfg: { enabled: boolean; apiKey: string; salt: string }) => {
    const client = makeClient(cfg.enabled && cfg.apiKey.trim().length > 0);
    createdClients.push(client);
    return client;
  });
});

describe('telemetry manager gating', () => {
  it('init with telemetry off creates a non-enabled client and passes the salt', async () => {
    initTelemetry();
    expect(createTelemetry).toHaveBeenCalledTimes(1);
    expect(createTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, salt: 'install-salt' }),
    );
    expect(createdClients[0]?.enabled).toBe(false);
  });

  it('enable-from-off recreates an enabled client', () => {
    initTelemetry();
    expect(createdClients[0]?.enabled).toBe(false);

    const cfg = updateTelemetryConfig({ enabled: true, apiKey: 'phc_key' });

    expect(cfg.enabled).toBe(true);
    expect(createTelemetry).toHaveBeenCalledTimes(2);
    expect(createdClients[1]?.enabled).toBe(true);
  });

  it('updating config shuts down the previous client before recreating', async () => {
    stored = { enabled: true, apiKey: 'phc_key', host: null, allowedHosts: [] };
    initTelemetry();
    const first = createdClients[0];
    expect(first?.enabled).toBe(true);

    updateTelemetryConfig({ apiKey: 'phc_other' });
    // shutdown is fire-and-forget inside updateTelemetryConfig; let microtasks flush.
    await Promise.resolve();

    expect(first?.shutdown).toHaveBeenCalledTimes(1);
    expect(createdClients).toHaveLength(2);
    expect(createTelemetry).toHaveBeenLastCalledWith(
      expect.objectContaining({ apiKey: 'phc_other' }),
    );
  });

  it('disabling recreates a non-enabled client and tears down the old one', async () => {
    stored = { enabled: true, apiKey: 'phc_key', host: null, allowedHosts: [] };
    initTelemetry();
    const first = createdClients[0];

    const cfg = updateTelemetryConfig({ enabled: false });
    await Promise.resolve();

    expect(cfg.enabled).toBe(false);
    expect(first?.shutdown).toHaveBeenCalledTimes(1);
    expect(createdClients[1]?.enabled).toBe(false);
  });

  it('track routes to the current client only', () => {
    stored = { enabled: true, apiKey: 'phc_key', host: null, allowedHosts: [] };
    initTelemetry();
    const client = createdClients[0];

    track('opened', { a: 1 }, 'user-1');

    expect(client?.track).toHaveBeenCalledWith('opened', { a: 1 }, 'user-1');
  });

  it('shutdown clears the client so subsequent track is a no-op', async () => {
    stored = { enabled: true, apiKey: 'phc_key', host: null, allowedHosts: [] };
    initTelemetry();
    const client = createdClients[0];

    await shutdownTelemetry();
    expect(client?.shutdown).toHaveBeenCalledTimes(1);

    track('after-shutdown');
    expect(client?.track).not.toHaveBeenCalled();
  });

  it('forwards allowedHosts to the client when present', () => {
    stored = { enabled: true, apiKey: 'phc_key', host: null, allowedHosts: ['posthog.example'] };
    initTelemetry();

    expect(createTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ allowedHosts: ['posthog.example'] }),
    );
  });
});
