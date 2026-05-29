import { describe, expect, it } from 'vitest';
import { anonymizeId, createTelemetry, generateInstallSalt } from './index';

describe('createTelemetry', () => {
  it('returns a no-op client when config is null', () => {
    const client = createTelemetry(null);
    expect(client.enabled).toBe(false);
    expect(() => client.track('foo')).not.toThrow();
    expect(() => client.identify('user-1')).not.toThrow();
  });

  it('returns a no-op client when disabled', () => {
    const client = createTelemetry({
      enabled: false,
      apiKey: 'phc_key',
      host: null,
      salt: 'salt',
    });
    expect(client.enabled).toBe(false);
  });

  it('returns a no-op client when apiKey is empty even if enabled', () => {
    const client = createTelemetry({ enabled: true, apiKey: '', host: null, salt: 'salt' });
    expect(client.enabled).toBe(false);
  });

  it('returns a no-op client when apiKey is whitespace', () => {
    const client = createTelemetry({ enabled: true, apiKey: '   ', host: null, salt: 'salt' });
    expect(client.enabled).toBe(false);
  });

  it('no-op shutdown resolves cleanly', async () => {
    const client = createTelemetry(null);
    await expect(client.shutdown()).resolves.toBeUndefined();
  });

  it('exposes an enabled flag when a real key is configured', () => {
    const client = createTelemetry({
      enabled: true,
      apiKey: 'phc_test',
      host: null,
      salt: 'salt',
    });
    expect(client.enabled).toBe(true);
  });

  it('rejects hosts not on the allowlist', () => {
    const client = createTelemetry({
      enabled: true,
      apiKey: 'phc_test',
      host: 'https://evil.example.com',
      salt: 'salt',
    });
    expect(client.enabled).toBe(false);
  });

  it('accepts the default posthog host', () => {
    const client = createTelemetry({
      enabled: true,
      apiKey: 'phc_test',
      host: 'https://us.i.posthog.com',
      salt: 'salt',
    });
    expect(client.enabled).toBe(true);
  });

  it('rejects garbage config shapes', () => {
    const client = createTelemetry({ enabled: 'yes' } as unknown as null);
    expect(client.enabled).toBe(false);
  });
});

describe('anonymizeId (HMAC-SHA-256)', () => {
  it('produces a deterministic hex hash for the same salt', () => {
    const salt = 'a-test-salt';
    expect(anonymizeId('openai/gpt-4o', salt)).toBe(anonymizeId('openai/gpt-4o', salt));
    expect(anonymizeId('openai/gpt-4o', salt)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when input changes', () => {
    expect(anonymizeId('a', 'salt')).not.toBe(anonymizeId('b', 'salt'));
  });

  it('changes when the salt changes (no cross-install collisions)', () => {
    expect(anonymizeId('openai/gpt-4o', 'salt-one')).not.toBe(
      anonymizeId('openai/gpt-4o', 'salt-two'),
    );
  });

  it('throws when the salt is empty (callers must thread a salt through)', () => {
    expect(() => anonymizeId('a', '')).toThrow();
  });
});

describe('generateInstallSalt', () => {
  it('returns a 64-char hex string', () => {
    const salt = generateInstallSalt();
    expect(salt).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns different salts on successive calls', () => {
    expect(generateInstallSalt()).not.toBe(generateInstallSalt());
  });
});
