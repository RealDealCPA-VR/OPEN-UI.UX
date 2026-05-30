// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoverHint } from './HoverHint';

function mockMatchMedia(reduced: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (q: string) => ({
      matches: q.includes('reduce') ? reduced : false,
      media: q,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe('HoverHint', () => {
  beforeEach(() => {
    // Scope fake timers to setTimeout/clearTimeout only so RTL's `waitFor`
    // (which polls via real `setInterval` and times itself with real `Date`)
    // doesn't deadlock against frozen wall-clock time. Faking `Date` here
    // would stop waitFor's elapsed-time check from ever firing.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mockMatchMedia(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders closed (no tooltip in DOM)', () => {
    render(
      <HoverHint hint="Save changes">
        <button>S</button>
      </HoverHint>,
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('opens after the 300ms delay on hover', () => {
    render(
      <HoverHint hint="Save changes">
        <button>S</button>
      </HoverHint>,
    );
    const btn = screen.getByRole('button');
    fireEvent.mouseEnter(btn);
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    // `act` already flushed the setOpen + useLayoutEffect — use a sync
    // assertion instead of `waitFor`, which would deadlock under faked
    // setTimeout (RTL's wait-for-element loop relies on setTimeout for its
    // polling step).
    expect(screen.getByRole('tooltip')).toBeTruthy();
  });

  it('closes 100ms after mouseleave', () => {
    render(
      <HoverHint hint="Save changes">
        <button>S</button>
      </HoverHint>,
    );
    const btn = screen.getByRole('button');
    fireEvent.mouseEnter(btn);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.mouseLeave(btn);
    act(() => {
      vi.advanceTimersByTime(99);
    });
    expect(screen.queryByRole('tooltip')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('closes immediately on Escape', () => {
    render(
      <HoverHint hint="Save changes">
        <button>S</button>
      </HoverHint>,
    );
    const btn = screen.getByRole('button');
    fireEvent.mouseEnter(btn);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole('tooltip')).toBeTruthy();
    act(() => {
      fireEvent.keyDown(btn, { key: 'Escape' });
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('opens instantly on focus', () => {
    render(
      <HoverHint hint="Save changes">
        <button>S</button>
      </HoverHint>,
    );
    const btn = screen.getByRole('button');
    act(() => {
      fireEvent.focus(btn);
    });
    expect(screen.getByRole('tooltip')).toBeTruthy();
  });

  it('attaches no listeners and no aria-describedby when disabled', () => {
    render(
      <HoverHint hint="Save changes" disabled>
        <button data-testid="b">S</button>
      </HoverHint>,
    );
    const btn = screen.getByTestId('b');
    expect(btn.getAttribute('aria-describedby')).toBeNull();
    fireEvent.mouseEnter(btn);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('warns once in dev when the hint exceeds 5 words', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <HoverHint hint="this hint definitely has more than five words total here">
        <button>S</button>
      </HoverHint>,
    );
    render(
      <HoverHint hint="this hint definitely has more than five words total here">
        <button>S</button>
      </HoverHint>,
    );
    const calls = spy.mock.calls.filter(
      ([msg]) => typeof msg === 'string' && msg.includes('exceeds 5 words'),
    );
    expect(calls.length).toBe(1);
  });

  it('honors prefers-reduced-motion (no transition)', () => {
    mockMatchMedia(true);
    render(
      <HoverHint hint="Save changes">
        <button>S</button>
      </HoverHint>,
    );
    act(() => {
      fireEvent.focus(screen.getByRole('button'));
    });
    const tip = screen.getByRole('tooltip');
    expect(tip.style.transition).toBe('none');
  });

  it('auto-flips to bottom when top placement would clip the viewport', () => {
    const origGBCR = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      // Anchor pinned to the top edge so top placement cannot fit.
      if ((this as HTMLElement).tagName === 'BUTTON') {
        return {
          top: 0,
          bottom: 24,
          left: 100,
          right: 140,
          width: 40,
          height: 24,
          x: 100,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      // Bubble.
      return {
        top: 0,
        bottom: 30,
        left: 0,
        right: 60,
        width: 60,
        height: 30,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    };
    try {
      render(
        <HoverHint hint="Save" placement="top">
          <button>S</button>
        </HoverHint>,
      );
      act(() => {
        fireEvent.focus(screen.getByRole('button'));
      });
      const tip = screen.getByRole('tooltip');
      expect(tip.getAttribute('data-placement')).toBe('bottom');
    } finally {
      Element.prototype.getBoundingClientRect = origGBCR;
    }
  });
});
