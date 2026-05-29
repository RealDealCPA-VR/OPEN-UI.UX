// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { OllamaStep } from './OllamaStep';
import type { OllamaInstallProgress, OllamaProbeResult } from '../../../shared/ollama';

interface BridgeOpts {
  probe?: OllamaProbeResult;
  installers?: Array<'homebrew' | 'winget' | 'script'>;
  installOk?: boolean;
  installRunningAfter?: OllamaProbeResult;
}

interface BridgeRefs {
  probe: Mock;
  install: Mock;
  listInstallableManagers: Mock;
  installProgressListenerRef: { fn: ((p: OllamaInstallProgress) => void) | null };
}

function setBridge(opts: BridgeOpts = {}): BridgeRefs {
  const listenerRef: { fn: ((p: OllamaInstallProgress) => void) | null } = { fn: null };
  let probeCallCount = 0;
  const probeImpl = async (): Promise<OllamaProbeResult> => {
    probeCallCount++;
    if (probeCallCount >= 2 && opts.installRunningAfter) return opts.installRunningAfter;
    return opts.probe ?? { running: false, models: [] };
  };
  const probe = vi.fn(probeImpl);
  const install = vi.fn(async () => ({
    ok: opts.installOk ?? true,
    exitCode: 0,
    durationMs: 100,
  }));
  const listInstallableManagers = vi.fn(async () => ({
    installers: opts.installers ?? [],
  }));
  const onInstallProgress = vi.fn((cb: (p: OllamaInstallProgress) => void) => {
    listenerRef.fn = cb;
    return () => {
      listenerRef.fn = null;
    };
  });

  window.opencodex = {
    ollama: {
      probe,
      install,
      listInstallableManagers,
      onInstallProgress,
    },
  } as unknown as Window['opencodex'];

  return { probe, install, listInstallableManagers, installProgressListenerRef: listenerRef };
}

describe('OllamaStep', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    // @ts-expect-error — opencodex is non-optional in production typings
    delete window.opencodex;
  });

  it('shows the running state and model list when probe succeeds', async () => {
    setBridge({
      probe: {
        running: true,
        models: [
          { id: 'llama3:8b', sizeGb: 4.7 },
          { id: 'qwen:7b', sizeGb: 4.1 },
        ],
      },
    });
    const onSkip = vi.fn();
    const onContinueCloud = vi.fn();
    const onAcceptLocalOnly = vi.fn();
    render(
      <OllamaStep
        onSkip={onSkip}
        onContinueCloud={onContinueCloud}
        onAcceptLocalOnly={onAcceptLocalOnly}
      />,
    );
    await waitFor(() => screen.getByTestId('ollama-running'));
    expect(screen.getByText('llama3:8b')).toBeTruthy();
    expect(screen.getByText('qwen:7b')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Use Ollama only/i })).toBeTruthy();
  });

  it('Use Ollama only calls onAcceptLocalOnly with selected model id', async () => {
    setBridge({
      probe: { running: true, models: [{ id: 'llama3:8b', sizeGb: 4.7 }] },
    });
    const onAcceptLocalOnly = vi.fn();
    render(
      <OllamaStep
        onSkip={vi.fn()}
        onContinueCloud={vi.fn()}
        onAcceptLocalOnly={onAcceptLocalOnly}
      />,
    );
    await waitFor(() => screen.getByTestId('ollama-running'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Use Ollama only/i }));
    });
    expect(onAcceptLocalOnly).toHaveBeenCalledWith('llama3:8b');
  });

  it('shows install options when probe reports not running', async () => {
    setBridge({
      probe: { running: false, models: [], error: 'ECONNREFUSED' },
      installers: ['homebrew', 'script'],
    });
    render(<OllamaStep onSkip={vi.fn()} onContinueCloud={vi.fn()} onAcceptLocalOnly={vi.fn()} />);
    await waitFor(() => screen.getByTestId('ollama-not-running'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Install Ollama/i })).toBeTruthy(),
    );
  });

  it('Install button invokes ollama.install with selected installer', async () => {
    const refs = setBridge({
      probe: { running: false, models: [] },
      installers: ['winget'],
      installOk: true,
      installRunningAfter: { running: true, models: [{ id: 'llama3:8b', sizeGb: 4.7 }] },
    });
    render(<OllamaStep onSkip={vi.fn()} onContinueCloud={vi.fn()} onAcceptLocalOnly={vi.fn()} />);
    await waitFor(() => screen.getByTestId('ollama-not-running'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Install Ollama/i })).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Install Ollama/i }));
    });
    await waitFor(() => expect(refs.install).toHaveBeenCalledWith({ installer: 'winget' }));
  });

  it('Skip calls onSkip', async () => {
    setBridge({ probe: { running: false, models: [] } });
    const onSkip = vi.fn();
    render(<OllamaStep onSkip={onSkip} onContinueCloud={vi.fn()} onAcceptLocalOnly={vi.fn()} />);
    await waitFor(() => screen.getByTestId('ollama-not-running'));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Skip — use cloud provider/i }));
    });
    expect(onSkip).toHaveBeenCalled();
  });

  it('continue-to-provider-setup calls onContinueCloud', async () => {
    setBridge({ probe: { running: false, models: [] } });
    const onContinueCloud = vi.fn();
    render(
      <OllamaStep onSkip={vi.fn()} onContinueCloud={onContinueCloud} onAcceptLocalOnly={vi.fn()} />,
    );
    await waitFor(() => screen.getByTestId('ollama-not-running'));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Continue to provider setup/i }));
    });
    expect(onContinueCloud).toHaveBeenCalled();
  });

  it('warns when probe finds Ollama but no models', async () => {
    setBridge({ probe: { running: true, models: [] } });
    render(<OllamaStep onSkip={vi.fn()} onContinueCloud={vi.fn()} onAcceptLocalOnly={vi.fn()} />);
    await waitFor(() => screen.getByText(/No models installed/i));
  });
});
