import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type StoreState = Record<string, unknown>;
const storeState: StoreState = {};
let throwOnGet = false;

vi.mock('../storage/lazy-electron-store', () => ({
  lazyElectronStore: <T extends Record<string, unknown>>(opts: { defaults: T }) => {
    Object.assign(storeState, opts.defaults);
    return {
      get: (key: string) => {
        if (throwOnGet) throw new Error('store read failed');
        return storeState[key];
      },
      set: (key: string, value: unknown) => {
        storeState[key] = value;
      },
    };
  },
}));

vi.mock('../logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { readNetworkPolicyFromStore, FAIL_CLOSED_NETWORK_POLICY } = await import('./store');

beforeEach(() => {
  throwOnGet = false;
  for (const k of Object.keys(storeState)) delete storeState[k];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('readNetworkPolicyFromStore', () => {
  it('returns the stored policy when valid', () => {
    storeState['network'] = {
      localOnlyMode: true,
      allowlist: ['api.openai.com'],
    };
    expect(readNetworkPolicyFromStore()).toEqual({
      localOnlyMode: true,
      allowlist: ['api.openai.com'],
    });
  });

  it('returns FAIL_CLOSED policy when stored data is corrupt (schema mismatch)', () => {
    storeState['network'] = { allowlist: 'not-an-array', localOnlyMode: 'nope' };
    expect(readNetworkPolicyFromStore()).toEqual(FAIL_CLOSED_NETWORK_POLICY);
    expect(FAIL_CLOSED_NETWORK_POLICY.localOnlyMode).toBe(true);
    expect(FAIL_CLOSED_NETWORK_POLICY.allowlist).toEqual([]);
  });

  it('returns FAIL_CLOSED policy when stored data is missing entirely', () => {
    storeState['network'] = undefined;
    expect(readNetworkPolicyFromStore()).toEqual(FAIL_CLOSED_NETWORK_POLICY);
  });

  it('returns FAIL_CLOSED policy when the underlying store throws', () => {
    throwOnGet = true;
    expect(readNetworkPolicyFromStore()).toEqual(FAIL_CLOSED_NETWORK_POLICY);
  });

  it('does not silently fall back to the permissive default with non-empty allowlist', () => {
    storeState['network'] = 'totally broken';
    const policy = readNetworkPolicyFromStore();
    expect(policy.localOnlyMode).toBe(true);
    expect(policy.allowlist).toEqual([]);
  });
});
