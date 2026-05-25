import { describe, expect, it, vi } from 'vitest';
import { voyageProvider } from './index';

describe('voyageProvider', () => {
  it('lists Voyage embedding models', async () => {
    const provider = voyageProvider.create({ apiKey: 'sk-x' });
    const models = await provider.listModels();
    expect(models.map((m) => m.id)).toContain('voyage-3');
    expect(models.every((m) => m.embeddings)).toBe(true);
  });

  it('embed() posts to /embeddings and returns ordered vectors', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { index: 1, embedding: [0.4, 0.5] },
              { index: 0, embedding: [0.1, 0.2] },
            ],
            usage: { total_tokens: 7 },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = voyageProvider.create({ apiKey: 'sk-x' });
    const result = await provider.embed({ model: 'voyage-3', inputs: ['a', 'b'] });
    expect(result.embeddings).toEqual([
      [0.1, 0.2],
      [0.4, 0.5],
    ]);
    expect(result.usage.tokens).toBe(7);
    vi.unstubAllGlobals();
  });

  it('chat() throws — Voyage is embeddings-only', async () => {
    const provider = voyageProvider.create({ apiKey: 'sk-x' });
    await expect(async () => {
      for await (const _ of provider.chat({ model: 'voyage-3', messages: [] })) void _;
    }).rejects.toThrow();
  });
});
