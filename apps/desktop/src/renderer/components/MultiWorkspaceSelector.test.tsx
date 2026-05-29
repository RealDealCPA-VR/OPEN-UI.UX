// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MultiWorkspaceSelector } from './MultiWorkspaceSelector';
import type { WorkspaceEntry } from '../../shared/workspaces';

const wsA: WorkspaceEntry = {
  id: 'a',
  path: '/tmp/repo-a',
  displayName: 'Repo A',
  isPrimary: true,
  ragEnabled: true,
  createdAt: '2024-01-01T00:00:00Z',
};
const wsB: WorkspaceEntry = {
  id: 'b',
  path: '/tmp/repo-b',
  displayName: null,
  isPrimary: false,
  ragEnabled: true,
  createdAt: '2024-01-02T00:00:00Z',
};

interface BridgeMocks {
  list: Mock;
  listForConversation: Mock;
  link: Mock;
  unlink: Mock;
}

function setupBridge(linked: WorkspaceEntry[]): BridgeMocks {
  const list = vi.fn(async () => ({ workspaces: [wsA, wsB] }));
  const listForConversation = vi.fn(async () => ({ workspaces: linked }));
  const link = vi.fn(async () => ({ workspaces: linked }));
  const unlink = vi.fn(async () => ({ workspaces: [] }));
  (window as unknown as { opencodex: unknown }).opencodex = {
    workspaces: {
      list,
      listForConversation,
      linkToConversation: link,
      unlinkFromConversation: unlink,
      onChanged: undefined,
    },
  };
  return { list, listForConversation, link, unlink };
}

beforeEach(() => {
  delete (window as unknown as { opencodex?: unknown }).opencodex;
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { opencodex?: unknown }).opencodex;
});

describe('MultiWorkspaceSelector', () => {
  it('renders injected available workspaces as chips', () => {
    const { container } = render(
      <MultiWorkspaceSelector
        conversationId={null}
        injectedAvailable={[wsA, wsB]}
        injectedSelected={[wsA]}
      />,
    );
    const chips = container.querySelectorAll('.multi-workspace-chip');
    expect(chips).toHaveLength(2);
  });

  it('marks the primary workspace with a primary badge', () => {
    const { container } = render(
      <MultiWorkspaceSelector
        conversationId={null}
        injectedAvailable={[wsA, wsB]}
        injectedSelected={[]}
      />,
    );
    const badges = container.querySelectorAll('.multi-workspace-chip-primary');
    expect(badges).toHaveLength(1);
  });

  it('loads via the bridge when a conversation id is provided', async () => {
    const bridge = setupBridge([wsA]);
    await act(async () => {
      render(<MultiWorkspaceSelector conversationId="conv-1" />);
    });
    await waitFor(() => {
      expect(bridge.list).toHaveBeenCalled();
      expect(bridge.listForConversation).toHaveBeenCalledWith('conv-1');
    });
  });

  it('marks chips as selected based on bridge response', async () => {
    setupBridge([wsA]);
    const { container } = await act(async () =>
      render(<MultiWorkspaceSelector conversationId="conv-1" />),
    );
    await waitFor(() => {
      const selected = container.querySelectorAll('.multi-workspace-chip.is-selected');
      expect(selected.length).toBe(1);
    });
  });

  it('disables chips when there is no conversation id', () => {
    const { container } = render(
      <MultiWorkspaceSelector
        conversationId={null}
        injectedAvailable={[wsA]}
        injectedSelected={[]}
      />,
    );
    const chip = container.querySelector('.multi-workspace-chip') as HTMLButtonElement | null;
    expect(chip).not.toBeNull();
    expect(chip?.disabled).toBe(true);
  });

  it('toggles a chip via the bridge', async () => {
    const bridge = setupBridge([]);
    bridge.link.mockResolvedValueOnce({ workspaces: [wsB] });
    const { container } = await act(async () =>
      render(<MultiWorkspaceSelector conversationId="conv-2" />),
    );
    await waitFor(() => {
      expect(bridge.list).toHaveBeenCalled();
    });
    const chips = container.querySelectorAll('.multi-workspace-chip');
    expect(chips.length).toBe(2);
    const second = chips[1] as HTMLButtonElement;
    await act(async () => {
      second.click();
    });
    await waitFor(() => {
      expect(bridge.link).toHaveBeenCalledWith({ conversationId: 'conv-2', workspaceId: 'b' });
    });
  });
});
