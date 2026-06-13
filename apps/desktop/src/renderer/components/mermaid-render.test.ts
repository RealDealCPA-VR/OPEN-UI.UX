import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mermaidThemeForApp, renderMermaidToSvg } from './mermaid-render';

const { initialize, render } = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock('mermaid', () => ({ default: { initialize, render } }));

describe('mermaidThemeForApp', () => {
  it('maps the app theme to a mermaid theme', () => {
    expect(mermaidThemeForApp('dark')).toBe('dark');
    expect(mermaidThemeForApp('light')).toBe('default');
  });
});

describe('renderMermaidToSvg', () => {
  beforeEach(() => {
    initialize.mockReset();
    render.mockReset();
  });

  it('returns the rendered svg on success', async () => {
    render.mockResolvedValue({ svg: '<svg>diagram</svg>' });
    const result = await renderMermaidToSvg('graph TD;\nA-->B;', 'default');
    expect(result).toEqual({ ok: true, svg: '<svg>diagram</svg>' });
    expect(render).toHaveBeenCalledWith(
      expect.stringMatching(/^opencodex-mermaid-\d+$/),
      'graph TD;\nA-->B;',
    );
  });

  it('initializes mermaid with the strict security level and requested theme', async () => {
    render.mockResolvedValue({ svg: '<svg/>' });
    await renderMermaidToSvg('graph TD;', 'dark');
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' }),
    );
  });

  it('returns an error result when the diagram source is invalid', async () => {
    render.mockRejectedValue(new Error('Parse error on line 2'));
    const result = await renderMermaidToSvg('not a diagram', 'default');
    expect(result).toEqual({ ok: false, error: 'Parse error on line 2' });
  });

  it('stringifies non-Error throws', async () => {
    render.mockRejectedValue('boom');
    const result = await renderMermaidToSvg('graph TD;', 'default');
    expect(result).toEqual({ ok: false, error: 'boom' });
  });

  it('uses a fresh element id per render', async () => {
    render.mockResolvedValue({ svg: '<svg/>' });
    await renderMermaidToSvg('graph TD;', 'default');
    await renderMermaidToSvg('graph TD;', 'default');
    const ids = render.mock.calls.map((call) => call[0] as string);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
