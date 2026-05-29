// @vitest-environment jsdom

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MergeReviewModal, parseRagCitations } from './MergeReviewModal';
import type { AppliedDiff } from '../../shared/replay';

// Avoid Monaco's lazy-loaded editor in jsdom. The viewer's toolbar (which has
// the Split/Unified toggle we care about here) and hunk action props all live
// outside the actual Monaco editor mount.
vi.mock('./MonacoDiffViewer', () => ({
  MonacoDiffViewer: ({ filePath }: { filePath?: string }) => (
    <div data-testid="mocked-monaco-diff-viewer" data-file={filePath} />
  ),
}));

const SAMPLE_DIFF = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 const x = 1;
-const y = 2;
+const y = 3;
 const z = 4;
`;

const sampleAppliedDiff: AppliedDiff = {
  id: 'd1',
  conversationId: 'conv-1',
  messageId: 'm1',
  toolCallId: 'tc-edit-1',
  filePath: 'src/a.ts',
  diff: SAMPLE_DIFF,
  promptSnapshot: 'Please change y to 3',
  ragCitationsJson: JSON.stringify([
    { filePath: 'src/a.ts', startLine: 1, endLine: 3 },
    'src/b.ts:7',
  ]),
  routingDecisionJson: null,
  providerId: 'openai',
  modelId: 'gpt-4o',
  tokensInput: 120,
  tokensOutput: 18,
  costUsd: 0.000456,
  seed: null,
  appliedAt: '2026-05-29T10:00:00Z',
};

interface BridgeMockOpts {
  appliedDiffs: AppliedDiff[];
}

function setupBridge(opts: BridgeMockOpts): { listAppliedDiffs: Mock } {
  const listAppliedDiffs = vi.fn(async () => ({
    rows: opts.appliedDiffs,
    total: opts.appliedDiffs.length,
  })) as unknown as Mock;
  window.opencodex = {
    agent: {
      getMergeBundle: vi.fn(async () => ({
        runId: 'run-1',
        diff: SAMPLE_DIFF,
        files: ['src/a.ts'],
        branch: 'agent/run-1',
      })),
      acceptMerge: vi.fn(async () => ({ ok: true })),
      rejectMerge: vi.fn(async () => ({ ok: true })),
    },
    replay: {
      listAppliedDiffs,
    },
    selectedModel: { get: vi.fn(async () => null) },
    chat: { regenerateHunk: vi.fn(async () => ({ ok: true, suggestion: 'const y = 99;' })) },
  } as unknown as Window['opencodex'];
  return { listAppliedDiffs };
}

describe('MergeReviewModal', () => {
  beforeEach(() => {
    setupBridge({ appliedDiffs: [sampleAppliedDiff] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error — window.opencodex is non-optional in production typings
    delete window.opencodex;
  });

  it('queries applied_diffs by conversationId and renders the diff viewer for each file', async () => {
    const { listAppliedDiffs } = setupBridge({ appliedDiffs: [sampleAppliedDiff] });
    render(
      <MergeReviewModal
        runId="run-1"
        conversationId="conv-1"
        workspaceRoot="/tmp/ws"
        onClose={() => {}}
        onResolved={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('mocked-monaco-diff-viewer')).toBeTruthy());
    await waitFor(() => expect(listAppliedDiffs).toHaveBeenCalled());

    const callArgs = listAppliedDiffs.mock.calls[0]?.[0] as { conversationId: string };
    expect(callArgs.conversationId).toBe('conv-1');
    expect(screen.getByTestId('mocked-monaco-diff-viewer').getAttribute('data-file')).toBe(
      'src/a.ts',
    );
  });

  it('renders an empty list when the rag citations json is null or malformed', () => {
    expect(parseRagCitations(null)).toEqual([]);
    expect(parseRagCitations('not-json')).toEqual([]);
    expect(parseRagCitations('{}')).toEqual([]);
  });

  it('formats rag citations as file:line ranges', () => {
    const json = JSON.stringify([
      { filePath: 'src/x.ts', startLine: 5, endLine: 12 },
      { filePath: 'src/y.ts', startLine: 8 },
      { filePath: 'src/z.ts' },
      'src/raw.ts:42',
      { unrelated: true },
    ]);
    expect(parseRagCitations(json)).toEqual([
      'src/x.ts:5-12',
      'src/y.ts:8',
      'src/z.ts',
      'src/raw.ts:42',
    ]);
  });

  it('Shift+J/K navigates between files without hijacking unmodified j/k', async () => {
    const twoFileDiff = `${SAMPLE_DIFF}diff --git a/src/b.ts b/src/b.ts\nindex 1..2 100644\n--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n`;
    window.opencodex = {
      agent: {
        getMergeBundle: vi.fn(async () => ({
          runId: 'run-1',
          diff: twoFileDiff,
          files: ['src/a.ts', 'src/b.ts'],
          branch: 'agent/run-1',
        })),
        acceptMerge: vi.fn(),
        rejectMerge: vi.fn(),
      },
      replay: {
        listAppliedDiffs: vi.fn(async () => ({ rows: [], total: 0 })),
      },
      selectedModel: { get: vi.fn(async () => null) },
      chat: { regenerateHunk: vi.fn() },
    } as unknown as Window['opencodex'];

    render(
      <MergeReviewModal
        runId="run-1"
        conversationId="conv-1"
        workspaceRoot="/tmp/ws"
        onClose={() => {}}
        onResolved={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('mocked-monaco-diff-viewer')).toBeTruthy());
    expect(screen.getByTestId('mocked-monaco-diff-viewer').getAttribute('data-file')).toBe(
      'src/a.ts',
    );

    fireEvent.keyDown(document, { key: 'J', shiftKey: true });

    await waitFor(() =>
      expect(screen.getByTestId('mocked-monaco-diff-viewer').getAttribute('data-file')).toBe(
        'src/b.ts',
      ),
    );
  });
});
