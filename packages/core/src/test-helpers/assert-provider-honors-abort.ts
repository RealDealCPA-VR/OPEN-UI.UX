import type { ChatEvent } from '../events';
import type { ChatRequest } from '../provider';
import type { LLMProvider } from '../provider';

export interface AssertProviderHonorsAbortOptions {
  chatRequest?: Partial<ChatRequest>;
  /**
   * How long to let the chat stream run before triggering abort. Default 10ms.
   */
  abortAfterMs?: number;
  /**
   * Hard deadline (from the moment we call .abort()) by which the iterator
   * MUST settle. Default 500ms.
   */
  maxSettleMs?: number;
}

export interface AssertProviderHonorsAbortResult {
  outcome: 'done-cancelled' | 'error-cancelled' | 'abort-thrown';
  events: ChatEvent[];
  /**
   * Milliseconds between calling controller.abort() and the iterator settling.
   */
  settledAfterMs: number;
}

const DEFAULT_REQUEST: ChatRequest = {
  model: 'test-model',
  messages: [{ role: 'user', content: 'hi' }],
};

function isAbortError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const name = (err as { name?: unknown }).name;
  if (name === 'AbortError') return true;
  const message = (err as { message?: unknown }).message;
  if (typeof message === 'string' && /abort/i.test(message)) return true;
  return false;
}

/**
 * Assert that an LLMProvider stops promptly when its ChatRequest signal is
 * aborted. Plugin authors and provider maintainers can call this in their
 * own tests after wiring a stub transport (e.g. by stubbing globalThis.fetch).
 *
 * The provider passes if, within `maxSettleMs` of `controller.abort()`, ONE of:
 *   1. the iterator yields a `done` event with stopReason 'cancelled', OR
 *   2. the iterator yields an `error` event with code 'cancelled', OR
 *   3. the iterator throws an AbortError-shaped error.
 *
 * This helper does NOT touch the network — providers must be tested behind a
 * stub or recorded-fixture transport before invoking it.
 */
export async function assertProviderHonorsAbort(
  makeProvider: () => LLMProvider,
  opts: AssertProviderHonorsAbortOptions = {},
): Promise<AssertProviderHonorsAbortResult> {
  const abortAfterMs = opts.abortAfterMs ?? 10;
  const maxSettleMs = opts.maxSettleMs ?? 500;

  const provider = makeProvider();
  const controller = new AbortController();
  const baseRequest: ChatRequest = { ...DEFAULT_REQUEST, ...opts.chatRequest };
  const request: ChatRequest = { ...baseRequest, signal: controller.signal };

  const events: ChatEvent[] = [];

  const iterator = provider.chat(request)[Symbol.asyncIterator]();

  const abortTimer = setTimeout(() => controller.abort('test'), abortAfterMs);
  let abortAt = 0;
  const originalAbort = controller.abort.bind(controller);
  controller.abort = ((reason?: unknown) => {
    abortAt = Date.now();
    return originalAbort(reason);
  }) as typeof controller.abort;

  const pump = (async (): Promise<AssertProviderHonorsAbortResult> => {
    try {
      while (true) {
        const next = await iterator.next();
        if (next.done) {
          const last = events.at(-1);
          if (last?.type === 'done' && last.stopReason === 'cancelled') {
            return {
              outcome: 'done-cancelled',
              events,
              settledAfterMs: Date.now() - abortAt,
            };
          }
          const cancelErr = events.find(
            (e): e is ChatEvent & { type: 'error' } => e.type === 'error' && e.code === 'cancelled',
          );
          if (cancelErr) {
            return {
              outcome: 'error-cancelled',
              events,
              settledAfterMs: Date.now() - abortAt,
            };
          }
          throw new Error(
            `Provider iterator completed without a cancelled signal. Last events: ${JSON.stringify(
              events.slice(-3),
            )}`,
          );
        }
        events.push(next.value);
      }
    } catch (err) {
      if (isAbortError(err)) {
        return {
          outcome: 'abort-thrown',
          events,
          settledAfterMs: Date.now() - abortAt,
        };
      }
      throw err;
    }
  })();

  const deadline = new Promise<never>((_, reject) => {
    const t = setTimeout(
      () => {
        reject(
          new Error(
            `Provider did not honor abort within ${maxSettleMs}ms (events: ${events.length})`,
          ),
        );
      },
      abortAfterMs + maxSettleMs + 50,
    );
    t.unref?.();
  });

  try {
    const result = await Promise.race([pump, deadline]);
    if (result.settledAfterMs > maxSettleMs) {
      throw new Error(
        `Provider honored abort but took ${result.settledAfterMs}ms (limit ${maxSettleMs}ms)`,
      );
    }
    return result;
  } finally {
    clearTimeout(abortTimer);
    try {
      await iterator.return?.();
    } catch {
      // ignore
    }
    try {
      await provider.dispose?.();
    } catch {
      // ignore
    }
  }
}
