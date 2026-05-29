// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { LocalOnlyPill } from './LocalOnlyPill';
import type { NetworkPolicy } from '../../shared/network-policy';

type ChangedListener = (payload: { policy: NetworkPolicy }) => void;

interface FakeNetworkApi {
  getPolicy: Mock;
  setLocalOnly: Mock;
  addAllowlistEntry: Mock;
  removeAllowlistEntry: Mock;
  onChanged: (listener: ChangedListener) => () => void;
  __emit: (policy: NetworkPolicy) => void;
}

function setupFakeApi(initial: NetworkPolicy): FakeNetworkApi {
  let listener: ChangedListener | null = null;
  let current: NetworkPolicy = initial;
  const api: FakeNetworkApi = {
    getPolicy: vi.fn(async () => current),
    setLocalOnly: vi.fn(async (enabled: boolean) => {
      current = { ...current, localOnlyMode: enabled };
      listener?.({ policy: current });
      return current;
    }),
    addAllowlistEntry: vi.fn(async () => current),
    removeAllowlistEntry: vi.fn(async () => current),
    onChanged: (l: ChangedListener) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
    __emit: (policy: NetworkPolicy) => {
      current = policy;
      listener?.({ policy });
    },
  };
  (window as unknown as { opencodex: { network: FakeNetworkApi } }).opencodex = {
    network: api,
  };
  return api;
}

function renderPill(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <LocalOnlyPill />
    </MemoryRouter>,
  );
}

describe('LocalOnlyPill', () => {
  beforeEach(() => {
    delete (window as unknown as { opencodex?: unknown }).opencodex;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when the network api is missing', () => {
    (window as unknown as { opencodex: { network: FakeNetworkApi | undefined } }).opencodex = {
      network: undefined,
    };
    const { container } = renderPill();
    expect(container.firstChild).toBeNull();
  });

  it('renders OFF state by default and reflects the loaded policy', async () => {
    setupFakeApi({ localOnlyMode: false, allowlist: ['api.openai.com'] });
    renderPill();
    const pill = await screen.findByTestId('local-only-pill');
    expect(pill.textContent ?? '').toMatch(/Local Only: OFF/);
    expect(pill.getAttribute('aria-pressed')).toBe('false');
    expect(pill.className).toMatch(/is-off/);
  });

  it('renders ON state when policy.localOnlyMode is true', async () => {
    setupFakeApi({ localOnlyMode: true, allowlist: [] });
    renderPill();
    const pill = await screen.findByTestId('local-only-pill');
    expect(pill.textContent ?? '').toMatch(/Local Only: ON/);
    expect(pill.getAttribute('aria-pressed')).toBe('true');
    expect(pill.className).toMatch(/is-on/);
  });

  it('toggles policy when clicked', async () => {
    const api = setupFakeApi({ localOnlyMode: false, allowlist: [] });
    renderPill();
    const pill = await screen.findByTestId('local-only-pill');
    await act(async () => {
      fireEvent.click(pill);
    });
    expect(api.setLocalOnly).toHaveBeenCalledWith(true);
    await waitFor(() => {
      expect(screen.getByTestId('local-only-pill').textContent ?? '').toMatch(/Local Only: ON/);
    });
  });

  it('updates when the main process emits a change', async () => {
    const api = setupFakeApi({ localOnlyMode: false, allowlist: [] });
    renderPill();
    await screen.findByTestId('local-only-pill');
    act(() => {
      api.__emit({ localOnlyMode: true, allowlist: [] });
    });
    await waitFor(() => {
      expect(screen.getByTestId('local-only-pill').textContent ?? '').toMatch(/Local Only: ON/);
    });
  });
});
