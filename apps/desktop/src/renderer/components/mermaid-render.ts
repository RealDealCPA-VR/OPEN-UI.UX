import type { EffectiveTheme } from '../../shared/theme';

export type MermaidTheme = 'default' | 'dark';

export type MermaidRenderResult = { ok: true; svg: string } | { ok: false; error: string };

export function mermaidThemeForApp(effective: EffectiveTheme): MermaidTheme {
  return effective === 'dark' ? 'dark' : 'default';
}

// Monotonic id: mermaid.render mounts a temporary element under this id, and
// reusing an id across renders can collide with a still-mounted error element.
let renderSeq = 0;

export async function renderMermaidToSvg(
  code: string,
  theme: MermaidTheme,
): Promise<MermaidRenderResult> {
  try {
    // Dynamic import keeps mermaid (multi-MB) out of the initial renderer bundle.
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme });
    renderSeq += 1;
    const { svg } = await mermaid.render(`opencodex-mermaid-${renderSeq}`, code);
    return { ok: true, svg };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
