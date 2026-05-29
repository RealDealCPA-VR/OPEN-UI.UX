// Shared vitest setup. Wired through the root `vitest.config.ts` `setupFiles`.
//
// Does two things:
//
// 1. Installs a default `window.opencodex` Proxy shim so React components that
//    dereference the preload IPC bridge in a `useEffect` don't synchronously
//    throw when a test forgot to install a bridge mock. Individual tests still
//    override with `Object.defineProperty(window, 'opencodex', { value: ... })`
//    or `(window as unknown as { opencodex: Bridge }).opencodex = ...` as
//    needed. This is a fallback that prevents partial-bridge crashes from
//    cascading across the suite.
//
// 2. Runs `@testing-library/react` cleanup after every test. The root vitest
//    config sets `globals: false`, which means RTL's auto-cleanup (which hooks
//    `afterEach` only when `globals === true`) never fires — leading to DOM
//    accumulation across tests and "found N elements" assertion failures.
//
// The Proxy `prop === 'then'` guard is important: without it, awaiting the
// proxy (or any of its sub-paths) turns it into a thenable and hangs.

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

type ProxyShim = ((...args: unknown[]) => unknown) & Record<PropertyKey, unknown>;

// The shim's `apply` trap returns another callable Proxy rather than a fixed
// value. Real bridge calls return one of: Promise<T>, an unsubscribe `() =>
// void`, or `undefined`. A Proxy is all three — awaiting it resolves
// undefined (thanks to the `then === undefined` get-trap guard), calling it
// returns another Proxy (so `const off = bridge.subscribe(); off()` works),
// and any further dereference keeps going.
const make = (): ProxyShim => {
  const target = (() => undefined) as ProxyShim;
  return new Proxy(target, {
    get(_t, prop): unknown {
      if (prop === 'then') return undefined;
      if (prop === Symbol.toPrimitive) return () => '[opencodex-test-shim]';
      if (prop === 'toString') return () => '[opencodex-test-shim]';
      // Symbol.asyncIterator / Symbol.iterator probing — let it return
      // undefined so consumers fall through to the default branch instead of
      // trying to iterate the shim.
      if (typeof prop === 'symbol') return undefined;
      return make();
    },
    apply(): ProxyShim {
      return make();
    },
  }) as ProxyShim;
};

declare global {
  var __opencodexTestShimInstalled: boolean | undefined;
}

if (typeof window !== 'undefined' && !globalThis.__opencodexTestShimInstalled) {
  const existing = (window as unknown as { opencodex?: unknown }).opencodex;
  if (existing === undefined) {
    (window as unknown as { opencodex: ProxyShim }).opencodex = make();
  }
  globalThis.__opencodexTestShimInstalled = true;
}

afterEach(() => {
  if (typeof document !== 'undefined') {
    cleanup();
  }
});
