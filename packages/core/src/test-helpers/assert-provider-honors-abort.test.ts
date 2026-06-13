import { describe, expect, it } from 'vitest';
import { assertProviderHonorsAbort } from './assert-provider-honors-abort';
import type { ChatEvent } from '../events';
import type { ChatRequest, LLMProvider } from '../provider';

function makeProvider(chat: (req: ChatRequest) => AsyncIterable<ChatEvent>): LLMProvider {
  return {
    id: 'stub',
    displayName: 'Stub',
    chat,
    embed: () => Promise.reject(new Error('not implemented')),
    listModels: () => Promise.resolve([]),
    capabilities: () => Promise.resolve(undefined),
  };
}

describe('assertProviderHonorsAbort', () => {
  it('passes for a provider that throws AbortError when its signal aborts', async () => {
    const result = await assertProviderHonorsAbort(() =>
      makeProvider(async function* (req) {
        yield { type: 'text_delta', delta: 'x' };
        await new Promise<never>((_, reject) => {
          req.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        });
      }),
    );
    expect(result.outcome).toBe('abort-thrown');
    expect(result.settledAfterMs).toBeLessThan(500);
  });

  it('fails with a clear message when the stream cancels before abort fires', async () => {
    await expect(
      assertProviderHonorsAbort(
        () =>
          makeProvider(async function* () {
            yield { type: 'done', stopReason: 'cancelled' };
          }),
        { abortAfterMs: 200 },
      ),
    ).rejects.toThrow(/settled before the abort fired/);
  });

  it('reports the deadline error without leaking an unhandled rejection when the provider ignores abort', async () => {
    // Hand-rolled iterator (not a generator) so iterator.return() can settle
    // the pending next() during teardown — that resolution is what makes the
    // abandoned pump reject after the deadline already won the race.
    let resolveNext: ((r: IteratorResult<ChatEvent>) => void) | undefined;
    const iterator: AsyncIterator<ChatEvent> = {
      next: () =>
        new Promise<IteratorResult<ChatEvent>>((res) => {
          resolveNext = res;
        }),
      return: () => {
        resolveNext?.({ done: true, value: undefined });
        return Promise.resolve({ done: true, value: undefined });
      },
    };
    await expect(
      assertProviderHonorsAbort(
        () => makeProvider(() => ({ [Symbol.asyncIterator]: () => iterator })),
        { abortAfterMs: 5, maxSettleMs: 25 },
      ),
    ).rejects.toThrow(/did not honor abort within/);
    // Give the abandoned pump a tick to reject; vitest fails the test if that
    // rejection is unobserved.
    await new Promise((res) => setTimeout(res, 10));
  });
});
