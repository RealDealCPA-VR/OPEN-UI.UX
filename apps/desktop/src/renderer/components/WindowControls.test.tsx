// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { WindowControls } from './WindowControls';

interface FakeWindowChrome {
  platform: string;
  minimize: Mock;
  toggleMaximize: Mock;
  close: Mock;
  isMaximized: Mock;
}

function setupFakeChrome(
  platform: string,
  opts: { initiallyMaximized?: boolean } = {},
): FakeWindowChrome {
  let maximized = opts.initiallyMaximized ?? false;
  const chrome: FakeWindowChrome = {
    platform,
    minimize: vi.fn(async () => undefined),
    toggleMaximize: vi.fn(async () => {
      maximized = !maximized;
      return { maximized };
    }),
    close: vi.fn(async () => undefined),
    isMaximized: vi.fn(async () => ({ maximized })),
  };
  (window as unknown as { opencodex: { windowChrome: FakeWindowChrome } }).opencodex = {
    windowChrome: chrome,
  };
  return chrome;
}

describe('WindowControls', () => {
  beforeEach(() => {
    delete (window as unknown as { opencodex?: unknown }).opencodex;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when the bridge is missing', () => {
    const { container } = render(<WindowControls />);
    expect(container.firstChild).toBeNull();
  });

  it.each(['win32', 'darwin'])('renders nothing on %s (native chrome)', (platform) => {
    setupFakeChrome(platform);
    const { container } = render(<WindowControls />);
    expect(container.firstChild).toBeNull();
  });

  it('renders minimize/maximize/close on linux', async () => {
    setupFakeChrome('linux');
    render(<WindowControls />);
    expect(screen.getByTestId('window-controls')).toBeTruthy();
    expect(screen.getByLabelText('Minimize window')).toBeTruthy();
    expect(screen.getByLabelText('Maximize window')).toBeTruthy();
    expect(screen.getByLabelText('Close window')).toBeTruthy();
  });

  it('invokes minimize and close on click', async () => {
    const chrome = setupFakeChrome('linux');
    render(<WindowControls />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Minimize window'));
      fireEvent.click(screen.getByLabelText('Close window'));
    });
    expect(chrome.minimize).toHaveBeenCalledTimes(1);
    expect(chrome.close).toHaveBeenCalledTimes(1);
  });

  it('toggles between maximize and restore on click', async () => {
    const chrome = setupFakeChrome('linux');
    render(<WindowControls />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Maximize window'));
    });
    expect(chrome.toggleMaximize).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByLabelText('Restore window')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Restore window'));
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Maximize window')).toBeTruthy();
    });
  });

  it('reflects an initially maximized window', async () => {
    setupFakeChrome('linux', { initiallyMaximized: true });
    render(<WindowControls />);
    await waitFor(() => {
      expect(screen.getByLabelText('Restore window')).toBeTruthy();
    });
  });
});
