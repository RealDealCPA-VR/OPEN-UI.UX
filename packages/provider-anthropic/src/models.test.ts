import { describe, expect, it } from 'vitest';
import { defaultMaxTokens, findModel, knownModels } from './models';

describe('models catalog', () => {
  it('lists opus 4.8 and 4.7 with 1M context, 128K output, $5/$25 pricing', () => {
    for (const id of ['claude-opus-4-8', 'claude-opus-4-7']) {
      expect(findModel(id)).toMatchObject({
        contextWindow: 1_000_000,
        maxOutputTokens: 128_000,
        pricing: { inputPerMillion: 5, outputPerMillion: 25, cachedInputPerMillion: 0.5 },
      });
    }
  });

  it('lists sonnet 4.6 with a 1M context window', () => {
    expect(findModel('claude-sonnet-4-6')).toMatchObject({
      contextWindow: 1_000_000,
      maxOutputTokens: 64_000,
    });
  });

  it('resolves haiku 4.5 by bare alias and by dated snapshot ID', () => {
    const bare = findModel('claude-haiku-4-5');
    expect(bare).toMatchObject({ id: 'claude-haiku-4-5', maxOutputTokens: 64_000 });
    expect(findModel('claude-haiku-4-5-20251001')).toEqual(bare);
  });

  it('no longer lists the retired 3.5 models', () => {
    expect(findModel('claude-3-5-sonnet-20241022')).toBeUndefined();
    expect(findModel('claude-3-5-haiku-20241022')).toBeUndefined();
    expect(knownModels().some((m) => m.id.startsWith('claude-3-5'))).toBe(false);
  });

  it('defaultMaxTokens reflects the catalog and falls back to 4096', () => {
    expect(defaultMaxTokens('claude-opus-4-8')).toBe(128_000);
    expect(defaultMaxTokens('claude-haiku-4-5')).toBe(64_000);
    expect(defaultMaxTokens('mystery-model')).toBe(4_096);
  });
});
