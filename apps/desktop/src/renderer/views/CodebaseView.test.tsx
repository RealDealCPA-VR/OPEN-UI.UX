// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../components/FileTree', () => ({
  FileTree: (): JSX.Element => <div data-testid="file-tree">file tree</div>,
}));

vi.mock('../components/CodebasePreviewPane', () => ({
  CodebasePreviewPane: (): JSX.Element => <div data-testid="preview-pane">preview</div>,
}));

vi.mock('../components/CodebaseSearchBox', () => ({
  CodebaseSearchBox: (): JSX.Element => <div data-testid="search-box">search</div>,
}));

vi.mock('../components/CodeGraph', () => ({
  CodeGraph: (): JSX.Element => <div data-testid="code-graph">graph</div>,
}));

vi.mock('../hooks/use-agent-pending-edits', () => ({
  useAgentPendingEdits: (): { entries: never[] } => ({ entries: [] }),
}));

import { CodebaseView } from './CodebaseView';

function installBridge(): void {
  const off = (): void => {};
  (window as unknown as { opencodex: unknown }).opencodex = {
    workspace: {
      get: () => Promise.resolve({ active: '/repo', history: [] }),
      onChanged: () => off,
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
  delete (window as unknown as { opencodex?: unknown }).opencodex;
});

describe('CodebaseView tabs', () => {
  it('defaults to the Tree tab', () => {
    installBridge();
    render(
      <MemoryRouter>
        <CodebaseView />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('file-tree')).toBeTruthy();
    expect(screen.queryByTestId('code-graph')).toBeNull();
  });

  it('switches to the Graph tab when clicked', async () => {
    installBridge();
    render(
      <MemoryRouter>
        <CodebaseView />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Graph' }));

    await waitFor(() => expect(screen.getByTestId('code-graph')).toBeTruthy());
    expect(screen.queryByTestId('file-tree')).toBeNull();
  });
});
