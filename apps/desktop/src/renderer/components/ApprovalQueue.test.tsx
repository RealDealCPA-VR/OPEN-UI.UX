// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { MonacoDiffHunk, MonacoDiffViewerProps } from './MonacoDiffViewer';
import type * as MonacoDiffHelpers from './monaco-diff-helpers';
import { ApprovalQueue } from './ApprovalQueue';
import type { ApprovalRequest } from '../../shared/approvals';

// Stub the Monaco viewer: real Monaco can't compute line changes in jsdom. The
// stub emits a fixed hunk set via onHunksChange and exposes accept/reject
// buttons wired to the real callbacks, so the REAL MonacoDiffModal decision
// logic (strict-subset gating + applyHunkDecisions + override shape) is exercised.
const STUB_HUNKS: MonacoDiffHunk[] = [
  {
    index: 0,
    originalStartLine: 1,
    originalEndLine: 1,
    modifiedStartLine: 1,
    modifiedEndLine: 1,
    kind: 'modify',
  },
  {
    index: 1,
    originalStartLine: 3,
    originalEndLine: 3,
    modifiedStartLine: 3,
    modifiedEndLine: 3,
    kind: 'modify',
  },
];

vi.mock('./MonacoDiffViewer', async () => {
  const actual = await vi.importActual<typeof MonacoDiffHelpers>('./monaco-diff-helpers');
  const { useEffect } = await import('react');
  return {
    ...actual,
    MonacoDiffViewer: (props: MonacoDiffViewerProps) => {
      useEffect(() => {
        props.onHunksChange?.(STUB_HUNKS);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return (
        <div data-testid="monaco-stub">
          <button type="button" onClick={() => props.onAcceptHunk?.(0, STUB_HUNKS[0]!)}>
            stub-accept-0
          </button>
          <button type="button" onClick={() => props.onRejectHunk?.(0, STUB_HUNKS[0]!)}>
            stub-reject-0
          </button>
          <button type="button" onClick={() => props.onRejectHunk?.(1, STUB_HUNKS[1]!)}>
            stub-reject-1
          </button>
        </div>
      );
    },
  };
});

interface BridgeMocks {
  respond: Mock;
  emit: (req: ApprovalRequest) => void;
}

function setupBridge(): BridgeMocks {
  let listener: ((r: ApprovalRequest) => void) | null = null;
  const respond = vi.fn(async () => undefined);
  window.opencodex = {
    approvals: {
      onRequest: vi.fn((cb: (r: ApprovalRequest) => void) => {
        listener = cb;
        return () => {
          listener = null;
        };
      }),
      respond,
      readFilePreview: vi.fn(async () => ({
        exists: false,
        content: '',
        truncated: false,
        sizeBytes: 0,
      })),
    },
  } as unknown as Window['opencodex'];
  return {
    respond,
    emit(req) {
      if (listener) listener(req);
    },
  };
}

function makeRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    requestId: 'req-1',
    streamId: 'stream-1',
    toolName: 'read_file',
    toolDescription: 'read a file',
    permissionTier: 'read',
    arguments: { path: '/tmp/x' },
    ...overrides,
  };
}

