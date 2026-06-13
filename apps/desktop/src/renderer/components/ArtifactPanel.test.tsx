import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactPanel } from './ArtifactPanel';
import type { Artifact } from './extract-artifacts';
import type * as MermaidRenderModule from './mermaid-render';

const { renderMermaidToSvg } = vi.hoisted(() => ({
  renderMermaidToSvg: vi.fn(),
}));

vi.mock('./mermaid-render', async (importOriginal) => {
  const actual = await importOriginal<typeof MermaidRenderModule>();
  return { ...actual, renderMermaidToSvg };
});

function artifact(kind: Artifact['kind'], code: string): Artifact {
  return { kind, code, messageId: 'm1', blockIndex: 0 };
}

function queryFrame(container: HTMLElement): HTMLIFrameElement | null {
  return container.querySelector('iframe');
}

afterEach(() => {
  renderMermaidToSvg.mockReset();
  document.documentElement.removeAttribute('data-theme');
});

describe('ArtifactPanel', () => {
  it('renders svg artifacts in a fully sandboxed iframe (no scripts)', () => {
    const { container } = render(
      <ArtifactPanel artifact={artifact('svg', '<svg><circle r="4"/></svg>')} onClose={() => {}} />,
    );
    const frame = queryFrame(container);
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('sandbox')).toBe('');
    expect(frame?.getAttribute('srcdoc') ?? '').toContain('<svg><circle r="4"/></svg>');
  });

  it('routes rendered mermaid svg through the same sandboxed srcdoc path as svg artifacts', async () => {
    renderMermaidToSvg.mockResolvedValue({ ok: true, svg: '<svg data-diagram="1"></svg>' });
    const { container } = render(
      <ArtifactPanel artifact={artifact('mermaid', 'graph TD;\nA-->B;')} onClose={() => {}} />,
    );
    await waitFor(() => {
      expect(queryFrame(container)).not.toBeNull();
    });
    const frame = queryFrame(container);
    expect(frame?.getAttribute('sandbox')).toBe('');
    const srcDoc = frame?.getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain('<svg data-diagram="1"></svg>');
    expect(srcDoc).toContain('<!doctype html>');
  });

  it('shows a readable error state when the mermaid source is invalid', async () => {
    renderMermaidToSvg.mockResolvedValue({ ok: false, error: 'Parse error on line 2' });
    const { container } = render(
      <ArtifactPanel artifact={artifact('mermaid', 'not a diagram')} onClose={() => {}} />,
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent ?? '').toContain('Could not render Mermaid diagram');
    expect(alert.textContent ?? '').toContain('Parse error on line 2');
    expect(queryFrame(container)).toBeNull();
  });

  it('passes the app theme through to the mermaid renderer', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    renderMermaidToSvg.mockResolvedValue({ ok: true, svg: '<svg/>' });
    render(<ArtifactPanel artifact={artifact('mermaid', 'graph TD;')} onClose={() => {}} />);
    await waitFor(() => {
      expect(renderMermaidToSvg).toHaveBeenCalledWith('graph TD;', 'dark');
    });
  });

  it('keeps allow-scripts only for html artifacts', () => {
    const { container } = render(
      <ArtifactPanel artifact={artifact('html', '<b>hi</b>')} onClose={() => {}} />,
    );
    expect(queryFrame(container)?.getAttribute('sandbox')).toBe('allow-scripts');
  });
});
