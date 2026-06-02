// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppliedDiff, ListAppliedDiffsResponse } from '../../shared/replay';

vi.mock('../components/ReplayDiffCard', () => ({
  ReplayDiffCard: ({ appliedDiff }: { appliedDiff: { id: string } }) => (
    <div data-testid="replay-diff-card" data-diff-id={appliedDiff.id} />
  ),
}));

vi.mock('../components/ProvenanceBundleExporter', () => ({
  ProvenanceBundleExporter: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="provenance-exporter" data-conversation-id={conversationId} />
  ),
}));

import { ReplayPanel } from './ReplayPanel';

function makeDiff(id: string, conversationId: string): AppliedDiff {
  return {
    id,
    conversationId,
    messageId: `m-${id}`,
    toolCallId: null,
    filePath: `src/${id}.ts`,
    diff: '--- a\n+++ b\n',
    promptSnapshot: null,
    ragCitationsJson: null,
    routingDecisionJson: null,
    providerId: null,
    modelId: null,
    tokensInput: null,
    tokensOutput: null,
    costUsd: null,
    seed: null,
    appliedAt: '2026-01-01T00:00:00.000Z',
  };
}

function setBridge(
  listAppliedDiffs:
    | ((req: { limit?: number; offset?: number }) => Promise<ListAppliedDiffsResponse>)
    | undefined,
): void {
  (window as unknown as { opencodex?: unknown }).opencodex =
    listAppliedDiffs === undefined ? { replay: {} } : { replay: { listAppliedDiffs } };
}

afterEach(() => {
  delete (window as unknown as { opencodex?: unknown }).opencodex;
  vi.restoreAllMocks();
});

describe('ReplayPanel', () => {
  it('loads and renders applied diffs grouped by conversation', async () => {
    const rows = [makeDiff('a', 'conv-1'), makeDiff('b', 'conv-1'), makeDiff('c', 'conv-2')];
    setBridge(() => Promise.resolve({ rows, total: 3 }));

    render(<ReplayPanel />);

    await waitFor(() => {
      expect(screen.getAllByTestId('replay-diff-card')).toHaveLength(3);
    });
    expect(screen.getAllByTestId('provenance-exporter')).toHaveLength(2);
    expect(screen.getByText(/3 of 3 applied diffs/)).toBeTruthy();
  });

  it('shows the empty state when there are no diffs', async () => {
    setBridge(() => Promise.resolve({ rows: [], total: 0 }));

    render(<ReplayPanel />);

    await waitFor(() => {
      expect(screen.getByText('No applied diffs yet.')).toBeTruthy();
    });
  });

  it('shows an error with a working retry when the load fails', async () => {
    let attempt = 0;
    setBridge(() => {
      attempt += 1;
      if (attempt === 1) return Promise.reject(new Error('boom'));
      return Promise.resolve({ rows: [makeDiff('a', 'conv-1')], total: 1 });
    });

    render(<ReplayPanel />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('boom');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getByTestId('replay-diff-card')).toBeTruthy();
    });
  });

  it('reports when the replay bridge is unavailable', async () => {
    setBridge(undefined);

    render(<ReplayPanel />);

    await waitFor(() => {
      expect(screen.getByText(/Replay bridge unavailable/)).toBeTruthy();
    });
  });
});
