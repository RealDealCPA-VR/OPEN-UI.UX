// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { PluginSearchPanel } from './PluginSearchPanel';

interface FakePluginsApi {
  getRegistryUrl: Mock;
  fetchRegistry: Mock;
  installFromRegistry: Mock;
  installFromPath: Mock;
}

const REGISTRY_URL = 'https://registry.example.com/plugins.json';
const INSTALL_URL = 'https://registry.example.com/plugins/acme-1.0.0.tgz';

function entry(): unknown {
  return {
    name: 'acme',
    version: '1.0.0',
    displayName: 'Acme',
    description: 'An example plugin.',
    installUrl: INSTALL_URL,
    permissions: [],
    signature: 'sig',
    signer: 'acme-inc',
  };
}

function setupFakeApi(overrides: Partial<FakePluginsApi> = {}): FakePluginsApi {
  const api: FakePluginsApi = {
    getRegistryUrl: vi.fn(async () => ({ url: REGISTRY_URL })),
    fetchRegistry: vi.fn(async () => ({ entries: [entry()], error: null })),
    installFromRegistry: vi.fn(async () => ({ ok: true, plugins: [] })),
    installFromPath: vi.fn(async () => ({ plugins: [] })),
    ...overrides,
  };
  (window as unknown as { opencodex: { plugins: FakePluginsApi } }).opencodex = {
    plugins: api,
  };
  return api;
}

describe('PluginSearchPanel', () => {
  beforeEach(() => {
    delete (window as unknown as { opencodex?: unknown }).opencodex;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('installs via the registry URL, never coercing it to a filesystem path', async () => {
    const api = setupFakeApi();
    render(<PluginSearchPanel />);

    const installBtn = await screen.findByRole('button', { name: 'Install' });
    await act(async () => {
      fireEvent.click(installBtn);
    });

    await waitFor(() => {
      expect(api.installFromRegistry).toHaveBeenCalledTimes(1);
    });
    expect(api.installFromRegistry).toHaveBeenCalledWith({ installUrl: INSTALL_URL });
    // The security fix: an https registry URL must never be handed to the
    // install-from-path flow, which treats its argument as a local directory.
    expect(api.installFromPath).not.toHaveBeenCalled();
  });

  it('surfaces a registry-not-configured notice instead of an install-by-path fallback', async () => {
    const api = setupFakeApi({
      getRegistryUrl: vi.fn(async () => ({ url: null })),
      fetchRegistry: vi.fn(async () => ({ entries: [], error: 'no registry URL configured' })),
    });
    render(<PluginSearchPanel />);

    await screen.findByText(/Registry not configured/i);
    expect(api.installFromPath).not.toHaveBeenCalled();
  });
});
