import { describe, expect, it } from 'vitest';
import { catalog, getAllProviderInfo } from '../providers/catalog';
import { resolveSelectedModel } from './resolve';

describe('resolveSelectedModel', () => {
  it('returns the matching capability for a valid provider + model pair', async () => {
    const infos = await getAllProviderInfo();
    for (const info of infos) {
      const first = info.models[0];
      if (!first) continue;
      const match = await resolveSelectedModel({
        providerId: info.id,
        modelId: first.id,
      });
      expect(match).not.toBeNull();
      expect(match?.id).toBe(first.id);
      expect(match?.providerId).toBe(info.id);
    }
  });

  it('returns null for an unknown provider id', async () => {
    const match = await resolveSelectedModel({
      providerId: 'does-not-exist',
      modelId: 'whatever',
    });
    expect(match).toBeNull();
  });

  it('returns null for a known provider but unknown model id', async () => {
    const first = catalog[0]!;
    const match = await resolveSelectedModel({
      providerId: first.id,
      modelId: 'not-a-real-model-id-zzz',
    });
    expect(match).toBeNull();
  });
});
