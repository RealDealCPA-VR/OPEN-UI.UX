// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ScheduledTaskEditorModalModule from './ScheduledTaskEditorModal';

function mockSelectedModel(): void {
  vi.doMock('../state/selected-model-context', () => ({
    useSelectedModel: () => ({
      selected: { providerId: 'openai', modelId: 'gpt-4o' },
      configuredProviders: [
        {
          info: {
            id: 'openai',
            displayName: 'OpenAI',
            models: [{ id: 'gpt-4o', displayName: 'gpt-4o', embeddings: false }],
          },
        },
      ],
    }),
  }));
}

function mockOpencodexBridge(): void {
  window.opencodex = {
    tools: { list: vi.fn(async () => []) },
    workspace: {
      get: vi.fn(async () => ({ active: '/tmp/ws' })),
      browse: vi.fn(async () => ({ active: '/tmp/ws' })),
    },
    agent: {
      listRunners: vi.fn(async () => []),
      checkRunnerInstalled: vi.fn(async () => ({ ok: true })),
      onRunnersChanged: vi.fn(() => () => {}),
    },
    scheduler: {
      getTriggerUrl: vi.fn(async () => ({ url: 'https://example.test/hook' })),
      createTask: vi.fn(),
      updateTask: vi.fn(),
    },
  } as unknown as Window['opencodex'];
}

async function importComponent(): Promise<
  typeof ScheduledTaskEditorModalModule.ScheduledTaskEditorModal
> {
  const mod = await import('./ScheduledTaskEditorModal');
  return mod.ScheduledTaskEditorModal;
}

describe('ScheduledTaskEditorModal', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSelectedModel();
    mockOpencodexBridge();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    // @ts-expect-error — window.opencodex is non-optional in production typings
    delete window.opencodex;
  });

  it('exposes an accessible name on the dialog via aria-labelledby', async () => {
    const ScheduledTaskEditorModal = await importComponent();
    render(<ScheduledTaskEditorModal task={null} onClose={() => {}} onSaved={() => {}} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-labelledby')).toBe('scheduled-task-editor-title');
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'New automation' })));
  });
});
