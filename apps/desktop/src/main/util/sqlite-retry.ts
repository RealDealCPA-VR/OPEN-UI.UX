/**
 * Bounded retry for SQLITE_BUSY / SQLITE_LOCKED on hot critical paths
 * (scheduler tick bookkeeping, audit-log writes). Two attempts after the
 * initial call: 50ms then 250ms. Anything still locked after that propagates.
 *
 * Synchronous variant — call sites already run in main-thread sync paths and
 * blocking briefly is preferable to introducing async edges through every
 * scheduler / audit helper.
 */
const SQLITE_RETRY_DELAYS_MS = [50, 250] as const;

export function withSqliteBusyRetry<T>(fn: () => T): T {
  let attempt = 0;
  while (true) {
    try {
      return fn();
    } catch (err) {
      if (!isSqliteBusy(err)) throw err;
      if (attempt >= SQLITE_RETRY_DELAYS_MS.length) throw err;
      const delay = SQLITE_RETRY_DELAYS_MS[attempt] ?? 0;
      attempt++;
      sleepSyncMs(delay);
    }
  }
}

function isSqliteBusy(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED';
}

function sleepSyncMs(ms: number): void {
  if (ms <= 0) return;
  // Atomics.wait works on a SharedArrayBuffer view; we don't need shared
  // memory, only the wait semantics. Falls back to a tight loop if Atomics
  // isn't available in the runtime (e.g. some test harnesses).
  try {
    const view = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(view, 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      // spin
    }
  }
}
