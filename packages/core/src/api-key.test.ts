import { describe, expect, it } from 'vitest';
import { assertValidApiKey, computeCostUsd } from './api-key';

describe('assertValidApiKey', () => {
  it('accepts a non-empty string', () => {
    expect(() => assertValidApiKey('sk-foo', 'Test')).not.toThrow();
  });

  it('accepts undefined (optional config)', () => {
    expect(() => assertValidApiKey(undefined, 'Test')).not.toThrow();
    expect(() => assertValidApiKey(null, 'Test')).not.toThrow();
  });

  it('rejects empty string', () => {
    expect(() => assertValidApiKey('', 'Test')).toThrow(/empty/i);
  });

  it('rejects whitespace-only string', () => {
    expect(() => assertValidApiKey('   ', 'Test')).toThrow(/whitespace/i);
  });

  it('rejects non-string types', () => {
    expect(() => assertValidApiKey(42, 'Test')).toThrow(/string/i);
    expect(() => assertValidApiKey({}, 'Test')).toThrow(/string/i);
  });
});

describe('computeCostUsd', () => {
  it('returns undefined when pricing is missing', () => {
    expect(computeCostUsd({ inputTokens: 100, outputTokens: 50 })).toBeUndefined();
  });

  it('computes input + output cost from per-million pricing', () => {
    const cost = computeCostUsd({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      pricing: { inputPerMillion: 2, outputPerMillion: 8 },
    });
    expect(cost).toBeCloseTo(10);
  });

  it('uses cached pricing for cachedInputTokens when available', () => {
    const cost = computeCostUsd({
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 500_000,
      pricing: { inputPerMillion: 2, outputPerMillion: 0, cachedInputPerMillion: 0.5 },
    });
    // 500k cached @ $0.50/m = $0.25; 500k uncached @ $2/m = $1.00; total $1.25
    expect(cost).toBeCloseTo(1.25);
  });

  it('falls back to full input rate when cached rate is absent', () => {
    const cost = computeCostUsd({
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 500_000,
      pricing: { inputPerMillion: 2, outputPerMillion: 0 },
    });
    expect(cost).toBeCloseTo(2);
  });
});
