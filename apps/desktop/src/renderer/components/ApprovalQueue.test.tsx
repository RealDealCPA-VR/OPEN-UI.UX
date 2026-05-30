// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ApprovalQueue } from './ApprovalQueue';
import type { ApprovalRequest } from '../../shared/approvals';

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