describe('ApprovalQueue', () => {
  let bridge: BridgeMocks;

  beforeEach(() => {
    bridge = setupBridge();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error — window.opencodex is non-optional in production typings
    delete window.opencodex;
  });

  it.each<[string, 'allow' | 'deny', 'once' | 'session' | 'always']>([
    ['1', 'allow', 'once'],
    ['2', 'allow', 'session'],
    ['3', 'allow', 'always'],
    ['4', 'deny', 'once'],
    ['5', 'deny', 'session'],
    ['6', 'deny', 'always'],
  ])('key %s invokes respond with decision=%s scope=%s', async (key, decision, scope) => {
    render(<ApprovalQueue />);
    act(() => {
      bridge.emit(makeRequest());
    });
    const dialog = await waitFor(() => screen.getByRole('dialog'));
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });
    await waitFor(() =>
      expect(bridge.respond).toHaveBeenCalledWith({
        requestId: 'req-1',
        decision,
        scope,
      }),
    );
  });

  it('Esc does not invoke respond (no Esc handler in current component)', async () => {
    render(<ApprovalQueue />);
    act(() => {
      bridge.emit(makeRequest());
    });
    const dialog = await waitFor(() => screen.getByRole('dialog'));
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(bridge.respond).not.toHaveBeenCalled();
  });

  it('shows "Always allow this exact command" footer for run_shell', async () => {
    render(<ApprovalQueue />);
    act(() => {
      bridge.emit(
        makeRequest({
          requestId: 'shell-1',
          toolName: 'run_shell',
          permissionTier: 'execute',
          arguments: { command: 'ls -la' },
        }),
      );
    });
    await waitFor(() => screen.getByRole('dialog'));
    expect(screen.getByText(/Always allow this exact command/i)).toBeTruthy();
  });

  it('does NOT show the exact-command footer for non-shell tools', async () => {
    render(<ApprovalQueue />);
    act(() => {
      bridge.emit(makeRequest());
    });
    await waitFor(() => screen.getByRole('dialog'));
    expect(screen.queryByText(/Always allow this exact command/i)).toBeNull();
  });

  async function openWriteFileDiffModal(): Promise<void> {
    // write_file preview loads current contents, then "View full diff" opens the
    // Monaco modal (stubbed). original=3 lines so the stub's 2 hunks are valid.
    (bridge.respond as Mock).mockClear();
    (window.opencodex.approvals.readFilePreview as Mock).mockResolvedValue({
      exists: true,
      content: 'a\nb\nc',
      truncated: false,
      sizeBytes: 5,
    });
    act(() => {
      bridge.emit(
        makeRequest({
          requestId: 'wf-1',
          toolName: 'write_file',
          permissionTier: 'write',
          arguments: { path: 'src/a.ts', content: 'A\nb\nC' },
        }),
      );
    });
    await waitFor(() => screen.getByRole('dialog'));
    const viewBtn = await screen.findByRole('button', { name: /View full diff/i });
    await act(async () => {
      fireEvent.click(viewBtn);
    });
    await screen.findByTestId('monaco-stub');
  }

  it('Apply selected hunks: rejecting a strict subset sends an override with reconstructed content', async () => {
    render(<ApprovalQueue />);
    await openWriteFileDiffModal();

    // Reject hunk 1 (keep hunk 0) → strict non-empty subset {0}.
    act(() => {
      fireEvent.click(screen.getByText('stub-reject-1'));
    });

    const applyBtn = await screen.findByRole('button', { name: /Apply selected hunks/i });
    expect((applyBtn as HTMLButtonElement).disabled).toBe(false);
    act(() => {
      fireEvent.click(applyBtn);
    });

    // accepted = {0} (hunk0 modifies line1 a→A, hunk1 rejected keeps line3 c).
    await waitFor(() =>
      expect(bridge.respond).toHaveBeenCalledWith({
        requestId: 'wf-1',
        decision: 'allow',
        scope: 'once',
        override: { toolName: 'write_file', arguments: { path: 'src/a.ts', content: 'A\nb\nc' } },
      }),
    );
  });

  it('Apply selected hunks is DISABLED at full-accept (all hunks accepted)', async () => {
    render(<ApprovalQueue />);
    await openWriteFileDiffModal();
    // Default state = all accepted → not a strict subset.
    const applyBtn = await screen.findByRole('button', { name: /Apply selected hunks/i });
    expect((applyBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('Apply selected hunks is DISABLED at full-reject (empty subset)', async () => {
    render(<ApprovalQueue />);
    await openWriteFileDiffModal();
    act(() => {
      fireEvent.click(screen.getByText('stub-reject-0'));
      fireEvent.click(screen.getByText('stub-reject-1'));
    });
    const applyBtn = await screen.findByRole('button', { name: /Apply selected hunks/i });
    expect((applyBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('whole-file Allow still sends a plain allow with NO override', async () => {
    render(<ApprovalQueue />);
    await openWriteFileDiffModal();
    // Use the main modal's "Allow once" (slot 0) — full accept routes here.
    const allowBtn = screen.getByRole('button', { name: /Allow once/i });
    act(() => {
      allowBtn.click();
    });
    await waitFor(() =>
      expect(bridge.respond).toHaveBeenCalledWith({
        requestId: 'wf-1',
        decision: 'allow',
        scope: 'once',
      }),
    );
  });

  it('whole-file Deny still sends a plain deny with NO override', async () => {
    render(<ApprovalQueue />);
    await openWriteFileDiffModal();
    const denyBtn = screen.getByRole('button', { name: /Deny once/i });
    act(() => {
      denyBtn.click();
    });
    await waitFor(() =>
      expect(bridge.respond).toHaveBeenCalledWith({
        requestId: 'wf-1',
        decision: 'deny',
        scope: 'once',
      }),
    );
  });

  it('clicking the always-allow footer auto-approves later identical shell commands', async () => {
    render(<ApprovalQueue />);
    act(() => {
      bridge.emit(
        makeRequest({
          requestId: 'shell-1',
          toolName: 'run_shell',
          permissionTier: 'execute',
          arguments: { command: 'echo hi' },
        }),
      );
    });
    await waitFor(() => screen.getByRole('dialog'));
    const footerBtn = screen.getByRole('button', { name: /Always allow this exact command/i });
    act(() => {
      footerBtn.click();
    });
    await waitFor(() =>
      expect(bridge.respond).toHaveBeenCalledWith({
        requestId: 'shell-1',
        decision: 'allow',
        scope: 'session',
      }),
    );

    bridge.respond.mockClear();
    act(() => {
      bridge.emit(
        makeRequest({
          requestId: 'shell-2',
          toolName: 'run_shell',
          permissionTier: 'execute',
          arguments: { command: 'echo hi' },
        }),
      );
    });
    await waitFor(() =>
      expect(bridge.respond).toHaveBeenCalledWith({
        requestId: 'shell-2',
        decision: 'allow',
        scope: 'session',
      }),
    );
  });
});
