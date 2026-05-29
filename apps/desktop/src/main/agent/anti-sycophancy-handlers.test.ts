import { describe, expect, it, vi } from 'vitest';

vi.mock('../storage/settings', () => {
  const state: { value: { antiSycophancyEnabled?: boolean } } = { value: {} };
  return {
    getSettings: () => state.value,
    updateSettings: (patch: Record<string, unknown>) => {
      state.value = { ...state.value, ...patch } as typeof state.value;
      return state.value;
    },
    __reset: (): void => {
      state.value = {};
    },
  };
});

vi.mock('../ipc/registry', () => ({
  registerInvoke: vi.fn(),
}));

const settingsModule = await import('../storage/settings');
const { getAntiSycophancyEnabled, setAntiSycophancyEnabled } =
  await import('./anti-sycophancy-handlers');

const reset = (settingsModule as unknown as { __reset: () => void }).__reset;

describe('anti-sycophancy-handlers', () => {
  it('defaults to enabled (true) when the setting is undefined', () => {
    reset();
    expect(getAntiSycophancyEnabled()).toBe(true);
  });

  it('returns false only when the setting is explicitly false', () => {
    reset();
    setAntiSycophancyEnabled(false);
    expect(getAntiSycophancyEnabled()).toBe(false);
    setAntiSycophancyEnabled(true);
    expect(getAntiSycophancyEnabled()).toBe(true);
  });
});
