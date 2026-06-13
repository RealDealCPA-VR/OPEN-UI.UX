// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../state/chat-context', () => ({
  useChat: () => ({
    streaming: true,
    draft: {
      messageId: 'a1',
      text: 'partial',
      blocks: [{ type: 'tool_use', id: 't1', name: 'read_file', arguments: '{}' }],
      done: false,
      error: null,
      inputTokens: 1200,
      outputTokens: 300,
      cachedInputTokens: 100,
      costUsd: 0.01,
    },
    usage: null,
    error: null,
  }),
}));

vi.mock('../state/selected-model-context', () => ({
  useSelectedModel: () => ({
    selectedCapabilities: { displayName: 'GPT-4o', toolUse: true, contextWindow: 128000 },
  }),
}));

vi.mock('./BudgetSpendIndicator', () => ({ BudgetSpendIndicator: () => null }));

import { StatusBar } from './StatusBar';

beforeEach(() => {
  window.localStorage.clear();
  const off = (): void => {};
  (window as unknown as { opencodex: unknown }).opencodex = {
    workspace: {
      get: () => Promise.resolve({ active: '/repo' }),
      onChanged: () => off,
    },
    shell: { showItemInFolder: () => Promise.resolve() },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as unknown as { opencodex?: unknown }).opencodex;
});

describe('StatusBar aria-live scoping', () => {
  it('scopes the live region to the coarse state label only', () => {
    const { container } = render(<StatusBar />);
    const footer = container.querySelector('footer');
    expect(footer?.getAttribute('aria-live')).toBeNull();
    expect(footer?.getAttribute('role')).toBeNull();

    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Streaming…');
    expect(status.getAttribute('aria-live')).toBe('polite');
  });

  it('hides the per-delta tool, token, and cache spans from assistive tech', () => {
    const { container } = render(<StatusBar />);
    const tool = container.querySelector('.statusbar-tool');
    expect(tool?.getAttribute('aria-hidden')).toBe('true');
    const tokens = container.querySelector('.statusbar-tokens');
    expect(tokens?.getAttribute('aria-hidden')).toBe('true');
    const cache = container.querySelector('.statusbar-cache');
    expect(cache?.getAttribute('aria-hidden')).toBe('true');
  });
});
