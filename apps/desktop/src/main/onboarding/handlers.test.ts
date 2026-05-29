import { homedir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

type Handler = (req: unknown) => unknown | Promise<unknown>;
const handlers = new Map<string, Handler>();

vi.mock('../ipc/registry', () => ({
  registerInvoke: (channel: string, _schema: unknown, fn: Handler): void => {
    handlers.set(channel, fn);
  },
}));

vi.mock('../storage/settings', () => ({
  clearOnboardingSteps: vi.fn(() => ({})),
  getOnboardingComplete: vi.fn(() => false),
  getOnboardingStep: vi.fn(() => null),
  getOnboardingSteps: vi.fn(() => ({})),
  setOnboardingComplete: vi.fn((v: boolean) => v),
  setOnboardingStep: vi.fn(() => ({})),
}));

const { registerOnboardingHandlers } = await import('./handlers');

describe('onboarding:get-defaults', () => {
  it('returns the OS home directory so the renderer can pre-seed a workspace', async () => {
    registerOnboardingHandlers();
    const handler = handlers.get('onboarding:get-defaults');
    expect(handler).toBeDefined();
    const result = await handler!(undefined);
    expect(result).toEqual({ homedir: homedir() });
  });
});
