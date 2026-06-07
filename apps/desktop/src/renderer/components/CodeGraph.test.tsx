// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CodebaseGraphResponse } from '../../shared/codebase-search';

const tapHandlers: Array<(evt: { target: { data: () => unknown } }) => void> = [];
const destroy = vi.fn();

const cytoscapeMock = vi.fn(() => ({
  on: (
    _event: string,
    _selector: string,
    handler: (evt: { target: { data: () => unknown } }) => void,
  ) => {
    tapHandlers.push(handler);
  },
  destroy,
}));

vi.mock('cytoscape', () => ({ default: cytoscapeMock }));

import { CodeGraph } from './CodeGraph';

interface MockBridge {
  codebase: { graph: Mock };
}

function installBridge(graph: Mock): MockBridge {
  const bridge: MockBridge = { codebase: { graph } };
  (window as unknown as { opencodex: MockBridge }).opencodex = bridge;
  return bridge;
}

function smallGraph(): CodebaseGraphResponse {
  return {
    available: true,
    nodes: [
      {
        id: 'a.ts::alpha',
        label: 'alpha',
        file: 'a.ts',
        startLine: 3,
        community: 0,
        kind: 'function',
        language: 'typescript',
      },
      {
        id: 'a.ts::beta',
        label: 'beta',
        file: 'a.ts',
        startLine: 9,
        community: 1,
        kind: 'function',
        language: 'typescript',
      },
    ],
    edges: [{ source: 'a.ts::alpha', target: 'a.ts::beta', relation: 'calls' }],
  };
}

afterEach(() => {
  vi.clearAllMocks();
  tapHandlers.length = 0;
  delete (window as unknown as { opencodex?: unknown }).opencodex;
});

describe('CodeGraph', () => {
  it('calls the bridge and renders the canvas container', async () => {
    const graph = vi.fn((): Promise<CodebaseGraphResponse> => Promise.resolve(smallGraph()));
    installBridge(graph);

    render(<CodeGraph onSelect={vi.fn()} />);

    await waitFor(() => expect(graph).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('code-graph-canvas')).toBeTruthy();
    await waitFor(() => expect(cytoscapeMock).toHaveBeenCalledTimes(1));
  });

  it('wires node taps to onSelect with file + start line', async () => {
    const graph = vi.fn((): Promise<CodebaseGraphResponse> => Promise.resolve(smallGraph()));
    installBridge(graph);
    const onSelect = vi.fn();

    render(<CodeGraph onSelect={onSelect} />);

    await waitFor(() => expect(cytoscapeMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(tapHandlers.length).toBe(1));

    tapHandlers[0]?.({ target: { data: () => ({ file: 'a.ts', startLine: 3 }) } });
    expect(onSelect).toHaveBeenCalledWith('a.ts', 3);
  });

  it('shows the unavailable state when available is false and never builds cytoscape', async () => {
    const graph = vi.fn(
      (): Promise<CodebaseGraphResponse> =>
        Promise.resolve({ nodes: [], edges: [], available: false }),
    );
    installBridge(graph);

    render(<CodeGraph onSelect={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/No code graph for this workspace/)).toBeTruthy());
    expect(cytoscapeMock).not.toHaveBeenCalled();
  });

  it('shows the empty state when the graph has no nodes', async () => {
    const graph = vi.fn(
      (): Promise<CodebaseGraphResponse> =>
        Promise.resolve({ nodes: [], edges: [], available: true }),
    );
    installBridge(graph);

    render(<CodeGraph onSelect={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/The code graph is empty/)).toBeTruthy());
    expect(cytoscapeMock).not.toHaveBeenCalled();
  });
});
