import type { ErrorEvent } from '@opencodex/core';
import { mapHttpStatusToErrorCode } from '@opencodex/core';

/**
 * Build a normalized error event for a failed provider HTTP response.
 * Retryability is derived from the normalized code so every provider
 * classifies 429/5xx/timeout/network failures the same way.
 */
export function httpErrorEvent(message: string, status: number): ErrorEvent {
  const code = mapHttpStatusToErrorCode(status);
  return {
    type: 'error',
    message,
    retryable:
      code === 'rate_limit' || code === 'server' || code === 'timeout' || code === 'network',
    code,
  };
}
