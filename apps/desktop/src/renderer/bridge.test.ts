// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBridge, resetBridgeWarning } from './bridge';

const originalOpencodex = (window as unknown as { opencodex?: unknown }).opencodex;

describe('getBridge', () => {
  beforeEach(() => {
    resetBridgeWarning();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    (window as unknown as { opencodex?: unknown }).opencodex = originalOpencodex;
  });

  it('returns the bridge when window.opencodex is defined', () => {
    const fakeBridge = { foo: 'bar' };
    (window as unknown as { opencodex: unknown }).opencodex = fakeBridge;
    expect(getBridge()).toBe(fakeBridge);
  });

  it('returns null and warns once when window.opencodex is missing', () => {
    (window as unknown as { opencodex?: unknown }).opencodex = undefined;
    const warn = vi.spyOn(console, 'warn');
    expect(getBridge()).toBeNull();
    expect(getBridge()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
