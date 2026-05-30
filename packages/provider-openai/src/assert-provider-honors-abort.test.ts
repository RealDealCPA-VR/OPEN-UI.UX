import { afterEach, describe, expect, it } from 'vitest';
import { assertProviderHonorsAbort } from '@opencodex/core';
import { openAIProvider } from './provider';

function infiniteStreamResponse(signal?: AbortSignal): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let cancelled = false;
      const onAbort = (): void => {
        cancelled = true;
        try {
          controller.error(new DOMException('Aborted', 'AbortError'));
        } catch {
          // already errored or closed
        }
      };
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
      const pump = (): void => {
        if (cancelled) return;
        try {
          controller.enqueue(
            encoder.encode(
              'data: {"id":"x","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"index":0,"delta":{"content":"."},"finish_reason":null}]}\n\n',
            ),
          );
        } catch {
          return;
        }
        setTimeout(pump, 5);
      };
      pump();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('openAIProvider honors abort signal', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('stops promptly when the chat AbortSignal fires', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      const signal = init?.signal as AbortSignal | undefined;
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      return new Promise<Response>((resolve, reject) => {
        const onAbort = (): void => {
          reject(new DOMException('Aborted', 'AbortError'));
        };
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        queueMicrotask(() => resolve(infiniteStreamResponse(signal)));
      });
    }) as typeof fetch;

    const result = await assertProviderHonorsAbort(
      () => openAIProvider.create({ apiKey: 'sk-test' }),
      { chatRequest: { model: 'gpt-4o' } },
    );

    expect(['done-cancelled', 'error-cancelled', 'abort-thrown']).toContain(result.outcome);
    expect(result.settledAfterMs).toBeLessThanOrEqual(500);
  });
});
