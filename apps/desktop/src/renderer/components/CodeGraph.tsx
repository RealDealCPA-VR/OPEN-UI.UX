import { useEffect, useRef, useState } from 'react';
import type cytoscape from 'cytoscape';
import type { CodebaseGraphResponse } from '../../shared/codebase-search';
import { getBridge } from '../bridge';

interface CodeGraphProps {
  onSelect: (file: string, startLine: number | null) => void;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ready' };

const COMMUNITY_COLORS = [
  '#4f8cff',
  '#22c55e',
  '#f59e0b',
  '#ec4899',
  '#a855f7',
  '#06b6d4',
  '#ef4444',
  '#84cc16',
];

function colorForCommunity(community: number | null): string {
  if (community === null) return 'var(--text-muted)';
  const index =
    ((community % COMMUNITY_COLORS.length) + COMMUNITY_COLORS.length) % COMMUNITY_COLORS.length;
  return COMMUNITY_COLORS[index] ?? '#4f8cff';
}

function toElements(graph: CodebaseGraphResponse): cytoscape.ElementDefinition[] {
  const nodes: cytoscape.ElementDefinition[] = graph.nodes.map((n) => ({
    group: 'nodes',
    data: {
      id: n.id,
      label: n.label,
      file: n.file,
      startLine: n.startLine,
      color: colorForCommunity(n.community),
    },
  }));
  const edges: cytoscape.ElementDefinition[] = graph.edges.map((e, i) => ({
    group: 'edges',
    data: {
      id: `e${i}:${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      relation: e.relation,
    },
  }));
  return [...nodes, ...edges];
}

const STYLESHEET: cytoscape.StylesheetJson = [
  {
    selector: 'node',
    style: {
      'background-color': 'data(color)',
      label: 'data(label)',
      color: 'var(--text-secondary)',
      'font-size': 9,
      'text-valign': 'bottom',
      'text-halign': 'center',
      width: 14,
      height: 14,
    },
  },
  {
    selector: 'edge',
    style: {
      width: 1,
      'line-color': 'var(--border)',
      'target-arrow-color': 'var(--border)',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
    },
  },
  {
    selector: 'edge[relation = "calls"]',
    style: { 'line-color': '#4f8cff', 'target-arrow-color': '#4f8cff' },
  },
  {
    selector: 'edge[relation = "imports"]',
    style: { 'line-style': 'dashed', 'line-color': '#a855f7', 'target-arrow-color': '#a855f7' },
  },
];

const containerStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  width: '100%',
  background: 'var(--bg-base)',
};

const messageStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text-muted)',
  fontSize: 13,
  padding: 'var(--space-6)',
  textAlign: 'center',
};

export function CodeGraph({ onSelect }: CodeGraphProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    let cancelled = false;
    let instance: cytoscape.Core | null = null;

    async function run(): Promise<void> {
      const bridge = getBridge();
      if (!bridge) {
        setState({ status: 'unavailable' });
        return;
      }

      let graph: CodebaseGraphResponse;
      try {
        graph = await bridge.codebase.graph({});
      } catch (err) {
        if (cancelled) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
        return;
      }
      if (cancelled) return;

      if (!graph.available) {
        setState({ status: 'unavailable' });
        return;
      }
      if (graph.nodes.length === 0) {
        setState({ status: 'empty' });
        return;
      }

      const cytoscapeModule = (await import('cytoscape')).default;
      if (cancelled) return;
      const container = containerRef.current;
      if (!container) return;

      instance = cytoscapeModule({
        container,
        elements: toElements(graph),
        style: STYLESHEET,
        layout: { name: 'cose', animate: false },
      });

      instance.on('tap', 'node', (evt) => {
        const data = evt.target.data() as { file?: string; startLine?: number | null };
        if (typeof data.file === 'string') {
          onSelectRef.current(data.file, data.startLine ?? null);
        }
      });

      setState({ status: 'ready' });
    }

    void run();

    return () => {
      cancelled = true;
      if (instance) instance.destroy();
    };
  }, []);

  const message =
    state.status === 'loading'
      ? 'Loading code graph…'
      : state.status === 'unavailable'
        ? 'No code graph for this workspace. Index it with RAG enabled to build one.'
        : state.status === 'empty'
          ? 'The code graph is empty.'
          : state.status === 'error'
            ? `Failed to load code graph: ${state.message}`
            : null;

  return (
    <div
      className="code-graph"
      style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}
    >
      <div ref={containerRef} style={containerStyle} data-testid="code-graph-canvas" />
      {message !== null && (
        <div style={{ ...messageStyle, position: 'absolute', inset: 0 }}>{message}</div>
      )}
    </div>
  );
}
