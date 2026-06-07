// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { FanoutConsentRequestedEvent } from '../../shared/agent-tree';
import { FanoutConsentModal } from './FanoutConsentModal';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function actWarnings(spy: MockInstance): string[] {
  return spy.mock.calls
    .map((args) => String(args[0]))
    .filter((msg) => msg.includes('not wrapped in act'));
}

function requestEvent(
  partial: Partial<FanoutConsentRequestedEvent> = {},
): FanoutConsentRequestedEvent {
  return {
    parentRunId: 'parent-run-1234',
    plan: [{ task: 'do the first thing' }, { task: 'do the second thing' }],
    requestedAt: Date.now(),
    autoAllowDelayMs: null,
    ...partial,
  };
}

interface DeferredBridge {
  resolve: (value: { ok: boolean; error?: string }) => void;
  reject: (err: unknown) => void;
}

function installDeferredBridge(): DeferredBridge {
  let resolve!: (value: { ok: boolean; error?: string }) => void;
  let reject!: (err: unknown) => void;
  const pending = new Promise<{ ok: boolean; error?: string }>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  (window as unknown as { opencodex: unknown }).opencodex = {
    agent: {
      fanoutConsent: vi.fn(() => pending),
    },
  };
  return { resolve, reject };
}

describe('FanoutConsentModal', () => {
  let errorSpy: MockInstance;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { opencodex?: unknown }).opencodex;
  });

  it('renders the plan tasks', () => {
    render(<FanoutConsentModal request={requestEvent()} onResolved={() => {}} />);
    expect(screen.getByText(/do the first thing/)).toBeTruthy();
    expect(screen.getByText(/do the second thing/)).toBeTruthy();
  });

  it('labels the dialog via aria-labelledby', () => {
    render(<FanoutConsentModal request={requestEvent()} onResolved={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-labelledby')).toBe('fanout-consent-title');
    const title = document.getElementById('fanout-consent-title');
    expect(title?.textContent).toContain('Agent wants to spawn subtasks');
  });

  it('does not resolve or warn after unmount when a submit promise settles late', async () => {
    const deferred = installDeferredBridge();
    const onResolved = vi.fn();
    const { unmount } = render(
      <FanoutConsentModal request={requestEvent()} onResolved={onResolved} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Allow$/ }));
    unmount();

    // Drive the awaited continuation to completion. The mountedRef guard must
    // short-circuit before onResolved() (and before any setState). React 18 no
    // longer warns on setState-after-unmount, so onResolved is the deterministic
    // observable; act-warnings are checked as a secondary signal.
    await act(async () => {
      deferred.resolve({ ok: true });
      await flushMicrotasks();
    });

    expect(onResolved).not.toHaveBeenCalled();
    expect(actWarnings(errorSpy)).toEqual([]);
  });

  it('does not setState after unmount when a submit promise rejects late', async () => {
    const deferred = installDeferredBridge();
    const { unmount } = render(
      <FanoutConsentModal request={requestEvent()} onResolved={() => {}} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Allow$/ }));
    unmount();

    // Settle OUTSIDE act(): an unguarded setError on the unmounted component
    // triggers React's "not wrapped in act(...)" warning. The mountedRef guard
    // must short-circuit before setError.
    deferred.reject(new Error('boom'));
    await flushMicrotasks();

    expect(actWarnings(errorSpy)).toEqual([]);
  });

  it('does not leak the auto-allow interval after unmount', () => {
    vi.useFakeTimers();
    try {
      const clearSpy = vi.spyOn(window, 'clearInterval');
      const { unmount } = render(
        <FanoutConsentModal
          request={requestEvent({ autoAllowDelayMs: 10_000, requestedAt: Date.now() })}
          onResolved={() => {}}
        />,
      );
      unmount();
      expect(clearSpy).toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
