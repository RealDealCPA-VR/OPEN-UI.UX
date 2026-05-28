// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type * as OnboardingWizardModule from './OnboardingWizard';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

interface MockProvider {
  info: {
    id: string;
    displayName: string;
    requiresApiKey: boolean;
    defaultBaseUrl: string;
    extraFields: never[];
    models: never[];
  };
  status: {
    hasApiKey: boolean;
    baseUrl: string | null;
    extra: Record<string, string>;
    lastTestedAt: string | null;
    lastTestResult: unknown;
  };
}

function makeProvider(id: string, displayName: string): MockProvider {
  return {
    info: {
      id,
      displayName,
      requiresApiKey: true,
      defaultBaseUrl: 'https://example.test',
      extraFields: [],
      models: [],
    },
    status: {
      hasApiKey: false,
      baseUrl: null,
      extra: {},
      lastTestedAt: null,
      lastTestResult: null,
    },
  };
}

function mockSelectedModel(providers: MockProvider[]): void {
  vi.doMock('../state/selected-model-context', () => ({
    useSelectedModel: () => ({
      providers,
      configuredProviders: providers.filter((p) => p.status.hasApiKey),
      selected: null,
      loading: false,
      reload: vi.fn(),
    }),
  }));
}

function mockBridge(opts: {
  complete?: boolean;
  testResult?: { ok: boolean; message?: string; httpStatus?: number };
  saveThrows?: boolean;
}): {
  save: Mock;
  test: Mock;
  setComplete: Mock;
} {
  const save = vi.fn(async () => undefined);
  const test = vi.fn(async () => opts.testResult ?? { ok: true });
  const setComplete = vi.fn(async () => undefined);
  if (opts.saveThrows) {
    save.mockRejectedValueOnce(new Error('save blew up'));
  }
  window.opencodex = {
    onboarding: {
      getState: vi.fn(async () => ({ complete: opts.complete ?? false })),
      setComplete,
    },
    workspace: {
      get: vi.fn(async () => ({ active: null, history: [] })),
      onChanged: vi.fn(() => () => {}),
      browse: vi.fn(async () => ({ active: '/tmp/ws', history: ['/tmp/ws'] })),
    },
    providers: {
      save,
      test,
    },
    skills: {
      installStarterPack: vi.fn(async () => undefined),
    },
  } as unknown as Window['opencodex'];
  return { save, test, setComplete };
}

async function importComponent(): Promise<typeof OnboardingWizardModule.OnboardingWizard> {
  const mod = await import('./OnboardingWizard');
  return mod.OnboardingWizard;
}

function renderWizard(Component: typeof OnboardingWizardModule.OnboardingWizard) {
  return render(
    <MemoryRouter>
      <Component />
    </MemoryRouter>,
  );
}

describe('OnboardingWizard', () => {
  beforeEach(() => {
    mockSelectedModel([makeProvider('openai', 'OpenAI'), makeProvider('anthropic', 'Anthropic')]);
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    // @ts-expect-error — window.opencodex is non-optional in production typings
    delete window.opencodex;
  });

  it('mounts on the provider step when onboarding is incomplete', async () => {
    mockBridge({ complete: false });
    const Wizard = await importComponent();
    renderWizard(Wizard);
    await waitFor(() => expect(screen.getByText(/Pick a provider/i)).toBeTruthy());
  });

  it('closes (unmounts the dialog) on Escape and marks onboarding incomplete', async () => {
    const { setComplete } = mockBridge({ complete: false });
    const Wizard = await importComponent();
    renderWizard(Wizard);
    const dialog = await waitFor(() => screen.getByRole('dialog'));
    act(() => {
      fireEvent.keyDown(dialog, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(setComplete).toHaveBeenCalledWith(false);
  });

  it('advances to api-key step on Enter when a provider is chosen', async () => {
    mockBridge({ complete: false });
    const Wizard = await importComponent();
    renderWizard(Wizard);
    await waitFor(() => screen.getByText(/Pick a provider/i));
    const radio = screen.getByRole('radio', { name: /OpenAI/i }) as HTMLInputElement;
    act(() => {
      fireEvent.click(radio);
    });
    act(() => {
      fireEvent.keyDown(radio, { key: 'Enter' });
    });
    await waitFor(() => expect(screen.getByText(/Add your OpenAI API key/i)).toBeTruthy());
  });

  it('renders the inline provider error when test-connection returns ok=false', async () => {
    mockBridge({
      complete: false,
      testResult: { ok: false, message: 'invalid api key', httpStatus: 401 },
    });
    const Wizard = await importComponent();
    renderWizard(Wizard);
    await waitFor(() => screen.getByText(/Pick a provider/i));
    const radio = screen.getByRole('radio', { name: /OpenAI/i }) as HTMLInputElement;
    act(() => {
      fireEvent.click(radio);
    });
    fireEvent.click(screen.getByRole('button', { name: /^Next$/ }));
    await waitFor(() => screen.getByText(/Add your OpenAI API key/i));
    const input = screen.getByPlaceholderText('sk-…') as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: 'sk-bad' } });
    });
    fireEvent.click(screen.getByRole('button', { name: /Save & continue/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(
        /rejected the key.*HTTP 401.*invalid api key/i,
      );
    });
  });

  it('includes the prefers-reduced-motion CSS rule that disables the success check animation', async () => {
    mockBridge({ complete: false });
    const Wizard = await importComponent();
    const { container } = renderWizard(Wizard);
    await waitFor(() => screen.getByRole('dialog'));
    const style = container.querySelector('style');
    expect(style).not.toBeNull();
    const css = style?.textContent ?? '';
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/onboarding-success-check\s*\{\s*animation:\s*none/);
  });
});
