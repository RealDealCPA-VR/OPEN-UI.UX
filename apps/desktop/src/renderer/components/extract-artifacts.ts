export type ArtifactKind = 'html' | 'svg' | 'markdown';

export interface Artifact {
  kind: ArtifactKind;
  code: string;
  messageId: string;
  /** Index of the source fenced block within the message (for stable keys). */
  blockIndex: number;
}

export interface ArtifactSourceMessage {
  id: string;
  role: string;
  content: string;
}

// Fenced-code languages we can render live in a sandboxed panel without any
// transpilation or extra dependencies. (jsx/tsx/mermaid are intentionally
// excluded — they would need a bundler/renderer; they stay as normal code.)
const LANG_TO_KIND: Readonly<Record<string, ArtifactKind>> = {
  html: 'html',
  svg: 'svg',
  markdown: 'markdown',
  md: 'markdown',
};

// Higher wins when a single message contains several previewable blocks.
const KIND_PRIORITY: Readonly<Record<ArtifactKind, number>> = {
  html: 3,
  svg: 2,
  markdown: 1,
};

const FENCE_RE = /```([\w-]*)[ \t]*\n([\s\S]*?)```/g;

/** Extract every previewable fenced block from one message's text. */
export function extractArtifactsFromText(text: string, messageId: string): Artifact[] {
  const out: Artifact[] = [];
  let match: RegExpExecArray | null;
  let blockIndex = 0;
  FENCE_RE.lastIndex = 0;
  while ((match = FENCE_RE.exec(text)) !== null) {
    const lang = (match[1] ?? '').toLowerCase();
    const code = match[2] ?? '';
    const kind = LANG_TO_KIND[lang];
    if (kind && code.trim().length > 0) {
      out.push({ kind, code: code.replace(/\n$/, ''), messageId, blockIndex });
    }
    blockIndex += 1;
  }
  return out;
}

/**
 * Pick the artifact to preview: the highest-priority previewable block from the
 * most recent assistant message that contains one. Returns null when there is
 * nothing previewable.
 */
export function pickLatestArtifact(messages: readonly ArtifactSourceMessage[]): Artifact | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || msg.role !== 'assistant') continue;
    const found = extractArtifactsFromText(msg.content, msg.id);
    if (found.length === 0) continue;
    return found.reduce((best, cur) =>
      KIND_PRIORITY[cur.kind] > KIND_PRIORITY[best.kind] ? cur : best,
    );
  }
  return null;
}

export function artifactExtension(kind: ArtifactKind): string {
  switch (kind) {
    case 'html':
      return 'html';
    case 'svg':
      return 'svg';
    case 'markdown':
      return 'md';
  }
}

export function artifactLabel(kind: ArtifactKind): string {
  switch (kind) {
    case 'html':
      return 'HTML preview';
    case 'svg':
      return 'SVG preview';
    case 'markdown':
      return 'Markdown preview';
  }
}
