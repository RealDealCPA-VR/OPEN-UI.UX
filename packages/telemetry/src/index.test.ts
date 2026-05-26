import { describe, expect, it } from 'vitest';
import { anonymizeId, createTelemetry } from './index';

describe('createTelemetry', () => {
  it('returns a no-op client when config is null', () => {
    const client = createTelemetry(null);
    expect(client.enabled).toBe(false);
    expect(() => client.track('foo')).not.toThrow();
    expect(() => client.identify('user-1')).not.toThrow();
  });

  it('returns a no-op client when disabled', () => {
    const client = createTelemetry({ enabled: false, apiKey: 'phc_key', host: null });
    expect(client.enabled).toBe(false);
  });

  it('returns a no-op client when apiKey is empty even if enabled', () => {
    const client = createTelemetry({ enabled: true, apiKey: '', host: null });
    expect(client.enabled).toBe(false);
  });

  it('returns a no-op client when apiKey is whitespace', () => {
    const client = createTelemetry({ enabled: true, apiKey: '   ', host: null });
    expect(client.enabled).toBe(false);
  });

  it('no-op shutdown resolves cleanly', async () => {
    const client = createTelemetry(null);
    await expect(client.shutdown()).resolves.toBeUndefined();
  });

  it('exposes an enabled flag when a real key is configured', () => {
    const client = createTelemetry({ enabled: true, apiKey: 'phc_test', host: null });
    expect(client.enabled).toBe(true);
  });
});

describe('anonymizeId', () => {
  it('produces a deterministic hex hash', () => {
    expect(anonymizeId('openai/gpt-4o')).toBe(anonymizeId('openai/gpt-4o'));
    expect(anonymizeId('openai/gpt-4o')).toMatch(/^[0-9a-f]+$/);
  });

  it('changes when input changes', () => {
    expect(anonymizeId('a')).not.toBe(anonymizeId('b'));
  });
});
